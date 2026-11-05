import { keepDocumentRef, type ApplicationDocumentView, type FieldErrors, type RegistrationInput, type SubmissionView } from '@fap/shared';
import type { PickedFile } from '../components/FileUpload';

// State and helpers for the registration form, shared by Register (PRD P2) and Edit & Resubmit (F3).

export interface ContactForm {
  key: string;
  name: string;
  email: string;
  mobile: string;
  idProof: PickedFile | null;
  photo: PickedFile | null;
}

export interface FormState {
  franchiseModel: string;
  firmType: string;
  firmName: string;
  pan: string;
  gst: string;
  panFile: PickedFile | null;
  gstFile: PickedFile | null;
  rentalFile: PickedFile | null;
  signatory: { name: string; capacity: string; email: string; mobile: string; idProof: PickedFile | null; photo: PickedFile | null };
  contacts: ContactForm[];
  sameAsSignatory: boolean;
}

let keySeq = 0;
export const newContact = (): ContactForm => ({ key: `c${++keySeq}`, name: '', email: '', mobile: '', idProof: null, photo: null });

export const emptyForm = (): FormState => ({
  franchiseModel: '',
  firmType: '',
  firmName: '',
  pan: '',
  gst: '',
  panFile: null,
  gstFile: null,
  rentalFile: null,
  signatory: { name: '', capacity: '', email: '', mobile: '', idProof: null, photo: null },
  contacts: [newContact()],
  sameAsSignatory: false,
});

// ---------- Browser autosave for new registrations (typed details only, never files) ----------

const DRAFT_KEY = 'fap.registration.draft.v1';

export function saveDraft(form: FormState) {
  const { panFile: _p, gstFile: _g, rentalFile: _r, ...rest } = form;
  const draft = {
    ...rest,
    signatory: { ...form.signatory, idProof: null, photo: null },
    contacts: form.contacts.map((c) => ({ ...c, idProof: null, photo: null })),
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable (private window): nothing to do */
  }
}

export function loadDraft(): FormState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<FormState>;
    const base = emptyForm();
    const contacts =
      Array.isArray(d.contacts) && d.contacts.length ? d.contacts.map((c) => ({ ...newContact(), name: c.name ?? '', email: c.email ?? '', mobile: c.mobile ?? '' })) : base.contacts;
    return {
      ...base,
      franchiseModel: d.franchiseModel ?? '',
      firmType: d.firmType ?? '',
      firmName: d.firmName ?? '',
      pan: d.pan ?? '',
      gst: d.gst ?? '',
      signatory: { ...base.signatory, ...(d.signatory ?? {}), idProof: null, photo: null },
      contacts,
      sameAsSignatory: !!d.sameAsSignatory,
    };
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- Edit & Resubmit: start from the latest submission ----------

/** A document from an earlier submission, kept unless the applicant replaces it. */
function keptFile(doc: ApplicationDocumentView | null, urlFor: (id: string) => string): PickedFile | null {
  if (!doc) return null;
  return {
    token: keepDocumentRef(doc.id),
    kind: doc.type === 'photo' ? 'photo' : doc.type === 'rental' ? 'rental' : 'document',
    fileName: doc.fileName,
    size: doc.size,
    mimeType: doc.mimeType,
    previewUrl: doc.mimeType.startsWith('image/') ? urlFor(doc.id) : null,
  };
}

export function formFromSubmission(s: SubmissionView, urlFor: (id: string) => string): FormState {
  return {
    franchiseModel: s.franchiseModel,
    firmType: s.firmType,
    firmName: s.firmName,
    pan: s.pan,
    gst: s.gst ?? '',
    panFile: keptFile(s.panDocument, urlFor),
    gstFile: keptFile(s.gstDocument, urlFor),
    rentalFile: keptFile(s.rentalDocument, urlFor),
    signatory: {
      name: s.signatory.name,
      capacity: s.signatory.capacity,
      email: s.signatory.email,
      mobile: s.signatory.mobile,
      idProof: keptFile(s.signatory.idProof, urlFor),
      photo: keptFile(s.signatory.photo, urlFor),
    },
    contacts: s.contacts.map((c) => ({ ...newContact(), name: c.name, email: c.email, mobile: c.mobile, idProof: keptFile(c.idProof, urlFor), photo: keptFile(c.photo, urlFor) })),
    sameAsSignatory: false,
  };
}

// ---------- Sending ----------

/** Builds what is sent to the server. Contact 1 copies the signatory when "Same as" is ticked. */
export function toPayload(form: FormState, agreementId: string, accepted: boolean, legalConsent: boolean, acknowledgeDuplicates: boolean): RegistrationInput {
  const s = form.signatory;
  return {
    franchiseModel: form.franchiseModel,
    firmType: form.firmType as RegistrationInput['firmType'],
    firmName: form.firmName,
    pan: form.pan,
    panFile: form.panFile?.token ?? '',
    gst: form.gst || null,
    gstFile: form.gst ? form.gstFile?.token ?? null : null,
    rentalFile: form.rentalFile?.token ?? null,
    signatory: {
      name: s.name,
      capacity: s.capacity as RegistrationInput['signatory']['capacity'],
      email: s.email,
      mobile: s.mobile,
      idProofFile: s.idProof?.token ?? '',
      photoFile: s.photo?.token ?? '',
    },
    contacts: form.contacts.map((c, i) =>
      i === 0 && form.sameAsSignatory
        ? { name: s.name, email: s.email, mobile: s.mobile, idProofFile: s.idProof?.token ?? '', photoFile: s.photo?.token ?? '' }
        : { name: c.name, email: c.email, mobile: c.mobile, idProofFile: c.idProof?.token ?? '', photoFile: c.photo?.token ?? '' },
    ),
    agreement: { agreementVersionId: agreementId, accepted: accepted as true },
    legalConsent: legalConsent as true,
    acknowledgeDuplicates,
  };
}

export const SECTIONS = [
  { id: 'firm', title: 'Franchise Details', prefixes: ['franchiseModel', 'firmType', 'firmName'] },
  { id: 'documents', title: 'Official Documents', prefixes: ['pan', 'panFile', 'gst', 'gstFile', 'rentalFile'] },
  { id: 'signatory', title: 'Applicant / Signatory', prefixes: ['signatory'] },
  { id: 'contacts', title: 'Contact Persons', prefixes: ['contacts'] },
  { id: 'agreement', title: 'Agreement', prefixes: ['agreement'] },
] as const;

export const sectionHasErrors = (errors: FieldErrors, prefixes: readonly string[]) =>
  Object.keys(errors).some((k) => prefixes.some((p) => k === p || k.startsWith(`${p}.`)));

/** "contacts.1.mobile" -> "Contact 2 mobile number" */
export function fieldLabel(path: string) {
  const [first, second, third] = path.split('.');
  const what = (key: string) => (key === 'email' ? 'email' : 'mobile number');
  if (first === 'signatory') return `Applicant / Signatory ${what(second)}`;
  if (first === 'contacts') return `Contact ${Number(second) + 1} ${what(third)}`;
  return path;
}

export const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 10);
