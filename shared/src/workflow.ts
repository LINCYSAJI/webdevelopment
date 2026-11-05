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
  duplicate: { open: boolean; matches: DuplicateMatchView[] };
  submission: SubmissionView;
  versions: number[];
  /** Fields and documents that changed since the previous version (resubmissions only). */
  changes: string[] | null;
  agreement: { versionNumber: number; title: string; acceptedAt: string } | null;
  /** Includes reviewers' full names (internal view). */
  history: HistoryEntryView[];
  actions: {
    canPickUp: boolean;
    canApprove: boolean;
    canReject: boolean;
    /** Why Approve is disabled, e.g. an open duplicate flag. */
    approveBlockedReason: string | null;
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
