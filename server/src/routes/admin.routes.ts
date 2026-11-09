import express, { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  MANAGED_ROLES,
  agreementDraftSchema,
  dataRequestDeclineSchema,
  duplicateDecisionSchema,
  emailTemplateUpdateSchema,
  smsSettingsSchema,
  smsTestSchema,
  dataRequestListQuerySchema,
  holidaySchema,
  internalUserSchema,
  reassignSchema,
  settingsSchema,
  type AdminRegistrationQuery,
  type AdminRejectedQuery,
  type ManagedRole,
} from '@fap/shared';
import { sendCsv } from '../lib/csv';
import { AppError, asyncHandler } from '../lib/errors';
import { sendFile } from '../lib/send-file';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody, validateBodyDetailed } from '../middleware/validate';
import * as agreements from '../services/agreement.service';
import * as dataRequests from '../services/data-request.service';
import * as duplicates from '../services/duplicate.service';
import * as emailTemplates from '../services/email-template-admin.service';
import * as generated from '../services/generated-agreement.service';
import * as oversight from '../services/oversight.service';
import * as scheduler from '../services/scheduler.service';
import * as smsAdmin from '../services/sms-admin.service';
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

// ---------- Email templates (PRD §11, §14) ----------

adminRouter.get(
  '/email-templates',
  asyncHandler(async (_req, res) => {
    res.json({ templates: await emailTemplates.listTemplates() });
  }),
);

adminRouter.put(
  '/email-templates/:key',
  validateBody(emailTemplateUpdateSchema),
  asyncHandler(async (req, res) => {
    res.json({ template: await emailTemplates.updateTemplate(req.params.key, req.body, actor(req)) });
  }),
);

adminRouter.delete(
  '/email-templates/:key',
  asyncHandler(async (req, res) => {
    res.json({ template: await emailTemplates.resetTemplate(req.params.key, actor(req)) });
  }),
);

adminRouter.post(
  '/email-templates/:key/preview',
  validateBody(emailTemplateUpdateSchema),
  asyncHandler(async (req, res) => {
    res.json({ preview: await emailTemplates.previewTemplate(req.params.key, req.body) });
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

// ---------- Admin oversight (PRD AD1–AD6) ----------

const stamp = () => new Date().toISOString().slice(0, 10);

adminRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    res.json({ dashboard: await oversight.dashboard() });
  }),
);

adminRouter.get(
  '/registrations',
  asyncHandler(async (req, res) => {
    res.json(await oversight.listRegistrations(req.query as AdminRegistrationQuery));
  }),
);

adminRouter.get(
  '/registrations/export',
  asyncHandler(async (req, res) => {
    sendCsv(res, `registrations-${stamp()}.csv`, await oversight.exportRegistrations(req.query as AdminRegistrationQuery, actor(req)));
  }),
);

adminRouter.get(
  '/registrations/:id',
  asyncHandler(async (req, res) => {
    const version = req.query.version ? Number(req.query.version) : undefined;
    res.json({ application: await oversight.getRegistration(req.params.id, version) });
  }),
);

adminRouter.get(
  '/registrations/:id/documents/:documentId',
  asyncHandler(async (req, res) => {
    sendFile(res, await oversight.openDocument(req.params.id, req.params.documentId));
  }),
);

adminRouter.get(
  '/tracking',
  asyncHandler(async (_req, res) => {
    res.json({ tracking: await oversight.tracking() });
  }),
);

// Runs the daily automatic check now (PRD 10.8). Safe to repeat: a reminder is never sent twice.
const dailyCheckLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'The check was run several times just now. Please wait a few minutes.' } },
});

adminRouter.post(
  '/daily-check/run',
  dailyCheckLimiter,
  asyncHandler(async (req, res) => {
    res.json({ run: await scheduler.runDailyCheck({ trigger: 'admin', actor: actor(req) }) });
  }),
);

adminRouter.get(
  '/approved',
  asyncHandler(async (req, res) => {
    res.json(await oversight.listApproved(req.query as AdminRegistrationQuery));
  }),
);

adminRouter.get(
  '/approved/export',
  asyncHandler(async (req, res) => {
    sendCsv(res, `approved-applications-${stamp()}.csv`, await oversight.exportApproved(req.query as AdminRegistrationQuery, actor(req)));
  }),
);

adminRouter.get(
  '/rejected',
  asyncHandler(async (req, res) => {
    res.json(await oversight.listRejected(req.query as AdminRejectedQuery));
  }),
);

adminRouter.get(
  '/rejected/export',
  asyncHandler(async (req, res) => {
    sendCsv(res, `rejected-applications-${stamp()}.csv`, await oversight.exportRejected(req.query as AdminRejectedQuery, actor(req)));
  }),
);

/** AD6: the agreement records and email history only — never the PDF itself (open question Q1 default). */
adminRouter.get(
  '/generated-agreements',
  asyncHandler(async (_req, res) => {
    res.json({ items: await generated.list() });
  }),
);

adminRouter.get(
  '/generated-agreements/:id/emails',
  asyncHandler(async (req, res) => {
    res.json({ items: await generated.emailHistory(req.params.id) });
  }),
);

// ---------- Duplicate Review (PRD AD3) ----------

adminRouter.get(
  '/duplicates',
  asyncHandler(async (_req, res) => {
    res.json({ items: await duplicates.listOpen() });
  }),
);

adminRouter.get(
  '/duplicates/:id',
  asyncHandler(async (req, res) => {
    res.json({ comparison: await duplicates.compare(req.params.id) });
  }),
);

adminRouter.post(
  '/duplicates/:id/not-duplicate',
  validateBody(duplicateDecisionSchema),
  asyncHandler(async (req, res) => {
    res.json(await duplicates.clearFlag(req.params.id, req.body.note, actor(req)));
  }),
);

adminRouter.post(
  '/duplicates/:id/confirm',
  validateBody(duplicateDecisionSchema),
  asyncHandler(async (req, res) => {
    res.json(await duplicates.confirmFlag(req.params.id, req.body.note, actor(req)));
  }),
);

// ---------- SMS Notifications (Networkz gateway) ----------

const smsTestLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many test messages. Please wait a few minutes.' } },
});

adminRouter.get(
  '/sms/status',
  asyncHandler(async (_req, res) => {
    res.json({ status: await smsAdmin.status() });
  }),
);

adminRouter.get(
  '/sms/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await smsAdmin.getSettingsView() });
  }),
);

adminRouter.put(
  '/sms/settings',
  validateBodyDetailed(smsSettingsSchema),
  asyncHandler(async (req, res) => {
    res.json({ settings: await smsAdmin.updateSettings(req.body, actor(req)) });
  }),
);

adminRouter.post(
  '/sms/test',
  smsTestLimiter,
  validateBodyDetailed(smsTestSchema),
  asyncHandler(async (req, res) => {
    res.json({ outcome: await smsAdmin.sendTest(req.body.mobile, req.body.event, actor(req)) });
  }),
);

adminRouter.get(
  '/sms/logs',
  asyncHandler(async (req, res) => {
    res.json(await smsAdmin.listLogs(req.query));
  }),
);

adminRouter.post(
  '/sms/logs/refresh-delivery',
  asyncHandler(async (req, res) => {
    res.json(await smsAdmin.refreshDelivery(actor(req)));
  }),
);
