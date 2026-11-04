import { createHash, randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import {
  maskEmail,
  maskMobile,
  registrationMergeValues,
  type DuplicateWarning,
  type FieldErrors,
  type RegistrationData,
  type RegistrationSubmitted,
  type UploadKind,
} from '@fap/shared';
import { AppError } from '../lib/errors';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { PendingUpload } from '../models/PendingUpload';
import { Registration } from '../models/Registration';
import { RegistrationDocument, type DocumentType } from '../models/RegistrationDocument';
import { getSettings } from '../models/Settings';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { User } from '../models/User';
import { recordAcceptance } from './agreement.service';
import { audit } from './audit.service';
import { hashUploadToken } from './upload.service';

interface RequestContext {
  ip?: string;
  userAgent?: string;
}

// ---------- Duplicate rules (PRD 10.1) ----------

export interface DuplicateMatch {
  field: string;
  value: string;
  matchedRegistrationId: Types.ObjectId;
  matchedApplicationId: string | null;
}

/** PAN / GST already registered, or the signatory already has a login: these block. */
async function findBlockingDuplicates(data: RegistrationData, supportContact: string): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const contactUs = supportContact ? `please contact ${supportContact}` : 'please contact us';

  // Only registrations that completed verification hold their PAN / GST (see Registration.panLock).
  if (await Registration.exists({ panLock: data.pan })) {
    errors.pan = `A franchise registration with this PAN already exists. If you believe this is an error, ${contactUs}.`;
  }
  if (data.gst && (await Registration.exists({ gstLock: data.gst }))) {
    errors.gst = `A franchise registration with this GST number already exists. If you believe this is an error, ${contactUs}.`;
  }
  if (await User.exists({ email: data.signatory.email })) {
    errors['signatory.email'] = 'An account already exists with this email. Please log in instead.';
  }
  if (await User.exists({ mobile: data.signatory.mobile })) {
    errors['signatory.mobile'] = 'An account already exists with this mobile number. Please log in instead.';
  }
  return errors;
}

interface PeopleDetails {
  signatory: { email: string; mobile: string };
  contacts: { email: string; mobile: string }[];
}

/**
 * Emails / mobiles already used in another verified registration: a warning plus an Admin
 * review flag. `excludeId` leaves out the applicant's own registration.
 */
export async function findPossibleDuplicates(data: PeopleDetails, excludeId?: Types.ObjectId): Promise<DuplicateMatch[]> {
  const people = [
    { prefix: 'signatory', email: data.signatory.email, mobile: data.signatory.mobile },
    ...data.contacts.map((c, i) => ({ prefix: `contacts.${i}`, email: c.email, mobile: c.mobile })),
  ];
  const emails = [...new Set(people.map((p) => p.email))];
  const mobiles = [...new Set(people.map((p) => p.mobile))];

  // Unverified (possibly abandoned) attempts are ignored, as they are for PAN and GST.
  const others = await Registration.find(
    {
      status: { $ne: 'pending_verification' },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      $or: [
        { 'signatory.email': { $in: emails } },
        { 'signatory.mobile': { $in: mobiles } },
        { 'contacts.email': { $in: emails } },
        { 'contacts.mobile': { $in: mobiles } },
      ],
    },
    { applicationId: 1, signatory: 1, contacts: 1 },
  ).limit(100);

  const matches: DuplicateMatch[] = [];
  for (const person of people) {
    for (const key of ['email', 'mobile'] as const) {
      const value = person[key];
      for (const other of others) {
        const used = other.signatory?.[key] === value || other.contacts.some((c) => c[key] === value);
        if (used) {
          matches.push({ field: `${person.prefix}.${key}`, value, matchedRegistrationId: other._id, matchedApplicationId: other.applicationId ?? null });
        }
      }
    }
  }
  return matches;
}

function toWarnings(matches: DuplicateMatch[]): DuplicateWarning[] {
  const fields = [...new Set(matches.map((m) => m.field))];
  return fields.map((field) => ({
    field,
    message: `This ${field.endsWith('email') ? 'email' : 'mobile number'} is already linked to another registration. Your application will be reviewed by our team.`,
  }));
}

// ---------- Uploaded files ----------

