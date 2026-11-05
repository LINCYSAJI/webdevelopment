import { z } from 'zod';
import type { ApplicationStatus } from './constants';

// ---------- Privacy Policy and Terms & Conditions (DPDP Act 2023, IT Act 2000) ----------

/**
 * Current versions of the two legal documents. When the wording changes, raise the version and
 * the effective date: every consent records the versions the applicant agreed to.
 */
export const LEGAL_DOCUMENTS = {
  privacy: { title: 'Privacy Policy', path: '/privacy-policy', version: '1.0', effectiveDate: '2026-11-05' },
  terms: { title: 'Terms & Conditions', path: '/terms', version: '1.0', effectiveDate: '2026-11-05' },
} as const;

/** Words next to the mandatory consent checkbox; stored with every consent record. */
export const LEGAL_CONSENT_TEXT =
  'I have read and agree to the Terms & Conditions and the Privacy Policy. I consent to my personal data, and that of the contact persons I have named (who know I am sharing it), being processed for the purposes described in the Privacy Policy.';

export const legalConsentSchema = z.literal(true, { error: 'Please tick the checkbox to accept the Terms & Conditions and the Privacy Policy' });

// ---------- Delete my account / data deletion requests (DPDP Act s.12, s.6(4)) ----------

export const DATA_REQUEST_STATUSES = ['pending', 'completed', 'declined', 'cancelled'] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

export const DATA_REQUEST_STATUS_LABELS: Record<DataRequestStatus, string> = {
  pending: 'Pending',
  completed: 'Data erased',
  declined: 'Declined',
  cancelled: 'Cancelled by user',
};

export const dataDeletionRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  reason: z.string().trim().max(1000, 'Use at most 1000 characters').default(''),
  confirm: z.literal(true, { error: 'Tick the box to confirm you understand what will happen' }),
});
export type DataDeletionRequestInput = z.input<typeof dataDeletionRequestSchema>;

export const dataRequestDeclineSchema = z.object({
  note: z.string().trim().min(10, 'Explain the reason in at least 10 characters').max(2000),
});

export const dataRequestListQuerySchema = z.object({
  status: z.enum(DATA_REQUEST_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

/** What the applicant sees about their own request in My Profile. */
export interface MyDataRequestView {
  id: string;
  status: DataRequestStatus;
  requestedAt: string;
  reason: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

/** One row of Admin's Data Deletion Requests screen. */
export interface DataRequestRow extends MyDataRequestView {
  userName: string;
  userEmail: string;
  applicationId: string | null;
  firmName: string | null;
  applicationStatus: ApplicationStatus | null;
  decidedByName: string | null;
  /** Why Admin cannot erase right now (e.g. an approved agreement must be kept), or null. */
  eraseBlockedReason: string | null;
}

/** Approved franchise agreements and their records are kept for this long after the relationship ends. */
export const AGREEMENT_RETENTION_YEARS = 8;
