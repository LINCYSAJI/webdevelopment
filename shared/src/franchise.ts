import { z } from 'zod';
import type { AgreementFormat } from './admin';
import type { ApplicationStatus } from './constants';
import { emailField, mobileField } from './registration';
import { isStrongPassword } from './validators';

// Email / SMS verification (PRD P3, P4, 10.3) and the Franchise User screens (PRD F1, F2, F4).

export const OTP_CHANNELS = ['email', 'sms'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export const otpCodeField = z
  .string({ error: 'Enter the 6-digit code' })
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

const verificationToken = z.string().min(20).max(200);

export const sendCodeSchema = z.object({ token: verificationToken, channel: z.enum(OTP_CHANNELS) });
export const verifyCodeSchema = z.object({ token: verificationToken, channel: z.enum(OTP_CHANNELS), code: otpCodeField });
export const verificationStatusSchema = z.object({ token: verificationToken });

const newPassword = {
  password: z.string().refine(isStrongPassword, 'Password does not meet the rules below'),
  confirmPassword: z.string(),
};
const passwordsMatch = (v: { password: string; confirmPassword: string }) => v.password === v.confirmPassword;
const mismatch = { message: 'Passwords do not match', path: ['confirmPassword'] };

export const completeRegistrationSchema = z
  .object({ token: verificationToken, ...newPassword })
  .refine(passwordsMatch, mismatch);
export type CompleteRegistrationInput = z.infer<typeof completeRegistrationSchema>;

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), ...newPassword })
  .refine(passwordsMatch, mismatch);
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const CONTACT_KINDS = ['email', 'mobile'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

export const contactChangeStartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('email'), value: emailField, currentPassword: z.string().min(1, 'Enter your current password') }),
  z.object({ kind: z.literal('mobile'), value: mobileField, currentPassword: z.string().min(1, 'Enter your current password') }),
]);
export type ContactChangeStartInput = z.infer<typeof contactChangeStartSchema>;

export const contactChangeConfirmSchema = z.object({ kind: z.enum(CONTACT_KINDS), code: otpCodeField });
export type ContactChangeConfirmInput = z.infer<typeof contactChangeConfirmSchema>;

/** State of one code (email or SMS) on the verification page. */
export interface OtpState {
  verified: boolean;
  /** A code was sent and can still be used. */
  active: boolean;
  expiresAt: string | null;
  /** When "Resend" becomes available. */
  resendAvailableAt: string | null;
}

export interface VerificationStatus {
  maskedEmail: string;
  maskedMobile: string;
  email: OtpState;
  sms: OtpState;
  otpExpiryMinutes: number;
}

export interface RegistrationCompleted {
  applicationId: string;
  status: ApplicationStatus;
}

// ---------- Franchise User screens ----------

/** Labels shown to the applicant (PRD 6.1 notes). */
export const APPLICANT_STATUS_TEXT: Record<ApplicationStatus, { label: string; explanation: string }> = {
  pending_verification: { label: 'Pending Verification', explanation: 'Please verify your email and mobile to submit your application.' },
  pending_accounts: { label: 'Pending Accounts Review', explanation: 'Your application is with our Accounts team for review.' },
  rejected_by_accounts: { label: 'Changes Requested by Accounts', explanation: 'Our Accounts team has asked for some changes. Please see the reason below.' },
  pending_manager: {
    label: 'Accounts Approved – Awaiting Manager Approval',
    explanation: 'Our Accounts team has approved your application. It is now with our Manager for final approval.',
  },
  rejected_by_manager: { label: 'Changes Requested by Manager', explanation: 'Our Manager has asked for some changes. Please see the reason below.' },
  approved: { label: 'Approved', explanation: 'Your franchise application has been approved.' },
};

export interface ApplicationDocumentView {
  id: string;
  type: 'pan' | 'gst' | 'rental' | 'id_proof' | 'photo';
  fileName: string;
  mimeType: string;
  size: number;
}

export interface ApplicationPersonView {
  name: string;
  email: string;
  mobile: string;
  idProof: ApplicationDocumentView | null;
  photo: ApplicationDocumentView | null;
}

/** One submission (v1, v2, …) exactly as it was sent. */
export interface SubmissionView {
  version: number;
  submittedAt: string;
  franchiseModel: string;
  firmType: string;
  firmName: string;
  pan: string;
  gst: string | null;
  panDocument: ApplicationDocumentView | null;
  gstDocument: ApplicationDocumentView | null;
  rentalDocument: ApplicationDocumentView | null;
  signatory: ApplicationPersonView & { capacity: string };
  contacts: ApplicationPersonView[];
}

export interface HistoryEntryView {
  at: string;
  event: string;
  /** Plain-English description, e.g. "Application submitted". */
  title: string;
  /** "You", "Accounts Team" or "Manager"; reviewers' personal names are never shown. */
  by: string;
  reason: string | null;
  submissionVersion: number | null;
}

export interface MyApplicationView {
  applicationId: string;
  status: ApplicationStatus;
  submittedAt: string;
  currentVersion: number;
  versions: number[];
  current: SubmissionView;
  agreement: { versionNumber: number; title: string; format: AgreementFormat; acceptedAt: string } | null;
  history: HistoryEntryView[];
  latestRejection: { stage: 'Accounts' | 'Manager'; reason: string; at: string } | null;
  /** Email or mobile can be changed in My Profile only when the application is not under review. */
  canChangeContactDetails: boolean;
}
