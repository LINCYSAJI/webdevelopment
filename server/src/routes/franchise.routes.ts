import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { contactChangeConfirmSchema, contactChangeStartSchema } from '@fap/shared';
import { asyncHandler } from '../lib/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody, validateBodyDetailed } from '../middleware/validate';
import { toPublicUser } from '../models/User';
import * as franchise from '../services/franchise.service';

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
    const file = await franchise.openMyDocument(req.user!, req.params.id);
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    file.stream.on('error', () => res.destroy());
    file.stream.pipe(res);
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
