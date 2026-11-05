import mongoose, { type FilterQuery, type Types } from 'mongoose';
import {
  businessDaysBetween,
  istDateKey,
  maskPan,
  reviewListQuerySchema,
  type AccountsDashboardView,
  type ManagerDashboardView,
  type ApplicationStatus,
  type Paginated,
  type ReviewApplicationView,
  type ReviewListQuery,
  type ReviewListRow,
  type ReviewedRow,
} from '@fap/shared';
import { AppError } from '../lib/errors';
import { AgreementAcceptance } from '../models/AgreementAcceptance';
import { AgreementEmailLog } from '../models/AgreementEmailLog';
import { DuplicateFlag } from '../models/DuplicateFlag';
import { GeneratedAgreement } from '../models/GeneratedAgreement';
import { Holiday } from '../models/Holiday';
import { Registration, type RegistrationDocument } from '../models/Registration';
import { RegistrationHistory } from '../models/RegistrationHistory';
import { getSettings } from '../models/Settings';
import { SubmissionVersion } from '../models/SubmissionVersion';
import { User, type UserDocument } from '../models/User';
import { changesSincePrevious, openRegistrationDocument, toHistoryView, toSubmissionView } from './application-view.service';
import { toSummary } from './generated-agreement.service';

// Review screens shared by Accounts (PRD A1–A4) and the Manager (M1–M4).
// Accounts may see (PRD 13.2): Pending Accounts, plus what they reviewed before.
// Managers may see: Pending Manager, Approved and Rejected by Manager, plus what they decided.

const ACCOUNTS_DECISIONS = ['accounts_approved', 'accounts_rejected'] as const;
const MANAGER_DECISIONS = ['manager_approved', 'manager_rejected'] as const;
export const MANAGER_STATUSES: ApplicationStatus[] = ['pending_manager', 'approved', 'rejected_by_manager'];

async function holidaySet() {
  return new Set((await Holiday.find({}, { date: 1 })).map((h) => h.date));
}

const waitingSince = (reg: RegistrationDocument) => reg.stageEnteredAt ?? reg.lastSubmittedAt ?? reg.submittedAt;

/** List rows, including (for Manager lists) who approved at the Accounts stage and when. */
export async function toRows(regs: RegistrationDocument[], withAccountsDecision = false): Promise<ReviewListRow[]> {
  const [holidays, settings] = await Promise.all([holidaySet(), getSettings()]);
  const assigneeIds = [...new Set(regs.map((r) => r.assignedTo?.toString()).filter(Boolean))];
  const decisions = withAccountsDecision
    ? await RegistrationHistory.aggregate<{ _id: Types.ObjectId; actorId: Types.ObjectId; at: Date }>([
        { $match: { registrationId: { $in: regs.map((r) => r._id) }, event: 'accounts_approved' } },
        { $sort: { at: 1 } },
        { $group: { _id: '$registrationId', actorId: { $last: '$actorId' }, at: { $last: '$at' } } },
      ])
    : [];
  const decisionBy = new Map(decisions.map((d) => [d._id.toString(), d]));
  const userIds = [...assigneeIds, ...decisions.map((d) => d.actorId?.toString())].filter(Boolean);
  const names = new Map((await User.find({ _id: { $in: userIds } }, { name: 1 })).map((u) => [u._id.toString(), u.name]));
  const now = new Date();

  return regs.map((r) => {
    const days = businessDaysBetween(waitingSince(r), now, holidays);
    const decision = decisionBy.get(r._id.toString());
    const waitingStage = r.status === 'pending_accounts' || r.status === 'pending_manager';
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
      // "Overdue (over 2 business days)" — the number comes from Settings (PRD A1, M1, 10.8).
      overdue: waitingStage && days > settings.reminderFirstAfterDays,
      assignedTo: r.assignedTo ? { id: r.assignedTo.toString(), name: names.get(r.assignedTo.toString()) ?? 'Unknown' } : null,
      hasOpenDuplicateFlag: !!r.hasOpenDuplicateFlag,
      resubmissionCount: Math.max(0, r.currentSubmissionVersion - 1),
      ...(withAccountsDecision
        ? { accountsApprovedBy: decision ? names.get(decision.actorId?.toString()) ?? 'Unknown' : null, accountsApprovedAt: decision?.at.toISOString() ?? null }
        : {}),
      agreementReferenceNo: r.agreementReferenceNo ?? null,
    };
  });
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "2026-11-04" (an IST date) -> the matching instant, at the start or end of that day. */
const istBoundary = (key: string, end: boolean) => new Date(`${key}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`);
export const monthStartIST = () => istBoundary(`${istDateKey(new Date()).slice(0, 7)}-01`, false);

