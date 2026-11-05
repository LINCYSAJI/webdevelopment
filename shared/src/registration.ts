import { z } from 'zod';
import { agreementAcceptanceInputSchema } from './admin';
import type { MergeValues } from './agreement';
import { FIRM_TYPES, SIGNATORY_CAPACITIES, type ApplicationStatus } from './constants';
import { formatDateIST } from './format';
import { GST_REGEX, MOBILE_REGEX, PAN_REGEX, gstMatchesPan } from './validators';

// Franchise Registration form (PRD §8). The same rules run in the browser and on the server.

// ---------- File uploads ----------

/**
 * - document: PAN image, GST certificate, ID proofs (JPG, PNG or PDF)
 * - photo: photographs (JPG or PNG)
 * - rental: rental agreement (JPG, PNG or PDF, larger limit)
 */
export const UPLOAD_KINDS = ['document', 'photo', 'rental'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const UPLOAD_MIME_TYPES: Record<UploadKind, readonly string[]> = {
  document: ['image/jpeg', 'image/png', 'application/pdf'],
  photo: ['image/jpeg', 'image/png'],
  rental: ['image/jpeg', 'image/png', 'application/pdf'],
};

export const UPLOAD_TYPE_LABELS: Record<UploadKind, string> = {
  document: 'JPG, PNG or PDF',
  photo: 'JPG or PNG',
  rental: 'JPG, PNG or PDF',
};

/** File size limits from Settings, sent to the registration page. */
export interface UploadLimits {
  maxDocumentSizeMB: number;
  maxPhotoSizeMB: number;
  maxRentalSizeMB: number;
}

export const uploadLimitMB = (kind: UploadKind, limits: UploadLimits) =>
  kind === 'photo' ? limits.maxPhotoSizeMB : kind === 'rental' ? limits.maxRentalSizeMB : limits.maxDocumentSizeMB;

/** What the server returns after a file is uploaded. The token is used once, on Register. */
export interface UploadedFileView {
  token: string;
  kind: UploadKind;
  fileName: string;
  size: number;
  mimeType: string;
}

export const UPLOAD_TOKEN_REGEX = /^[a-f0-9]{48}$/;

// ---------- Field rules ----------

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `Enter the ${label}` })
    .trim()
    .min(1, `Enter the ${label}`)
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const personName = (label: string) =>
  text(label, 2, 100).regex(/^[A-Za-z][A-Za-z .']*$/, `${label} can contain only letters, spaces, dots and apostrophes`);

export const emailField = z
  .string({ error: 'Enter the email address' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter the email address')
  .max(254, 'Email address is too long')
  .pipe(z.email('Enter a valid email address, like name@example.com'));

export const mobileField = z
  .string({ error: 'Enter the mobile number' })
  .trim()
  .min(1, 'Enter the mobile number')
  .regex(MOBILE_REGEX, 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9');

/**
 * On Edit & Resubmit an unchanged document is kept instead of uploaded again:
 * the file field then holds "keep:<documentId>" (PRD F3).
 */
export const KEEP_DOCUMENT_REGEX = /^keep:[a-f0-9]{24}$/;
export const keepDocumentRef = (documentId: string) => `keep:${documentId}`;

const isFileRef = (allowKeep: boolean) => (v: string) => UPLOAD_TOKEN_REGEX.test(v) || (allowKeep && KEEP_DOCUMENT_REGEX.test(v));

/** Technical safety limit only; in practice there is no limit on contact persons (PRD 8.4). */
export const MAX_CONTACTS = 100;

/** The registration form rules. `allowKeep` is true for Edit & Resubmit. */
function buildRegistrationSchema(allowKeep: boolean) {
  const fileToken = (label: string) => z.string({ error: `Upload the ${label}` }).refine(isFileRef(allowKeep), `Upload the ${label}`);
  const optionalFileToken = z
    .string()
    .refine(isFileRef(allowKeep))
    .nullish()
    .transform((v) => v ?? null);

  const contactSchema = z.object({
    name: personName('Name'),
    mobile: mobileField,
    email: emailField,
    idProofFile: fileToken('ID proof'),
    photoFile: fileToken('photograph'),
  });

  return z
  .object({
    // Section 1: Franchise Details
    franchiseModel: text('Franchise Model', 2, 100),
    firmType: z.enum(FIRM_TYPES, { error: 'Select the firm type' }),
    firmName: text('Firm Name', 2, 150),

    // Section 2: Official Documents
    pan: z
      .string({ error: 'Enter the PAN' })
      .trim()
      .toUpperCase()
      .min(1, 'Enter the PAN')
      .regex(PAN_REGEX, 'PAN must be 10 characters like ABCDE1234F'),
    panFile: fileToken('PAN image'),
    gst: z
      .string()
      .trim()
      .toUpperCase()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || GST_REGEX.test(v), 'GST number must be 15 characters like 29ABCDE1234F1Z5'),
    gstFile: optionalFileToken,
    rentalFile: optionalFileToken,

    // Section 3: Applicant / Authorised Signatory
    signatory: z.object({
      name: personName('Full Name'),
      capacity: z.enum(SIGNATORY_CAPACITIES, { error: 'Select the capacity / designation' }),
      email: emailField,
      mobile: mobileField,
      idProofFile: fileToken('ID proof'),
      photoFile: fileToken('photograph'),
    }),

    // Section 4: Contact Persons
    contacts: z
      .array(contactSchema)
      .min(1, 'Add at least one contact person')
      .max(MAX_CONTACTS, `At most ${MAX_CONTACTS} contact persons can be added`),

    // Section 5: Franchise Agreement
    agreement: agreementAcceptanceInputSchema,

    /** Set when the applicant chose "Continue" after a possible-duplicate warning. */
    acknowledgeDuplicates: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.gst && PAN_REGEX.test(data.pan) && !gstMatchesPan(data.gst, data.pan)) {
      ctx.addIssue({ code: 'custom', path: ['gst'], message: 'GST number does not belong to the PAN entered' });
    }
    if (data.gst && !data.gstFile) {
      ctx.addIssue({ code: 'custom', path: ['gstFile'], message: 'Upload the GST Certificate' });
    }
  });
}

/** New registration: every file must be freshly uploaded. */
export const registrationSchema = buildRegistrationSchema(false);
/**
 * Edit & Resubmit: files may also be kept from earlier submissions. The signatory's email and
 * mobile are always taken from the account (changed only in My Profile).
 */
export const resubmissionSchema = buildRegistrationSchema(true);

export type RegistrationInput = z.input<typeof registrationSchema>;
export type RegistrationData = z.output<typeof registrationSchema>;

/** Field errors keyed by dotted path, for example "signatory.email" or "contacts.1.mobile". */
export type FieldErrors = Record<string, string>;

/** Turns validation problems into one message per field (the first one found). */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    out[key] ??= issue.message;
  }
  return out;
}

// ---------- Submit responses ----------

/** A possible duplicate the applicant may continue past (PRD 10.1). */
export interface DuplicateWarning {
  /** Form field that matched, e.g. "signatory.email" or "contacts.0.mobile". */
  field: string;
  message: string;
}

export interface RegistrationSubmitted {
  /** Used by the verification page (build step 4); keep it in the browser session only. */
  verificationToken: string;
  maskedEmail: string;
  maskedMobile: string;
  status: ApplicationStatus;
}

// ---------- Helpers ----------

/** "lincy@gmail.com" -> "li***@gmail.com" */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

/** "9876543210" -> "******3210" */
export const maskMobile = (mobile: string) => `******${mobile.slice(-4)}`;

const NOT_YET = 'To be issued on approval';

/** Values used to personalise a typed agreement from the registration details (PRD 10.4). */
export function registrationMergeValues(
  data: {
    firmName?: string;
    firmType?: string;
    franchiseModel?: string;
    pan?: string;
    gst?: string | null;
    signatory?: { name?: string; capacity?: string; email?: string; mobile?: string };
  },
  extra: { organisationName: string; acceptedAt?: Date | string | null },
): MergeValues {
  const s = data.signatory ?? {};
  const v = (x: string | null | undefined) => (x && x.trim() ? x.trim() : null);
  return {
    firm_name: v(data.firmName),
    firm_type: v(data.firmType),
    franchise_model: v(data.franchiseModel),
    pan_number: v(data.pan?.toUpperCase()),
    gst_number: v(data.gst?.toUpperCase()) ?? 'Not Applicable',
    signatory_name: v(s.name),
    signatory_capacity: v(s.capacity),
    signatory_email: v(s.email?.toLowerCase()),
    signatory_mobile: v(s.mobile),
    acceptance_date: formatDateIST(extra.acceptedAt ?? new Date()),
    agreement_reference_no: NOT_YET,
    approval_date: NOT_YET,
    organisation_name: extra.organisationName,
  };
}
