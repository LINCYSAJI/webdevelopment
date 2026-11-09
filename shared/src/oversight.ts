import { z } from 'zod';
import { STATUSES, type ApplicationStatus } from './constants';
import type { SubmissionView } from './franchise';
import type { ReviewListRow } from './workflow';

// ---------- Admin oversight (PRD AD1–AD6) ----------

const objectId = z.string().regex(/^[a-f0-9]{24}$/);
/** Empty query values ("?status=") mean "not filtered". */
const blank = z.literal('').transform(() => undefined);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(blank);
const flag = z.preprocess((v) => v === '1' || v === 'true' || v === true, z.boolean()).default(false);

/** AD2 filters (also used by the CSV export). */
export const adminRegistrationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).or(blank).optional(),
  firmType: z.string().max(60).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  /** An Accounts user's id, or "unassigned". */
  assignee: z.union([objectId, z.literal('unassigned'), blank]).optional(),
  flagged: flag,
  overdue: flag,
  resubmitted: flag,
});
export type AdminRegistrationQuery = z.input<typeof adminRegistrationQuerySchema>;

/** AD5 rejected list filters. */
export const adminRejectedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  stage: z.enum(['accounts', 'manager']).or(blank).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  resubmitted: z.enum(['yes', 'no']).or(blank).optional(),
});
export type AdminRejectedQuery = z.input<typeof adminRejectedQuerySchema>;

/** One rejection decision (an application rejected twice appears twice). */
export interface RejectionRow {
  id: string;
  applicationId: string;
  firmName: string;
  stage: 'accounts' | 'manager';
  reason: string;
  reviewer: string;
  rejectedAt: string;
  /** The applicant resubmitted after this rejection. */
  resubmitted: boolean;
  currentStatus: ApplicationStatus;
}

export interface AdminDashboardView {
  totalRegistrations: number;
  pendingVerification: number;
  pendingAccounts: number;
  pendingManager: number;
  approved: number;
  rejectedByAccounts: number;
  rejectedByManager: number;
  duplicateCasesOpen: number;
  /** Waiting longer than the Admin escalation period in Settings (default 5 business days). */
  overdue: number;
  escalationAfterDays: number;
  accountsUsers: number;
  managerUsers: number;
  generatedAgreements: number;
  agreementsNotYetEmailed: number;
  /** Last 12 months, oldest first; "YYYY-MM" (IST). Counts applications that completed verification. */
  registrationsPerMonth: { month: string; count: number }[];
  /** Average business days spent at each review stage, over all completed stage visits. */
  averageStageDays: { stage: 'accounts' | 'manager'; averageDays: number | null; samples: number }[];
  /** Applications waiting longer than the escalation period, oldest first. */
  alerts: ReviewListRow[];
}

/** One reminder (N13) or Admin escalation (N14) sent for an application. */
export interface ReminderSentView {
  at: string;
  kind: ReminderKind;
  /** Names of the people it was sent to. */
  to: string;
}

/** AD4 pipeline. */
export interface TrackingView {
  columns: { key: 'pending_accounts' | 'pending_manager' | 'approved' | 'rejected'; label: string; count: number; rows: ReviewListRow[] }[];
  /** Reminders sent during the application's current stage, oldest first. */
  overdue: (ReviewListRow & { reminders: ReminderSentView[] })[];
  reminderFirstAfterDays: number;
  reminderRepeatEveryDays: number;
  escalationAfterDays: number;
  /** The daily automatic check (PRD 10.8): when it runs and what it did last time. */
  dailyCheck: { runTime: string; lastRun: DailyCheckRunView | null };
}

// ---------- Reminders and the daily automatic check (PRD 10.8, N13, N14) ----------

export const REMINDER_KINDS = ['reminder', 'escalation'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/**
 * Which reminder is due for an application that has waited `daysWaiting` business days, or 0 if
 * none yet. The first is due once it has waited MORE than `after` business days (PRD A18, so an
 * application that arrived on Monday afternoon gets its first reminder on Thursday morning), then
 * one more every `repeatEvery` business days. A missed day sends only the latest reminder, never a
 * burst of old ones.
 */
export function dueReminderNumber(daysWaiting: number, after: number, repeatEvery: number): number {
  if (daysWaiting <= after) return 0;
  return Math.floor((daysWaiting - after - 1) / Math.max(1, repeatEvery)) + 1;
}

export interface DailyCheckSummary {
  /** It was a weekend or holiday, so reminders were not checked (clean-ups still ran). */
  businessDay: boolean;
  reminders: number;
  escalations: number;
  emailsSent: number;
  emailsFailed: number;
  unverifiedRemoved: number;
  uploadsRemoved: number;
  problems: string[];
}

export interface DailyCheckRunView {
  /** The IST day it ran for, YYYY-MM-DD. */
  day: string;
  trigger: 'schedule' | 'admin';
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'finished' | 'failed';
  summary: DailyCheckSummary | null;
}

// ---------- Duplicate Review (PRD AD3, 10.1) ----------

export const duplicateDecisionSchema = z.object({
  note: z.string().trim().min(10, 'Write a note of at least 10 characters').max(2000, 'Use at most 2000 characters'),
});

export interface DuplicateCaseRow {
  flagId: string;
  raisedAt: string;
  registration: { id: string; applicationId: string; firmName: string; status: ApplicationStatus; signatoryName: string; assignedTo: string | null };
  matches: { field: string; value: string; matchedRegistrationId: string; matchedApplicationId: string | null; matchedFirmName: string | null }[];
}

export interface DuplicateComparisonView {
  flagId: string;
  status: 'open' | 'not_duplicate' | 'confirmed';
  raisedAt: string;
  note: string | null;
  application: { id: string; applicationId: string; status: ApplicationStatus; submission: SubmissionView };
  matches: DuplicateCaseRow['matches'];
  /** The other registration(s), side by side; null when it was erased at the applicant's request. */
  others: ({ id: string; applicationId: string; status: ApplicationStatus; submission: SubmissionView } | { id: string; erased: true })[];
}