/** Shared search, filters, oldest-first sort and paging for every review list. */
export async function listApplications(
  base: FilterQuery<RegistrationDocument>,
  rawQuery: ReviewListQuery,
  opts: { withAccountsDecision?: boolean; newestFirst?: boolean } = {},
): Promise<Paginated<ReviewListRow>> {
  const q = reviewListQuerySchema.parse(rawQuery);
  const filter: FilterQuery<RegistrationDocument> = { ...base };
  if (q.firmType) filter.firmType = q.firmType;
  if (q.flagged) filter.hasOpenDuplicateFlag = true;
  if (q.resubmitted) filter.currentSubmissionVersion = { $gt: 1 };
  if (q.from || q.to) {
    filter.lastSubmittedAt = { ...(q.from ? { $gte: istBoundary(q.from, false) } : {}), ...(q.to ? { $lte: istBoundary(q.to, true) } : {}) };
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = ['applicationId', 'firmName', 'pan', 'gst', 'signatory.name', 'signatory.email', 'signatory.mobile', 'agreementReferenceNo'].map((f) => ({ [f]: rx }));
  }
  const sort = opts.newestFirst ? { stageEnteredAt: -1 as const, _id: -1 as const } : { stageEnteredAt: 1 as const, _id: 1 as const };
  // Volumes are small (tens per month), so business-day filtering happens after loading.
  let rows = await toRows(await Registration.find(filter).sort(sort), opts.withAccountsDecision);
  if (q.overdue) rows = rows.filter((r) => r.overdue);
  const start = (q.page - 1) * q.pageSize;
  return { items: rows.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total: rows.length };
}

/** The full review view; the caller decides which actions this user may take. */
export async function buildReviewView(
  reg: RegistrationDocument,
  version: number | undefined,
  actions: ReviewApplicationView['actions'],
  opts: { forManager?: boolean } = {},
): Promise<ReviewApplicationView> {
  if (reg.status === 'withdrawn') {
    throw new AppError(410, "This application was withdrawn and its personal data erased at the applicant's request.", 'erased');
  }
  const shownVersion = version && Number.isInteger(version) && version >= 1 && version <= reg.currentSubmissionVersion ? version : reg.currentSubmissionVersion;
  const [[row], versions, historyRows, acceptance, flags, generated] = await Promise.all([
    toRows([reg]),
    SubmissionVersion.find({ registrationId: reg._id }, { version: 1 }).sort({ version: 1 }),
    RegistrationHistory.find({ registrationId: reg._id }).sort({ at: 1 }),
    AgreementAcceptance.findOne({ registrationId: reg._id }).sort({ acceptedAt: -1 }),
    DuplicateFlag.find({ registrationId: reg._id, status: 'open' }),
    opts.forManager ? GeneratedAgreement.findOne({ registrationId: reg._id }) : Promise.resolve(null),
  ]);
  const history = await toHistoryView(historyRows, 'internal');
  const lastAccountsApproval = [...history].reverse().find((h) => h.event === 'accounts_approved');

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
      open: !!reg.hasOpenDuplicateFlag,
      matches: flags.flatMap((f) => f.matches.map((m) => ({ field: m.field, value: m.value, matchedApplicationId: m.matchedApplicationId ?? null }))),
    },
    submission: await toSubmissionView(reg._id, shownVersion),
    versions: versions.map((v) => v.version),
    changes: await changesSincePrevious(reg._id, shownVersion),
    agreement: acceptance ? { versionNumber: acceptance.versionNumber, title: acceptance.title, acceptedAt: acceptance.acceptedAt.toISOString() } : null,
    accountsDecision: lastAccountsApproval ? { by: lastAccountsApproval.by, at: lastAccountsApproval.at } : null,
    agreementReferenceNo: reg.agreementReferenceNo ?? null,
    generatedAgreement: generated ? toSummary(generated) : null,
    history,
    actions,
  };
}

async function loadRegistration(id: string) {
  return mongoose.isValidObjectId(id) ? Registration.findById(id) : null;
}

const notFound = () => new AppError(404, 'Application not found.', 'not_found');

// ---------- Accounts ----------

/** A2: the three Accounts queues. */
export async function listPending(user: UserDocument, rawQuery: ReviewListQuery): Promise<Paginated<ReviewListRow>> {
  const tab = reviewListQuerySchema.parse(rawQuery).tab;
  const base: FilterQuery<RegistrationDocument> = { status: 'pending_accounts' };
  if (tab === 'unassigned') base.assignedTo = null;
  if (tab === 'mine') base.assignedTo = user._id;
  return listApplications(base, rawQuery);
}

