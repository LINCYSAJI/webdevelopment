import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../lib/errors';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const { fields, ...rest } = err.extra ?? {};
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...rest,
        // Same shape as validation errors: field -> list of messages.
        ...(fields ? { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, [v]])) } : {}),
      },
    });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'The file is too large.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
};
