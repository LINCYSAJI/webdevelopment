import mongoose, { type ClientSession, type Types } from 'mongoose';
import type { ReassignInput, Role } from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { AssignmentHistory } from '../models/AssignmentHistory';
import { Registration, type RegistrationDocument } from '../models/Registration';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { User, type UserDocument } from '../models/User';
import { audit } from './audit.service';
import { sendEmail } from './email.service';
import {
  accountsApprovedApplicantEmail,
  applicationAssignedEmail,
  awaitingManagerEmail,
  correctionRequestedEmail,
  rejectedAdminEmail,
} from './email-templates';

/**
 * Status and assignment changes for the Accounts stage (PRD 6.2, 10.6, 10.7).
 * There is no generic "update registration": each action has its own function, checks role,
 * status, assignee and the duplicate flag in one conditional update, and saves the status
 * change, history, assignment history and audit entry in one transaction (CLAUDE.md rule 3).
 */

interface Actor {
  user: UserDocument;
  ip?: string;
}

const portalUrl = () => `${config.CLIENT_ORIGIN}/app`;

async function load(id: string) {
  const reg = mongoose.isValidObjectId(id) ? await Registration.findById(id) : null;
  if (!reg) throw new AppError(404, 'Application not found.', 'not_found');
  return reg;
}

/** Explains why a conditional update did not match, using the latest saved state. */
async function explainConflict(id: Types.ObjectId, me: Types.ObjectId, wantApprove = false): Promise<AppError> {
  const reg = await Registration.findById(id);
  if (!reg || reg.status !== 'pending_accounts') {
    return new AppError(409, 'This application is no longer waiting for Accounts review. Please refresh.', 'wrong_status');
  }
  if (!reg.assignedTo) return new AppError(409, 'Pick up this application before approving or rejecting it.', 'not_assigned');
  if (!reg.assignedTo.equals(me)) {
    const other = await User.findById(reg.assignedTo, { name: 1 });
    return new AppError(409, `Already picked up by ${other?.name ?? 'another Accounts user'}.`, 'assigned_to_other');
  }
  if (wantApprove && reg.hasOpenDuplicateFlag) {
    return new AppError(409, 'Approve is not available while a possible duplicate is waiting for Admin review. You can still reject.', 'duplicate_flag_open');
  }
  return new AppError(409, 'This application changed while you were working. Please refresh.', 'conflict');
}

async function history(
  session: ClientSession,
  reg: RegistrationDocument,
  actor: Actor,
  event: string,
  toStatus: string,
  reason: string | null = null,
) {
  await RegistrationHistory.create(
    [
      {
        registrationId: reg._id,
        at: new Date(),
        event,
        actorId: actor.user._id,
        actorRole: actor.user.role,
        fromStatus: reg.status,
        toStatus,
        reason,
        submissionVersion: reg.currentSubmissionVersion,
      },
    ],
    { session },
  );
}

// ---------- Pick up ----------

/** Assigns an unassigned Pending Accounts application to the current Accounts user. */
export async function pickUp(id: string, actor: Actor) {
  const reg = await load(id);
  await mongoose.connection.transaction(async (session) => {
    const updated = await Registration.findOneAndUpdate(
      { _id: reg._id, status: 'pending_accounts', assignedTo: null },
      { $set: { assignedTo: actor.user._id } },
      { session },
    );
    if (!updated) {
      const latest = await Registration.findById(reg._id).session(session);
      if (latest?.status === 'pending_accounts' && latest.assignedTo) {
        if (latest.assignedTo.equals(actor.user._id)) throw new AppError(409, 'You have already picked up this application.', 'already_yours');
        const other = await User.findById(latest.assignedTo, { name: 1 });
        throw new AppError(409, `Already picked up by ${other?.name ?? 'another Accounts user'}.`, 'assigned_to_other');
      }
      throw new AppError(409, 'This application is no longer waiting for Accounts review. Please refresh.', 'wrong_status');
    }
    await AssignmentHistory.create([{ registrationId: reg._id, at: new Date(), action: 'pick_up', fromUser: null, toUser: actor.user._id, by: actor.user._id }], { session });
    await audit({ action: 'application_picked_up', userId: actor.user._id, role: 'accounts', targetType: 'registration', targetId: reg._id.toString(), details: { applicationId: reg.applicationId }, ip: actor.ip }, session);
  });
}

// ---------- Approve / reject ----------

/** Accounts approval: Pending Accounts -> Pending Manager ("Accounts Approved" history event). */
export async function approveByAccounts(id: string, actor: Actor) {
  const reg = await load(id);
  const now = new Date();
  await mongoose.connection.transaction(async (session) => {
    const updated = await Registration.findOneAndUpdate(
      { _id: reg._id, status: 'pending_accounts', assignedTo: actor.user._id, hasOpenDuplicateFlag: { $ne: true } },
      { $set: { status: 'pending_manager', stageEnteredAt: now } },
      { session },
    );
    if (!updated) throw await explainConflict(reg._id, actor.user._id, true);
    await history(session, updated, actor, 'accounts_approved', 'pending_manager');
    await audit({ action: 'accounts_approved', userId: actor.user._id, role: 'accounts', targetType: 'registration', targetId: reg._id.toString(), details: { applicationId: reg.applicationId, submissionVersion: reg.currentSubmissionVersion }, ip: actor.ip }, session);
  });
  void notifyAccountsApproved(reg);
}

