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

/** Rejects the request unless it carries a valid login. The role is always loaded from the database. */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token: string | undefined = req.cookies?.[ACCESS_COOKIE];
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) throw new AppError(401, 'Please log in to continue.', 'unauthenticated');

  if (!(await isSessionActive(claims.sessionId))) {
    throw new AppError(401, 'Your session has ended. Please log in again.', 'unauthenticated');
  }

  const user = await User.findById(claims.userId);
  if (!user || !user.isActive) throw new AppError(401, 'Please log in to continue.', 'unauthenticated');

  req.user = user;
  req.sessionId = claims.sessionId;
  await touchSession(claims.sessionId);
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
