import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { OtpChannel, OtpState } from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { duplicateKeyField } from '../lib/mongo-errors';
import { Otp, type OtpPurpose } from '../models/Otp';
import { OtpThrottle } from '../models/OtpThrottle';
import { getSettings } from '../models/Settings';
import { sendEmail } from './email.service';
import { otpEmail } from './email-templates';
import { sendSms } from './sms.service';

/** At most this many codes per hour for one person and channel: the first plus 5 resends (PRD 10.3). */
const MAX_CODES_PER_HOUR = 6;

interface OtpSubject {
  purpose: OtpPurpose;
  channel: OtpChannel;
  /** "reg:<registrationId>" or "user:<userId>". */
  subjectKey: string;
}

// Keyed hash: a leaked database copy alone is not enough to work out the codes.
const hashCode = (subject: OtpSubject, code: string) =>
  createHmac('sha256', config.JWT_ACCESS_SECRET).update(`${subject.subjectKey}|${subject.purpose}|${subject.channel}|${code}`).digest('hex');

const activeFilter = (subject: OtpSubject) => ({
  ...subject,
  verifiedAt: null,
  invalidatedAt: null,
  expiresAt: { $gt: new Date() },
});

const throttleKey = (subject: OtpSubject) => `${subject.subjectKey}|${subject.purpose}|${subject.channel}`;

/** Whether a usable code exists and when Resend becomes available. */
export async function otpState(subject: OtpSubject): Promise<Omit<OtpState, 'verified'>> {
  const settings = await getSettings();
  const [throttle, active] = await Promise.all([
    OtpThrottle.findById(throttleKey(subject)),
    Otp.findOne(activeFilter(subject)).sort({ createdAt: -1 }),
  ]);
  const resendAt = throttle ? new Date(throttle.lastSentAt.getTime() + settings.otpResendCooldownSeconds * 1000) : null;
  return {
    active: !!active,
    expiresAt: active?.expiresAt.toISOString() ?? null,
    resendAvailableAt: resendAt && resendAt.getTime() > Date.now() ? resendAt.toISOString() : null,
  };
}

/**
 * Reserves one send for this person + channel in a single atomic step. Fails if the resend
 * cooldown has not passed (parallel clicks included) or the hourly limit is used up.
 */
async function reserveSend(subject: OtpSubject, now: Date, cooldownMs: number) {
  const key = throttleKey(subject);
  const hourAgo = new Date(now.getTime() - 3600_000);
  const inWindow = { $gt: ['$windowStart', hourAgo] };
  let slot: { count?: number } | null;
  try {
    slot = (await OtpThrottle.collection.findOneAndUpdate(
      { _id: key as never, lastSentAt: { $lte: new Date(now.getTime() - cooldownMs) } },
      [
        {
          $set: {
            lastSentAt: now,
            windowStart: { $cond: [inWindow, '$windowStart', now] },
            count: { $cond: [inWindow, { $add: ['$count', 1] }, 1] },
          },
        },
      ],
      // No matching row: a new one is created; if a row exists but is still cooling down,
      // creating it again fails with a duplicate key, which means "wait".
      { upsert: true, returnDocument: 'after' },
    )) as { count?: number } | null;
  } catch (err) {
    if (!duplicateKeyField(err)) throw err;
    const row = await OtpThrottle.findById(key);
    const wait = row ? Math.max(1, Math.ceil((row.lastSentAt.getTime() + cooldownMs - now.getTime()) / 1000)) : 1;
    throw new AppError(429, `Please wait ${wait} seconds before requesting a new code.`, 'otp_cooldown');
  }
  if (!slot || (slot.count ?? 0) > MAX_CODES_PER_HOUR) {
    throw new AppError(429, 'You have requested too many codes. Please try again in about an hour.', 'otp_limit');
  }
  return key;
}

/**
 * Sends a new 6-digit code. The earlier code keeps working until the new one has actually been
 * sent; if sending fails, the cooldown and hourly allowance are given back.
 */
export async function issueOtp(subject: OtpSubject, target: string, emailPurpose: 'registration' | 'change_email' = 'registration') {
  const settings = await getSettings();
  const now = new Date();
  const cooldownMs = settings.otpResendCooldownSeconds * 1000;
  const key = await reserveSend(subject, now, cooldownMs);

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expiresAt = new Date(now.getTime() + settings.otpExpiryMinutes * 60_000);
  const otp = await Otp.create({ ...subject, target, codeHash: hashCode(subject, code), expiresAt, deleteAt: new Date(expiresAt.getTime() + 86_400_000) });

  const sent =
    subject.channel === 'email'
      ? await sendEmail({ to: target, event: `${subject.purpose}_otp`, ...(await otpEmail(code, settings.otpExpiryMinutes, emailPurpose)) })
      : await sendSms({
          to: target,
          event: `${subject.purpose}_otp`,
          text: `${code} is your ${settings.organisationName} verification code. It is valid for ${settings.otpExpiryMinutes} minutes. Do not share it with anyone.`,
        });

  if (!sent) {
    // The undelivered code is cancelled; the previous code (if any) still works.
    await Otp.updateOne({ _id: otp._id }, { $set: { invalidatedAt: new Date() } });
    await OtpThrottle.updateOne(
      { _id: key, lastSentAt: now },
      { $set: { lastSentAt: new Date(now.getTime() - cooldownMs - 1000) }, $inc: { count: -1 } },
    );
    throw new AppError(502, `We could not send the code by ${subject.channel === 'email' ? 'email' : 'SMS'}. Please try again shortly.`, 'otp_send_failed');
  }

  // Delivered: from now on only the newest code works.
  await Otp.updateMany({ ...activeFilter(subject), _id: { $ne: otp._id } }, { $set: { invalidatedAt: new Date() } });
  return otpState(subject);
}

/**
 * Checks a code. Wrong codes count towards the limit from Settings (default 5), after which the
 * code stops working and a new one must be requested. Returns the address the code was sent to.
 */
export async function verifyOtp(subject: OtpSubject, code: string): Promise<string> {
  const settings = await getSettings();
  // Count the attempt BEFORE checking the code, in one atomic step, so many guesses sent at
  // the same moment cannot get past the limit: once the limit is used up, no guess is checked.
  const otp = await Otp.findOneAndUpdate(
    { ...activeFilter(subject), attempts: { $lt: settings.otpMaxAttempts } },
    { $inc: { attempts: 1 } },
    { sort: { createdAt: -1 }, new: true },
  );
  if (!otp) throw new AppError(400, 'This code has expired or is no longer valid. Please request a new code.', 'otp_expired');

  const expected = Buffer.from(otp.codeHash, 'hex');
  const given = Buffer.from(hashCode(subject, code), 'hex');
  if (timingSafeEqual(expected, given)) {
    // Conditional update: the same code can never be used twice.
    const used = await Otp.findOneAndUpdate({ _id: otp._id, verifiedAt: null, invalidatedAt: null }, { $set: { verifiedAt: new Date() } });
    if (!used) throw new AppError(400, 'This code has already been used. Please request a new code.', 'otp_expired');
    return otp.target;
  }

  const attempts = otp.attempts;
  if (attempts >= settings.otpMaxAttempts) {
    await Otp.updateOne({ _id: otp._id }, { $set: { invalidatedAt: new Date() } });
    throw new AppError(400, 'Too many incorrect attempts. This code no longer works; please request a new code.', 'otp_locked');
  }
  const left = settings.otpMaxAttempts - attempts;
  throw new AppError(400, `Incorrect code. You have ${left} attempt${left === 1 ? '' : 's'} left.`, 'otp_incorrect');
}
