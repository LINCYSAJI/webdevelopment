import mongoose from 'mongoose';
import { config } from '../config';
import { SmtpEmail } from '../lib/smtp-email';
import { NotificationLog } from '../models/NotificationLog';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Notification event code, e.g. "user_invite" (PRD §11). */
  event: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

interface EmailProvider {
  name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Development only: keeps emails in the database for the test mailbox page. */
const devOutboxProvider: EmailProvider = {
  name: 'dev_outbox',
  async send(message) {
    // Attachments are listed (name and size) but not stored in the test mailbox.
    const { attachments, ...rest } = message;
    await mongoose.connection.db!.collection('dev_outbox').insertOne({
      ...rest,
      attachments: (attachments ?? []).map((a) => ({ filename: a.filename, size: a.content.length, contentType: a.contentType })),
      at: new Date(),
    });
    // The subject may contain a verification code, so only the kind of email is logged.
    console.log(`[test mailbox] email to=${message.to} event=${message.event}`);
  },
};

let smtpProvider: (EmailProvider & { verify(): Promise<void> }) | null = null;

/** Any email provider's SMTP service (Amazon SES, SendGrid, Brevo, Zoho, ...), always over TLS. */
function smtp(): EmailProvider & { verify(): Promise<void> } {
  if (!smtpProvider) {
    const client = new SmtpEmail({
      host: config.SMTP_HOST!,
      port: config.SMTP_PORT,
      user: config.SMTP_USER,
      password: config.SMTP_PASSWORD,
      from: config.EMAIL_FROM!,
      replyTo: config.EMAIL_REPLY_TO,
    });
    smtpProvider = { name: 'smtp', send: (message) => client.send(message), verify: () => client.verify() };
  }
  return smtpProvider;
}

/** Admin › Email delivery: which provider is used, and (for SMTP) whether it can connect and log in. */
export async function checkEmailConnection(): Promise<{ provider: string; ok: boolean; error: string | null }> {
  if (config.EMAIL_PROVIDER !== 'smtp') return { provider: config.EMAIL_PROVIDER, ok: true, error: null };
  try {
    await smtp().verify();
    return { provider: 'smtp', ok: true, error: null };
  } catch (err) {
    return { provider: 'smtp', ok: false, error: friendlySmtpError(err) };
  }
}

/** A plain-language reason for an SMTP failure (never includes the password). */
export function friendlySmtpError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const text = e?.message ?? String(err);
  if (e?.code === 'EAUTH' || e?.responseCode === 535) {
    return /gmail|google/i.test(text) || /gmail/i.test(config.SMTP_HOST ?? '')
      ? 'Gmail refused the login. Use a Google App Password (Google Account › Security › 2-Step Verification › App passwords), not the normal Gmail password.'
      : 'The email provider refused the login. Check the email user name and password.';
  }
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNECTION' || e?.code === 'ESOCKET' || e?.code === 'ECONNREFUSED') return `Could not reach the email server (${e.code}). Check the host and port, and that this network allows outgoing email on that port.`;
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

function getProvider(): EmailProvider {
  switch (config.EMAIL_PROVIDER) {
    case 'dev_outbox':
      return devOutboxProvider;
    case 'smtp':
      return smtp();
  }
}

const MAX_ATTEMPTS = 3;

/**
 * Sends an email, retrying up to 3 times (PRD §11), and records the outcome in the
 * notification log. Returns false instead of throwing so a failed email never undoes
 * the business action that triggered it.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  return (await sendEmailWithResult(message)).ok;
}

/** Like sendEmail, but also returns the provider's error message when sending failed. */
export async function sendEmailWithResult(message: EmailMessage): Promise<{ ok: boolean; error: string | null }> {
  const provider = getProvider();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await provider.send(message);
      await NotificationLog.create({
        recipient: message.to,
        channel: 'email',
        event: message.event,
        subject: message.subject,
        provider: provider.name,
        status: 'sent',
        attempts: attempt,
      });
      return { ok: true, error: null };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  console.error(`Email to ${message.to} failed:`, lastError);
  await NotificationLog.create({
    recipient: message.to,
    channel: 'email',
    event: message.event,
    subject: message.subject,
    provider: provider.name,
    status: 'failed',
    attempts: MAX_ATTEMPTS,
    error: friendlySmtpError(lastError),
  });
  return { ok: false, error: friendlySmtpError(lastError) };
}
