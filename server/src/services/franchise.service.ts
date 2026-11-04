import bcrypt from 'bcryptjs';
import mongoose, { type Types } from 'mongoose';
import {
  maskEmail,
  maskMobile,
  type AgreementFormat,
  type ApplicationDocumentView,
  type ApplicationStatus,
  type ContactChangeConfirmInput,
  type ContactChangeStartInput,
  type HistoryEntryView,
  type MyApplicationView,
  type Role,
  type SubmissionView,
} from '@fap/shared';
import { AppError } from '../lib/errors';
import { duplicateKeyField } from '../lib/mongo-errors';
import { storage } from '../lib/storage';
import { AgreementAcceptance } from '../models/AgreementAcceptance';
import { AgreementVersion } from '../models/AgreementVersion';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { Registration } from '../models/Registration';
import { RegistrationDocument } from '../models/RegistrationDocument';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { User, type UserDocument } from '../models/User';
import { audit } from './audit.service';
import { sendEmail } from './email.service';
import { contactChangedEmail } from './email-templates';
import { findPossibleDuplicates, notifyAdminsOfDuplicate } from './registration.service';
import { issueOtp, verifyOtp } from './otp.service';

/** Every query here is limited to the logged-in user's own registration (CLAUDE.md rule 2). */
async function myRegistration(user: UserDocument) {
  const reg = await Registration.findOne({ userId: user._id });
  if (!reg) throw new AppError(404, 'No application was found for your account.', 'not_found');
  return reg;
}

const UNDER_REVIEW: ApplicationStatus[] = ['pending_accounts', 'pending_manager'];

// ---------- Views ----------

type Snapshot = {
  franchiseModel: string;
  firmType: string;
  firmName: string;
  pan: string;
  gst: string | null;
  panDocumentId?: Types.ObjectId | null;
  gstDocumentId?: Types.ObjectId | null;
  rentalDocumentId?: Types.ObjectId | null;
  signatory: { name: string; capacity: string; email: string; mobile: string; idProofDocumentId?: Types.ObjectId | null; photoDocumentId?: Types.ObjectId | null };
  contacts: { name: string; email: string; mobile: string; idProofDocumentId?: Types.ObjectId | null; photoDocumentId?: Types.ObjectId | null }[];
};

async function toSubmissionView(registrationId: Types.ObjectId, version: number): Promise<SubmissionView> {
  const snap = await SubmissionVersion.findOne({ registrationId, version });
  if (!snap) throw new AppError(404, 'This version was not found.', 'not_found');
  const data = snap.data as Snapshot;
  const docs = await RegistrationDocument.find({ registrationId, submissionVersion: version });
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  const doc = (id?: Types.ObjectId | null): ApplicationDocumentView | null => {
    const d = id ? byId.get(id.toString()) : undefined;
    return d ? { id: d._id.toString(), type: d.type as ApplicationDocumentView['type'], fileName: d.fileName, mimeType: d.mimeType, size: d.size } : null;
  };
  return {
    version,
    submittedAt: snap.submittedAt.toISOString(),
    franchiseModel: data.franchiseModel,
    firmType: data.firmType,
    firmName: data.firmName,
    pan: data.pan,
    gst: data.gst ?? null,
    panDocument: doc(data.panDocumentId),
    gstDocument: doc(data.gstDocumentId),
    rentalDocument: doc(data.rentalDocumentId),
    signatory: {
      name: data.signatory.name,
      capacity: data.signatory.capacity,
      email: data.signatory.email,
      mobile: data.signatory.mobile,
      idProof: doc(data.signatory.idProofDocumentId),
      photo: doc(data.signatory.photoDocumentId),
    },
    contacts: data.contacts.map((c) => ({ name: c.name, email: c.email, mobile: c.mobile, idProof: doc(c.idProofDocumentId), photo: doc(c.photoDocumentId) })),
  };
}

const HISTORY_TITLES: Record<string, string> = {
  submitted: 'Application submitted',
  resubmitted: 'Application resubmitted',
  accounts_approved: 'Approved by Accounts',
  accounts_rejected: 'Changes requested by Accounts',
  manager_approved: 'Final approval given',
  manager_rejected: 'Changes requested by Manager',
};

