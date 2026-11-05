import express, { Router, type Request } from 'express';
import { z } from 'zod';
import {
  MANAGED_ROLES,
  agreementDraftSchema,
  dataRequestDeclineSchema,
  dataRequestListQuerySchema,
  holidaySchema,
  internalUserSchema,
  reassignSchema,
  settingsSchema,
  type ManagedRole,
} from '@fap/shared';
import { AppError, asyncHandler } from '../lib/errors';
import { sendFile } from '../lib/send-file';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import * as agreements from '../services/agreement.service';
import * as dataRequests from '../services/data-request.service';
import { listAuditActions, listAuditLogs } from '../services/audit.service';
import * as settings from '../services/settings.service';
import * as users from '../services/users.service';
import * as workflow from '../services/workflow.service';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const actor = (req: Request): users.Actor => ({ user: req.user!, ip: req.ip });

function managedRole(value: string): ManagedRole {
  if (!(MANAGED_ROLES as readonly string[]).includes(value)) throw new AppError(404, 'Not found.', 'not_found');
  return value as ManagedRole;
}

// ---------- Accounts / Manager users (AD8, AD9) ----------

adminRouter.get(
  '/users/:role',
  asyncHandler(async (req, res) => {
    res.json({ users: await users.listUsers(managedRole(req.params.role)) });
  }),
);

adminRouter.post(
  '/users/:role',
  validateBody(internalUserSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await users.createUser(managedRole(req.params.role), req.body, actor(req)));
  }),
);

adminRouter.put(
  '/users/:role/:id',
  validateBody(internalUserSchema),
  asyncHandler(async (req, res) => {
    res.json({ user: await users.updateUser(managedRole(req.params.role), req.params.id, req.body, actor(req)) });
  }),
);

adminRouter.post(
  '/users/:role/:id/deactivate',
  asyncHandler(async (req, res) => {
    res.json({ user: await users.setUserActive(managedRole(req.params.role), req.params.id, false, actor(req)) });
  }),
);

/** Moves every application an Accounts user is reviewing (used before deactivating them, PRD AD8). */
adminRouter.post(
  '/users/accounts/:id/move-assignments',
  validateBody(reassignSchema),
  asyncHandler(async (req, res) => {
    res.json({ moved: await workflow.reassignAllFrom(req.params.id, req.body, actor(req)) });
  }),
);

adminRouter.post(
  '/users/:role/:id/reactivate',
  asyncHandler(async (req, res) => {
    res.json({ user: await users.setUserActive(managedRole(req.params.role), req.params.id, true, actor(req)) });
  }),
);

adminRouter.post(
  '/users/:role/:id/password-link',
  asyncHandler(async (req, res) => {
    res.json({ emailSent: await users.sendPasswordLink(managedRole(req.params.role), req.params.id, actor(req)) });
  }),
);

// ---------- Settings and holidays (AD11) ----------

adminRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await settings.getSettingsView() });
  }),
);

adminRouter.put(
  '/settings',
  validateBody(settingsSchema),
  asyncHandler(async (req, res) => {
    res.json({ settings: await settings.updateSettings(req.body, actor(req)) });
  }),
);

adminRouter.get(
  '/holidays',
  asyncHandler(async (_req, res) => {
    res.json({ holidays: await settings.listHolidays() });
  }),
);

adminRouter.post(
  '/holidays',
  validateBody(holidaySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ holiday: await settings.addHoliday(req.body, actor(req)) });
  }),
);

adminRouter.delete(
  '/holidays/:id',
  asyncHandler(async (req, res) => {
    await settings.removeHoliday(req.params.id, actor(req));
    res.json({ ok: true });
  }),
);

// ---------- Audit log (AD10) ----------

const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().trim().max(100).optional(),
});

adminRouter.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const q = auditQuerySchema.safeParse(req.query);
    if (!q.success) throw new AppError(400, 'Invalid filters.', 'validation');
    res.json(await listAuditLogs({ ...q.data, action: q.data.action || undefined, search: q.data.search || undefined }));
  }),
);

adminRouter.get(
  '/audit-logs/actions',
  asyncHandler(async (_req, res) => {
    res.json({ actions: await listAuditActions() });
  }),
);

// ---------- Agreement content (AD7) ----------

adminRouter.get(
  '/agreements',
  asyncHandler(async (_req, res) => {
    res.json({ versions: await agreements.listVersions() });
  }),
);

adminRouter.get(
  '/agreements/:id',
  asyncHandler(async (req, res) => {
    res.json({ version: await agreements.getVersion(req.params.id) });
  }),
);

adminRouter.post(
  '/agreements',
  validateBody(agreementDraftSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ version: await agreements.createDraft(req.body, actor(req)) });
  }),
);

adminRouter.put(
  '/agreements/:id',
  validateBody(agreementDraftSchema),
  asyncHandler(async (req, res) => {
    res.json({ version: await agreements.updateDraft(req.params.id, req.body, actor(req)) });
  }),
);

// The PDF is sent as the raw request body (Content-Type: application/pdf); the original
// file name travels in the X-File-Name header.
adminRouter.put(
  '/agreements/:id/pdf',
  express.raw({ type: 'application/pdf', limit: '10mb' }),
  asyncHandler(async (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let fileName: string | undefined;
    try {
      fileName = decodeURIComponent(req.get('x-file-name') ?? '');
    } catch {
      fileName = undefined;
    }
    res.json({ version: await agreements.uploadPdf(req.params.id, data, fileName, actor(req)) });
  }),
);

adminRouter.get(
  '/agreements/:id/pdf',
  asyncHandler(async (req, res) => {
    sendFile(res, await agreements.openPdf(req.params.id, { activeOnly: false }), req.query.download === '1');
  }),
);

adminRouter.post(
  '/agreements/:id/duplicate',
  asyncHandler(async (req, res) => {
    res.status(201).json({ version: await agreements.duplicateAsDraft(req.params.id, actor(req)) });
  }),
);

adminRouter.post(
  '/agreements/:id/activate',
  asyncHandler(async (req, res) => {
    res.json({ version: await agreements.activateVersion(req.params.id, actor(req)) });
  }),
);

adminRouter.post(
  '/agreements/:id/deactivate',
  asyncHandler(async (req, res) => {
    res.json({ version: await agreements.deactivateVersion(req.params.id, actor(req)) });
  }),
);

// ---------- Registrations: reassign the Accounts reviewer (PRD AD2, 10.6) ----------

adminRouter.post(
  '/registrations/:id/reassign',
  validateBody(reassignSchema),
  asyncHandler(async (req, res) => {
    await workflow.reassign(req.params.id, req.body, actor(req));
    res.json({ ok: true });
  }),
);

// ---------- Data deletion requests (DPDP Act s.12) ----------

adminRouter.get(
  '/data-requests',
  asyncHandler(async (req, res) => {
    const query = dataRequestListQuerySchema.safeParse(req.query);
    if (!query.success) throw new AppError(400, 'Invalid filter.', 'validation');
    res.json(await dataRequests.listRequests(query.data));
  }),
);

adminRouter.post(
  '/data-requests/:id/erase',
  asyncHandler(async (req, res) => {
    res.json(await dataRequests.eraseRequest(req.params.id, actor(req)));
  }),
);

adminRouter.post(
  '/data-requests/:id/decline',
  validateBody(dataRequestDeclineSchema),
  asyncHandler(async (req, res) => {
    res.json({ request: await dataRequests.declineRequest(req.params.id, req.body.note, actor(req)) });
  }),
);
