import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { isValidMobile, type Role } from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { User, type UserDocument } from '../models/User';
import { Session } from '../models/Session';
import { getSettings } from '../models/Settings';
import { audit } from './audit.service';

const INVALID_LOGIN = 'Invalid login details. Please check and try again.';

/** A refresh token reused within this time of its rotation is a parallel tab, not theft. */
const REFRESH_RACE_GRACE_MS = 15_000;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export const hashPassword = (password: string) => bcrypt.hash(password, 12);

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Franchise users sign in with email or mobile; internal users with email or username (PRD §6.3).
 */
export async function findUserByIdentifier(identifier: string): Promise<UserDocument | null> {
  const value = identifier.trim();
  if (value.includes('@')) return User.findOne({ email: value.toLowerCase() });
  if (isValidMobile(value)) return User.findOne({ mobile: value, role: 'franchise_user' });
  return User.findOne({ username: value.toLowerCase(), role: { $ne: 'franchise_user' } });
}

async function recordFailedLogin(user: UserDocument) {
  const { maxAttempts, windowMinutes, lockMinutes } = config.loginLockout;
  const now = Date.now();
  const windowStart = user.firstFailedLoginAt?.getTime() ?? 0;

  if (now - windowStart > windowMinutes * 60_000) {
    user.failedLoginAttempts = 1;
    user.firstFailedLoginAt = new Date(now);
  } else {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
  }
  if (user.failedLoginAttempts >= maxAttempts) {
    user.lockedUntil = new Date(now + lockMinutes * 60_000);
    user.failedLoginAttempts = 0;
    user.firstFailedLoginAt = undefined;
  }
  await user.save();
}

/** Starts a login session for a user (also used right after a new franchise account is created). */
export async function issueTokens(user: UserDocument, client: ClientInfo): Promise<IssuedTokens> {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const refreshExpiresAt = new Date(Date.now() + config.refreshTokenDays * 86_400_000);
  const session = await Session.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    expiresAt: refreshExpiresAt,
    ip: client.ip,
    userAgent: client.userAgent,
  });
  const accessToken = jwt.sign({ sid: session._id.toString() }, config.JWT_ACCESS_SECRET, {
    subject: user._id.toString(),
    expiresIn: `${config.accessTokenMinutes}m`,
  });
  return { accessToken, refreshToken, refreshExpiresAt };
}

export async function login(identifier: string, password: string, client: ClientInfo) {
  const user = await findUserByIdentifier(identifier);

  if (!user || !user.passwordHash) {
    await audit({ action: 'login_failed', details: { identifier, reason: 'unknown_user' }, ip: client.ip });
    throw new AppError(401, INVALID_LOGIN, 'invalid_login');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(
      423,
      `Too many failed attempts. Your account is locked for ${minutes} more minute(s).`,
      'locked',
    );
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    await recordFailedLogin(user);
    await audit({
      action: 'login_failed',
      userId: user._id,
      role: user.role as Role,
      details: { reason: 'wrong_password' },
      ip: client.ip,
    });
    throw new AppError(401, INVALID_LOGIN, 'invalid_login');
  }

  if (!user.isActive) {
    throw new AppError(403, 'Your account has been deactivated. Please contact the Admin.', 'inactive');
  }

  user.failedLoginAttempts = 0;
  user.firstFailedLoginAt = undefined;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  await audit({ action: 'login', userId: user._id, role: user.role as Role, ip: client.ip });
  return { user, tokens: await issueTokens(user, client) };
}

/** Swaps a refresh token for a new pair (rotation). Enforces the inactivity timeout. */
export async function refresh(refreshToken: string, client: ClientInfo) {
  const session = await Session.findOne({ tokenHash: sha256(refreshToken) });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, 'Your session has ended. Please log in again.', 'session_expired');
  }

  if (session.replacedAt) {
    // Two tabs refreshing at the same moment: the other tab already rotated this token and its
    // new cookies are shared with this tab, so this is not theft. The browser simply retries.
    if (Date.now() - session.replacedAt.getTime() < REFRESH_RACE_GRACE_MS) {
      throw new AppError(409, 'Your session was just renewed. Please retry.', 'refresh_race');
    }
    // A rotated token was used again later: treat as stolen and sign the user out everywhere.
    await revokeAllSessions(session.userId);
    await audit({ action: 'session_token_reuse', userId: session.userId, ip: client.ip });
    throw new AppError(401, 'Your session has ended. Please log in again.', 'session_expired');
  }

  const { sessionTimeoutMinutes } = await getSettings();
  if (Date.now() - session.lastUsedAt.getTime() > sessionTimeoutMinutes * 60_000) {
    session.revokedAt = new Date();
    await session.save();
    throw new AppError(401, 'You were logged out after a period of inactivity.', 'session_expired');
  }

  const user = await User.findById(session.userId);
  if (!user || !user.isActive) {
    throw new AppError(401, 'Your session has ended. Please log in again.', 'session_expired');
  }

  // Atomic claim: only one request can rotate this token, even if several arrive together.
  const claimed = await Session.findOneAndUpdate(
    { _id: session._id, replacedAt: null, revokedAt: null },
    { $set: { replacedAt: new Date() } },
  );
  if (!claimed) throw new AppError(409, 'Your session was just renewed. Please retry.', 'refresh_race');
  return { user, tokens: await issueTokens(user, client) };
}

/** Signs the user out of every browser (after a password change or deactivation). */
export async function revokeAllSessions(userId: Types.ObjectId | string) {
  await Session.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await Session.updateOne({ tokenHash: sha256(refreshToken) }, { revokedAt: new Date() });
}

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

/** Records activity so the inactivity timeout counts from the last real request. */
export async function touchSession(sessionId: string) {
  await Session.updateOne(
    { _id: sessionId, revokedAt: null, lastUsedAt: { $lt: new Date(Date.now() - 60_000) } },
    { lastUsedAt: new Date() },
  );
}

export async function isSessionActive(sessionId: string) {
  const session = await Session.findById(sessionId, { revokedAt: 1, expiresAt: 1 });
  return !!session && !session.revokedAt && session.expiresAt.getTime() > Date.now();
}

/**
 * Changes the password of the logged-in user after checking the current one. Other browsers are
 * signed out; the current session continues.
 */
export async function changePassword(user: UserDocument, currentPassword: string, newPassword: string, currentSessionId: string | undefined, ip?: string) {
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'Your current password is not correct.', 'wrong_password', { fields: { currentPassword: 'Your current password is not correct.' } });
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new AppError(400, 'Choose a password different from your current one.', 'same_password', { fields: { password: 'Choose a password different from your current one.' } });
  }
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  await Session.updateMany({ userId: user._id, revokedAt: null, _id: { $ne: currentSessionId } }, { revokedAt: new Date() });
  await audit({ action: 'password_changed', userId: user._id, role: user.role as Role, ip });
}
