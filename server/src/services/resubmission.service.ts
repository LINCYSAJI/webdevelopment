import mongoose, { Types } from 'mongoose';
import {
  KEEP_DOCUMENT_REGEX,
  registrationMergeValues,
  type ApplicationStatus,
  type FieldErrors,
  type PublicAgreementView,
  type RegistrationData,
  type SubmissionView,
  type UploadLimits,
} from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { duplicateKeyField } from '../lib/mongo-errors';
import { storage } from '../lib/storage';
import { AgreementVersion } from '../models/AgreementVersion';
import { AssignmentHistory } from '../models/AssignmentHistory';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { Registration } from '../models/Registration';
import { RegistrationDocument } from '../models/RegistrationDocument';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { getSettings } from '../models/Settings';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { User, type UserDocument } from '../models/User';
import { getVersion as getAgreementVersion, recordAcceptance } from './agreement.service';
import { toSubmissionView } from './application-view.service';
import { audit } from './audit.service';
import { sendEmail } from './email.service';
import { resubmittedApplicantEmail, resubmittedStaffEmail } from './email-templates';
import { myRegistration } from './franchise.service';
import {
  claimUploads,
  fileSlots,
  findPossibleDuplicates,
  loadUploads,
  notifyAdminsOfDuplicate,
  saveSubmissionFiles,
  snapshotOf,
  toWarnings,
  uploadAsFile,
  type DuplicateMatch,
  type FileSlot,
  type RequestContext,
  type StoredFileInfo,
} from './registration.service';
import { hashUploadToken } from './upload.service';

// Edit & Resubmit (PRD F3, 5.1 step 9, 6.2).

const REJECTED: ApplicationStatus[] = ['rejected_by_accounts', 'rejected_by_manager'];

/** Resubmitting after Accounts goes back to Accounts; after the Manager, straight back to the Manager. */
const NEXT_STATUS = { rejected_by_accounts: 'pending_accounts', rejected_by_manager: 'pending_manager' } as const;

async function rejectedRegistration(user: UserDocument) {
  const reg = await myRegistration(user);
  if (!REJECTED.includes(reg.status as ApplicationStatus)) {
    throw new AppError(409, 'Your application can only be edited after changes have been requested.', 'not_editable');
  }
  return reg;
}

export interface ResubmitFormView {
  latestRejection: { stage: 'Accounts' | 'Manager'; reason: string; at: string } | null;
  submission: SubmissionView;
  /** The agreement version accepted originally (PRD 10.4); it must be accepted again. */
  agreement: PublicAgreementView;
  limits: UploadLimits;
}

/** Everything the Edit & Resubmit page needs, pre-filled with the latest submission. */
export async function getResubmitForm(user: UserDocument): Promise<ResubmitFormView> {
  const reg = await rejectedRegistration(user);
  const [settings, rejection, version] = await Promise.all([
    getSettings(),
    RegistrationHistory.findOne({ registrationId: reg._id, event: { $in: ['accounts_rejected', 'manager_rejected'] } }).sort({ at: -1 }),
    getAgreementVersion(reg.agreementVersionId.toString()),
  ]);
  return {
    latestRejection: rejection
      ? { stage: rejection.event === 'accounts_rejected' ? 'Accounts' : 'Manager', reason: rejection.reason ?? '', at: rejection.at.toISOString() }
      : null,
    submission: await toSubmissionView(reg._id, reg.currentSubmissionVersion),
    agreement: {
      id: version.id,
      versionNumber: version.versionNumber,
      title: version.title,
      format: version.format,
      content: version.format === 'text' ? version.content : '',
      pdf: version.pdf,
      pdfUrl: version.format === 'pdf' && version.pdf ? '/api/franchise/agreement/pdf' : null,
    },
    limits: { maxDocumentSizeMB: settings.maxDocumentSizeMB, maxPhotoSizeMB: settings.maxPhotoSizeMB, maxRentalSizeMB: settings.maxRentalSizeMB },
  };
}

/** The PDF of the agreement version this applicant accepted (the blank agreement, not a generated one). */
export async function openMyAgreementPdf(user: UserDocument) {
  const reg = await myRegistration(user);
  const version = await AgreementVersion.findById(reg.agreementVersionId);
  if (!version?.pdf) throw new AppError(404, 'This agreement PDF is not available.', 'not_found');
  const file = await storage.open(version.pdf.key);
  return { ...file, fileName: version.pdf.fileName, mimeType: 'application/pdf' };
}

// Document slots that may reuse each other's kept files.
const DOCUMENT_TYPES = new Set(['pan', 'gst', 'id_proof']);
const compatible = (slotType: string, docType: string) =>
  slotType === docType || (DOCUMENT_TYPES.has(slotType) && DOCUMENT_TYPES.has(docType));

