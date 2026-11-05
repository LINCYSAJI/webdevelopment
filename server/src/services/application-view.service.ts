import mongoose, { type Types } from 'mongoose';
import type { ApplicationDocumentView, HistoryEntryView, Role, SubmissionView } from '@fap/shared';
import { AppError } from '../lib/errors';
import { storage } from '../lib/storage';
import { RegistrationDocument } from '../models/RegistrationDocument';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { User } from '../models/User';

// Read-only views of an application, shared by the Franchise User, Accounts (and later Manager
// and Admin) screens. Callers must check permissions before using these.

type DocId = Types.ObjectId | null | undefined;

/** The shape stored in `submissionversions.data`. */
export interface SubmissionSnapshot {
  franchiseModel: string;
  firmType: string;
  firmName: string;
  pan: string;
  gst: string | null;
  panDocumentId?: DocId;
  gstDocumentId?: DocId;
  rentalDocumentId?: DocId;
  signatory: { name: string; capacity: string; email: string; mobile: string; idProofDocumentId?: DocId; photoDocumentId?: DocId };
  contacts: { name: string; email: string; mobile: string; idProofDocumentId?: DocId; photoDocumentId?: DocId }[];
  agreementVersionId?: string;
}

async function loadVersion(registrationId: Types.ObjectId, version: number) {
  const snap = await SubmissionVersion.findOne({ registrationId, version });
  if (!snap) return null;
  const docs = await RegistrationDocument.find({ registrationId, submissionVersion: version });
  return { snap, data: snap.data as SubmissionSnapshot, byId: new Map(docs.map((d) => [d._id.toString(), d])) };
}

/** One submission (v1, v2, …) exactly as it was sent. */
export async function toSubmissionView(registrationId: Types.ObjectId, version: number): Promise<SubmissionView> {
  const loaded = await loadVersion(registrationId, version);
  if (!loaded) throw new AppError(404, 'This version was not found.', 'not_found');
  const { snap, data, byId } = loaded;
  const doc = (id?: DocId): ApplicationDocumentView | null => {
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

/**
 * "Changes since last review" (PRD A3): fields and documents that differ between this version and
 * the one before. Documents are compared by content fingerprint, so a re-uploaded identical file
 * does not count as a change. Paths match SubmissionView (e.g. "signatory.photo", "contacts.1.email").
 */
export async function changesSincePrevious(registrationId: Types.ObjectId, version: number): Promise<string[] | null> {
  if (version < 2) return null;
  const [cur, prev] = await Promise.all([loadVersion(registrationId, version), loadVersion(registrationId, version - 1)]);
  if (!cur || !prev) return null;
  const changes: string[] = [];
  const sha = (v: typeof cur, id?: DocId) => (id ? v.byId.get(id.toString())?.sha256 ?? null : null);
  const field = (path: string, a: unknown, b: unknown) => {
    if ((a ?? null) !== (b ?? null)) changes.push(path);
  };
  const file = (path: string, a?: DocId, b?: DocId) => {
    if (sha(cur, a) !== sha(prev, b)) changes.push(path);
  };

  const c = cur.data;
  const p = prev.data;
  for (const k of ['franchiseModel', 'firmType', 'firmName', 'pan', 'gst'] as const) field(k, c[k], p[k]);
  file('panDocument', c.panDocumentId, p.panDocumentId);
  file('gstDocument', c.gstDocumentId, p.gstDocumentId);
  file('rentalDocument', c.rentalDocumentId, p.rentalDocumentId);
  for (const k of ['name', 'capacity', 'email', 'mobile'] as const) field(`signatory.${k}`, c.signatory[k], p.signatory[k]);
  file('signatory.idProof', c.signatory.idProofDocumentId, p.signatory.idProofDocumentId);
  file('signatory.photo', c.signatory.photoDocumentId, p.signatory.photoDocumentId);

  c.contacts.forEach((contact, i) => {
    const before = p.contacts[i];
    if (!before) {
      changes.push(`contacts.${i}`);
      return;
    }
    for (const k of ['name', 'email', 'mobile'] as const) field(`contacts.${i}.${k}`, contact[k], before[k]);
    file(`contacts.${i}.idProof`, contact.idProofDocumentId, before.idProofDocumentId);
    file(`contacts.${i}.photo`, contact.photoDocumentId, before.photoDocumentId);
  });
  if (p.contacts.length > c.contacts.length) changes.push(`contacts.removed.${p.contacts.length - c.contacts.length}`);
  return changes;
}

/** Streams a document after checking it belongs to the given registration. */
export async function openRegistrationDocument(registrationId: Types.ObjectId, documentId: string) {
  if (!mongoose.isValidObjectId(documentId)) throw new AppError(404, 'Document not found.', 'not_found');
  const doc = await RegistrationDocument.findOne({ _id: documentId, registrationId });
  if (!doc) throw new AppError(404, 'Document not found.', 'not_found');
  if (doc.erasedAt) throw new AppError(410, "This file was erased at the applicant's request.", 'erased');
  const file = await storage.open(doc.storageKey);
  return { ...file, fileName: doc.fileName, mimeType: doc.mimeType };
}

// ---------- History ----------

const HISTORY_TITLES: Record<string, string> = {
  submitted: 'Application submitted',
  resubmitted: 'Application resubmitted',
  accounts_approved: 'Approved by Accounts',
  accounts_rejected: 'Changes requested by Accounts',
  manager_approved: 'Final approval given',
  manager_rejected: 'Changes requested by Manager',
  withdrawn_erased: 'Application withdrawn and personal data erased',
};

const ROLE_TEAM: Record<string, string> = { franchise_user: 'Applicant', accounts: 'Accounts Team', manager: 'Manager', admin: 'Admin' };

interface HistoryRow {
  at: Date;
  event: string;
  actorId?: Types.ObjectId | null;
  actorRole?: string | null;
  reason?: string | null;
  submissionVersion?: number | null;
}

/**
 * The timeline. Applicants never see reviewers' personal names (PRD F2): they see "You",
 * "Accounts Team" or "Manager". Internal users see full names (PRD A3).
 */
export async function toHistoryView(rows: HistoryRow[], audience: 'applicant' | 'internal'): Promise<HistoryEntryView[]> {
  const names = new Map<string, string>();
  if (audience === 'internal') {
    const ids = [...new Set(rows.map((r) => r.actorId?.toString()).filter(Boolean))];
    for (const u of await User.find({ _id: { $in: ids } }, { name: 1 })) names.set(u._id.toString(), u.name);
  }
  return rows.map((h) => {
    const role = (h.actorRole ?? null) as Role | null;
    const by =
      audience === 'applicant'
        ? role === 'franchise_user'
          ? 'You'
          : ROLE_TEAM[role ?? ''] ?? 'System'
        : `${names.get(h.actorId?.toString() ?? '') ?? 'System'}${role ? ` (${ROLE_TEAM[role] ?? role})` : ''}`;
    return {
      at: h.at.toISOString(),
      event: h.event,
      title: HISTORY_TITLES[h.event] ?? h.event,
      by,
      reason: h.reason ?? null,
      submissionVersion: h.submissionVersion ?? null,
    };
  });
}
