import mongoose from 'mongoose';
import { config } from '../config';
import { NotificationLog } from '../models/NotificationLog';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Notification event code, e.g. "user_invite" (PRD §11). */
  event: string;
}

interface EmailProvider {
  name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Development only: keeps emails in the database for the test mailbox page. */
const devOutboxProvider: EmailProvider = {
  name: 'dev_outbox',
  async send(message) {
    await mongoose.connection.db!.collection('dev_outbox').insertOne({ ...message, at: new Date() });
    console.log(`[test mailbox] to=${message.to} subject="${message.subject}"`);
  },
};

function getProvider(): EmailProvider {
  switch (config.EMAIL_PROVIDER) {
    case 'dev_outbox':
      return devOutboxProvider;
  }
}

const MAX_ATTEMPTS = 3;

/**
 * Sends an email, retrying up to 3 times (PRD §11), and records the outcome in the
 * notification log. Returns false instead of throwing so a failed email never undoes
 * the business action that triggered it.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
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
      return true;
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
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return false;
}