/** Resolves every file slot: kept documents must belong to this application and be of a fitting type. */
async function resolveFiles(registrationId: Types.ObjectId, slots: FileSlot[]) {
  const keepSlots = slots.filter((s) => KEEP_DOCUMENT_REGEX.test(s.token));
  const uploadSlots = slots.filter((s) => !KEEP_DOCUMENT_REGEX.test(s.token));

  const keptIds = keepSlots.map((s) => s.token.slice(5));
  const kept = new Map((await RegistrationDocument.find({ _id: { $in: keptIds }, registrationId })).map((d) => [d._id.toString(), d]));
  const errors: FieldErrors = {};
  for (const slot of keepSlots) {
    const doc = kept.get(slot.token.slice(5));
    if (!doc || !compatible(slot.type, doc.type)) errors[slot.field] = 'Please upload this file again.';
  }
  if (Object.keys(errors).length) throw new AppError(400, 'Some files need to be uploaded again.', 'upload_missing', { fields: errors });

  const uploads = uploadSlots.length ? await loadUploads(uploadSlots) : { byHash: new Map(), hashes: [] as string[] };
  const resolve = (slot: FileSlot): StoredFileInfo => {
    if (KEEP_DOCUMENT_REGEX.test(slot.token)) {
      const d = kept.get(slot.token.slice(5))!;
      return { storageKey: d.storageKey, fileName: d.fileName, mimeType: d.mimeType, size: d.size, sha256: d.sha256, uploadedAt: d.uploadedAt };
    }
    return uploadAsFile(uploads.byHash.get(hashUploadToken(slot.token))!);
  };
  return { resolve, hashes: uploads.hashes };
}

const matchKey = (m: { field: string; value: string; matchedRegistrationId: { toString(): string } }) => `${m.field}|${m.value}|${m.matchedRegistrationId.toString()}`;

/**
 * Saves a new submission version and sends the application back for review, in one transaction:
 * registration details + status, documents, snapshot, agreement re-acceptance, duplicate flag,
 * history, assignment history and audit entry.
 */
