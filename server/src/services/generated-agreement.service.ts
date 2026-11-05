import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import {
  formatDateIST,
  formatDateTimeIST,
  registrationMergeValues,
  renderAgreement,
  type AgreementEmailLogView,
  type GeneratedAgreementRow,
  type GeneratedAgreementSummary,
  type GenerationStatus,
  type Role,
  type SendAgreementInput,
} from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { storage } from '../lib/storage';
import { AgreementAcceptance } from '../models/AgreementAcceptance';
import { AgreementEmailLog } from '../models/AgreementEmailLog';
import { AgreementVersion } from '../models/AgreementVersion';
import { GeneratedAgreement, type GeneratedAgreementDocument } from '../models/GeneratedAgreement';
import { Registration } from '../models/Registration';
import { getSettings } from '../models/Settings';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { User, type UserDocument } from '../models/User';
import { buildAgreementPdf } from './agreement-pdf';
import type { SubmissionSnapshot } from './application-view.service';
import { audit } from './audit.service';
import { sendEmail, sendEmailWithResult } from './email.service';
import { agreementEmail, defaultAgreementEmailText, pdfGenerationFailedEmail } from './email-templates';

// The agreement PDF (PRD §9) and its delivery by the Manager (PRD M5). Access: Managers only
// (CLAUDE.md rule 4); the routes enforce the role, and every view, download and email is audited.

interface Actor {
  user: UserDocument;
  ip?: string;
}

const fileNameFor = (referenceNumber: string) => `Franchise-Agreement-${referenceNumber.replace(/\//g, '-')}.pdf`;

export function toSummary(g: GeneratedAgreementDocument): GeneratedAgreementSummary {
  return {
    id: g._id.toString(),
    referenceNumber: g.referenceNumber,
    status: g.status as GenerationStatus,
    generatedAt: g.file?.generatedAt.toISOString() ?? null,
    error: g.status === 'failed' ? g.error ?? 'Unknown error' : null,
    pageCount: g.file?.pageCount ?? null,
  };
}

/** Builds the PDF from the approved data (PRD 9.2). */
async function buildFor(g: GeneratedAgreementDocument) {
  const reg = await Registration.findById(g.registrationId);
  if (!reg) throw new Error('Registration not found');
  const [settings, snap, acceptance, version] = await Promise.all([
    getSettings(),
    SubmissionVersion.findOne({ registrationId: reg._id, version: g.submissionVersion }),
    AgreementAcceptance.findOne({ registrationId: reg._id, submissionVersion: g.submissionVersion }).sort({ acceptedAt: -1 }),
    AgreementVersion.findById(g.agreementVersionId),
  ]);
  if (!snap || !acceptance || !version) throw new Error('The approved submission, its acceptance or its agreement version is missing');
  const data = snap.data as SubmissionSnapshot;

  let content: { format: 'text'; html: string } | { format: 'pdf'; bytes: Uint8Array };
  if ((version.format ?? 'text') === 'pdf') {
    if (!version.pdf) throw new Error('The accepted agreement PDF is missing');
    content = { format: 'pdf', bytes: await storage.read(version.pdf.key) };
  } else {
    // Typed agreement: merge fields filled from the approved data, now including the reference and approval date.
    const values = registrationMergeValues(data, { organisationName: settings.organisationName, acceptedAt: acceptance.acceptedAt });
    values.agreement_reference_no = g.referenceNumber;
    values.approval_date = formatDateIST(g.approvedAt);
    content = { format: 'text', html: renderAgreement(version.content, values) };
  }

  return buildAgreementPdf({
    organisationName: settings.organisationName,
    primaryColor: settings.primaryColor,
    logoDataUrl: settings.logoUrl ?? null,
    title: version.title,
    referenceNumber: g.referenceNumber,
    agreementVersionNumber: version.versionNumber,
    details: {
      franchiseModel: data.franchiseModel,
      firmType: data.firmType,
      firmName: data.firmName,
      pan: data.pan,
      gst: data.gst ?? null,
      signatory: { name: data.signatory.name, capacity: data.signatory.capacity, email: data.signatory.email, mobile: data.signatory.mobile },
      contacts: data.contacts.map((c) => ({ name: c.name, mobile: c.mobile, email: c.email })),
    },
    content,
    acceptedBy: data.signatory.name,
    acceptedAt: formatDateTimeIST(acceptance.acceptedAt),
    approvedAt: formatDateTimeIST(g.approvedAt),
    generatedAt: formatDateTimeIST(new Date()),
  });
}

