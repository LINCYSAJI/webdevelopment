import mongoose, { type FilterQuery, type Types } from 'mongoose';
import {
  adminRegistrationQuerySchema,
  adminRejectedQuerySchema,
  businessDaysBetween,
  formatDateIST,
  formatDateTimeIST,
  istDateKey,
  STATUS_LABELS,
  type AdminDashboardView,
  type AdminRegistrationQuery,
  type AdminRejectedQuery,
  type ApplicationStatus,
  type Paginated,
  type RejectionRow,
  type ReminderKind,
  type ReminderSentView,
  type ReviewApplicationView,
  type ReviewListRow,
  type TrackingView,
} from '@fap/shared';
import { toCsv } from '../lib/csv';
import { AppError } from '../lib/errors';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { Registration, type RegistrationDocument } from '../models/Registration';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { ReminderLog } from '../models/ReminderLog';
import { getSettings } from '../models/Settings';
import { User } from '../models/User';
import { openRegistrationDocument } from './application-view.service';
import { audit } from './audit.service';
import { lastDailyCheck } from './scheduler.service';
import { agreementCounts, buildReviewView, holidaySet, istBoundary, listApplications, toRows, waitingSince } from './review.service';
import type { Actor } from './users.service';

/**
 * Admin oversight (PRD AD1–AD6). Admin sees every application, read-only: the only workflow
 * actions here are Reassign (AD2) and the duplicate decisions (duplicate.service.ts). Admin never
 * sees the agreement PDF itself (open question Q1 default): only its record and email history.
 */

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- AD2: Franchise Registrations ----------

function registrationFilter(q: ReturnType<typeof adminRegistrationQuerySchema.parse>): FilterQuery<RegistrationDocument> {
  const base: FilterQuery<RegistrationDocument> = {};
  if (q.status) base.status = q.status;
  if (q.assignee === 'unassigned') {
    base.assignedTo = null;
    base.status ??= 'pending_accounts';
  } else if (q.assignee) {
    // "Assigned reviewer" means who holds it now, which only applies while it waits for Accounts.
    base.assignedTo = new mongoose.Types.ObjectId(q.assignee);
    base.status ??= 'pending_accounts';
  }
  return base;
}

export async function listRegistrations(raw: AdminRegistrationQuery, opts: { all?: boolean } = {}): Promise<Paginated<ReviewListRow>> {
  const q = adminRegistrationQuerySchema.parse(raw);
  return listApplications(registrationFilter(q), q, { sort: { submittedAt: -1, _id: -1 }, all: opts.all });
}

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

export async function exportRegistrations(raw: AdminRegistrationQuery, actor: Actor) {
  const { items } = await listRegistrations(raw, { all: true });
  await audit({ action: 'registrations_exported', userId: actor.user._id, role: 'admin', targetType: 'export', details: { filters: raw, rows: items.length }, ip: actor.ip });
  return toCsv(
    ['Application ID', 'Status', 'Firm Name', 'Firm Type', 'PAN (masked)', 'Applicant / Signatory', 'Submitted / Resubmitted On', 'Business Days Waiting', 'Overdue', 'Assigned To', 'Possible Duplicate', 'Resubmissions', 'Agreement Reference'],
    items.map((r) => [
      r.applicationId || '(not yet verified)',
      STATUS_LABELS[r.status],
      r.firmName,
      r.firmType,
      r.panMasked,
      r.signatoryName,
      formatDateIST(r.submittedAt),
      r.status === 'pending_accounts' || r.status === 'pending_manager' ? r.businessDaysWaiting : '',
      yesNo(r.overdue),
      r.assignedTo?.name ?? '',
      yesNo(r.hasOpenDuplicateFlag),
      r.resubmissionCount,
      r.agreementReferenceNo ?? '',
    ]),
  );
}

async function loadRegistration(id: string) {
  const reg = mongoose.isValidObjectId(id) ? await Registration.findById(id) : null;
  if (!reg) throw new AppError(404, 'Application not found.', 'not_found');
  return reg;
}

/** The read-only detail page (all sections, documents, history and acceptance details). */
export async function getRegistration(id: string, version?: number): Promise<ReviewApplicationView> {
  const reg = await loadRegistration(id);
  return buildReviewView(
    reg,
    version,
    { canPickUp: false, canApprove: false, canReject: false, approveBlockedReason: null, canReassign: reg.status === 'pending_accounts' },
    { forManager: true },
  );
}

