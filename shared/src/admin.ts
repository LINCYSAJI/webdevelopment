import { z } from 'zod';
import { MOBILE_REGEX, isStrongPassword } from './validators';
import type { Role } from './constants';

// ---------- Passwords ----------

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email, mobile number or username'),
});

export const setPasswordSchema = z
  .object({
    token: z.string().min(20),
    password: z.string().refine(isStrongPassword, 'Password does not meet the rules below'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

// ---------- Internal users (Accounts / Manager) ----------

export const MANAGED_ROLES = ['accounts', 'manager'] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

const optionalMobile = z
  .string()
  .trim()
  .refine((v) => v === '' || MOBILE_REGEX.test(v), 'Enter a 10-digit Indian mobile number')
  .transform((v) => (v === '' ? null : v));

export const internalUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, 'Use 3–30 letters, numbers, dots, dashes or underscores'),
  mobile: optionalMobile,
});
export type InternalUserInput = z.input<typeof internalUserSchema>;

export interface AdminUserView {
  id: string;
  name: string;
  email: string;
  username: string | null;
  mobile: string | null;
  role: Role;
  isActive: boolean;
  passwordSet: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

// ---------- Settings ----------

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1e3a8a');
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const LOGO_MAX_BYTES = 300 * 1024;

export const settingsSchema = z
  .object({
    organisationName: z.string().trim().min(2).max(100),
    portalName: z.string().trim().min(2).max(100),
    logoUrl: z
      .string()
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a PNG, JPG or WebP image')
      .max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 40, 'Logo must be 300 KB or smaller')
      .nullable(),
    primaryColor: hexColor,
    secondaryColor: hexColor,
    supportEmail: z
      .string()
      .trim()
      .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address')
      .transform((v) => v || null),
    supportPhone: z
      .string()
      .trim()
      .max(20)
      .transform((v) => v || null),
    registeredAddress: z
      .string()
      .trim()
      .max(300)
      .transform((v) => v || null),
    grievanceOfficerName: z
      .string()
      .trim()
      .max(100)
      .transform((v) => v || null),
    grievanceOfficerEmail: z
      .string()
      .trim()
      .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address')
      .transform((v) => v || null),
    agreementRefPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'Use 2–6 capital letters'),
    otpExpiryMinutes: int(2, 60),
    otpResendCooldownSeconds: int(15, 600),
    otpMaxAttempts: int(3, 10),
    pendingVerificationRetentionDays: int(1, 90),
    reminderFirstAfterDays: int(1, 30),
    reminderRepeatEveryDays: int(1, 30),
    escalationAfterDays: int(1, 60),
    reminderRunTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use 24-hour time like 09:00'),
    maxDocumentSizeMB: int(1, 25),
    maxPhotoSizeMB: int(1, 10),
    maxRentalSizeMB: int(1, 25),
    sessionTimeoutMinutes: int(5, 480),
  })
  .refine((s) => s.escalationAfterDays >= s.reminderFirstAfterDays, {
    message: 'Admin escalation should not come before the first reminder',
    path: ['escalationAfterDays'],
  });
export type SettingsInput = z.input<typeof settingsSchema>;
export type SettingsView = z.output<typeof settingsSchema>;

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  name: z.string().trim().min(2, 'Enter the holiday name').max(100),
});
export type HolidayInput = z.infer<typeof holidaySchema>;
export interface HolidayView extends HolidayInput {
  id: string;
}

// ---------- Audit log ----------

export interface AuditLogView {
  id: string;
  at: string;
  user: { id: string; name: string; email: string } | null;
  role: Role | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------- Agreement versions ----------

export const AGREEMENT_STATUSES = ['draft', 'active', 'inactive'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/**
 * How the agreement is supplied:
 * - `pdf`: Admin uploads a ready-made PDF (the default for new versions).
 * - `text`: Admin types it in the editor, with merge fields filled in per applicant.
 */
export const AGREEMENT_FORMATS = ['pdf', 'text'] as const;
export type AgreementFormat = (typeof AGREEMENT_FORMATS)[number];

/** Largest agreement PDF Admin may upload. */
export const AGREEMENT_PDF_MAX_BYTES = 10 * 1024 * 1024;

export const agreementDraftSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  // Fixed when the draft is created; ignored on later saves.
  format: z.enum(AGREEMENT_FORMATS).default('text'),
  content: z.string().max(500_000, 'The agreement text is too long').default(''),
});
export type AgreementDraftInput = z.input<typeof agreementDraftSchema>;
export type AgreementDraftData = z.output<typeof agreementDraftSchema>;

export interface AgreementPdfView {
  fileName: string;
  size: number;
  pageCount: number;
  uploadedAt: string;
}

export interface AgreementVersionView {
  id: string;
  versionNumber: number;
  title: string;
  format: AgreementFormat;
  content: string;
  pdf: AgreementPdfView | null;
  status: AgreementStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  acceptanceCount: number;
}

/** The active agreement as shown on the public registration page. */
export interface PublicAgreementView {
  id: string;
  versionNumber: number;
  title: string;
  format: AgreementFormat;
  /** Text agreements only. */
  content: string;
  /** PDF agreements only. */
  pdf: AgreementPdfView | null;
  pdfUrl: string | null;
}

/** Wording of the mandatory checkbox below the agreement (PRD 8.5). */
export const AGREEMENT_ACCEPTANCE_TEXT =
  'I have read and agree to all the terms and conditions mentioned in this franchise agreement.';

/** The agreement part of a registration submission. */
export const agreementAcceptanceInputSchema = z.object({
  agreementVersionId: z.string().regex(/^[a-f0-9]{24}$/, 'Agreement version is missing'),
  accepted: z.literal(true, { error: 'Please tick the checkbox to accept the franchise agreement' }),
});
export type AgreementAcceptanceInput = z.infer<typeof agreementAcceptanceInputSchema>;
