import type { z } from 'zod';
import type { AdminUserView, ManagedRole, Role, internalUserSchema } from '@fap/shared';
import { AppError } from '../lib/errors';
import { duplicateKeyField } from '../lib/mongo-errors';
import { Registration } from '../models/Registration';
import { User, type UserDocument } from '../models/User';
import { audit } from './audit.service';
import { revokeAllSessions } from './auth.service';
import { sendInvite, sendPasswordReset } from './password.service';

type InternalUserData = z.output<typeof internalUserSchema>;

export interface Actor {
  user: UserDocument;
  ip?: string;
}

export function toAdminUserView(u: UserDocument): AdminUserView {
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    username: u.username ?? null,
    mobile: u.mobile ?? null,
    role: u.role as Role,
    isActive: u.isActive,
    passwordSet: !!u.passwordHash,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

/** Turns a unique-index clash into a message naming the field already in use. */
function duplicateKeyError(err: unknown): AppError | null {
  const field = duplicateKeyField(err);
  if (!field) return null;
  const label = { email: 'email address', username: 'username', mobile: 'mobile number' }[field] ?? field;
  return new AppError(409, `This ${label} is already used by another account.`, 'duplicate');
}

async function findManagedUser(id: string, role: ManagedRole) {
  const user = await User.findOne({ _id: id, role }).catch(() => null);
  if (!user) throw new AppError(404, 'User not found.', 'not_found');
  return user;
}

export async function listUsers(role: ManagedRole) {
  const users = await User.find({ role }).sort({ isActive: -1, name: 1 });
  return users.map(toAdminUserView);
}

export async function createUser(role: ManagedRole, data: InternalUserData, actor: Actor) {
  let user: UserDocument;
  try {
    user = await User.create({ ...data, mobile: data.mobile ?? undefined, role, createdBy: actor.user._id });
  } catch (err) {
    throw duplicateKeyError(err) ?? err;
  }
  const emailSent = await sendInvite(user);
  await audit({
    action: 'user_created',
    userId: actor.user._id,
    role: 'admin',
    targetType: 'user',
    targetId: user._id.toString(),
    details: { role, email: user.email, inviteEmailSent: emailSent },
    ip: actor.ip,
  });
  return { user: toAdminUserView(user), emailSent };
}

export async function updateUser(role: ManagedRole, id: string, data: InternalUserData, actor: Actor) {
  const user = await findManagedUser(id, role);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ['name', 'email', 'username', 'mobile'] as const) {
    const before = user[key] ?? null;
    const after = data[key] ?? null;
    if (before !== after) changes[key] = { from: before, to: after };
  }
  if (Object.keys(changes).length === 0) return toAdminUserView(user);

  user.name = data.name;
  user.email = data.email;
  user.username = data.username;
  user.mobile = data.mobile ?? undefined;
  try {
    await user.save();
  } catch (err) {
    throw duplicateKeyError(err) ?? err;
  }
  await audit({
    action: 'user_updated',
    userId: actor.user._id,
    role: 'admin',
    targetType: 'user',
    targetId: id,
    details: { changes },
    ip: actor.ip,
  });
  return toAdminUserView(user);
}

export async function setUserActive(role: ManagedRole, id: string, isActive: boolean, actor: Actor) {
  const user = await findManagedUser(id, role);
  if (user.isActive === isActive) return toAdminUserView(user);

  // An Accounts user who still has applications to review must hand them over first (PRD AD8).
  if (!isActive && role === 'accounts') {
    const assigned = await Registration.countDocuments({ status: 'pending_accounts', assignedTo: user._id });
    if (assigned > 0) {
      throw new AppError(
        409,
        `${user.name} still has ${assigned} application${assigned === 1 ? '' : 's'} to review. Move ${assigned === 1 ? 'it' : 'them'} to another Accounts user (or back to Unassigned) first.`,
        'has_assignments',
        { assignedCount: assigned },
      );
    }
  }
  user.isActive = isActive;
  await user.save();
  if (!isActive) await revokeAllSessions(user._id);

  await audit({
    action: isActive ? 'user_reactivated' : 'user_deactivated',
    userId: actor.user._id,
    role: 'admin',
    targetType: 'user',
    targetId: id,
    ip: actor.ip,
  });
  return toAdminUserView(user);
}

/** Sends a set-password link if they never set one, otherwise a reset link. */
export async function sendPasswordLink(role: ManagedRole, id: string, actor: Actor) {
  const user = await findManagedUser(id, role);
  if (!user.isActive) throw new AppError(400, 'Reactivate this user before sending a password link.', 'inactive');
  const emailSent = user.passwordHash ? await sendPasswordReset(user) : await sendInvite(user);
  await audit({
    action: 'password_link_sent',
    userId: actor.user._id,
    role: 'admin',
    targetType: 'user',
    targetId: id,
    details: { emailSent },
    ip: actor.ip,
  });
  return emailSent;
}
