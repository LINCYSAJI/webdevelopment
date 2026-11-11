import { z } from 'zod';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { audit } from './audit.service';
import { checkEmailConnection, sendEmailWithResult } from './email.service';
import { layout } from './email-templates';
import type { Actor } from './users.service';

/**
 * Admin › Email Templates › Email delivery: which email service is used, whether it can connect and
 * log in, and a test email. Never returns the password; the login name is partly masked.
 */

const mask = (v: string | undefined) => {
  if (!v) return null;
  const [name, domain] = v.split('@');
  return domain ? `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}` : `${v.slice(0, 2)}•••`;
};

export interface EmailDeliveryStatus {
  provider: 'dev_outbox' | 'smtp';
  host: string | null;
  port: number | null;
  security: string | null;
  login: string | null;
  from: string | null;
  connection: { ok: boolean; error: string | null; checkedAt: string };
}

export async function deliveryStatus(): Promise<EmailDeliveryStatus> {
  const smtp = config.EMAIL_PROVIDER === 'smtp';
  const check = await checkEmailConnection();
  return {
    provider: config.EMAIL_PROVIDER,
    host: smtp ? (config.SMTP_HOST ?? null) : null,
    port: smtp ? config.SMTP_PORT : null,
    security: smtp ? (config.SMTP_PORT === 465 ? 'TLS' : 'STARTTLS (required)') : null,
    login: smtp ? mask(config.SMTP_USER) : null,
    from: smtp ? (config.EMAIL_FROM ?? null) : null,
    connection: { ok: check.ok, error: check.error, checkedAt: new Date().toISOString() },
  };
}

export const testEmailSchema = z.object({ to: z.string().trim().toLowerCase().email('Enter a valid email address') });

export async function sendTestEmail(to: string, actor: Actor) {
  const message = await layout('Test email from the Franchise Agreement Portal', [
    `Hello ${actor.user.name},`,
    'This is a test email from the Franchise Agreement Portal. If you can read it, email delivery is working.',
    `Sent ${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date())} (India time).`,
  ]);
  const result = await sendEmailWithResult({ to, event: 'test_email', ...message });
  await audit({ action: 'email_test_sent', userId: actor.user._id, role: 'admin', targetType: 'email', details: { to, ok: result.ok }, ip: actor.ip });
  if (!result.ok) throw new AppError(502, `The test email could not be sent: ${result.error ?? 'unknown error'}`, 'email_failed');
  return { sent: true, provider: config.EMAIL_PROVIDER };
}
