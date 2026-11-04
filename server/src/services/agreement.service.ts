import { createHash, randomBytes } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import sanitizeHtml from 'sanitize-html';
import {
  AGREEMENT_PDF_MAX_BYTES,
  renderAgreement,
  unknownMergeFields,
  type AgreementDraftData,
  type AgreementFormat,
  type AgreementPdfView,
  type AgreementStatus,
  type AgreementVersionView,
  type MergeValues,
  type PublicAgreementView,
} from '@fap/shared';
import { nextSequence } from '../lib/counters';
import { AppError } from '../lib/errors';
import { cleanFileName, sniffMimeType } from '../lib/files';
import { storage } from '../lib/storage';
import { AgreementAcceptance } from '../models/AgreementAcceptance';
import { AgreementVersion, type AgreementVersionDocument } from '../models/AgreementVersion';
import { User } from '../models/User';
import { audit } from './audit.service';
import type { Actor } from './users.service';

/** Only simple document formatting is kept; anything else (scripts, styles, links) is removed. */
function sanitizeAgreementHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 's', 'u', 'ul', 'ol', 'li', 'br', 'blockquote', 'hr'],
    allowedAttributes: {},
  });
}

const formatOf = (doc: AgreementVersionDocument) => (doc.format ?? 'text') as AgreementFormat;

/** The fields Admin may save on a draft. PDF drafts have no typed text. */
function validateContent(input: AgreementDraftData, format: AgreementFormat) {
  if (format === 'pdf') return { title: input.title };
  const unknown = unknownMergeFields(input.content);
  if (unknown.length) {
    throw new AppError(400, `Unknown merge field(s): ${unknown.map((k) => `{{${k}}}`).join(', ')}. Use the Insert Merge Field menu.`, 'unknown_merge_field');
  }
  return { title: input.title, content: sanitizeAgreementHtml(input.content) };
}

function pdfView(doc: AgreementVersionDocument): AgreementPdfView | null {
  const pdf = doc.pdf;
  return pdf ? { fileName: pdf.fileName, size: pdf.size, pageCount: pdf.pageCount, uploadedAt: pdf.uploadedAt.toISOString() } : null;
}

