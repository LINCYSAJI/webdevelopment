import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { UPLOAD_KINDS, registrationSchema, type Branding, type UploadKind, type UploadLimits } from '@fap/shared';
import { AppError, asyncHandler } from '../lib/errors';
import { getSettings } from '../models/Settings';
import { sendPdf } from '../lib/send-pdf';
import { validateBodyDetailed } from '../middleware/validate';
import { getActiveVersion, openPdf } from '../services/agreement.service';
import { submitRegistration } from '../services/registration.service';
import { createUpload } from '../services/upload.service';

export const publicRouter = Router();

const limiter = (limit: number, message: string) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message } },
  });

// ---------- Franchise Registration (PRD P2) ----------

/** Everything the registration page needs: the active agreement and the file size limits. */
publicRouter.get(
  '/registration-form',
  asyncHandler(async (_req, res) => {
    const s = await getSettings();
    const limits: UploadLimits = { maxDocumentSizeMB: s.maxDocumentSizeMB, maxPhotoSizeMB: s.maxPhotoSizeMB, maxRentalSizeMB: s.maxRentalSizeMB };
    res.json({ agreement: await getActiveVersion(), limits });
  }),
);

/**
 * One file chosen on the registration page. The file is the raw request body; its name
 * travels in the X-File-Name header. Returns a one-time token used on Register.
 */
publicRouter.put(
  '/uploads/:kind',
  limiter(200, 'Too many uploads. Please wait a few minutes and try again.'),
  express.raw({ type: () => true, limit: '25mb' }),
  asyncHandler(async (req, res) => {
    const kind = req.params.kind as UploadKind;
    if (!UPLOAD_KINDS.includes(kind)) throw new AppError(404, 'Not found.', 'not_found');
    if (!(await getActiveVersion())) throw new AppError(409, 'Registration is currently closed.', 'registration_closed');
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

publicRouter.post(
  '/registrations',
  limiter(20, 'Too many registration attempts. Please wait a few minutes and try again.'),
  validateBodyDetailed(registrationSchema),
  asyncHandler(async (req, res) => {
    const result = await submitRegistration(req.body, { ip: req.ip, userAgent: req.get('user-agent') });
    res.status(201).json(result);
  }),
);

/** The published agreement shown on the registration page; null means registration is closed. */
publicRouter.get(
  '/agreement',
  asyncHandler(async (_req, res) => {
    res.json({ agreement: await getActiveVersion() });
  }),
);

/** The blank agreement PDF, available publicly only while its version is the active one. */
publicRouter.get(
  '/agreements/:id/pdf',
  asyncHandler(async (req, res) => {
    sendPdf(res, await openPdf(req.params.id, { activeOnly: true }), req.query.download === '1');
  }),
);

publicRouter.get(
  '/branding',
  asyncHandler(async (_req, res) => {
    const s = await getSettings();
    const branding: Branding = {
      organisationName: s.organisationName,
      portalName: s.portalName,
      logoUrl: s.logoUrl ?? null,
      primaryColor: s.primaryColor,
      secondaryColor: s.secondaryColor,
      supportEmail: s.supportEmail ?? null,
      supportPhone: s.supportPhone ?? null,
    };
    res.json({ branding });
  }),
);