export async function openDocument(id: string, documentId: string) {
  const reg = await loadRegistration(id);
  return openRegistrationDocument(reg._id as Types.ObjectId, documentId);
}

// ---------- AD1: Dashboard ----------

/** Average business days per review stage, from the timeline of every application. */
async function averageStageDays(holidays: Set<string>): Promise<AdminDashboardView['averageStageDays']> {
  const rows = await RegistrationHistory.find({ $or: [{ toStatus: { $in: ['pending_accounts', 'pending_manager'] } }, { fromStatus: { $in: ['pending_accounts', 'pending_manager'] } }] }, {
    registrationId: 1,
    at: 1,
    fromStatus: 1,
    toStatus: 1,
  }).sort({ registrationId: 1, at: 1 });
  const totals = { accounts: { days: 0, n: 0 }, manager: { days: 0, n: 0 } };
  const entered = new Map<string, Date>(); // "<registrationId>:<status>" -> when it entered that stage
  for (const h of rows) {
    const key = h.registrationId.toString();
    for (const [status, stage] of [
      ['pending_accounts', 'accounts'],
      ['pending_manager', 'manager'],
    ] as const) {
      const since = entered.get(`${key}:${status}`);
      if (h.fromStatus === status && since) {
        totals[stage].days += businessDaysBetween(since, h.at, holidays);
        totals[stage].n += 1;
        entered.delete(`${key}:${status}`);
      }
      if (h.toStatus === status) entered.set(`${key}:${status}`, h.at);
    }
  }
  return (['accounts', 'manager'] as const).map((stage) => ({
    stage,
    averageDays: totals[stage].n ? Math.round((totals[stage].days / totals[stage].n) * 10) / 10 : null,
    samples: totals[stage].n,
  }));
}

