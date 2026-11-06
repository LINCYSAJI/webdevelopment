import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { maskEmail, maskMobile, type OtpChannel, type RegistrationCompleted, type VerificationStatus } from '@fap/shared';
import { config } from '../config';
import { nextSequence } from '../lib/counters';
import { AppError } from '../lib/errors';
import { duplicateKeyField } from '../lib/mongo-errors';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { Registration, type RegistrationDocument } from '../models/Registration';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { getSettings } from '../models/Settings';
import { User, type UserDocument } from '../models/User';
import { audit } from './audit.service';
import { hashPassword, issueTokens, type ClientInfo } from './auth.service';
import { notifyApplicantBySms } from './sms.service';
import { sendEmail } from './email.service';
import {
  applicationSubmittedEmail,
  newApplicationForAccountsEmail,
  newRegistrationAdminEmail,
} from './email-templates';
import { issueOtp, otpState, verifyOtp } from './otp.service';
import { findPossibleDuplicates, notifyAdminsOfDuplicate } from './registration.service';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** The registration waiting for this browser's verification, or a clear error. */
async function findPending(token: string): Promise<RegistrationDocument> {
  const reg = await Registration.findOne({ 'verification.tokenHash': tokenHash(token) });
  if (!reg) throw new AppError(404, 'This verification session is no longer valid. If you already verified, please log in; otherwise register again.', 'verification_not_found');
  if (reg.status !== 'pending_verification') throw new AppError(409, 'This registration is already verified. Please log in.', 'already_verified');
  if (!reg.verification?.expiresAt || reg.verification.expiresAt.getTime() < Date.now()) {
    throw new AppError(410, 'This registration has expired because it was not verified in time. Please register again.', 'verification_expired');
  }
  return reg;
}

const subject = (reg: RegistrationDocument, channel: OtpChannel) => ({ purpose: 'registration' as const, channel, subjectKey: `reg:${reg._id.toString()}` });
const isVerified = (reg: RegistrationDocument, channel: OtpChannel) =>
  !!(channel === 'email' ? reg.verification?.emailVerifiedAt : reg.verification?.mobileVerifiedAt);

/** Builds the page status from an already-loaded registration; both channels are read in parallel. */
async function buildStatus(reg: RegistrationDocument): Promise<VerificationStatus> {
  const settings = await getSettings();
  const state = async (channel: OtpChannel) => ({ verified: isVerified(reg, channel), ...(await otpState(subject(reg, channel), settings)) });
  const [email, sms] = await Promise.all([state('email'), state('sms')]);
  return {
    maskedEmail: maskEmail(reg.signatory!.email),
    maskedMobile: maskMobile(reg.signatory!.mobile),
    email,
    sms,
    otpExpiryMinutes: settings.otpExpiryMinutes,
  };
}

export async function getStatus(token: string): Promise<VerificationStatus> {
  return buildStatus(await findPending(token));
}

export async function sendCode(token: string, channel: OtpChannel) {
  const reg = await findPending(token);
  if (isVerified(reg, channel)) throw new AppError(409, `Your ${channel === 'email' ? 'email' : 'mobile'} is already verified.`, 'already_verified_channel');
  await issueOtp(subject(reg, channel), channel === 'email' ? reg.signatory!.email : reg.signatory!.mobile);
  return buildStatus(reg);
}

export async function verifyCode(token: string, channel: OtpChannel, code: string, ip?: string) {
  const reg = await findPending(token);
  if (!isVerified(reg, channel)) {
    await verifyOtp(subject(reg, channel), code);
    const field = channel === 'email' ? 'verification.emailVerifiedAt' : 'verification.mobileVerifiedAt';
    const now = new Date();
    await Registration.updateOne({ _id: reg._id, status: 'pending_verification' }, { $set: { [field]: now } });
    await audit({ action: channel === 'email' ? 'registration_email_verified' : 'registration_mobile_verified', targetType: 'registration', targetId: reg._id.toString(), ip });
    // Reflect the change on the copy already in memory instead of loading it again.
    reg.set(field, now);
  }
  return buildStatus(reg);
}

/** "APP-2026-0001": numbered per calendar year (IST) when verification completes (PRD A11). */
async function nextApplicationId(session: mongoose.ClientSession) {
  const year = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date());
  const seq = await nextSequence(`application_${year}`, session);
  return `APP-${year}-${String(seq).padStart(4, '0')}`;
}

function duplicateKeyError(err: unknown): AppError | null {
  const key = duplicateKeyField(err);
  if (!key) return null;
  if (key === 'panLock') return new AppError(409, 'A franchise registration with this PAN already exists. Please contact us if you believe this is an error.', 'duplicate_pan');
  if (key === 'gstLock') return new AppError(409, 'A franchise registration with this GST number already exists. Please contact us if you believe this is an error.', 'duplicate_gst');
  if (key === 'email' || key === 'mobile') return new AppError(409, `An account already exists with this ${key}. Please log in instead.`, 'account_exists');
  return new AppError(409, 'This registration could not be completed. Please try again.', 'conflict');
}