interface FileSlot {
  field: string; // form field, for error messages
  token: string;
  kind: UploadKind; // the upload kind this slot accepts
  type: DocumentType;
  owner: { kind: 'registration' | 'signatory' | 'contact'; index?: number };
}

function fileSlots(data: RegistrationData): FileSlot[] {
  const slots: FileSlot[] = [
    { field: 'panFile', token: data.panFile, kind: 'document', type: 'pan', owner: { kind: 'registration' } },
    { field: 'signatory.idProofFile', token: data.signatory.idProofFile, kind: 'document', type: 'id_proof', owner: { kind: 'signatory' } },
    { field: 'signatory.photoFile', token: data.signatory.photoFile, kind: 'photo', type: 'photo', owner: { kind: 'signatory' } },
  ];
  if (data.gst && data.gstFile) {
    slots.push({ field: 'gstFile', token: data.gstFile, kind: 'document', type: 'gst', owner: { kind: 'registration' } });
  }
  if (data.rentalFile) {
    slots.push({ field: 'rentalFile', token: data.rentalFile, kind: 'rental', type: 'rental', owner: { kind: 'registration' } });
  }
  data.contacts.forEach((c, i) => {
    slots.push({ field: `contacts.${i}.idProofFile`, token: c.idProofFile, kind: 'document', type: 'id_proof', owner: { kind: 'contact', index: i } });
    slots.push({ field: `contacts.${i}.photoFile`, token: c.photoFile, kind: 'photo', type: 'photo', owner: { kind: 'contact', index: i } });
  });
  return slots;
}

/** Finds each uploaded file; files expire after 24 hours and can only be used by one application. */
async function loadUploads(slots: FileSlot[]) {
  const hashes = [...new Set(slots.map((s) => hashUploadToken(s.token)))];
  const uploads = await PendingUpload.find({ tokenHash: { $in: hashes }, claimedBy: null, expiresAt: { $gt: new Date() } });
  const byHash = new Map(uploads.map((u) => [u.tokenHash, u]));

  const errors: FieldErrors = {};
  for (const slot of slots) {
    const upload = byHash.get(hashUploadToken(slot.token));
    if (!upload) errors[slot.field] = 'This file has expired or was not received. Please upload it again.';
    else if (upload.kind !== slot.kind) errors[slot.field] = 'This file was uploaded for a different field. Please upload it again.';
  }
  if (Object.keys(errors).length) {
    throw new AppError(400, 'Some files need to be uploaded again.', 'upload_missing', { fields: errors });
  }
  return { byHash, hashes };
}

// ---------- Submit ----------

/**
 * Saves a new registration in Pending Verification (PRD 6.2) together with its documents,
 * the first submission snapshot, the agreement acceptance and any duplicate flag. Everything
 * is saved in one transaction, so a failure leaves nothing half-saved.
 */