/** A1: summary cards and the oldest waiting applications. */
export async function dashboard(user: UserDocument): Promise<AccountsDashboardView> {
  const pending = await toRows(await Registration.find({ status: 'pending_accounts' }).sort({ stageEnteredAt: 1, _id: 1 }));
  const since = monthStartIST();
  const [approved, rejected] = await Promise.all(
    ACCOUNTS_DECISIONS.map((event) => RegistrationHistory.countDocuments({ actorId: user._id, event, at: { $gte: since } })),
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
async function accountsAccessible(user: UserDocument, id: string) {
  const reg = await loadRegistration(id);
  if (reg) {
    if (reg.status === 'pending_accounts') return reg;
    if (await RegistrationHistory.exists({ registrationId: reg._id, actorId: user._id, event: { $in: ACCOUNTS_DECISIONS } })) return reg;
  }
  throw notFound();
}

/** A3: everything the reviewer needs, plus which actions this user may take right now. */
export async function getForReview(user: UserDocument, id: string, version?: number): Promise<ReviewApplicationView> {
  const reg = await accountsAccessible(user, id);
  const mine = !!reg.assignedTo?.equals(user._id);
  const pendingHere = reg.status === 'pending_accounts';
  const flagged = !!reg.hasOpenDuplicateFlag;
  return buildReviewView(reg, version, {
    canPickUp: pendingHere && !reg.assignedTo,
    canApprove: pendingHere && mine && !flagged,
    canReject: pendingHere && mine,
    approveBlockedReason: pendingHere && mine && flagged ? 'A possible duplicate is waiting for Admin review. Approve becomes available once Admin clears it; you can still reject.' : null,
  });
}

export async function openDocumentForReview(user: UserDocument, id: string, documentId: string) {
  const reg = await accountsAccessible(user, id);
  return openRegistrationDocument(reg._id as Types.ObjectId, documentId);
}

/** A4: applications this user approved or rejected, newest decision first. */
export async function reviewedByMe(user: UserDocument): Promise<ReviewedRow[]> {
  const decisions = await RegistrationHistory.find({ actorId: user._id, event: { $in: ACCOUNTS_DECISIONS } }).sort({ at: -1 }).limit(500);
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

// ---------- Manager ----------

/** The application, if a Manager may see it (PRD 13.2); otherwise "not found". */
export async function managerAccessible(user: UserDocument, id: string) {
  const reg = await loadRegistration(id);
  if (reg) {
    if (MANAGER_STATUSES.includes(reg.status as ApplicationStatus)) return reg;
    if (await RegistrationHistory.exists({ registrationId: reg._id, actorId: user._id, event: { $in: MANAGER_DECISIONS } })) return reg;
  }
  throw notFound();
}

/** M3: any Manager can act on Pending Manager applications; there is no assignment at this stage. */
export async function getForManager(user: UserDocument, id: string, version?: number): Promise<ReviewApplicationView> {
  const reg = await managerAccessible(user, id);
  const pending = reg.status === 'pending_manager';
  const flagged = !!reg.hasOpenDuplicateFlag;
  return buildReviewView(
    reg,
    version,
    {
      canPickUp: false,
      canApprove: pending && !flagged,
      canReject: pending,
      approveBlockedReason: pending && flagged ? 'A possible duplicate is waiting for Admin review. Approve becomes available once Admin clears it; you can still reject.' : null,
    },
    { forManager: true },
  );
}

export async function openDocumentForManager(user: UserDocument, id: string, documentId: string) {
  const reg = await managerAccessible(user, id);
  return openRegistrationDocument(reg._id as Types.ObjectId, documentId);
}

/** M1: summary cards and the oldest applications waiting for final approval. */
export async function managerDashboard(): Promise<ManagerDashboardView> {
  const pending = await toRows(await Registration.find({ status: 'pending_manager' }).sort({ stageEnteredAt: 1, _id: 1 }), true);
  const since = monthStartIST();
  const [approved, rejected] = await Promise.all(
    MANAGER_DECISIONS.map((event) => RegistrationHistory.countDocuments({ event, at: { $gte: since } })),
  );
  const generated = await GeneratedAgreement.find({ status: 'generated' }, { _id: 1 });
  const emailed = new Set(
    (await AgreementEmailLog.distinct('generatedAgreementId', { status: 'sent', generatedAgreementId: { $in: generated.map((g) => g._id) } })).map(String),
  );
  return {
    pendingApproval: pending.length,
    overdue: pending.filter((r) => r.overdue).length,
    approvedThisMonth: approved,
    rejectedThisMonth: rejected,
    agreementsNotYetEmailed: generated.filter((g) => !emailed.has(g._id.toString())).length,
    oldest: pending.slice(0, 5),
  };
}
