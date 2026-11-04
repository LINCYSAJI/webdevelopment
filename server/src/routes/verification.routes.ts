import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { completeRegistrationSchema, sendCodeSchema, verificationStatusSchema, verifyCodeSchema } from '@fap/shared';
import { asyncHandler } from '../lib/errors';
import { setAuthCookies } from '../lib/auth-cookies';
import { validateBody, validateBodyDetailed } from '../middleware/validate';
import { toPublicUser } from '../models/User';
import * as verification from '../services/verification.service';

/**
 * Email / SMS verification after Register (PRD P3, P4). The browser proves which registration
 * it is with the secret token returned by Register; it is sent in the body, never in the URL.
 */
export const verificationRouter = Router();

verificationRouter.use(
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests. Please wait a few minutes and try again.' } },
  }),
);

verificationRouter.post(
  '/status',
  validateBody(verificationStatusSchema),
  asyncHandler(async (req, res) => {
    res.json({ status: await verification.getStatus(req.body.token) });
  }),
);

verificationRouter.post(
  '/send',
  validateBody(sendCodeSchema),
  asyncHandler(async (req, res) => {
    res.json({ status: await verification.sendCode(req.body.token, req.body.channel) });
  }),
);

verificationRouter.post(
  '/verify',
  validateBody(verifyCodeSchema),
  asyncHandler(async (req, res) => {
    res.json({ status: await verification.verifyCode(req.body.token, req.body.channel, req.body.code, req.ip) });
  }),
);

verificationRouter.post(
  '/complete',
  validateBodyDetailed(completeRegistrationSchema),
  asyncHandler(async (req, res) => {
    const { user, tokens, result } = await verification.completeRegistration(req.body.token, req.body.password, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    setAuthCookies(res, tokens);
    res.status(201).json({ ...result, user: toPublicUser(user) });
  }),
);
