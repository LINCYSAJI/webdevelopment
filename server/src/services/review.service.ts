import mongoose, { type FilterQuery, type Types } from 'mongoose';
import {
  businessDaysBetween,
  istDateKey,
  maskPan,
  reviewListQuerySchema,
  type AccountsDashboardView,
  type ApplicationStatus,
  type Paginated,
  type ReviewApplicationView,
  type ReviewListQuery,
  type ReviewListRow,
  type ReviewedRow,
} from '@fap/shared';
import { AppError } from '../lib/errors';
import { AgreementAcceptance } from '../models/AgreementAcceptance';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { Holiday } from '../models/Holiday';
import { Registration, type RegistrationDocument } from '../models/Registration';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { getSettings } from '../models/Settings';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { User, type UserDocument } from '../models/User';
import { changesSincePrevious, openRegistrationDocument, toHistoryView, toSubmissionView } from './application-view.service';

// Accounts screens (PRD A1–A4). What Accounts may see (PRD 13.2): applications in Pending
// Accounts, plus the ones they reviewed before (read-only), plus their documents.

const DECISIONS = ['accounts_approved', 'accounts_rejected'] as const;

async function holidaySet() {
  return new Set((await Holiday.find({}, { date: 1 })).map((h) => h.date));
}

const waitingSince = (reg: RegistrationDocument) => reg.stageEnteredAt ?? reg.lastSubmittedAt ?? reg.submittedAt;