export async function resubmit(user: UserDocument, input: RegistrationData, ctx: RequestContext) {
  const reg = await rejectedRegistration(user);
  const fromStatus = reg.status as keyof typeof NEXT_STATUS;
  const toStatus = NEXT_STATUS[fromStatus];
  const settings = await getSettings();

  // The login email and mobile are changed only in My Profile (PRD F3).
  const data: RegistrationData = { ...input, signatory: { ...input.signatory, email: user.email, mobile: user.mobile ?? reg.signatory!.mobile } };

  // PAN / GST must still be unique, ignoring this application itself (PRD F3, 10.1).
  const support = [settings.supportEmail, settings.supportPhone].filter(Boolean).join(' / ');
  const contactUs = support ? `please contact ${support}` : 'please contact us';
  const blocking: FieldErrors = {};
  if (await Registration.exists({ panLock: data.pan, _id: { $ne: reg._id } })) {
    blocking.pan = `A franchise registration with this PAN already exists. If you believe this is an error, ${contactUs}.`;
  }
  if (data.gst && (await Registration.exists({ gstLock: data.gst, _id: { $ne: reg._id } }))) {
    blocking.gst = `A franchise registration with this GST number already exists. If you believe this is an error, ${contactUs}.`;
  }
  if (Object.keys(blocking).length) throw new AppError(409, 'This application cannot be resubmitted. Please see the highlighted fields.', 'duplicate_blocked', { fields: blocking });

  // Only matches not already raised for this application need a new warning and flag.
  const known = new Set((await DuplicateFlag.find({ registrationId: reg._id })).flatMap((f) => f.matches.map(matchKey)));
  const newMatches: DuplicateMatch[] = (await findPossibleDuplicates(data, reg._id)).filter((m) => !known.has(matchKey(m)));
  if (newMatches.length && !data.acknowledgeDuplicates) {
    throw new AppError(409, 'Some details are already linked to another registration.', 'duplicate_warning', { warnings: toWarnings(newMatches) });
  }

  const slots = fileSlots(data);
  const { resolve, hashes } = await resolveFiles(reg._id, slots);

  // Back to the same Accounts reviewer if they are still active (PRD 10.6, A5).
  let assignee: Types.ObjectId | null = null;
  if (toStatus === 'pending_accounts' && reg.assignedTo && (await User.exists({ _id: reg.assignedTo, role: 'accounts', isActive: true }))) {
    assignee = reg.assignedTo;
  }

  const version = reg.currentSubmissionVersion + 1;
  const now = new Date();
  try {
    await mongoose.connection.transaction(async (session) => {
      const openFlag = await DuplicateFlag.exists({ registrationId: reg._id, status: 'open' }).session(session);
      const updated = await Registration.findOneAndUpdate(
        // Conditional: only from the rejected status and the version we read, so a double click saves once.
        { _id: reg._id, userId: user._id, status: fromStatus, currentSubmissionVersion: reg.currentSubmissionVersion },
        {
          $set: {
            status: toStatus,
            franchiseModel: data.franchiseModel,
            firmType: data.firmType,
            firmName: data.firmName,
            pan: data.pan,
            gst: data.gst,
            panLock: data.pan,
            signatory: { name: data.signatory.name, capacity: data.signatory.capacity, email: data.signatory.email, mobile: data.signatory.mobile },
            contacts: data.contacts.map((c) => ({ name: c.name, email: c.email, mobile: c.mobile })),
            currentSubmissionVersion: version,
            lastSubmittedAt: now,
            stageEnteredAt: now,
            hasOpenDuplicateFlag: !!openFlag || newMatches.length > 0,
            ...(toStatus === 'pending_accounts' ? { assignedTo: assignee } : {}),
            ...(data.gst ? { gstLock: data.gst } : {}),
          },
          ...(data.gst ? {} : { $unset: { gstLock: '' } }),
        },
        { session },
      );
      if (!updated) throw new AppError(409, 'Your application has already been resubmitted. Please refresh.', 'already_resubmitted');

      const docId = await saveSubmissionFiles(session, reg._id, version, slots, resolve);
      await claimUploads(session, hashes, reg._id);
      await SubmissionVersion.create([{ registrationId: reg._id, version, submittedAt: now, submittedBy: user._id, ip: ctx.ip, data: snapshotOf(data, docId) }], { session });

      // The same agreement version is accepted again (PRD 10.4).
      await recordAcceptance(
        {
          registrationId: reg._id,
          submissionVersion: version,
          agreementVersionId: data.agreement.agreementVersionId,
          lockedVersionId: reg.agreementVersionId.toString(),
          mergeValues: registrationMergeValues(data, { organisationName: settings.organisationName, acceptedAt: now }),
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        session,
      );

      if (newMatches.length) {
        if (openFlag) await DuplicateFlag.updateOne({ _id: openFlag._id }, { $push: { matches: { $each: newMatches } } }, { session });
        else await DuplicateFlag.create([{ registrationId: reg._id, submissionVersion: version, matches: newMatches, status: 'open' }], { session });
      }

      await RegistrationHistory.create(
        [{ registrationId: reg._id, at: now, event: 'resubmitted', actorId: user._id, actorRole: 'franchise_user', fromStatus, toStatus, submissionVersion: version }],
        { session },
      );
      if (toStatus === 'pending_accounts') {
        await AssignmentHistory.create(
          [{ registrationId: reg._id, at: now, action: assignee ? 'auto_reassign' : 'release', fromUser: reg.assignedTo ?? null, toUser: assignee, by: null, note: assignee ? 'Returned to the same reviewer after resubmission' : 'Previous reviewer no longer active' }],
          { session },
        );
      }
      await audit({ action: 'application_resubmitted', userId: user._id, role: 'franchise_user', targetType: 'registration', targetId: reg._id.toString(), details: { applicationId: reg.applicationId, version, toStatus, duplicateFlag: newMatches.length > 0 }, ip: ctx.ip }, session);
      if (newMatches.length) {
        await audit({ action: 'duplicate_flag_raised', userId: user._id, role: 'franchise_user', targetType: 'registration', targetId: reg._id.toString(), details: { fields: [...new Set(newMatches.map((m) => m.field))] }, ip: ctx.ip }, session);
      }
    });
  } catch (err) {
    const field = duplicateKeyField(err);
    if (field === 'panLock') throw new AppError(409, 'A franchise registration with this PAN already exists.', 'duplicate_blocked', { fields: { pan: 'A franchise registration with this PAN already exists.' } });
    if (field === 'gstLock') throw new AppError(409, 'A franchise registration with this GST number already exists.', 'duplicate_blocked', { fields: { gst: 'A franchise registration with this GST number already exists.' } });
    throw err;
  }

  void notifyResubmitted(reg.applicationId ?? '', data, toStatus === 'pending_accounts' ? 'Accounts' : 'Manager', assignee);
  if (newMatches.length) void notifyAdminsOfDuplicate(reg.applicationId ?? '', data.firmName, newMatches.map((m) => m.field));
  return { status: toStatus, version };
}

/** N7 / N10: applicant confirmation; the assignee (or all Accounts users), or all Managers; and Admin. */
async function notifyResubmitted(applicationId: string, data: RegistrationData, stage: 'Accounts' | 'Manager', assignee: Types.ObjectId | null) {
  try {
    const url = `${config.CLIENT_ORIGIN}/app`;
    const event = stage === 'Accounts' ? 'resubmitted_to_accounts' : 'resubmitted_to_manager';
    const reviewers =
      stage === 'Accounts'
        ? await User.find(assignee ? { _id: assignee } : { role: 'accounts', isActive: true }, { name: 1, email: 1 })
        : await User.find({ role: 'manager', isActive: true }, { name: 1, email: 1 });
    const admins = await User.find({ role: 'admin', isActive: true }, { name: 1, email: 1 });
    await Promise.allSettled([
      resubmittedApplicantEmail(data.signatory.name, applicationId, stage, url).then((m) => sendEmail({ to: data.signatory.email, event, ...m })),
      ...[...reviewers, ...admins].map((u) => resubmittedStaffEmail(u.name, applicationId, data.firmName, stage, url).then((m) => sendEmail({ to: u.email, event, ...m }))),
    ]);
  } catch (err) {
    console.error('Could not send resubmission notifications:', err);
  }
}
