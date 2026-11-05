import { z } from 'zod';
import type { ApplicationStatus } from './constants';
import type { HistoryEntryView, SubmissionView } from './franchise';

// Review workflow (PRD §5, 6.2, 7.3, 10.6–10.8): business days, Accounts screens, decisions.

// ---------- Business days (Monday–Friday minus Admin holidays, IST) ----------

/** "2026-11-04" for the date in India. */
export function istDateKey(value: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  return parts; // en-CA formats as YYYY-MM-DD
}

/**
 * Business days that have passed since `from` (not counting the start day itself), up to and
 * including `to`. Weekends and the given holidays ("YYYY-MM-DD") are skipped.
 */
export function businessDaysBetween(from: Date | string, to: Date | string, holidays: ReadonlySet<string>): number {
  const [fy, fm, fd] = istDateKey(from).split('-').map(Number);
  const end = istDateKey(to);
  const day = new Date(Date.UTC(fy, fm - 1, fd));
  let count = 0;
  for (let i = 0; i < 3660; i++) {
    day.setUTCDate(day.getUTCDate() + 1);
    const key = day.toISOString().slice(0, 10);
    if (key > end) break;
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(key)) count++;
  }
  return count;
}

/** "ABCDE1234F" -> "ABCDE****F" for list views (PRD 13.3). */
export const maskPan = (pan: string) => (pan.length === 10 ? `${pan.slice(0, 5)}****${pan.slice(-1)}` : pan);

// ---------- Inputs ----------

const objectId = /^[a-f0-9]{24}$/;

export const decisionReasonSchema = z.object({
  reason: z
    .string({ error: 'Please give a reason' })
    .trim()
    .min(10, 'Please give a reason of at least 10 characters')
    .max(2000, 'The reason must be at most 2000 characters'),
});
export type DecisionReasonInput = z.infer<typeof decisionReasonSchema>;

export const reassignSchema = z.object({
  /** An active Accounts user, or null to put the application back in the Unassigned queue. */
  toUserId: z.string().regex(objectId, 'Choose an Accounts user').nullable(),
  note: z.string().trim().max(500, 'The note must be at most 500 characters').default(''),
});
export type ReassignInput = z.input<typeof reassignSchema>;

export const ACCOUNTS_TABS = ['unassigned', 'mine', 'all'] as const;
export type AccountsTab = (typeof ACCOUNTS_TABS)[number];

const flag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');
const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal('').transform(() => undefined));

export const reviewListQuerySchema = z.object({
  tab: z.enum(ACCOUNTS_TABS).default('unassigned'),
  search: z.string().trim().max(100).optional(),
  firmType: z.string().trim().max(60).optional(),
  from: dateKey,
  to: dateKey,
  overdue: flag,
  flagged: flag,
  resubmitted: flag,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});
export type ReviewListQuery = z.input<typeof reviewListQuerySchema>;

// ---------- Views ----------

export interface UserRef {
  id: string;
  name: string;
}

export interface ReviewListRow {
  id: string;
  applicationId: string;
  status: ApplicationStatus;
  firmName: string;
  firmType: string;
  panMasked: string;
  signatoryName: string;
  /** Latest submission or resubmission. */
  submittedAt: string;
  businessDaysWaiting: number;
  overdue: boolean;
  assignedTo: UserRef | null;
  hasOpenDuplicateFlag: boolean;
  resubmissionCount: number;
  /** Manager lists (PRD M2): who approved at the Accounts stage, and when. */
  accountsApprovedBy?: string | null;
  accountsApprovedAt?: string | null;
  /** Approved applications. */
  agreementReferenceNo?: string | null;
}

export interface AccountsDashboardView {
  unassigned: number;
  assignedToMe: number;
  approvedByMeThisMonth: number;
  rejectedByMeThisMonth: number;
  overdue: number;
  oldest: ReviewListRow[];
}

export interface DuplicateMatchView {
  field: string;
  value: string;
  matchedApplicationId: string | null;
}

