import { Router, type Request } from 'express';
import { MANAGER_LISTS, decisionReasonSchema, reviewListQuerySchema, sendAgreementSchema, type ManagerList } from '@fap/shared';
import { AppError, asyncHandler } from '../lib/errors';
import { sendFile } from '../lib/send-file';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import * as generated from '../services/generated-agreement.service';
import * as review from '../services/review.service';
import * as workflow from '../services/workflow.service';

/**
 * Manager screens and actions (PRD M1–M5). Managers only: this is also the ONLY way to reach a
 * generated agreement PDF (CLAUDE.md rule 4) — Accounts, Franchise Users and Admin are refused.
 */
export const managerRouter = Router();
managerRouter.use(requireAuth, requireRole('manager'));

const actor = (req: Request) => ({ user: req.user!, ip: req.ip });

const LIST_FILTER: Record<ManagerList, Record<string, unknown>> = {
  pending: { status: 'pending_manager' },
  approved: { status: 'approved' },
  rejected: { status: 'rejected_by_manager' },
};

managerRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    res.json({ dashboard: await review.managerDashboard() });
  }),
);

/** M2 (pending, oldest first) and M4 (approved / rejected, newest first). */
managerRouter.get(
  '/applications',
  asyncHandler(async (req, res) => {
    const list = String(req.query.list ?? 'pending') as ManagerList;
    if (!MANAGER_LISTS.includes(list)) throw new AppError(400, 'Unknown list.', 'validation');
    if (!reviewListQuerySchema.safeParse(req.query).success) throw new AppError(400, 'Invalid filters.', 'validation');
    res.json(await review.listApplications(LIST_FILTER[list], req.query as never, { withAccountsDecision: true, newestFirst: list !== 'pending' }));
  }),
);

managerRouter.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const version = req.query.version ? Number(req.query.version) : undefined;
    res.json({ application: await review.getForManager(req.user!, req.params.id, version) });
  }),
);

managerRouter.get(
  '/applications/:id/documents/:documentId',
  asyncHandler(async (req, res) => {
    sendFile(res, await review.openDocumentForManager(req.user!, req.params.id, req.params.documentId));
  }),
);

// ---------- Decisions (each its own endpoint, CLAUDE.md rule 3) ----------

managerRouter.post(
  '/applications/:id/approve',
  asyncHandler(async (req, res) => {
    const result = await workflow.approveByManager(req.params.id, actor(req));
    res.json({ ...result, application: await review.getForManager(req.user!, req.params.id) });
  }),
);

managerRouter.post(
  '/applications/:id/reject',
  validateBody(decisionReasonSchema),
  asyncHandler(async (req, res) => {
    await workflow.rejectByManager(req.params.id, req.body.reason, actor(req));
    res.json({ application: await review.getForManager(req.user!, req.params.id) });
  }),
);

// ---------- Generated agreements (M5) ----------

managerRouter.get(
  '/agreements',
  asyncHandler(async (_req, res) => {
    res.json({ items: await generated.list() });
  }),
);

/** View in the browser, or with ?download=1 download it — the only download point in the portal. */
managerRouter.get(
  '/agreements/:id/pdf',
  asyncHandler(async (req, res) => {
    const download = req.query.download === '1';
    sendFile(res, await generated.openPdf(req.params.id, download, actor(req)), download);
  }),
);

managerRouter.get(
  '/agreements/:id/email-draft',
  asyncHandler(async (req, res) => {
    res.json({ draft: await generated.emailDraft(req.params.id) });
  }),
);

managerRouter.post(
  '/agreements/:id/send',
  validateBody(sendAgreementSchema),
  asyncHandler(async (req, res) => {
    res.json(await generated.send(req.params.id, req.body, actor(req)));
  }),
);

managerRouter.get(
  '/agreements/:id/emails',
  asyncHandler(async (req, res) => {
    res.json({ items: await generated.emailHistory(req.params.id) });
  }),
);

managerRouter.post(
  '/agreements/:id/retry',
  asyncHandler(async (req, res) => {
    res.json({ generation: await generated.retry(req.params.id, actor(req)) });
  }),
);
