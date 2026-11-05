import { Router, type Request } from 'express';
import { decisionReasonSchema, reviewListQuerySchema } from '@fap/shared';
import { AppError, asyncHandler } from '../lib/errors';
import { sendFile } from '../lib/send-file';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import * as review from '../services/review.service';
import * as workflow from '../services/workflow.service';

/** Accounts screens and actions (PRD A1–A4). Accounts users only. */
export const accountsRouter = Router();
accountsRouter.use(requireAuth, requireRole('accounts'));

const actor = (req: Request) => ({ user: req.user!, ip: req.ip });

accountsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    res.json({ dashboard: await review.dashboard(req.user!) });
  }),
);

accountsRouter.get(
  '/applications',
  asyncHandler(async (req, res) => {
    const parsed = reviewListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'Invalid filters.', 'validation');
    res.json(await review.listPending(req.user!, req.query as never));
  }),
);

accountsRouter.get(
  '/reviewed',
  asyncHandler(async (req, res) => {
    res.json({ items: await review.reviewedByMe(req.user!) });
  }),
);

accountsRouter.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const version = req.query.version ? Number(req.query.version) : undefined;
    res.json({ application: await review.getForReview(req.user!, req.params.id, version) });
  }),
);

accountsRouter.get(
  '/applications/:id/documents/:documentId',
  asyncHandler(async (req, res) => {
    sendFile(res, await review.openDocumentForReview(req.user!, req.params.id, req.params.documentId));
  }),
);

// ---------- Workflow actions: each one is its own endpoint (CLAUDE.md rule 3) ----------

accountsRouter.post(
  '/applications/:id/pick-up',
  asyncHandler(async (req, res) => {
    await workflow.pickUp(req.params.id, actor(req));
    res.json({ application: await review.getForReview(req.user!, req.params.id) });
  }),
);

accountsRouter.post(
  '/applications/:id/approve',
  asyncHandler(async (req, res) => {
    await workflow.approveByAccounts(req.params.id, actor(req));
    res.json({ application: await review.getForReview(req.user!, req.params.id) });
  }),
);

accountsRouter.post(
  '/applications/:id/reject',
  validateBody(decisionReasonSchema),
  asyncHandler(async (req, res) => {
    await workflow.rejectByAccounts(req.params.id, req.body.reason, actor(req));
    res.json({ application: await review.getForReview(req.user!, req.params.id) });
  }),
);