export interface ReviewApplicationView {
  id: string;
  applicationId: string;
  status: ApplicationStatus;
  assignedTo: UserRef | null;
  submittedAt: string;
  businessDaysWaiting: number;
  overdue: boolean;
  resubmissionCount: number;
  /** `confirmed` is set when Admin confirmed it is a duplicate: approval stays blocked and the reviewer should reject. */
  duplicate: { open: boolean; confirmed: { note: string; at: string } | null; matches: DuplicateMatchView[] };
  submission: SubmissionView;
  versions: number[];
  /** Fields and documents that changed since the previous version (resubmissions only). */
  changes: string[] | null;
  agreement: { versionNumber: number; title: string; acceptedAt: string } | null;
  /** The latest Accounts approval (shown to the Manager, PRD M3). */
  accountsDecision: { by: string; at: string } | null;
  /** Set when the Manager approves (PRD 10.5). */
  agreementReferenceNo: string | null;
  /** The generated agreement PDF's state (Manager view only). */
  generatedAgreement: GeneratedAgreementSummary | null;
  /** Includes reviewers' full names (internal view). */
  history: HistoryEntryView[];
  actions: {
    canPickUp: boolean;
    canApprove: boolean;
    canReject: boolean;
    /** Why Approve is disabled, e.g. an open duplicate flag. */
    approveBlockedReason: string | null;
    /** Admin only: the application can be reassigned to another Accounts user (PRD AD2). */
    canReassign?: boolean;
  };
}

export interface ReviewedRow {
  id: string;
  applicationId: string;
  firmName: string;
  decision: 'approved' | 'rejected';
  decidedAt: string;
  reason: string | null;
  currentStatus: ApplicationStatus;
}

/** Labels for the "Changes since last review" list (paths match SubmissionView). */
export function describeChange(path: string): string {
  const labels: Record<string, string> = {
    franchiseModel: 'Franchise Model',
    firmType: 'Firm Type',
    firmName: 'Firm Name',
    pan: 'PAN Number',
    gst: 'GST Number',
    panDocument: 'PAN Image',
    gstDocument: 'GST Certificate',
    rentalDocument: 'Rental Agreement',
    name: 'Name',
    capacity: 'Capacity',
    email: 'Email',
    mobile: 'Mobile',
    idProof: 'ID Proof',
    photo: 'Photograph',
  };
  const parts = path.split('.');
  if (parts[0] === 'signatory') return `Applicant / Signatory: ${labels[parts[1]] ?? parts[1]}`;
  if (parts[0] === 'contacts') {
    if (parts[1] === 'removed') return `${parts[2]} contact person(s) removed`;
    const n = Number(parts[1]) + 1;
    return parts.length === 2 ? `Contact ${n} added` : `Contact ${n}: ${labels[parts[2]] ?? parts[2]}`;
  }
  return labels[path] ?? path;
}

// ---------- Manager (PRD M1–M5) and the generated agreement (PRD §9) ----------

export const MANAGER_LISTS = ['pending', 'approved', 'rejected'] as const;
export type ManagerList = (typeof MANAGER_LISTS)[number];

export interface ManagerDashboardView {
  pendingApproval: number;
  overdue: number;
  approvedThisMonth: number;
  rejectedThisMonth: number;
  agreementsNotYetEmailed: number;
  oldest: ReviewListRow[];
}

export const GENERATION_STATUSES = ['pending', 'generated', 'failed'] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export interface GeneratedAgreementSummary {
  id: string;
  referenceNumber: string;
  status: GenerationStatus;
  generatedAt: string | null;
  error: string | null;
  pageCount: number | null;
}

export interface GeneratedAgreementRow extends GeneratedAgreementSummary {
  registrationId: string;
  applicationId: string;
  firmName: string;
  recipient: string;
  approvedAt: string;
  lastEmailedAt: string | null;
  lastEmailStatus: 'sent' | 'failed' | null;
  timesSent: number;
}

export interface AgreementEmailLogView {
  at: string;
  recipient: string;
  subject: string;
  status: 'sent' | 'failed';
  sentBy: string;
  error: string | null;
}

/** The "Send to Franchisee" dialog (PRD M5). The recipient is always the registered email. */
export const sendAgreementSchema = z.object({
  subject: z.string().trim().min(3, 'Enter a subject').max(200, 'The subject must be at most 200 characters'),
  message: z.string().trim().min(1, 'Enter a message').max(5000, 'The message must be at most 5000 characters'),
});
export type SendAgreementInput = z.infer<typeof sendAgreementSchema>;

/** The exact footer required on every page of the generated agreement (PRD D9, 9.3). */
export const AGREEMENT_PDF_FOOTER =
  'This is a computer-generated digital agreement and does not require any physical or digital signature.';