async function acceptanceCounts(ids: mongoose.Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await AgreementAcceptance.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
    { $match: { agreementVersionId: { $in: ids } } },
    { $group: { _id: '$agreementVersionId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

async function toViews(docs: AgreementVersionDocument[]): Promise<AgreementVersionView[]> {
  const userIds = docs.flatMap((d) => [d.createdBy, d.publishedBy]).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }, { name: 1 });
  const names = new Map(users.map((u) => [u._id.toString(), u.name]));
  const counts = await acceptanceCounts(docs.map((d) => d._id));

  return docs.map((d) => ({
    id: d._id.toString(),
    versionNumber: d.versionNumber,
    title: d.title,
    format: formatOf(d),
    content: d.content,
    pdf: pdfView(d),
    status: d.status as AgreementStatus,
    createdBy: d.createdBy ? names.get(d.createdBy.toString()) ?? null : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    publishedBy: d.publishedBy ? names.get(d.publishedBy.toString()) ?? null : null,
    publishedAt: d.publishedAt?.toISOString() ?? null,
    acceptanceCount: counts.get(d._id.toString()) ?? 0,
  }));
}

async function findVersion(id: string) {
  const doc = await AgreementVersion.findById(id).catch(() => null);
  if (!doc) throw new AppError(404, 'Agreement version not found.', 'not_found');
  return doc;
}

export async function listVersions() {
  const docs = await AgreementVersion.find().sort({ versionNumber: -1 });
  return toViews(docs);
}

export async function getVersion(id: string) {
  const [view] = await toViews([await findVersion(id)]);
  return view;
}

/** The version shown on the public registration page, or null if registration is closed. */
export async function getActiveVersion(): Promise<PublicAgreementView | null> {
  const doc = await AgreementVersion.findOne({ status: 'active' });
  if (!doc) return null;
  const format = formatOf(doc);
  return {
    id: doc._id.toString(),
    versionNumber: doc.versionNumber,
    title: doc.title,
    format,
    content: format === 'text' ? doc.content : '',
    pdf: format === 'pdf' ? pdfView(doc) : null,
    pdfUrl: format === 'pdf' && doc.pdf ? `/api/public/agreements/${doc._id.toString()}/pdf` : null,
  };
}

export async function createDraft(input: AgreementDraftData, actor: Actor) {
  const data = validateContent(input, input.format);
  const versionNumber = await nextSequence('agreement_version');
  const doc = await AgreementVersion.create({ ...data, format: input.format, versionNumber, status: 'draft', createdBy: actor.user._id });
  await audit({ action: 'agreement_draft_created', userId: actor.user._id, role: 'admin', targetType: 'agreement_version', targetId: doc._id.toString(), details: { versionNumber, format: input.format }, ip: actor.ip });
  return getVersion(doc._id.toString());
}

export async function updateDraft(id: string, input: AgreementDraftData, actor: Actor) {
  const existing = await findVersion(id);
  const data = validateContent(input, formatOf(existing));
  // Only drafts can be edited; published versions are locked forever (PRD AD7).
  const doc = await AgreementVersion.findOneAndUpdate({ _id: id, status: 'draft' }, data, { new: true }).catch(() => null);
  if (!doc) throw new AppError(409, 'Only draft versions can be edited. Use "Duplicate as new draft" to change a published version.', 'not_draft');
  await audit({ action: 'agreement_draft_updated', userId: actor.user._id, role: 'admin', targetType: 'agreement_version', targetId: id, details: { versionNumber: doc.versionNumber }, ip: actor.ip });
  return getVersion(id);
}

export async function duplicateAsDraft(id: string, actor: Actor) {
  const source = await findVersion(id);
  const versionNumber = await nextSequence('agreement_version');
  const doc = await AgreementVersion.create({
    title: source.title,
    format: formatOf(source),
    content: source.content,
    // Stored files are never changed, so the copy can safely point at the same file.
    pdf: source.pdf ?? null,
    versionNumber,
    status: 'draft',
    createdBy: actor.user._id,
  });
  await audit({ action: 'agreement_duplicated', userId: actor.user._id, role: 'admin', targetType: 'agreement_version', targetId: doc._id.toString(), details: { fromVersion: source.versionNumber, versionNumber }, ip: actor.ip });
  return getVersion(doc._id.toString());
}

/** Makes a draft or inactive version the single active one; the previous one becomes inactive. */
export async function activateVersion(id: string, actor: Actor) {
  const target = await findVersion(id);
  if (target.status === 'active') return getVersion(id);
  if (formatOf(target) === 'pdf' && !target.pdf) {
    throw new AppError(400, 'Upload the agreement PDF before publishing.', 'empty');
  }
  if (formatOf(target) === 'text' && !target.content.replace(/<[^>]*>/g, '').trim()) {
    throw new AppError(400, 'The agreement text is empty. Add the agreement content before publishing.', 'empty');
  }

  let previous: number | null = null;
  await mongoose.connection.transaction(async (session) => {
    const old = await AgreementVersion.findOneAndUpdate({ status: 'active' }, { status: 'inactive' }, { session });
    previous = old?.versionNumber ?? null;
    const update: Record<string, unknown> = { status: 'active' };
    if (!target.publishedAt) {
      update.publishedAt = new Date();
      update.publishedBy = actor.user._id;
    }
    const res = await AgreementVersion.updateOne({ _id: id, status: { $in: ['draft', 'inactive'] } }, update, { session });
    if (res.modifiedCount !== 1) throw new AppError(409, 'This version changed while you were working. Please refresh.', 'conflict');

    await audit(
      {
        action: target.status === 'draft' ? 'agreement_published' : 'agreement_activated',
        userId: actor.user._id,
        role: 'admin',
        targetType: 'agreement_version',
        targetId: id,
        details: { versionNumber: target.versionNumber, previousActiveVersion: previous },
        ip: actor.ip,
      },
      session,
    );
  });
  return getVersion(id);
}

/** Closes registration until another version is activated. */
export async function deactivateVersion(id: string, actor: Actor) {
  const doc = await AgreementVersion.findOneAndUpdate({ _id: id, status: 'active' }, { status: 'inactive' }, { new: true }).catch(() => null);
  if (!doc) throw new AppError(409, 'Only the active version can be deactivated.', 'not_active');
  await audit({ action: 'agreement_deactivated', userId: actor.user._id, role: 'admin', targetType: 'agreement_version', targetId: id, details: { versionNumber: doc.versionNumber }, ip: actor.ip });
  return getVersion(id);
}

// ---------- PDF agreements ----------

/** Stores an uploaded PDF on a PDF draft, replacing any PDF uploaded to that draft earlier. */
export async function uploadPdf(id: string, data: Buffer, rawFileName: string | undefined, actor: Actor) {
  const version = await findVersion(id);
  if (version.status !== 'draft') {
    throw new AppError(409, 'Only draft versions can be changed. Use "Duplicate as new draft" to change a published version.', 'not_draft');
  }
  if (formatOf(version) !== 'pdf') throw new AppError(400, 'This version is a typed agreement, not a PDF.', 'wrong_format');
  if (!data.length) throw new AppError(400, 'Choose a PDF file to upload.', 'empty');
  if (data.length > AGREEMENT_PDF_MAX_BYTES) throw new AppError(413, 'The PDF must be 10 MB or smaller.', 'too_large');
  // Check the actual file content, not just the file name.
  if (sniffMimeType(data) !== 'application/pdf') {
    throw new AppError(400, 'This file is not a PDF. Please upload the agreement as a PDF.', 'not_pdf');
  }

  let pageCount: number;
  try {
    const pdf = await PDFDocument.load(data, { updateMetadata: false });
    pageCount = pdf.getPageCount();
  } catch (err) {
    const encrypted = err instanceof Error && /encrypt/i.test(err.message);
    throw new AppError(
      400,
      encrypted
        ? 'This PDF is password-protected. Please upload a copy without a password.'
        : 'This PDF could not be read. It may be damaged; please export it again and retry.',
      'invalid_pdf',
    );
  }
  if (pageCount < 1) throw new AppError(400, 'This PDF has no pages.', 'invalid_pdf');

  const sha256 = createHash('sha256').update(data).digest('hex');
  const key = `agreements/${id}/${Date.now()}-${randomBytes(6).toString('hex')}.pdf`;
  await storage.put(key, data);

  const fileName = cleanFileName(rawFileName, 'franchise-agreement.pdf', '.pdf');
  const pdf = { key, fileName, size: data.length, pageCount, sha256, uploadedAt: new Date(), uploadedBy: actor.user._id };
  // Only while it is still a draft: a version published in the meantime stays untouched.
  const updated = await AgreementVersion.findOneAndUpdate({ _id: id, status: 'draft', format: 'pdf' }, { pdf }, { new: true });
  if (!updated) throw new AppError(409, 'This version was published while you were uploading. Please refresh.', 'conflict');

  await audit({
    action: version.pdf ? 'agreement_pdf_replaced' : 'agreement_pdf_uploaded',
    userId: actor.user._id,
    role: 'admin',
    targetType: 'agreement_version',
    targetId: id,
    details: { versionNumber: version.versionNumber, fileName, size: data.length, pageCount, sha256 },
    ip: actor.ip,
  });
  return getVersion(id);
}

/**
 * Opens a version's PDF for streaming. With `activeOnly`, only the currently active version
 * is available (used by the public registration page).
 */
export async function openPdf(id: string, { activeOnly }: { activeOnly: boolean }) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'Not found.', 'not_found');
  const doc = await AgreementVersion.findOne(activeOnly ? { _id: id, status: 'active' } : { _id: id });
  if (!doc?.pdf) throw new AppError(404, 'This agreement PDF is not available.', 'not_found');
  const file = await storage.open(doc.pdf.key);
  return { ...file, fileName: doc.pdf.fileName, mimeType: 'application/pdf' };
}

