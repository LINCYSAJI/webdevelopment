import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { OtpChannel, OtpState } from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { Otp, type OtpPurpose } from '../models/Otp';
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

/** Whether a usable code exists and when Resend becomes available. */
export async function otpState(subject: OtpSubject): Promise<Omit<OtpState, 'verified'>> {
  const settings = await getSettings();
  const latest = await Otp.findOne(subject).sort({ createdAt: -1 });
  const active = await Otp.findOne(activeFilter(subject)).sort({ createdAt: -1 });
  const resendAt = latest ? new Date(latest.createdAt.getTime() + settings.otpResendCooldownSeconds * 1000) : null;
  return {
    active: !!active,
    expiresAt: active?.expiresAt.toISOString() ?? null,
    resendAvailableAt: resendAt && resendAt.getTime() > Date.now() ? resendAt.toISOString() : null,
  };
}

/**
 * Sends a new 6-digit code, replacing any earlier one. Enforces the resend cooldown and the
 * hourly limit from Settings.
 */
export async function issueOtp(subject: OtpSubject, target: string, emailPurpose: 'registration' | 'change_email' = 'registration') {
  const settings = await getSettings();
  const now = Date.now();

  const latest = await Otp.findOne(subject).sort({ createdAt: -1 });
  if (latest) {
    const wait = Math.ceil((latest.createdAt.getTime() + settings.otpResendCooldownSeconds * 1000 - now) / 1000);
    if (wait > 0) throw new AppError(429, `Please wait ${wait} seconds before requesting a new code.`, 'otp_cooldown');
  }
  const lastHour = await Otp.countDocuments({ ...subject, createdAt: { $gt: new Date(now - 3600_000) } });
  if (lastHour >= MAX_CODES_PER_HOUR) {
    throw new AppError(429, 'You have requested too many codes. Please try again in about an hour.', 'otp_limit');
  }

  // Only the newest code works.
  await Otp.updateMany(activeFilter(subject), { $set: { invalidatedAt: new Date() } });

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const expiresAt = new Date(now + settings.otpExpiryMinutes * 60_000);
  await Otp.create({ ...subject, target, codeHash: hashCode(subject, code), expiresAt, deleteAt: new Date(expiresAt.getTime() + 86_400_000) });

  const sent =
    subject.channel === 'email'
      ? await sendEmail({ to: target, event: `${subject.purpose}_otp`, ...(await otpEmail(code, settings.otpExpiryMinutes, emailPurpose)) })
      : await sendSms({
          to: target,
          event: `${subject.purpose}_otp`,
          text: `${code} is your ${settings.organisationName} verification code. It is valid for ${settings.otpExpiryMinutes} minutes. Do not share it with anyone.`,
        });
  if (!sent) {
    throw new AppError(502, `We could not send the code by ${subject.channel === 'email' ? 'email' : 'SMS'}. Please try again shortly.`, 'otp_send_failed');
  }
  return otpState(subject);
}

/**
 * Checks a code. Wrong codes count towards the limit from Settings (default 5), after which the
 * code stops working and a new one must be requested. Returns the address the code was sent to.
 */
export async function verifyOtp(subject: OtpSubject, code: string): Promise<string> {
  const settings = await getSettings();
  const otp = await Otp.findOne(activeFilter(subject)).sort({ createdAt: -1 });
  if (!otp) throw new AppError(400, 'This code has expired or is no longer valid. Please request a new code.', 'otp_expired');

  const expected = Buffer.from(otp.codeHash, 'hex');
  const given = Buffer.from(hashCode(subject, code), 'hex');
  if (timingSafeEqual(expected, given)) {
    // Conditional update: the same code can never be used twice.
    const used = await Otp.findOneAndUpdate({ _id: otp._id, verifiedAt: null, invalidatedAt: null }, { $set: { verifiedAt: new Date() } });
    if (!used) throw new AppError(400, 'This code has already been used. Please request a new code.', 'otp_expired');
    return otp.target;
  }

  const updated = await Otp.findOneAndUpdate({ _id: otp._id, invalidatedAt: null }, { $inc: { attempts: 1 } }, { new: true });
  const attempts = updated?.attempts ?? settings.otpMaxAttempts;
  if (attempts >= settings.otpMaxAttempts) {
    await Otp.updateOne({ _id: otp._id }, { $set: { invalidatedAt: new Date() } });
    throw new AppError(400, 'Too many incorrect attempts. This code no longer works; please request a new code.', 'otp_locked');
  }
  const left = settings.otpMaxAttempts - attempts;
  throw new AppError(400, `Incorrect code. You have ${left} attempt${left === 1 ? '' : 's'} left.`, 'otp_incorrect');
}
