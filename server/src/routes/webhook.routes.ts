import { timingSafeEqual } from 'node:crypto';
import express, { Router, type Request } from 'express';
import { config } from '../config';
import { AppError, asyncHandler } from '../lib/errors';
import { applyDeliveryWebhook } from '../services/sms.service';

/**
 * Delivery-status webhook from the Networkz SMS gateway (event sms.v1_0.delivery-status-update).
 * Enabled only when NETWORKZ_SMS_WEBHOOK_SECRET is set; every call must carry that secret in the
 * X-Webhook-Secret header (configured as a custom header on the webhook in the Networkz panel).
 * Supports the panel's GET, POST (form) and POST-JSON payload options.
 */
export const webhookRouter = Router();

function authorised(req: Request): boolean {
  const expected = config.NETWORKZ_SMS_WEBHOOK_SECRET;
  if (!expected) return false;
  const given = req.get('x-webhook-secret') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const handle = asyncHandler(async (req, res) => {
  if (!config.NETWORKZ_SMS_WEBHOOK_SECRET) throw new AppError(404, 'Not found.', 'not_found');
  if (!authorised(req)) throw new AppError(401, 'Invalid webhook secret.', 'unauthorised');
  const payload = (req.method === 'GET' ? req.query : req.body) as Record<string, unknown>;
  const matched = await applyDeliveryWebhook(payload ?? {});
  res.json({ ok: true, matched });
});

webhookRouter.get('/networkz-sms', handle);
webhookRouter.post('/networkz-sms', express.urlencoded({ extended: true, limit: '100kb' }), handle);
