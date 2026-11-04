import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, setPasswordSchema } from '@fap/shared';
import { clearAuthCookies, setAuthCookies } from '../lib/auth-cookies';
import { AppError, asyncHandler } from '../lib/errors';
import { REFRESH_COOKIE, requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { toPublicUser } from '../models/User';
import * as auth from '../services/auth.service';
import * as passwords from '../services/password.service';

export const authRouter = Router();

const clientInfo = (req: Request): auth.ClientInfo => ({ ip: req.ip, userAgent: req.get('user-agent') });

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many login attempts. Please wait a few minutes.' } },
});

authRouter.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { user, tokens } = await auth.login(req.body.identifier, req.body.password, clientInfo(req));
    setAuthCookies(res, tokens);
    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!token) return res.status(401).json({ error: { code: 'session_expired', message: 'Please log in.' } });
    try {
      const { user, tokens } = await auth.refresh(token, clientInfo(req));
      setAuthCookies(res, tokens);
      res.json({ user: toPublicUser(user) });
    } catch (err) {
      // On a parallel-tab race the other tab has already set fresh cookies: keep them.
      if (!(err instanceof AppError && err.code === 'refresh_race')) clearAuthCookies(res);
      throw err;
    }
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user!) });
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests. Please wait a few minutes and try again.' } },
});

authRouter.post(
  '/forgot-password',
  passwordLimiter,
  validateBody(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    await passwords.requestPasswordReset(req.body.identifier, req.ip);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/password-token/:token',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    res.json(await passwords.describeToken(req.params.token));
  }),
);

authRouter.post(
  '/set-password',
  passwordLimiter,
  validateBody(setPasswordSchema),
  asyncHandler(async (req, res) => {
    await passwords.setPasswordWithToken(req.body.token, req.body.password, req.ip);
    clearAuthCookies(res);
    res.json({ ok: true });
  }),
);

/** Any logged-in user can change their own password (PRD F4). */
authRouter.post(
  '/change-password',
  passwordLimiter,
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    await auth.changePassword(req.user!, req.body.currentPassword, req.body.password, req.sessionId, req.ip);
    res.json({ ok: true });
  }),
);
