import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { toFieldErrors } from '@fap/shared';

/** Validates and cleans req.body against a shared schema. */
export const validateBody =
  (schema: ZodTypeAny) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: { code: 'validation', message: 'Please correct the highlighted fields.', fields: result.error.flatten().fieldErrors },
      });
    }
    req.body = result.data;
    next();
  };

/**
 * Like validateBody, for forms with nested sections: errors are keyed by dotted path
 * ("signatory.email", "contacts.1.mobile") so the page can show each one next to its field.
 */
export const validateBodyDetailed =
  (schema: ZodTypeAny) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields = Object.fromEntries(Object.entries(toFieldErrors(result.error)).map(([k, v]) => [k, [v]]));
      return res.status(400).json({ error: { code: 'validation', message: 'Please correct the highlighted fields.', fields } });
    }
    req.body = result.data;
    next();
  };
