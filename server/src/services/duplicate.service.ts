import mongoose from 'mongoose';
import type { ApplicationStatus, DuplicateCaseRow, DuplicateComparisonView } from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { Registration, type RegistrationDocument } from '../models/Registration';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { User } from '../models/User';
import { toSubmissionView } from './application-view.service';
import { audit } from './audit.service';
import { sendEmail } from './email.service';
import { duplicateConfirmedEmail } from './email-templates';
import type { Actor } from './users.service';

/**
 * Duplicate Review (PRD AD3, 10.1). Admin either clears a flag ("Not a Duplicate"), after which
 * Accounts can approve, or confirms it, after which Approve stays blocked and the reviewer is asked
 * to reject with Admin's note. Admin never approves or rejects an application directly.
 */

type FlagDoc = InstanceType<typeof DuplicateFlag>;

async function matchesWithFirms(flags: FlagDoc[]) {
  const ids = [...new Set(flags.flatMap((f) => f.matches.map((m) => m.matchedRegistrationId.toString())))];
  const regs = new Map((await Registration.find({ _id: { $in: ids } }, { firmName: 1, applicationId: 1 })).map((r) => [r._id.toString(), r]));
  return (f: FlagDoc): DuplicateCaseRow['matches'] =>
    f.matches.map((m) => {
      const other = regs.get(m.matchedRegistrationId.toString());
      return {
        field: m.field,
        value: m.value,
        matchedRegistrationId: m.matchedRegistrationId.toString(),
        matchedApplicationId: other?.applicationId ?? m.matchedApplicationId ?? null,
        matchedFirmName: other?.firmName ?? null,
      };
    });
}

export async function listOpen(): Promise<DuplicateCaseRow[]> {
  const flags = await DuplicateFlag.find({ status: 'open' }).sort({ createdAt: 1 });
  const regs = new Map(
    (await Registration.find({ _id: { $in: flags.map((f) => f.registrationId) } }, { applicationId: 1, firmName: 1, status: 1, signatory: 1, assignedTo: 1 })).map((r) => [
      r._id.toString(),
      r,
    ]),
  );
  const assignees = new Map(
    (await User.find({ _id: { $in: [...regs.values()].map((r) => r.assignedTo).filter(Boolean) } }, { name: 1 })).map((u) => [u._id.toString(), u.name]),
  );
  const matches = await matchesWithFirms(flags);
  return flags.flatMap((f) => {
    const reg = regs.get(f.registrationId.toString());
    // Applications still in Pending Verification are not reviewable yet; withdrawn ones have nothing left to check.
    if (!reg || reg.status === 'pending_verification' || reg.status === 'withdrawn') return [];
    return [
      {
        flagId: f._id.toString(),
        raisedAt: (f.get('createdAt') as Date).toISOString(),
        registration: {
          id: reg._id.toString(),
          applicationId: reg.applicationId ?? '',
          firmName: reg.firmName,
          status: reg.status as ApplicationStatus,
          signatoryName: reg.signatory?.name ?? '',
          assignedTo: reg.assignedTo ? assignees.get(reg.assignedTo.toString()) ?? null : null,
        },
        matches: matches(f),
      },
    ];
  });
}

async function loadFlag(id: string) {
  const flag = mongoose.isValidObjectId(id) ? await DuplicateFlag.findById(id) : null;
  if (!flag) throw new AppError(404, 'Duplicate case not found.', 'not_found');
  return flag;
}

export async function compare(id: string): Promise<DuplicateComparisonView> {
  const flag = await loadFlag(id);
  const reg = await Registration.findById(flag.registrationId);
  if (!reg || reg.status === 'withdrawn') throw new AppError(410, "This application was withdrawn and its personal data erased at the applicant's request.", 'erased');
  const matches = (await matchesWithFirms([flag]))(flag);
  const otherIds = [...new Set(matches.map((m) => m.matchedRegistrationId))];
  const others = await Promise.all(
    otherIds.map(async (otherId) => {
      const other = await Registration.findById(otherId);
      if (!other || other.status === 'withdrawn') return { id: otherId, erased: true as const };
      return {
        id: otherId,
        applicationId: other.applicationId ?? '',
        status: other.status as ApplicationStatus,
        submission: await toSubmissionView(other._id, other.currentSubmissionVersion),
      };
    }),
  );
  return {
    flagId: flag._id.toString(),
    status: flag.status as DuplicateComparisonView['status'],
    raisedAt: (flag.get('createdAt') as Date).toISOString(),
    note: flag.note ?? null,
    application: {
      id: reg._id.toString(),
      applicationId: reg.applicationId ?? '',
      status: reg.status as ApplicationStatus,
      submission: await toSubmissionView(reg._id, reg.currentSubmissionVersion),
    },
    matches,
    others,
  };
}