// Reviewers' personal names are never shown to the applicant (PRD F2).
const actorLabel = (role: Role | null) =>
  role === 'franchise_user' ? 'You' : role === 'accounts' ? 'Accounts Team' : role === 'manager' ? 'Manager' : role === 'admin' ? 'Admin' : 'System';

export async function getMyApplication(user: UserDocument): Promise<MyApplicationView> {
  const reg = await myRegistration(user);
  const [versions, history, acceptance] = await Promise.all([
    SubmissionVersion.find({ registrationId: reg._id }, { version: 1 }).sort({ version: 1 }),
    RegistrationHistory.find({ registrationId: reg._id }).sort({ at: 1 }),
    AgreementAcceptance.findOne({ registrationId: reg._id }).sort({ acceptedAt: -1 }),
  ]);
  const agreementVersion = acceptance ? await AgreementVersion.findById(acceptance.agreementVersionId, { format: 1 }) : null;

  const historyView: HistoryEntryView[] = history.map((h) => ({
    at: h.at.toISOString(),
    event: h.event,
    title: HISTORY_TITLES[h.event] ?? h.event,
    by: actorLabel(h.actorRole as Role | null),
    reason: h.reason ?? null,
    submissionVersion: h.submissionVersion ?? null,
  }));
  const lastRejection = [...history].reverse().find((h) => h.event === 'accounts_rejected' || h.event === 'manager_rejected');
  const status = reg.status as ApplicationStatus;

  return {
    applicationId: reg.applicationId ?? '',
    status,
    submittedAt: reg.submittedAt.toISOString(),
    currentVersion: reg.currentSubmissionVersion,
    versions: versions.map((v) => v.version),
    current: await toSubmissionView(reg._id, reg.currentSubmissionVersion),
    agreement: acceptance
      ? { versionNumber: acceptance.versionNumber, title: acceptance.title, format: (agreementVersion?.format ?? acceptance.format) as AgreementFormat, acceptedAt: acceptance.acceptedAt.toISOString() }
      : null,
    history: historyView,
    latestRejection:
      lastRejection && (status === 'rejected_by_accounts' || status === 'rejected_by_manager')
        ? { stage: lastRejection.event === 'accounts_rejected' ? 'Accounts' : 'Manager', reason: lastRejection.reason ?? '', at: lastRejection.at.toISOString() }
        : null,
    canChangeContactDetails: !UNDER_REVIEW.includes(status),
  };
}

export async function getMySubmission(user: UserDocument, version: number) {
  const reg = await myRegistration(user);
  if (!Number.isInteger(version) || version < 1) throw new AppError(404, 'This version was not found.', 'not_found');
  return toSubmissionView(reg._id, version);
}

/** Streams one of the user's own documents; anything else is "not found". */
export async function openMyDocument(user: UserDocument, documentId: string) {
  const reg = await myRegistration(user);
  if (!mongoose.isValidObjectId(documentId)) throw new AppError(404, 'Document not found.', 'not_found');
  const doc = await RegistrationDocument.findOne({ _id: documentId, registrationId: reg._id });
  if (!doc) throw new AppError(404, 'Document not found.', 'not_found');
  const file = await storage.open(doc.storageKey);
  return { ...file, fileName: doc.fileName, mimeType: doc.mimeType };
}

// ---------- Change login email / mobile (PRD F4) ----------

const otpSubject = (user: UserDocument, kind: 'email' | 'mobile') => ({
  purpose: kind === 'email' ? ('change_email' as const) : ('change_mobile' as const),
  channel: kind === 'email' ? ('email' as const) : ('sms' as const),
  subjectKey: `user:${user._id.toString()}`,
});

async function assertNotUnderReview(user: UserDocument) {
  const reg = await myRegistration(user);
  if (UNDER_REVIEW.includes(reg.status as ApplicationStatus)) {
    throw new AppError(409, 'You can change your email or mobile only when your application is not under review.', 'under_review');
  }
  return reg;
}