/**
 * P4: both codes verified + password set. Creates the Franchise User account and moves the
 * application to Pending Accounts, all in one transaction (PRD 6.2), then logs the user in.
 */
export async function completeRegistration(token: string, password: string, client: ClientInfo) {
  const reg = await findPending(token);
  if (!isVerified(reg, 'email') || !isVerified(reg, 'sms')) {
    throw new AppError(400, 'Please verify both your email and your mobile number first.', 'not_verified');
  }
  const s = reg.signatory!;
  if (await User.exists({ $or: [{ email: s.email }, { mobile: s.mobile }] })) {
    throw new AppError(409, 'An account already exists with this email or mobile number. Please log in instead.', 'account_exists');
  }

  // Others may have been verified since Register was pressed, so look for duplicates again.
  const matches = await findPossibleDuplicates({ signatory: s, contacts: reg.contacts }, reg._id);
  const passwordHash = await hashPassword(password);
  const now = new Date();
  let applicationId = '';
  let user: UserDocument | null = null;
  let flagged = false;

  try {
    await mongoose.connection.transaction(async (session) => {
      applicationId = await nextApplicationId(session);
      [user] = await User.create([{ name: s.name, email: s.email, mobile: s.mobile, role: 'franchise_user', passwordHash, lastLoginAt: now }], { session });

      const openFlag = await DuplicateFlag.exists({ registrationId: reg._id, status: 'open' }).session(session);
      if (matches.length && !openFlag) {
        await DuplicateFlag.create([{ registrationId: reg._id, submissionVersion: reg.currentSubmissionVersion, matches, status: 'open' }], { session });
      }
      flagged = matches.length > 0 || !!openFlag;

      const updated = await Registration.findOneAndUpdate(
        { _id: reg._id, status: 'pending_verification', 'verification.tokenHash': reg.verification!.tokenHash },
        {
          $set: {
            status: 'pending_accounts',
            applicationId,
            userId: user!._id,
            panLock: reg.pan,
            ...(reg.gst ? { gstLock: reg.gst } : {}),
            hasOpenDuplicateFlag: flagged,
            stageEnteredAt: now,
          },
          $unset: { 'verification.tokenHash': '' },
        },
        { session, new: true },
      );
      if (!updated) throw new AppError(409, 'This registration is already verified. Please log in.', 'already_verified');

      await RegistrationHistory.create(
        [{ registrationId: reg._id, at: now, event: 'submitted', actorId: user!._id, actorRole: 'franchise_user', fromStatus: 'pending_verification', toStatus: 'pending_accounts', submissionVersion: reg.currentSubmissionVersion }],
        { session },
      );

      // Audit entries are part of the same all-or-nothing save.
      const userId = user!._id;
      await audit({ action: 'registration_verified', userId, role: 'franchise_user', targetType: 'registration', targetId: reg._id.toString(), details: { applicationId, duplicateFlag: flagged }, ip: client.ip }, session);
      await audit({ action: 'franchise_account_created', userId, role: 'franchise_user', targetType: 'user', targetId: userId.toString(), ip: client.ip }, session);
    });
  } catch (err) {
    throw duplicateKeyError(err) ?? err;
  }

  const newUser = user as unknown as UserDocument;

  void notifySubmitted(reg, applicationId, flagged);
  const tokens = await issueTokens(newUser, client);
  const result: RegistrationCompleted = { applicationId, status: 'pending_accounts' };
  return { user: newUser, tokens, result };
}

/** N2 (applicant, all Accounts users, Admin) and, when flagged, N3 (Admin). Never blocks the applicant. */
async function notifySubmitted(reg: RegistrationDocument, applicationId: string, flagged: boolean) {
  try {
    const url = `${config.CLIENT_ORIGIN}/app`;
    const firm = reg.firmName;
    const s = reg.signatory!;
    const staff = await User.find({ role: { $in: ['accounts', 'admin'] }, isActive: true }, { name: 1, email: 1, role: 1 });
    const jobs: Promise<boolean>[] = [
      applicationSubmittedEmail(s.name, applicationId, firm, url).then((m) => sendEmail({ to: s.email, event: 'application_submitted', ...m })),
    ];
    for (const u of staff) {
      const make = u.role === 'accounts' ? newApplicationForAccountsEmail : newRegistrationAdminEmail;
      jobs.push(make(u.name, applicationId, firm, url).then((m) => sendEmail({ to: u.email, event: 'application_submitted', ...m })));
    }
    await Promise.allSettled(jobs);
    await notifyApplicantBySms('registration_submitted', { ...reg.toObject(), _id: reg._id, applicationId }, { dedupe: 'once' });
    if (flagged) {
      const flag = await DuplicateFlag.findOne({ registrationId: reg._id, status: 'open' });
      await notifyAdminsOfDuplicate(applicationId, firm, (flag?.matches ?? []).map((m) => m.field));
    }
  } catch (err) {
    console.error('Could not send submission notifications:', err);
  }
}