/** Records Admin's decision on an open flag, in one transaction with the history and audit entries. */
async function decide(id: string, decision: 'not_duplicate' | 'confirmed', note: string, actor: Actor) {
  const flag = await loadFlag(id);
  if (flag.status !== 'open') throw new AppError(409, 'This duplicate case has already been resolved. Please refresh.', 'already_resolved');
  const now = new Date();
  let reg = await Registration.findById(flag.registrationId);
  if (!reg || reg.status === 'withdrawn') throw new AppError(410, "This application was withdrawn and its personal data erased at the applicant's request.", 'erased');

  await mongoose.connection.transaction(async (session) => {
    const claimed = await DuplicateFlag.findOneAndUpdate(
      { _id: flag._id, status: 'open' },
      { $set: { status: decision, resolvedBy: actor.user._id, resolvedAt: now, note } },
      { session },
    );
    if (!claimed) throw new AppError(409, 'This duplicate case has already been resolved. Please refresh.', 'already_resolved');

    // Confirmed: Approve stays blocked until the applicant resubmits (the resubmission re-checks).
    // Not a duplicate: Approve unblocks unless another flag is still open.
    const stillOpen = await DuplicateFlag.countDocuments({ registrationId: flag.registrationId, status: 'open' }).session(session);
    const blocked = decision === 'confirmed' || stillOpen > 0;
    reg = await Registration.findOneAndUpdate({ _id: flag.registrationId }, { $set: { hasOpenDuplicateFlag: blocked } }, { session, new: true });

    await RegistrationHistory.create(
      [
        {
          registrationId: flag.registrationId,
          at: now,
          event: decision === 'not_duplicate' ? 'duplicate_cleared' : 'duplicate_confirmed',
          actorId: actor.user._id,
          actorRole: 'admin',
          reason: note,
          submissionVersion: flag.submissionVersion,
        },
      ],
      { session },
    );
    await audit(
      {
        action: decision === 'not_duplicate' ? 'duplicate_cleared' : 'duplicate_confirmed',
        userId: actor.user._id,
        role: 'admin',
        targetType: 'registration',
        targetId: flag.registrationId.toString(),
        details: { flagId: flag._id.toString(), applicationId: reg?.applicationId ?? null, note },
        ip: actor.ip,
      },
      session,
    );
  });

  if (decision === 'confirmed' && reg) void notifyReviewers(reg, note);
  return { status: decision, hasOpenDuplicateFlag: !!reg?.hasOpenDuplicateFlag };
}

/** "Confirm Duplicate": the assignee (or every Accounts user if unassigned, or every Manager) is asked to reject. */
async function notifyReviewers(reg: RegistrationDocument, note: string) {
  try {
    let recipients: { name: string; email: string }[] = [];
    let url = `${config.CLIENT_ORIGIN}/app`;
    if (reg.status === 'pending_accounts') {
      recipients = reg.assignedTo
        ? await User.find({ _id: reg.assignedTo, isActive: true }, { name: 1, email: 1 })
        : await User.find({ role: 'accounts', isActive: true }, { name: 1, email: 1 });
      url = `${config.CLIENT_ORIGIN}/app/accounts/applications/${reg._id}`;
    } else if (reg.status === 'pending_manager') {
      recipients = await User.find({ role: 'manager', isActive: true }, { name: 1, email: 1 });
      url = `${config.CLIENT_ORIGIN}/app/manager/applications/${reg._id}`;
    }
    await Promise.allSettled(
      recipients.map(async (u) => sendEmail({ to: u.email, event: 'duplicate_confirmed', ...(await duplicateConfirmedEmail(u.name, reg.applicationId ?? '', reg.firmName, note, url)) })),
    );
  } catch (err) {
    console.error('Could not send the duplicate-confirmed email:', err);
  }
}

export const clearFlag = (id: string, note: string, actor: Actor) => decide(id, 'not_duplicate', note, actor);
export const confirmFlag = (id: string, note: string, actor: Actor) => decide(id, 'confirmed', note, actor);
