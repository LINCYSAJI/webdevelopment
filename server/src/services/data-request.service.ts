import bcrypt from 'bcryptjs';
import mongoose, { type Types } from 'mongoose';
import {
  AGREEMENT_RETENTION_YEARS,
  type ApplicationStatus,
  type DataDeletionRequestInput,
  type DataRequestRow,
  type DataRequestStatus,
  type MyDataRequestView,
  type Paginated,
} from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { duplicateKeyField } from '../lib/mongo-errors';
import { storage } from '../lib/storage';
import { AgreementAcceptance } from '../models/AgreementAcceptance';
import { DataRequest } from '../models/DataRequest';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { NotificationLog } from '../models/NotificationLog';
import { Otp } from '../models/Otp';
import { Registration, type RegistrationDocument as RegistrationDoc } from '../models/Registration';
import { RegistrationDocument } from '../models/RegistrationDocument';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { SmsLog } from '../models/SmsLog';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { User, type UserDocument } from '../models/User';
import { audit } from './audit.service';
import { revokeAllSessions } from './auth.service';
import { sendEmail } from './email.service';
import { dataErasedEmail, dataRequestAdminEmail, dataRequestDeclinedEmail, dataRequestReceivedEmail } from './email-templates';
import type { Actor } from './users.service';

/**
 * "Delete my account" (DPDP Act 2023 s.12 erasure and s.6(4) withdrawal of consent).
 *
 * The applicant asks from My Profile; Admin then either erases the data or declines with a
 * reason. Erasure is refused while a signed (approved) agreement exists, because those records
 * must be kept by law (PRD A25). Erasure is the ONE place where permanent records are changed:
 * personal details are overwritten and uploaded files deleted, while a minimal, non-personal
 * trace (status, dates, audit entries, the consent record) is kept as proof.
 */

const ERASED = '[erased]';
const PAGE_SIZE = 20;

type RequestRow = InstanceType<typeof DataRequest>;

const toMyView = (r: RequestRow): MyDataRequestView => ({
  id: r._id.toString(),
  status: r.status as DataRequestStatus,
  requestedAt: r.requestedAt.toISOString(),
  reason: r.reason ?? '',
  decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  decisionNote: r.decisionNote ?? null,
});

function eraseBlockedReason(reg: Pick<RegistrationDoc, 'status'> | null): string | null {
  if (reg?.status === 'approved') {
    return `This franchise agreement has been approved. The signed agreement and the details in it must be kept for as long as the franchise relationship lasts and ${AGREEMENT_RETENTION_YEARS} years after it ends, so the data cannot be erased now. Decline the request and explain this to the applicant.`;
  }
  return null;
}

// ---------- Franchise User ----------

export async function getMyRequest(user: UserDocument): Promise<{ request: MyDataRequestView | null; eraseBlockedReason: string | null }> {
  const [request, reg] = await Promise.all([
    DataRequest.findOne({ userId: user._id }).sort({ requestedAt: -1 }),
    Registration.findOne({ userId: user._id }, { status: 1 }),
  ]);
  return { request: request ? toMyView(request) : null, eraseBlockedReason: eraseBlockedReason(reg) };
}

export async function requestDeletion(user: UserDocument, input: Required<Omit<DataDeletionRequestInput, 'confirm'>>, ctx: { ip?: string }) {
  if (!user.passwordHash || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'Your current password is not correct.', 'wrong_password', { fields: { currentPassword: 'Your current password is not correct.' } });
  }
  const reg = await Registration.findOne({ userId: user._id }, { applicationId: 1 });
  let request: RequestRow;
  try {
    request = await DataRequest.create({
      userId: user._id,
      registrationId: reg?._id ?? null,
      applicationId: reg?.applicationId ?? null,
      reason: input.reason,
      requestedAt: new Date(),
      ip: ctx.ip,
    });
  } catch (err) {
    if (duplicateKeyField(err)) throw new AppError(409, 'You already have a pending deletion request.', 'already_requested');
    throw err;
  }
  await audit({ action: 'data_deletion_requested', userId: user._id, role: 'franchise_user', targetType: 'data_request', targetId: request._id.toString(), ip: ctx.ip });

  // Emails never block the request itself.
  void (async () => {
    try {
      await sendEmail({ to: user.email, event: 'data_request_received', ...(await dataRequestReceivedEmail(user.name)) });
      const admins = await User.find({ role: 'admin', isActive: true }, { name: 1, email: 1 });
      const url = `${config.CLIENT_ORIGIN}/app/admin/data-requests`;
      await Promise.allSettled(
        admins.map(async (a) => sendEmail({ to: a.email, event: 'data_request_admin', ...(await dataRequestAdminEmail(a.name, user.name, reg?.applicationId ?? null, url)) })),
      );
    } catch (err) {
      console.error('Could not send the data deletion request emails:', err);
    }
  })();
  return toMyView(request);
}