/**
 * Generates (or regenerates after a failure) the PDF and stores it privately. Never throws: a
 * failure is recorded on the record and Managers and Admin are alerted (PRD 9.1, N12).
 */
export async function generate(generatedId: mongoose.Types.ObjectId): Promise<GeneratedAgreementDocument | null> {
  // Claim the work, so two requests never generate the same agreement at once.
  const claimed = await GeneratedAgreement.findOneAndUpdate(
    { _id: generatedId, status: { $in: ['pending', 'failed'] } },
    { $set: { status: 'pending', error: null }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (!claimed) return GeneratedAgreement.findById(generatedId);

  try {
    const { bytes, pageCount } = await buildFor(claimed);
    const data = Buffer.from(bytes);
    const storageKey = `agreements/generated/${claimed.registrationId.toString()}/${Date.now()}-${claimed.attempts}.pdf`;
    await storage.put(storageKey, data);
    const file = {
      storageKey,
      fileName: fileNameFor(claimed.referenceNumber),
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      pageCount,
      generatedAt: new Date(),
    };
    return await GeneratedAgreement.findOneAndUpdate(
      { _id: claimed._id, status: 'pending' },
      { $set: { status: 'generated', file, error: null }, ...(claimed.file ? { $push: { previousFiles: claimed.file } } : {}) },
      { new: true },
    );
  } catch (err) {
    console.error('Agreement PDF generation failed:', err);
    const message = err instanceof Error ? err.message.slice(0, 500) : 'Unknown error';
    const failed = await GeneratedAgreement.findOneAndUpdate({ _id: claimed._id }, { $set: { status: 'failed', error: message } }, { new: true });
    await audit({ action: 'agreement_pdf_failed', targetType: 'generated_agreement', targetId: claimed._id.toString(), details: { referenceNumber: claimed.referenceNumber, error: message } });
    void notifyGenerationFailed(claimed);
    return failed;
  }
}

async function notifyGenerationFailed(g: GeneratedAgreementDocument) {
  try {
    const reg = await Registration.findById(g.registrationId, { applicationId: 1 });
    const staff = await User.find({ role: { $in: ['manager', 'admin'] }, isActive: true }, { name: 1, email: 1, role: 1 });
    await Promise.allSettled(
      staff.map((u) =>
        pdfGenerationFailedEmail(u.name, reg?.applicationId ?? '', g.referenceNumber, `${config.CLIENT_ORIGIN}/app/manager/agreements`).then((m) =>
          sendEmail({ to: u.email, event: 'pdf_generation_failed', ...m }),
        ),
      ),
    );
  } catch (err) {
    console.error('Could not send the generation-failed alert:', err);
  }
}

async function findGenerated(id: string) {
  const g = mongoose.isValidObjectId(id) ? await GeneratedAgreement.findById(id) : null;
  if (!g) throw new AppError(404, 'Agreement not found.', 'not_found');
  return g;
}

/** Retry Generation (PRD M5): only for a failed agreement. */
export async function retry(id: string, actor: Actor) {
  const g = await findGenerated(id);
  if (g.status !== 'failed') throw new AppError(409, 'Only a failed agreement can be generated again.', 'not_failed');
  await audit({ action: 'agreement_pdf_retry', userId: actor.user._id, role: actor.user.role as Role, targetType: 'generated_agreement', targetId: id, ip: actor.ip });
  const result = await generate(g._id);
  return toSummary(result ?? g);
}

/** View or download the PDF (Managers only; enforced by the route). */
export async function openPdf(id: string, download: boolean, actor: Actor) {
  const g = await findGenerated(id);
  if (g.status !== 'generated' || !g.file) throw new AppError(409, 'The agreement PDF is not available yet.', 'not_generated');
  await audit({
    action: download ? 'agreement_pdf_downloaded' : 'agreement_pdf_viewed',
    userId: actor.user._id,
    role: actor.user.role as Role,
    targetType: 'generated_agreement',
    targetId: id,
    details: { referenceNumber: g.referenceNumber },
    ip: actor.ip,
  });
  const file = await storage.open(g.file.storageKey);
  return { ...file, fileName: g.file.fileName, mimeType: 'application/pdf' };
}

// ---------- M5 list, email dialog, sending, history ----------

export async function list(): Promise<GeneratedAgreementRow[]> {
  const items = await GeneratedAgreement.find().sort({ approvedAt: -1 }).limit(1000);
  const regs = new Map(
    (await Registration.find({ _id: { $in: items.map((g) => g.registrationId) } }, { applicationId: 1, firmName: 1, signatory: 1 })).map((r) => [r._id.toString(), r]),
  );
  const stats = await AgreementEmailLog.aggregate<{ _id: mongoose.Types.ObjectId; sent: number; last: Date; lastStatus: 'sent' | 'failed' }>([
    { $match: { generatedAgreementId: { $in: items.map((g) => g._id) } } },
    { $sort: { at: 1 } },
    { $group: { _id: '$generatedAgreementId', sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } }, last: { $last: '$at' }, lastStatus: { $last: '$status' } } },
  ]);
  const byId = new Map(stats.map((s) => [s._id.toString(), s]));
  return items.map((g) => {
    const reg = regs.get(g.registrationId.toString());
    const s = byId.get(g._id.toString());
    return {
      ...toSummary(g),
      registrationId: g.registrationId.toString(),
      applicationId: reg?.applicationId ?? '',
      firmName: reg?.firmName ?? '',
      recipient: reg?.signatory?.email ?? '',
      approvedAt: g.approvedAt.toISOString(),
      lastEmailedAt: s?.last.toISOString() ?? null,
      lastEmailStatus: s?.lastStatus ?? null,
      timesSent: s?.sent ?? 0,
    };
  });
}