export async function submitRegistration(data: RegistrationData, ctx: RequestContext): Promise<RegistrationSubmitted> {
  const settings = await getSettings();
  const support = [settings.supportEmail, settings.supportPhone].filter(Boolean).join(' / ');

  const blocking = await findBlockingDuplicates(data, support);
  if (Object.keys(blocking).length) {
    throw new AppError(409, 'This registration cannot be submitted. Please see the highlighted fields.', 'duplicate_blocked', { fields: blocking });
  }

  const matches = await findPossibleDuplicates(data);
  if (matches.length && !data.acknowledgeDuplicates) {
    throw new AppError(409, 'Some details are already linked to another registration.', 'duplicate_warning', { warnings: toWarnings(matches) });
  }

  const slots = fileSlots(data);
  const { byHash, hashes } = await loadUploads(slots);

  const registrationId = new Types.ObjectId();
  const now = new Date();
  const verificationToken = randomBytes(32).toString('base64url');

  await mongoose.connection.transaction(async (session) => {
    // 1. Documents, one per file slot (the same upload may be reused, e.g. "Same as Signatory").
    const docs = slots.map((slot) => {
      const upload = byHash.get(hashUploadToken(slot.token))!;
      return {
        _id: new Types.ObjectId(),
        registrationId,
        submissionVersion: 1,
        type: slot.type,
        owner: slot.owner,
        storageKey: upload.storageKey,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        size: upload.size,
        sha256: upload.sha256,
        uploadedAt: upload.createdAt,
      };
    });
    await RegistrationDocument.insertMany(docs, { session });
    const docId = (field: string) => docs[slots.findIndex((s) => s.field === field)]?._id ?? null;

    // 2. Mark the uploads as used; if someone else used one meanwhile, nothing is saved.
    const claim = await PendingUpload.updateMany(
      { tokenHash: { $in: hashes }, claimedBy: null },
      { $set: { claimedBy: registrationId } },
      { session },
    );
    if (claim.modifiedCount !== hashes.length) {
      throw new AppError(409, 'Some files were already used in another submission. Please upload them again.', 'upload_conflict');
    }

    // 3. The application itself.
    await Registration.create(
      [
        {
          _id: registrationId,
          status: 'pending_verification',
          franchiseModel: data.franchiseModel,
          firmType: data.firmType,
          firmName: data.firmName,
          pan: data.pan,
          gst: data.gst,
          signatory: { name: data.signatory.name, capacity: data.signatory.capacity, email: data.signatory.email, mobile: data.signatory.mobile },
          contacts: data.contacts.map((c) => ({ name: c.name, email: c.email, mobile: c.mobile })),
          currentSubmissionVersion: 1,
          agreementVersionId: new Types.ObjectId(data.agreement.agreementVersionId),
          hasOpenDuplicateFlag: matches.length > 0,
          verification: {
            tokenHash: createHash('sha256').update(verificationToken).digest('hex'),
            expiresAt: new Date(now.getTime() + settings.pendingVerificationRetentionDays * 86_400_000),
          },
          submittedAt: now,
        },
      ],
      { session },
    );

    // 4. Permanent snapshot of this submission (version 1).
    await SubmissionVersion.create(
      [
        {
          registrationId,
          version: 1,
          submittedAt: now,
          ip: ctx.ip,
          data: {
            franchiseModel: data.franchiseModel,
            firmType: data.firmType,
            firmName: data.firmName,
            pan: data.pan,
            gst: data.gst,
            panDocumentId: docId('panFile'),
            gstDocumentId: docId('gstFile'),
            rentalDocumentId: docId('rentalFile'),
            signatory: {
              name: data.signatory.name,
              capacity: data.signatory.capacity,
              email: data.signatory.email,
              mobile: data.signatory.mobile,
              idProofDocumentId: docId('signatory.idProofFile'),
              photoDocumentId: docId('signatory.photoFile'),
            },
            contacts: data.contacts.map((c, i) => ({
              name: c.name,
              email: c.email,
              mobile: c.mobile,
              idProofDocumentId: docId(`contacts.${i}.idProofFile`),
              photoDocumentId: docId(`contacts.${i}.photoFile`),
            })),
            agreementVersionId: data.agreement.agreementVersionId,
          },
        },
      ],
      { session },
    );

    // 5. Agreement acceptance (refused if the agreement changed while the form was open).
    await recordAcceptance(
      {
        registrationId,
        submissionVersion: 1,
        agreementVersionId: data.agreement.agreementVersionId,
        mergeValues: registrationMergeValues(data, { organisationName: settings.organisationName, acceptedAt: now }),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      session,
    );

    // 6. Possible duplicate for Admin to review.
    if (matches.length) {
      await DuplicateFlag.create([{ registrationId, submissionVersion: 1, matches, status: 'open' }], { session });
    }

    // 7. Audit entries, saved together with everything above.
    await audit(
      {
        action: 'registration_submitted',
        targetType: 'registration',
        targetId: registrationId.toString(),
        details: { firmName: data.firmName, status: 'pending_verification', contacts: data.contacts.length, duplicateFlag: matches.length > 0 },
        ip: ctx.ip,
      },
      session,
    );
    if (matches.length) {
      await audit(
        { action: 'duplicate_flag_raised', targetType: 'registration', targetId: registrationId.toString(), details: { fields: [...new Set(matches.map((m) => m.field))] }, ip: ctx.ip },
        session,
      );
    }
  });

  return {
    verificationToken,
    maskedEmail: maskEmail(data.signatory.email),
    maskedMobile: maskMobile(data.signatory.mobile),
    status: 'pending_verification',
  };
}
