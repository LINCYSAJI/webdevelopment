import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@fap/shared';
import { AppError, asyncHandler } from '../lib/errors';
import { User, type UserDocument } from '../models/User';
import { isSessionActive, touchSession, verifyAccessToken } from '../services/auth.service';

export const ACCESS_COOKIE = 'fap_access';
export const REFRESH_COOKIE = 'fap_refresh';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDocument;
      sessionId?: string;
    }
  }
}

/** The login carried by this request, or why there is none. The role is always loaded from the database. */
export async function currentLogin(req: Request): Promise<{ user: UserDocument; sessionId: string } | { error: string }> {
  const token: string | undefined = req.cookies?.[ACCESS_COOKIE];
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) return { error: 'Please log in to continue.' };
  if (!(await isSessionActive(claims.sessionId))) return { error: 'Your session has ended. Please log in again.' };
  const user = await User.findById(claims.userId);
  if (!user || !user.isActive) return { error: 'Please log in to continue.' };
  await touchSession(claims.sessionId);
  return { user, sessionId: claims.sessionId };
}

/** Rejects the request unless it carries a valid login. */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const login = await currentLogin(req);
  if ('error' in login) throw new AppError(401, login.error, 'unauthenticated');
  req.user = login.user;
  req.sessionId = login.sessionId;
  next();
});

/** Use after requireAuth. Allows only the listed roles. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role as Role)) {
      return next(new AppError(403, 'You do not have permission to do this.', 'forbidden'));
    }
    next();
  };
