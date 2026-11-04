import mongoose from 'mongoose';
import { escapeHtml } from '@fap/shared';
import { config } from '../config';
import { NotificationLog } from '../models/NotificationLog';

export interface SmsMessage {
  /** 10-digit Indian mobile number. */
  to: string;
  text: string;
  /** Notification event code, e.g. "registration_otp". */
  event: string;
}

interface SmsProvider {
  name: string;
  send(message: SmsMessage): Promise<void>;
}

/** Development only: keeps SMS in the database so they appear in the test mailbox page. */
const devOutboxProvider: SmsProvider = {
  name: 'dev_outbox',
  async send(message) {
    await mongoose.connection.db!.collection('dev_outbox').insertOne({
      channel: 'sms',
      to: `+91 ${message.to}`,
      subject: `SMS: ${message.text.slice(0, 60)}`,
      text: message.text,
      html: `<pre style="font:15px Arial,sans-serif;white-space:pre-wrap;padding:16px">${escapeHtml(message.text)}</pre>`,
      event: message.event,
      at: new Date(),
    });
    console.log(`[test mailbox] SMS to=${message.to}`);
  },
};

function getProvider(): SmsProvider {
  switch (config.SMS_PROVIDER) {
    case 'dev_outbox':
      return devOutboxProvider;
  }
}

const MAX_ATTEMPTS = 3;

/** Sends an SMS with up to 3 attempts and records the outcome. Returns false if it could not be sent. */
export async function sendSms(message: SmsMessage): Promise<boolean> {
  const provider = getProvider();
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await provider.send(message);
      await NotificationLog.create({ recipient: message.to, channel: 'sms', event: message.event, provider: provider.name, status: 'sent', attempts: attempt });
      return true;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  console.error(`SMS to ${message.to} failed:`, lastError);
  await NotificationLog.create({
    recipient: message.to,
    channel: 'sms',
    event: message.event,
    provider: provider.name,
    status: 'failed',
    attempts: MAX_ATTEMPTS,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return false;
}