/** "YYYY-MM" keys for the last 12 months (IST), oldest first. */
function lastTwelveMonths(): string[] {
  const [y, m] = istDateKey(new Date()).split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export async function dashboard(): Promise<AdminDashboardView> {
  const [settings, holidays] = await Promise.all([getSettings(), holidaySet()]);
  const byStatus = new Map(
    (await Registration.aggregate<{ _id: ApplicationStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map((s) => [s._id, s.n]),
  );
  const count = (s: ApplicationStatus) => byStatus.get(s) ?? 0;

  const months = lastTwelveMonths();
  const firstMonth = istBoundary(`${months[0]}-01`, false);
  // Applications that completed verification, by the month they were submitted (IST).
  const perMonth = new Map(
    (
      await RegistrationHistory.aggregate<{ _id: string; n: number }>([
        { $match: { event: 'submitted', at: { $gte: firstMonth } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$at', timezone: '+05:30' } }, n: { $sum: 1 } } },
      ])
    ).map((r) => [r._id, r.n]),
  );

  const waiting = await Registration.find({ status: { $in: ['pending_accounts', 'pending_manager'] } }).sort({ stageEnteredAt: 1, _id: 1 });
  const now = new Date();
  const late = waiting.filter((r) => businessDaysBetween(waitingSince(r), now, holidays) > settings.escalationAfterDays);

  const [duplicateCasesOpen, accountsUsers, managerUsers, agreements, averages, alerts] = await Promise.all([
    DuplicateFlag.countDocuments({ status: 'open' }),
    User.countDocuments({ role: 'accounts', isActive: true }),
    User.countDocuments({ role: 'manager', isActive: true }),
    agreementCounts(),
    averageStageDays(holidays),
    toRows(late),
  ]);

  return {
    totalRegistrations: [...byStatus.entries()].filter(([s]) => s !== 'withdrawn').reduce((n, [, v]) => n + v, 0),
    pendingVerification: count('pending_verification'),
    pendingAccounts: count('pending_accounts'),
    pendingManager: count('pending_manager'),
    approved: count('approved'),
    rejectedByAccounts: count('rejected_by_accounts'),
    rejectedByManager: count('rejected_by_manager'),
    duplicateCasesOpen,
    overdue: late.length,
    escalationAfterDays: settings.escalationAfterDays,
    accountsUsers,
    managerUsers,
    generatedAgreements: agreements.generated,
    agreementsNotYetEmailed: agreements.notYetEmailed,
    registrationsPerMonth: months.map((month) => ({ month, count: perMonth.get(month) ?? 0 })),
    averageStageDays: averages,
    alerts,
  };
}

// ---------- AD4: Approval Tracking ----------

const RECENT = 10;

export async function tracking(): Promise<TrackingView> {
  const settings = await getSettings();
  const [pa, pm, approved, rejected, approvedCount, rejectedCount] = await Promise.all([
    Registration.find({ status: 'pending_accounts' }).sort({ stageEnteredAt: 1, _id: 1 }),
    Registration.find({ status: 'pending_manager' }).sort({ stageEnteredAt: 1, _id: 1 }),
    Registration.find({ status: 'approved' }).sort({ approvedAt: -1 }).limit(RECENT),
    Registration.find({ status: { $in: ['rejected_by_accounts', 'rejected_by_manager'] } }).sort({ stageEnteredAt: -1 }).limit(RECENT),
    Registration.countDocuments({ status: 'approved' }),
    Registration.countDocuments({ status: { $in: ['rejected_by_accounts', 'rejected_by_manager'] } }),
  ]);
  const [paRows, pmRows, approvedRows, rejectedRows] = await Promise.all([toRows(pa), toRows(pm, true), toRows(approved), toRows(rejected)]);
  const overdue = [...paRows, ...pmRows].filter((r) => r.overdue).sort((a, b) => b.businessDaysWaiting - a.businessDaysWaiting);

  // Reminders (N13) and escalations (N14) sent during each overdue application's current stage.
  const enteredAt = new Map([...pa, ...pm].map((r) => [r._id.toString(), waitingSince(r)]));
  const logs = overdue.length
    ? await ReminderLog.find({ $or: overdue.map((r) => ({ registrationId: new mongoose.Types.ObjectId(r.id), stageEnteredAt: enteredAt.get(r.id) })) }).sort({ at: 1 })
    : [];
  const remindersByReg = new Map<string, ReminderSentView[]>();
  for (const log of logs) {
    const list = remindersByReg.get(log.registrationId.toString()) ?? [];
    list.push({ at: log.at.toISOString(), kind: log.kind as ReminderKind, to: log.recipients.map((u) => u.name).join(', ') });
    remindersByReg.set(log.registrationId.toString(), list);
  }
  const lastRun = await lastDailyCheck();

  return {
    columns: [
      { key: 'pending_accounts', label: 'Pending Accounts', count: paRows.length, rows: paRows },
      { key: 'pending_manager', label: 'Pending Manager', count: pmRows.length, rows: pmRows },
      { key: 'approved', label: 'Approved', count: approvedCount, rows: approvedRows },
      { key: 'rejected', label: 'Rejected', count: rejectedCount, rows: rejectedRows },
    ],
    overdue: overdue.map((r) => ({ ...r, reminders: remindersByReg.get(r.id) ?? [] })),
    reminderFirstAfterDays: settings.reminderFirstAfterDays,
    reminderRepeatEveryDays: settings.reminderRepeatEveryDays,
    escalationAfterDays: settings.escalationAfterDays,
    dailyCheck: { runTime: settings.reminderRunTime, lastRun },
  };
}

// ---------- AD5: Approved and Rejected Applications ----------

export async function listApproved(raw: AdminRegistrationQuery, opts: { all?: boolean } = {}) {
  const q = adminRegistrationQuerySchema.parse(raw);
  return listApplications({ status: 'approved' }, q, { withAccountsDecision: true, sort: { approvedAt: -1, _id: -1 }, all: opts.all });
}

export async function exportApproved(raw: AdminRegistrationQuery, actor: Actor) {
  const { items } = await listApproved(raw, { all: true });
  const approvedAt = new Map((await Registration.find({ _id: { $in: items.map((r) => r.id) } }, { approvedAt: 1 })).map((r) => [r._id.toString(), r.approvedAt]));
  await audit({ action: 'approved_exported', userId: actor.user._id, role: 'admin', targetType: 'export', details: { filters: raw, rows: items.length }, ip: actor.ip });
  return toCsv(
    ['Application ID', 'Agreement Reference', 'Firm Name', 'Firm Type', 'PAN (masked)', 'Applicant / Signatory', 'Accounts Approved By', 'Accounts Approved On', 'Final Approval On', 'Resubmissions'],
    items.map((r) => [
      r.applicationId,
      r.agreementReferenceNo ?? '',
      r.firmName,
      r.firmType,
      r.panMasked,
      r.signatoryName,
      r.accountsApprovedBy ?? '',
      r.accountsApprovedAt ? formatDateIST(r.accountsApprovedAt) : '',
      approvedAt.get(r.id) ? formatDateIST(approvedAt.get(r.id)!) : '',
      r.resubmissionCount,
    ]),
  );
}

/** Every rejection decision, newest first, with whether the applicant resubmitted afterwards. */
export async function listRejected(raw: AdminRejectedQuery, opts: { all?: boolean } = {}): Promise<Paginated<RejectionRow>> {
  const q = adminRejectedQuerySchema.parse(raw);
  const match: FilterQuery<unknown> = { event: q.stage ? `${q.stage}_rejected` : { $in: ['accounts_rejected', 'manager_rejected'] } };
  if (q.from || q.to) match.at = { ...(q.from ? { $gte: istBoundary(q.from, false) } : {}), ...(q.to ? { $lte: istBoundary(q.to, true) } : {}) };
  const decisions = await RegistrationHistory.find(match).sort({ at: -1 }).limit(5000);

  const regIds = [...new Set(decisions.map((d) => d.registrationId.toString()))];
  const regFilter: FilterQuery<RegistrationDocument> = { _id: { $in: regIds }, status: { $ne: 'withdrawn' } };
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    regFilter.$or = ['applicationId', 'firmName', 'pan', 'gst', 'signatory.name', 'signatory.email', 'signatory.mobile'].map((f) => ({ [f]: rx }));
  }
  const [regs, resubmissions, reviewers] = await Promise.all([
    Registration.find(regFilter, { applicationId: 1, firmName: 1, status: 1 }),
    RegistrationHistory.find({ registrationId: { $in: regIds }, event: 'resubmitted' }, { registrationId: 1, at: 1 }),
    User.find({ _id: { $in: [...new Set(decisions.map((d) => d.actorId?.toString()).filter(Boolean))] } }, { name: 1 }),
  ]);
  const regById = new Map(regs.map((r) => [r._id.toString(), r]));
  const names = new Map(reviewers.map((u) => [u._id.toString(), u.name]));
  const resubmittedAt = new Map<string, Date[]>();
  for (const r of resubmissions) resubmittedAt.set(r.registrationId.toString(), [...(resubmittedAt.get(r.registrationId.toString()) ?? []), r.at]);

  let rows: RejectionRow[] = decisions.flatMap((d) => {
    const reg = regById.get(d.registrationId.toString());
    if (!reg) return [];
    return [
      {
        id: reg._id.toString(),
        applicationId: reg.applicationId ?? '',
        firmName: reg.firmName,
        stage: d.event === 'accounts_rejected' ? 'accounts' : 'manager',
        reason: d.reason ?? '',
        reviewer: names.get(d.actorId?.toString() ?? '') ?? 'Unknown',
        rejectedAt: d.at.toISOString(),
        resubmitted: (resubmittedAt.get(reg._id.toString()) ?? []).some((at) => at > d.at),
        currentStatus: reg.status as ApplicationStatus,
      },
    ];
  });
  if (q.resubmitted) rows = rows.filter((r) => r.resubmitted === (q.resubmitted === 'yes'));
  if (opts.all) return { items: rows, page: 1, pageSize: rows.length, total: rows.length };
  const start = (q.page - 1) * q.pageSize;
  return { items: rows.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total: rows.length };
}

export async function exportRejected(raw: AdminRejectedQuery, actor: Actor) {
  const { items } = await listRejected(raw, { all: true });
  await audit({ action: 'rejected_exported', userId: actor.user._id, role: 'admin', targetType: 'export', details: { filters: raw, rows: items.length }, ip: actor.ip });
  return toCsv(
    ['Application ID', 'Firm Name', 'Rejected At Stage', 'Reason', 'Rejected By', 'Rejected On', 'Resubmitted Since', 'Current Status'],
    items.map((r) => [
      r.applicationId,
      r.firmName,
      r.stage === 'accounts' ? 'Accounts' : 'Manager',
      r.reason,
      r.reviewer,
      formatDateTimeIST(r.rejectedAt),
      yesNo(r.resubmitted),
      STATUS_LABELS[r.currentStatus],
    ]),
  );
}