/** Accounts rejection with a mandatory reason: Pending Accounts -> Rejected by Accounts. */
export async function rejectByAccounts(id: string, reason: string, actor: Actor) {
  const reg = await load(id);
  await mongoose.connection.transaction(async (session) => {
    // The reviewer stays recorded as assignee, so a resubmission returns to them (PRD 10.6).
    const updated = await Registration.findOneAndUpdate(
      { _id: reg._id, status: 'pending_accounts', assignedTo: actor.user._id },
      { $set: { status: 'rejected_by_accounts', stageEnteredAt: new Date() } },
      { session },
    );
    if (!updated) throw await explainConflict(reg._id, actor.user._id);
    await history(session, updated, actor, 'accounts_rejected', 'rejected_by_accounts', reason);
    await audit({ action: 'accounts_rejected', userId: actor.user._id, role: 'accounts', targetType: 'registration', targetId: reg._id.toString(), details: { applicationId: reg.applicationId, reason, submissionVersion: reg.currentSubmissionVersion }, ip: actor.ip }, session);
  });
  void notifyRejected(reg, 'Accounts', reason);
}

// ---------- Admin reassignment ----------

async function activeAccountsUser(userId: string) {
  const user = mongoose.isValidObjectId(userId) ? await User.findOne({ _id: userId, role: 'accounts', isActive: true }) : null;
  if (!user) throw new AppError(400, 'Choose an active Accounts user.', 'invalid_assignee', { fields: { toUserId: 'Choose an active Accounts user.' } });
  return user;
}

/** Admin moves one Pending Accounts application to another Accounts user, or back to Unassigned. */
export async function reassign(id: string, input: ReassignInput, actor: Actor) {
  const reg = await load(id);
  const target = input.toUserId ? await activeAccountsUser(input.toUserId) : null;
  const note = input.note?.trim() ?? '';
  if (reg.status !== 'pending_accounts') throw new AppError(409, 'Only applications pending Accounts review can be reassigned.', 'wrong_status');
  const from = reg.assignedTo ?? null;
  if ((from?.toString() ?? null) === (target?._id.toString() ?? null)) {
    throw new AppError(400, 'The application is already assigned there.', 'unchanged');
  }

  await mongoose.connection.transaction(async (session) => {
    const updated = await Registration.findOneAndUpdate(
      { _id: reg._id, status: 'pending_accounts', assignedTo: from },
      { $set: { assignedTo: target?._id ?? null } },
      { session },
    );
    if (!updated) throw new AppError(409, 'This application changed while you were working. Please refresh.', 'conflict');
    await AssignmentHistory.create(
      [{ registrationId: reg._id, at: new Date(), action: target ? 'reassign' : 'release', fromUser: from, toUser: target?._id ?? null, by: actor.user._id, note }],
      { session },
    );
    await audit(
      { action: 'application_reassigned', userId: actor.user._id, role: actor.user.role as Role, targetType: 'registration', targetId: reg._id.toString(), details: { applicationId: reg.applicationId, from: from?.toString() ?? null, to: target?._id.toString() ?? null, note }, ip: actor.ip },
      session,
    );
  });

  if (target) {
    void applicationAssignedEmail(target.name, reg.applicationId ?? '', reg.firmName, note, portalUrl()).then((m) => sendEmail({ to: target.email, event: 'application_reassigned', ...m }));
  }
}

/** Moves every Pending Accounts application of one Accounts user (used before deactivating them, PRD AD8). */
export async function reassignAllFrom(fromUserId: string, input: ReassignInput, actor: Actor) {
  if (input.toUserId && input.toUserId === fromUserId) throw new AppError(400, 'Choose a different Accounts user.', 'unchanged', { fields: { toUserId: 'Choose a different Accounts user.' } });
  const apps = await Registration.find({ status: 'pending_accounts', assignedTo: fromUserId }, { _id: 1 });
  for (const app of apps) await reassign(app._id.toString(), input, actor);
  return apps.length;
}

// ---------- Notifications ----------

async function activeStaff(roles: Role[]) {
  return User.find({ role: { $in: roles }, isActive: true }, { name: 1, email: 1, role: 1 });
}

/** N5: applicant, all Managers and Admin. */
async function notifyAccountsApproved(reg: RegistrationDocument) {
  try {
    const appId = reg.applicationId ?? '';
    const s = reg.signatory!;
    const jobs = [accountsApprovedApplicantEmail(s.name, appId, portalUrl()).then((m) => sendEmail({ to: s.email, event: 'accounts_approved', ...m }))];
    for (const u of await activeStaff(['manager', 'admin'])) {
      jobs.push(awaitingManagerEmail(u.name, appId, reg.firmName, portalUrl(), u.role === 'admin').then((m) => sendEmail({ to: u.email, event: 'accounts_approved', ...m })));
    }
    await Promise.allSettled(jobs);
  } catch (err) {
    console.error('Could not send approval notifications:', err);
  }
}

/** N6 / N9: applicant (reason + resubmit steps) and Admin. */
export async function notifyRejected(reg: RegistrationDocument, stage: 'Accounts' | 'Manager', reason: string) {
  try {
    const appId = reg.applicationId ?? '';
    const s = reg.signatory!;
    const event = stage === 'Accounts' ? 'accounts_rejected' : 'manager_rejected';
    const jobs = [correctionRequestedEmail(s.name, appId, stage, reason, portalUrl()).then((m) => sendEmail({ to: s.email, event, ...m }))];
    for (const u of await activeStaff(['admin'])) {
      jobs.push(rejectedAdminEmail(u.name, appId, reg.firmName, stage, reason, portalUrl()).then((m) => sendEmail({ to: u.email, event, ...m })));
    }
    await Promise.allSettled(jobs);
  } catch (err) {
    console.error('Could not send rejection notifications:', err);
  }
}