// ---------- Acceptance (called by the registration submit, build step 3) ----------

export interface RecordAcceptanceInput {
  registrationId: mongoose.Types.ObjectId;
  submissionVersion: number;
  agreementVersionId: string;
  /**
   * On resubmission the registration stays on the version it first accepted (PRD 10.4),
   * so that version is accepted even if it is no longer active. Leave empty on first submit.
   */
  lockedVersionId?: string | null;
  /** Applicant details, used to personalise text agreements. */
  mergeValues: MergeValues;
  ip?: string;
  userAgent?: string;
}

/**
 * Records that the applicant accepted the agreement. Call it inside the same transaction
 * that saves the submission, so both are saved together or not at all.
 */
export async function recordAcceptance(input: RecordAcceptanceInput, session: ClientSession) {
  const lockedId = input.lockedVersionId ?? null;
  const changed = () =>
    new AppError(
      409,
      lockedId
        ? 'Please accept the same agreement version you accepted originally.'
        : 'The franchise agreement was updated while you were filling in the form. Please read the latest agreement and accept it again.',
      'agreement_changed',
    );

  if (!mongoose.isValidObjectId(input.agreementVersionId)) throw changed();
  if (lockedId && lockedId !== input.agreementVersionId) throw changed();

  const version = await AgreementVersion.findOne(
    lockedId ? { _id: lockedId, status: { $ne: 'draft' } } : { _id: input.agreementVersionId, status: 'active' },
  ).session(session);
  if (!version) throw changed();

  const format = formatOf(version);
  if (format === 'pdf' && !version.pdf) throw changed();
  const snapshot =
    format === 'pdf'
      ? { pdfKey: version.pdf!.key, pdfSha256: version.pdf!.sha256, pdfFileName: version.pdf!.fileName }
      : { html: renderAgreement(version.content, input.mergeValues) };

  const [row] = await AgreementAcceptance.create(
    [
      {
        registrationId: input.registrationId,
        submissionVersion: input.submissionVersion,
        agreementVersionId: version._id,
        versionNumber: version.versionNumber,
        title: version.title,
        format,
        snapshot,
        acceptedAt: new Date(),
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 500),
      },
    ],
    { session },
  );
  return row;
}
