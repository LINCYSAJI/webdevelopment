import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    /** Optional per-field messages (dotted paths like "signatory.email") and extra data for the page. */
    public extra?: { fields?: Record<string, string>; [key: string]: unknown },
  ) {
    super(message);
  }
}

/** Lets async route handlers pass thrown errors to the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