export async function cancelMyRequest(user: UserDocument, ip?: string) {
  const request = await DataRequest.findOneAndUpdate(
    { userId: user._id, status: 'pending' },
    { $set: { status: 'cancelled', decidedAt: new Date(), decidedBy: user._id } },
    { new: true },
  );
  if (!request) throw new AppError(409, 'There is no pending request to cancel.', 'no_pending_request');
  await audit({ action: 'data_deletion_cancelled', userId: user._id, role: 'franchise_user', targetType: 'data_request', targetId: request._id.toString(), ip });
  return toMyView(request);
}

// ---------- Admin ----------

export async function listRequests(query: { status?: DataRequestStatus; page: number }): Promise<Paginated<DataRequestRow>> {
  const filter = query.status ? { status: query.status } : {};
  const [requests, total] = await Promise.all([
    DataRequest.find(filter)
      .sort(query.status === 'pending' ? { requestedAt: 1 } : { requestedAt: -1 })
      .skip((query.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
    DataRequest.countDocuments(filter),
  ]);
  const userIds = [...new Set(requests.flatMap((r) => [r.userId.toString(), r.decidedBy?.toString()].filter((v): v is string => !!v)))];
  const regIds = requests.map((r) => r.registrationId).filter((v): v is Types.ObjectId => !!v);
  const [users, regs] = await Promise.all([
    User.find({ _id: { $in: userIds } }, { name: 1, email: 1 }),
    Registration.find({ _id: { $in: regIds } }, { status: 1, applicationId: 1, firmName: 1 }),
  ]);
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  const regById = new Map(regs.map((r) => [r._id.toString(), r]));

  return {
    items: requests.map((r) => {
      const u = userById.get(r.userId.toString());
      const reg = r.registrationId ? regById.get(r.registrationId.toString()) ?? null : null;
      return {
        ...toMyView(r),
        userName: u?.name ?? '—',
        userEmail: u?.email ?? '—',
        applicationId: reg?.applicationId ?? r.applicationId ?? null,
        firmName: reg?.firmName ?? null,
        applicationStatus: (reg?.status as ApplicationStatus | undefined) ?? null,
        decidedByName: r.decidedBy ? userById.get(r.decidedBy.toString())?.name ?? null : null,
        eraseBlockedReason: r.status === 'pending' ? eraseBlockedReason(reg) : null,
      };
    }),
    page: query.page,
    pageSize: PAGE_SIZE,
    total,
  };
}

async function pendingRequest(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'Request not found.', 'not_found');
  const request = await DataRequest.findById(id);
  if (!request) throw new AppError(404, 'Request not found.', 'not_found');
  if (request.status !== 'pending') throw new AppError(409, 'This request has already been handled. Please refresh.', 'already_handled');
  return request;
}

export async function declineRequest(id: string, note: string, actor: Actor) {
  await pendingRequest(id);
  const request = await DataRequest.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'declined', decidedBy: actor.user._id, decidedAt: new Date(), decisionNote: note } },
    { new: true },
  );
  if (!request) throw new AppError(409, 'This request has already been handled. Please refresh.', 'already_handled');
  await audit({ action: 'data_deletion_declined', userId: actor.user._id, role: 'admin', targetType: 'data_request', targetId: id, details: { note }, ip: actor.ip });

  const user = await User.findById(request.userId, { name: 1, email: 1 });
  if (user) {
    void dataRequestDeclinedEmail(user.name, note)
      .then((m) => sendEmail({ to: user.email, event: 'data_request_declined', ...m }))
      .catch((err) => console.error('Could not send the data request declined email:', err));
  }
  return toMyView(request);
}

/**
 * Erases the applicant's personal data: closes the login, withdraws the application, overwrites
 * the details in every submission snapshot, and deletes the uploaded files. All database changes
 * happen in one transaction; files are deleted once it has committed.
 */