async function toRows(regs: RegistrationDocument[]): Promise<ReviewListRow[]> {
  const [holidays, settings] = await Promise.all([holidaySet(), getSettings()]);
  const assigneeIds = [...new Set(regs.map((r) => r.assignedTo?.toString()).filter(Boolean))];
  const names = new Map((await User.find({ _id: { $in: assigneeIds } }, { name: 1 })).map((u) => [u._id.toString(), u.name]));
  const now = new Date();
  return regs.map((r) => {
    const days = businessDaysBetween(waitingSince(r), now, holidays);
    return {
      id: r._id.toString(),
      applicationId: r.applicationId ?? '',
      status: r.status as ApplicationStatus,
      firmName: r.firmName,
      firmType: r.firmType,
      panMasked: maskPan(r.pan),
      signatoryName: r.signatory?.name ?? '',
      submittedAt: (r.lastSubmittedAt ?? r.submittedAt).toISOString(),
      businessDaysWaiting: days,
      // "Overdue (over 2 business days)" — the number comes from Settings (PRD A1, 10.8).
      overdue: days > settings.reminderFirstAfterDays,
      assignedTo: r.assignedTo ? { id: r.assignedTo.toString(), name: names.get(r.assignedTo.toString()) ?? 'Unknown' } : null,
      hasOpenDuplicateFlag: !!r.hasOpenDuplicateFlag,
      resubmissionCount: Math.max(0, r.currentSubmissionVersion - 1),
    };
  });
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "2026-11-04" (an IST date) -> the matching instant, at the start or end of that day. */
const istBoundary = (key: string, end: boolean) => new Date(`${key}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`);

/** A2: the three queues, with search, filters and oldest-first sorting. */
export async function listPending(user: UserDocument, rawQuery: ReviewListQuery): Promise<Paginated<ReviewListRow>> {
  const q = reviewListQuerySchema.parse(rawQuery);
  const filter: FilterQuery<RegistrationDocument> = { status: 'pending_accounts' };
  if (q.tab === 'unassigned') filter.assignedTo = null;
  if (q.tab === 'mine') filter.assignedTo = user._id;
  if (q.firmType) filter.firmType = q.firmType;
  if (q.flagged) filter.hasOpenDuplicateFlag = true;
  if (q.resubmitted) filter.currentSubmissionVersion = { $gt: 1 };
  if (q.from || q.to) {
    filter.lastSubmittedAt = { ...(q.from ? { $gte: istBoundary(q.from, false) } : {}), ...(q.to ? { $lte: istBoundary(q.to, true) } : {}) };
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = ['applicationId', 'firmName', 'pan', 'gst', 'signatory.name', 'signatory.email', 'signatory.mobile'].map((f) => ({ [f]: rx }));
  }

  // Volumes are small (tens per month), so business-day filtering happens after loading.
  let rows = await toRows(await Registration.find(filter).sort({ stageEnteredAt: 1, _id: 1 }));
  if (q.overdue) rows = rows.filter((r) => r.overdue);
  const start = (q.page - 1) * q.pageSize;
  return { items: rows.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total: rows.length };
}

const monthStartIST = () => istBoundary(`${istDateKey(new Date()).slice(0, 7)}-01`, false);

/** A1: summary cards and the oldest waiting applications. */
export async function dashboard(user: UserDocument): Promise<AccountsDashboardView> {
  const pending = await toRows(await Registration.find({ status: 'pending_accounts' }).sort({ stageEnteredAt: 1, _id: 1 }));
  const since = monthStartIST();
  const [approved, rejected] = await Promise.all(
    DECISIONS.map((event) => RegistrationHistory.countDocuments({ actorId: user._id, event, at: { $gte: since } })),
  );
  const mine = user._id.toString();
  return {
    unassigned: pending.filter((r) => !r.assignedTo).length,
    assignedToMe: pending.filter((r) => r.assignedTo?.id === mine).length,
    approvedByMeThisMonth: approved,
    rejectedByMeThisMonth: rejected,
    overdue: pending.filter((r) => r.overdue).length,
    oldest: pending.filter((r) => !r.assignedTo || r.assignedTo.id === mine).slice(0, 5),
  };
}

/** The application, if this Accounts user may see it; otherwise "not found" (no hints). */
async function accessibleRegistration(user: UserDocument, id: string) {
  const reg = mongoose.isValidObjectId(id) ? await Registration.findById(id) : null;
  if (reg) {
    if (reg.status === 'pending_accounts') return reg;
    const reviewed = await RegistrationHistory.exists({ registrationId: reg._id, actorId: user._id, event: { $in: DECISIONS } });
    if (reviewed) return reg;
  }
  throw new AppError(404, 'Application not found.', 'not_found');
}

/** A3: everything the reviewer needs, plus which actions this user may take right now. */
export async function getForReview(user: UserDocument, id: string, version?: number): Promise<ReviewApplicationView> {
  const reg = await accessibleRegistration(user, id);
  const shownVersion = version && Number.isInteger(version) && version >= 1 && version <= reg.currentSubmissionVersion ? version : reg.currentSubmissionVersion;
  const [[row], versions, historyRows, acceptance, flags] = await Promise.all([
    toRows([reg]),
    SubmissionVersion.find({ registrationId: reg._id }, { version: 1 }).sort({ version: 1 }),
    RegistrationHistory.find({ registrationId: reg._id }).sort({ at: 1 }),
    AgreementAcceptance.findOne({ registrationId: reg._id }).sort({ acceptedAt: -1 }),
    DuplicateFlag.find({ registrationId: reg._id, status: 'open' }),
  ]);

  const mine = !!reg.assignedTo?.equals(user._id);
  const pendingHere = reg.status === 'pending_accounts';
  const flagged = !!reg.hasOpenDuplicateFlag;

  return {
    id: reg._id.toString(),
    applicationId: row.applicationId,
    status: row.status,
    assignedTo: row.assignedTo,
    submittedAt: row.submittedAt,
    businessDaysWaiting: row.businessDaysWaiting,
    overdue: row.overdue,
    resubmissionCount: row.resubmissionCount,
    duplicate: {
      open: flagged,
      matches: flags.flatMap((f) => f.matches.map((m) => ({ field: m.field, value: m.value, matchedApplicationId: m.matchedApplicationId ?? null }))),
    },
    submission: await toSubmissionView(reg._id, shownVersion),
    versions: versions.map((v) => v.version),
    changes: await changesSincePrevious(reg._id, shownVersion),
    agreement: acceptance ? { versionNumber: acceptance.versionNumber, title: acceptance.title, acceptedAt: acceptance.acceptedAt.toISOString() } : null,
    history: await toHistoryView(historyRows, 'internal'),
    actions: {
      canPickUp: pendingHere && !reg.assignedTo,
      canApprove: pendingHere && mine && !flagged,
      canReject: pendingHere && mine,
      approveBlockedReason: pendingHere && mine && flagged ? 'A possible duplicate is waiting for Admin review. Approve becomes available once Admin clears it; you can still reject.' : null,
    },
  };
}

export async function openDocumentForReview(user: UserDocument, id: string, documentId: string) {
  const reg = await accessibleRegistration(user, id);
  return openRegistrationDocument(reg._id as Types.ObjectId, documentId);
}

/** A4: applications this user approved or rejected, newest decision first. */
export async function reviewedByMe(user: UserDocument): Promise<ReviewedRow[]> {
  const decisions = await RegistrationHistory.find({ actorId: user._id, event: { $in: DECISIONS } }).sort({ at: -1 }).limit(500);
  const regs = new Map(
    (await Registration.find({ _id: { $in: decisions.map((d) => d.registrationId) } }, { applicationId: 1, firmName: 1, status: 1 })).map((r) => [r._id.toString(), r]),
  );
  return decisions.flatMap((d) => {
    const reg = regs.get(d.registrationId.toString());
    if (!reg) return [];
    return [
      {
        id: reg._id.toString(),
        applicationId: reg.applicationId ?? '',
        firmName: reg.firmName,
        decision: d.event === 'accounts_approved' ? 'approved' : 'rejected',
        decidedAt: d.at.toISOString(),
        reason: d.reason ?? null,
        currentStatus: reg.status as ApplicationStatus,
      } satisfies ReviewedRow,
    ];
  });
}
