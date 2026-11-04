import type { CookieOptions, Response } from 'express';
import { config } from '../config';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../middleware/auth';
import type { IssuedTokens } from '../services/auth.service';

// Login cookies: HTTP-only so page scripts can never read them (PRD 13.1).
const baseCookie: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProduction,
};

export function setAuthCookies(res: Response, tokens: IssuedTokens) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookie,
    path: '/api',
    maxAge: config.accessTokenMinutes * 60_000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookie,
    path: '/api/auth',
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie, path: '/api' });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie, path: '/api/auth' });
}