/** Step 1: checks the current password and sends a code to the NEW email or mobile. */
export async function startContactChange(user: UserDocument, input: ContactChangeStartInput, ip?: string) {
  await assertNotUnderReview(user);
  if (!user.passwordHash || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'Your current password is not correct.', 'wrong_password', { fields: { currentPassword: 'Your current password is not correct.' } });
  }
  const current = input.kind === 'email' ? user.email : user.mobile;
  if (input.value === current) {
    throw new AppError(400, `This is already your ${input.kind === 'email' ? 'email' : 'mobile number'}.`, 'unchanged', { fields: { value: 'Enter a different value.' } });
  }
  if (await User.exists({ [input.kind]: input.value, _id: { $ne: user._id } })) {
    throw new AppError(409, `This ${input.kind === 'email' ? 'email' : 'mobile number'} is already used by another account.`, 'in_use', { fields: { value: 'Already used by another account.' } });
  }
  const state = await issueOtp(otpSubject(user, input.kind), input.value, 'change_email');
  await audit({ action: `${input.kind}_change_requested`, userId: user._id, role: 'franchise_user', ip });
  return { sentTo: input.kind === 'email' ? maskEmail(input.value) : maskMobile(input.value), ...state };
}

/** Step 2: the code proves the new value belongs to the user; login and application details are updated. */
export async function confirmContactChange(user: UserDocument, input: ContactChangeConfirmInput, ip?: string) {
  const reg = await assertNotUnderReview(user);
  const newValue = await verifyOtp(otpSubject(user, input.kind), input.code);
  const oldEmail = user.email;
  const oldValue = input.kind === 'email' ? user.email : user.mobile;
  const field = `signatory.${input.kind}`;

  // The same duplicate rule as at registration (PRD 10.1): a value used in another registration
  // raises a flag for Admin. Only the changed field is checked; the others were checked before.
  const s = reg.signatory!;
  const people = {
    signatory: { email: input.kind === 'email' ? newValue : s.email, mobile: input.kind === 'mobile' ? newValue : s.mobile },
    contacts: reg.contacts,
  };
  const matches = (await findPossibleDuplicates(people, reg._id)).filter((m) => m.field === field);

  try {
    await mongoose.connection.transaction(async (session) => {
      // Conditional on the status at the moment of saving, so a change cannot land while a
      // resubmission is moving the application into review.
      const updated = await Registration.findOneAndUpdate(
        { _id: reg._id, userId: user._id, status: { $nin: UNDER_REVIEW } },
        { $set: { [field]: newValue, ...(matches.length ? { hasOpenDuplicateFlag: true } : {}) } },
        { session },
      );
      if (!updated) throw new AppError(409, 'You can change your email or mobile only when your application is not under review.', 'under_review');
      await User.updateOne({ _id: user._id }, { $set: { [input.kind]: newValue } }, { session });

      if (matches.length) {
        const open = await DuplicateFlag.findOne({ registrationId: reg._id, status: 'open' }).session(session);
        if (open) await DuplicateFlag.updateOne({ _id: open._id }, { $push: { matches: { $each: matches } } }, { session });
        else await DuplicateFlag.create([{ registrationId: reg._id, submissionVersion: reg.currentSubmissionVersion, matches, status: 'open' }], { session });
        await audit({ action: 'duplicate_flag_raised', userId: user._id, role: 'franchise_user', targetType: 'registration', targetId: reg._id.toString(), details: { fields: [field], reason: `${input.kind}_changed` }, ip }, session);
      }
      await audit({ action: `${input.kind}_changed`, userId: user._id, role: 'franchise_user', targetType: 'user', targetId: user._id.toString(), details: { from: oldValue, to: newValue }, ip }, session);
    });
  } catch (err) {
    if (duplicateKeyField(err)) {
      throw new AppError(409, `This ${input.kind === 'email' ? 'email' : 'mobile number'} is already used by another account.`, 'in_use');
    }
    throw err;
  }

  void contactChangedEmail(user.name, input.kind === 'email' ? 'email address' : 'mobile number', newValue).then((m) =>
    sendEmail({ to: oldEmail, event: `${input.kind}_changed`, ...m }),
  );
  if (matches.length) void notifyAdminsOfDuplicate(reg.applicationId ?? '', reg.firmName, [field]);
  return User.findById(user._id);
}