/** Prefilled values for the "Send to Franchisee" dialog. The recipient cannot be changed (PRD A9). */
export async function emailDraft(id: string) {
  const g = await findGenerated(id);
  const [reg, settings] = await Promise.all([Registration.findById(g.registrationId), getSettings()]);
  if (!reg) throw new AppError(404, 'Agreement not found.', 'not_found');
  return { recipient: reg.signatory!.email, ...defaultAgreementEmailText(reg.signatory!.name, g.referenceNumber, settings.organisationName) };
}

/** N11: emails the PDF as an attachment to the signatory's registered email. Every attempt is logged. */
export async function send(id: string, input: SendAgreementInput, actor: Actor) {
  const g = await findGenerated(id);
  if (g.status !== 'generated' || !g.file) throw new AppError(409, 'The agreement PDF is not available yet.', 'not_generated');
  const reg = await Registration.findById(g.registrationId);
  if (!reg) throw new AppError(404, 'Agreement not found.', 'not_found');
  const recipient = reg.signatory!.email;

  const content = await storage.read(g.file.storageKey);
  const rendered = await agreementEmail(input.subject, input.message);
  const result = await sendEmailWithResult({
    to: recipient,
    event: 'agreement_sent',
    ...rendered,
    subject: input.subject,
    attachments: [{ filename: g.file.fileName, content, contentType: 'application/pdf' }],
  });

  const at = new Date();
  await mongoose.connection.transaction(async (session) => {
    await AgreementEmailLog.create(
      [{ generatedAgreementId: g._id, registrationId: reg._id, at, recipient, subject: input.subject, sentBy: actor.user._id, status: result.ok ? 'sent' : 'failed', error: result.error }],
      { session },
    );
    await audit(
      {
        action: result.ok ? 'agreement_emailed' : 'agreement_email_failed',
        userId: actor.user._id,
        role: actor.user.role as Role,
        targetType: 'generated_agreement',
        targetId: id,
        details: { referenceNumber: g.referenceNumber, recipient, error: result.error },
        ip: actor.ip,
      },
      session,
    );
  });
  if (!result.ok) throw new AppError(502, 'The email could not be sent. It has been logged; please try again.', 'email_failed');
  return { recipient, at: at.toISOString() };
}

export async function emailHistory(id: string): Promise<AgreementEmailLogView[]> {
  const g = await findGenerated(id);
  const logs = await AgreementEmailLog.find({ generatedAgreementId: g._id }).sort({ at: -1 });
  const names = new Map((await User.find({ _id: { $in: logs.map((l) => l.sentBy) } }, { name: 1 })).map((u) => [u._id.toString(), u.name]));
  return logs.map((l) => ({
    at: l.at.toISOString(),
    recipient: l.recipient,
    subject: l.subject,
    status: l.status as 'sent' | 'failed',
    sentBy: names.get(l.sentBy.toString()) ?? 'Unknown',
    error: l.error ?? null,
  }));
}