export async function eraseRequest(id: string, actor: Actor) {
  const request = await pendingRequest(id);
  const user = await User.findById(request.userId);
  if (!user) throw new AppError(404, 'The account for this request no longer exists.', 'not_found');
  const reg = await Registration.findOne({ userId: user._id });
  const blocked = eraseBlockedReason(reg);
  if (blocked) throw new AppError(409, blocked, 'retention_required');

  const now = new Date();
  const formerEmail = user.email;
  const formerName = user.name;
  // Every address and number of this applicant that may appear in the notification log.
  const identifiers = [user.email, user.mobile, reg?.signatory?.email, reg?.signatory?.mobile, ...(reg?.contacts ?? []).flatMap((c) => [c.email, c.mobile])].filter(
    (v): v is string => !!v,
  );
  const files = reg ? await RegistrationDocument.find({ registrationId: reg._id }, { storageKey: 1 }) : [];

  await mongoose.connection.transaction(async (session) => {
    const claimed = await DataRequest.findOneAndUpdate(
      { _id: request._id, status: 'pending' },
      { $set: { status: 'completed', decidedBy: actor.user._id, decidedAt: now, decisionNote: 'Account closed and personal data erased.' } },
      { session },
    );
    if (!claimed) throw new AppError(409, 'This request has already been handled. Please refresh.', 'already_handled');

    if (reg) {
      const updated = await Registration.findOneAndUpdate(
        // Conditional: if a Manager approved it a moment ago, nothing is erased.
        { _id: reg._id, status: reg.status },
        {
          $set: {
            status: 'withdrawn',
            firmName: ERASED,
            pan: ERASED,
            gst: null,
            signatory: { name: ERASED, capacity: reg.signatory?.capacity, email: `erased-${reg._id}@erased.invalid`, mobile: ERASED },
            contacts: [],
            assignedTo: null,
            hasOpenDuplicateFlag: false,
            stageEnteredAt: now,
            erasedAt: now,
          },
          $unset: { panLock: '', gstLock: '', verification: '' },
        },
        { session },
      );
      if (!updated) throw new AppError(409, 'The application changed while you were working. Please refresh and try again.', 'status_changed');

      // Permanent records are changed directly (bypassing their append-only guard) ONLY here.
      await SubmissionVersion.collection.updateMany({ registrationId: reg._id }, { $set: { data: { erased: true }, erasedAt: now }, $unset: { ip: '' } }, { session });
      await RegistrationDocument.collection.updateMany({ registrationId: reg._id }, { $set: { fileName: ERASED, erasedAt: now } }, { session });
      await AgreementAcceptance.collection.updateMany(
        { registrationId: reg._id },
        { $set: { erasedAt: now }, $unset: { 'snapshot.html': '', ip: '', userAgent: '' } },
        { session },
      );
      await DuplicateFlag.updateMany(
        { registrationId: reg._id, status: 'open' },
        { $set: { status: 'not_duplicate', resolvedAt: now, note: 'Application withdrawn and personal data erased.' } },
        { session },
      );
      await DuplicateFlag.updateMany({ registrationId: reg._id }, { $set: { 'matches.$[].value': ERASED } }, { session });
      await DuplicateFlag.updateMany(
        { 'matches.matchedRegistrationId': reg._id },
        { $set: { 'matches.$[m].value': ERASED } },
        { arrayFilters: [{ 'm.matchedRegistrationId': reg._id }], session },
      );
      await RegistrationHistory.create(
        [{ registrationId: reg._id, at: now, event: 'withdrawn_erased', actorId: actor.user._id, actorRole: 'admin', fromStatus: reg.status, toStatus: 'withdrawn' }],
        { session },
      );
    }

    await Otp.deleteMany({ subjectKey: { $in: [`user:${user._id}`, ...(reg ? [`reg:${reg._id}`] : [])] } }, { session });
    await User.updateOne(
      { _id: user._id },
      {
        $set: { name: 'Erased user', email: `erased-${user._id}@erased.invalid`, isActive: false, erasedAt: now },
        $unset: { mobile: '', passwordHash: '', username: '' },
      },
      { session },
    );
    await audit(
      {
        action: 'data_erased',
        userId: actor.user._id,
        role: 'admin',
        targetType: 'data_request',
        targetId: request._id.toString(),
        details: { registrationId: reg?._id.toString() ?? null, applicationId: reg?.applicationId ?? null, files: files.length },
        ip: actor.ip,
      },
      session,
    );
  });

  await revokeAllSessions(user._id);

  const removed = await Promise.allSettled(files.map((f) => storage.remove(f.storageKey)));
  const failed = removed.filter((r) => r.status === 'rejected').length;
  if (failed) {
    console.error(`Data erasure ${request._id}: ${failed} file(s) could not be deleted.`);
    await audit({ action: 'data_erasure_files_failed', targetType: 'data_request', targetId: request._id.toString(), details: { failed } });
  }

  try {
    await sendEmail({ to: formerEmail, event: 'data_erased', ...(await dataErasedEmail(formerName)) });
  } catch (err) {
    console.error('Could not send the data erased email:', err);
  }
  // Finally remove the applicant's addresses from the delivery log (including the email just sent).
  await NotificationLog.updateMany({ recipient: { $in: identifiers } }, { $set: { recipient: ERASED } });
  await SmsLog.updateMany(
    { $or: [{ recipient: { $in: identifiers } }, ...(reg ? [{ registrationId: reg._id }] : [])] },
    { $set: { recipient: ERASED, text: ERASED } },
  );

  return { status: 'completed' as const };
}
