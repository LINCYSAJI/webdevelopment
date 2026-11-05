import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { UPLOAD_KINDS, contactChangeConfirmSchema, contactChangeStartSchema, resubmissionSchema, type UploadKind } from '@fap/shared';
import { AppError, asyncHandler } from '../lib/errors';
import { sendFile } from '../lib/send-file';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody, validateBodyDetailed } from '../middleware/validate';
import { toPublicUser } from '../models/User';
import * as franchise from '../services/franchise.service';
import * as resubmission from '../services/resubmission.service';
import { createUpload } from '../services/upload.service';

/** Franchise User screens (PRD F1, F2, F4). Every route is limited to the user's own application. */
export const franchiseRouter = Router();
franchiseRouter.use(requireAuth, requireRole('franchise_user'));

franchiseRouter.get(
  '/application',
  asyncHandler(async (req, res) => {
    res.json({ application: await franchise.getMyApplication(req.user!) });
  }),
);

franchiseRouter.get(
  '/application/versions/:version',
  asyncHandler(async (req, res) => {
    res.json({ submission: await franchise.getMySubmission(req.user!, Number(req.params.version)) });
  }),
);

/** Streams one of the user's own uploaded documents after the ownership check. */
franchiseRouter.get(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    sendFile(res, await franchise.openMyDocument(req.user!, req.params.id));
  }),
);

const contactChangeLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

franchiseRouter.post(
  '/profile/contact-change',
  contactChangeLimiter,
  validateBodyDetailed(contactChangeStartSchema),
  asyncHandler(async (req, res) => {
    res.json(await franchise.startContactChange(req.user!, req.body, req.ip));
  }),
);

franchiseRouter.post(
  '/profile/contact-change/confirm',
  contactChangeLimiter,
  validateBody(contactChangeConfirmSchema),
  asyncHandler(async (req, res) => {
    const user = await franchise.confirmContactChange(req.user!, req.body, req.ip);
    res.json({ user: toPublicUser(user!) });
  }),
);

// ---------- Edit & Resubmit (PRD F3) ----------

franchiseRouter.get(
  '/application/resubmit-form',
  asyncHandler(async (req, res) => {
    res.json({ form: await resubmission.getResubmitForm(req.user!) });
  }),
);

franchiseRouter.post(
  '/application/resubmit',
  validateBodyDetailed(resubmissionSchema),
  asyncHandler(async (req, res) => {
    res.json(await resubmission.resubmit(req.user!, req.body, { ip: req.ip, userAgent: req.get('user-agent') }));
  }),
);

/** The agreement version this applicant accepted, shown again on Edit & Resubmit. */
franchiseRouter.get(
  '/agreement/pdf',
  asyncHandler(async (req, res) => {
    sendFile(res, await resubmission.openMyAgreementPdf(req.user!), req.query.download === '1');
  }),
);

const uploadLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many uploads. Please wait a few minutes and try again.' } },
});

/** Replacement files chosen on Edit & Resubmit (same checks as registration uploads). */
franchiseRouter.put(
  '/uploads/:kind',
  uploadLimiter,
  express.raw({ type: () => true, limit: '25mb' }),
  asyncHandler(async (req, res) => {
    const kind = req.params.kind as UploadKind;
    if (!UPLOAD_KINDS.includes(kind)) throw new AppError(404, 'Not found.', 'not_found');
    let fileName: string | undefined;
    try {
      fileName = decodeURIComponent(req.get('x-file-name') ?? '');
    } catch {
      fileName = undefined;
    }
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.status(201).json({ upload: await createUpload(kind, data, fileName, req.ip) });
  }),
);
