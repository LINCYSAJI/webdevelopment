import crypto from 'node:crypto';
import type { Role } from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { PasswordToken, type PasswordTokenPurpose } from '../models/PasswordToken';
import { User, type UserDocument } from '../models/User';
import { audit } from './audit.service';
import { findUserByIdentifier, hashPassword, revokeAllSessions, sha256 } from './auth.service';
import { sendEmail } from './email.service';
import { inviteEmail, passwordResetEmail } from './email-templates';

const INVITE_VALID_HOURS = 72;
const RESET_VALID_MINUTES = 60;
const INVALID_LINK = 'This link is invalid or has expired. Please request a new one.';

async function createToken(user: UserDocument, purpose: PasswordTokenPurpose, validMs: number) {
  // Only the newest link works: older unused links for this user are retired.
  await PasswordToken.updateMany({ userId: user._id, usedAt: null }, { usedAt: new Date() });
  const token = crypto.randomBytes(32).toString('base64url');
  await PasswordToken.create({
    userId: user._id,
    tokenHash: sha256(token),
    purpose,
    expiresAt: new Date(Date.now() + validMs),
  });
  return `${config.CLIENT_ORIGIN}/set-password?token=${token}`;
}

/** Emails a new internal user a link to choose their own password. */
export async function sendInvite(user: UserDocument) {
  const url = await createToken(user, 'set_password', INVITE_VALID_HOURS * 3_600_000);
  const email = await inviteEmail(user.name, user.role as Role, url, INVITE_VALID_HOURS);
  return sendEmail({ to: user.email, event: 'user_invite', ...email });
}

/** Emails a password reset link. */
export async function sendPasswordReset(user: UserDocument) {
  const url = await createToken(user, 'reset_password', RESET_VALID_MINUTES * 60_000);
  const email = await passwordResetEmail(user.name, url, RESET_VALID_MINUTES);
  return sendEmail({ to: user.email, event: 'password_reset', ...email });
}

/** Forgot Password. Always behaves the same so it never reveals whether an account exists. */
export async function requestPasswordReset(identifier: string, ip?: string) {
  const user = await findUserByIdentifier(identifier);
  if (!user || !user.isActive) return;
  await sendPasswordReset(user);
  await audit({ action: 'password_reset_requested', userId: user._id, role: user.role as Role, ip });
}

async function findValidToken(token: string) {
  const record = await PasswordToken.findOne({ tokenHash: sha256(token) });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) return null;
  return record;
}

/** Lets the Set Password page show who the link is for before the user types. */
export async function describeToken(token: string) {
  const record = await findValidToken(token);
  const user = record && (await User.findById(record.userId));
  if (!record || !user || !user.isActive) throw new AppError(400, INVALID_LINK, 'invalid_token');
  return { purpose: record.purpose, name: user.name, email: user.email };
}

export async function setPasswordWithToken(token: string, password: string, ip?: string) {
  const record = await findValidToken(token);
  const user = record && (await User.findById(record.userId));
  if (!record || !user || !user.isActive) throw new AppError(400, INVALID_LINK, 'invalid_token');

  // Claim the token atomically so the same link cannot be used twice.
  const claimed = await PasswordToken.updateOne({ _id: record._id, usedAt: null }, { usedAt: new Date() });
  if (claimed.modifiedCount !== 1) throw new AppError(400, INVALID_LINK, 'invalid_token');

  user.passwordHash = await hashPassword(password);
  user.failedLoginAttempts = 0;
  user.firstFailedLoginAt = undefined;
  user.lockedUntil = undefined;
  await user.save();
  await revokeAllSessions(user._id);

  await audit({
    action: record.purpose === 'set_password' ? 'password_set' : 'password_reset',
    userId: user._id,
    role: user.role as Role,
    ip,
  });
}
