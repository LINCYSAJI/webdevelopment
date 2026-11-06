import mongoose, { type Types } from 'mongoose';
import {
  SMS_EVENT_INFO,
  checkSmsFormat,
  escapeHtml,
  isPlainSmsText,
  renderSms,
  type SmsDeliveryStatus,
  type SmsEvent,
  type SmsValues,
} from '@fap/shared';
import { config } from '../config';
import { duplicateKeyField } from '../lib/mongo-errors';
import { NetworkzError, getNetworkzDeliveryReport, getNetworkzWalletBalance, sendNetworkzSms, type NetworkzCredentials } from '../lib/networkz-sms';
import { NotificationLog } from '../models/NotificationLog';
import { getSettings } from '../models/Settings';
import { SmsLog } from '../models/SmsLog';
import { getSmsSettings } from '../models/SmsSettings';

/**
 * Every SMS goes through here (PRD §11 plus the SMS notifications added for the Networkz gateway).
 *
 * - The message is built from the DLT template Admin registered for that event, and is checked
 *   against the approved wording before sending (India's DLT rules block anything else).
 * - Notifications are sent at most once (`dedupeKey`, unique in the database).
 * - Failures are logged and never thrown: an SMS problem never stops a registration or approval.
 *   Only the OTP reports failure to its caller, because the applicant must then try again.
 */

// ---------- Providers ----------

interface OutgoingSms {
  to: string;
  text: string;
  templateId: string | null;
  event: string;
}

interface SmsProvider {
  name: string;
  /** Sends for real (not the development test mailbox). */
  live: boolean;
  /** Required settings that are missing (names only). */
  missing(): string[];
  send(sms: OutgoingSms): Promise<{ submissionId: string | null; messageId: string | null }>;
}

/** Development only: keeps SMS in the database so they appear in the test mailbox page. */
const devOutboxProvider: SmsProvider = {
  name: 'dev_outbox',
  live: false,
  missing: () => [],
  async send(sms) {
    await mongoose.connection.db!.collection('dev_outbox').insertOne({
      channel: 'sms',
      to: `+91 ${sms.to}`,
      subject: `SMS: ${sms.text.slice(0, 60)}`,
      text: sms.text,
      html: `<pre style="font:15px Arial,sans-serif;white-space:pre-wrap;padding:16px">${escapeHtml(sms.text)}</pre>${sms.templateId ? `<p style="font:12px Arial;color:#64748b;padding:0 16px">DLT template ${escapeHtml(sms.templateId)}</p>` : ''}`,
      event: sms.event,
      at: new Date(),
    });
    console.log(`[test mailbox] SMS to=${sms.to}`);
    return { submissionId: null, messageId: null };
  },
};

function networkzCredentials(): NetworkzCredentials | null {
  if (!config.NETWORKZ_SMS_ACCESS_TOKEN || !config.NETWORKZ_SMS_ACCESS_TOKEN_KEY) return null;
  return { baseUrl: config.NETWORKZ_SMS_BASE_URL, accessToken: config.NETWORKZ_SMS_ACCESS_TOKEN, accessTokenKey: config.NETWORKZ_SMS_ACCESS_TOKEN_KEY };
}

const networkzProvider: SmsProvider = {
  name: 'networkz',
  live: true,
  missing() {
    const required = ['NETWORKZ_SMS_ACCESS_TOKEN', 'NETWORKZ_SMS_ACCESS_TOKEN_KEY', 'NETWORKZ_SMS_ENTITY_ID', 'NETWORKZ_SMS_SENDER_ID'] as const;
    return required.filter((k) => !config[k]);
  },
  async send(sms) {
    const creds = networkzCredentials();
    if (!creds || this.missing().length) throw new NetworkzError(`SMS gateway not configured: missing ${this.missing().join(', ')}`, null, false);
    if (!sms.templateId) throw new NetworkzError('No DLT template ID for this message', null, false);
    const result = await sendNetworkzSms(creds, {
      to: sms.to,
      text: sms.text,
      senderId: config.NETWORKZ_SMS_SENDER_ID!,
      entityId: config.NETWORKZ_SMS_ENTITY_ID!,
      templateId: sms.templateId,
      route: config.NETWORKZ_SMS_ROUTE,
      templateMatching: config.NETWORKZ_SMS_TEMPLATE_MATCHING === '1',
      webhookId: config.NETWORKZ_SMS_WEBHOOK_ID || undefined,
    });
    return { submissionId: result.submissionId, messageId: result.messageIds[0] ?? null };
  },
};

export function smsProvider(): SmsProvider {
  return config.SMS_PROVIDER === 'networkz' ? networkzProvider : devOutboxProvider;
}

/** Wording used only by the development test mailbox when Admin has not entered a template yet. */
const DEV_FALLBACK: Record<SmsEvent, string> = {
  otp: '{otp} is your {organisation} verification code. It is valid for {minutes} minutes. Do not share it with anyone.',
  registration_submitted: 'Dear {name}, your franchise application {applicationId} has been submitted to {organisation}.',
  accounts_approved: 'Dear {name}, your franchise application {applicationId} has been approved by our Accounts team.',
  accounts_rejected: 'Dear {name}, changes are requested on your franchise application {applicationId}. Please log in to the portal.',
  manager_approved: 'Dear {name}, your franchise application {applicationId} is approved. Agreement reference {referenceNo}.',
  manager_rejected: 'Dear {name}, changes are requested on your franchise application {applicationId}. Please log in to the portal.',
  agreement_generated: 'Dear {name}, your franchise agreement {referenceNo} for application {applicationId} has been generated.',
};

// ---------- Sending ----------

const MAX_ATTEMPTS = 3;

export interface SmsOutcome {
  ok: boolean;
  status: 'sent' | 'failed' | 'skipped' | 'duplicate';
  reason?: string;
}

/** Works out the text and template for an event, or why it cannot be sent. */
async function compose(event: SmsEvent, values: SmsValues, opts: { test?: boolean }): Promise<{ text: string; templateId: string | null } | { skip: string }> {
  const sms = await getSmsSettings();
  const provider = smsProvider();
  if (!opts.test && event !== 'otp' && !sms.enabled) return { skip: 'SMS notifications are switched off' };
  const t = sms.templates?.[event];
  if (!opts.test && !t?.enabled) return { skip: 'This message is switched off' };

  const templateId = t?.templateId?.trim() || null;
  const hasTemplate = !!(templateId && t?.dltText?.trim() && t?.format?.trim());
  if (!hasTemplate) {
    if (!provider.live) return { text: renderSms(DEV_FALLBACK[event], values), templateId };
    return { skip: 'No DLT template set for this message (Admin > SMS Notifications)' };
  }
  const problem = checkSmsFormat(t!.dltText, t!.format, SMS_EVENT_INFO[event].variables);
  if (problem) return { skip: `Template problem: ${problem}` };
  const text = renderSms(t!.format, values);
  if (!isPlainSmsText(text)) return { skip: 'The message contains characters SMS cannot send as plain text' };
  return { text, templateId };
}

/**
 * Sends one SMS for an event. Never throws. With a `dedupeKey`, the same notification is never
 * sent twice, even if two requests race.
 */
export async function sendEventSms(
  event: SmsEvent,
  to: string,
  values: SmsValues,
  opts: { dedupeKey?: string; registrationId?: Types.ObjectId | string | null; applicationId?: string | null; test?: boolean } = {},
): Promise<SmsOutcome> {
  const provider = smsProvider();
  let log: InstanceType<typeof SmsLog> | null = null;
  try {
    const composed = await compose(event, values, opts);
    const base = {
      event,
      recipient: to,
      provider: provider.name,
      registrationId: opts.registrationId ?? null,
      applicationId: opts.applicationId ?? null,
      test: !!opts.test,
      ...(opts.dedupeKey ? { dedupeKey: opts.dedupeKey } : {}),
    };
    if ('skip' in composed) {
      // Skips are logged without the de-duplication key, so the message can still go out once it is switched on.
      await SmsLog.create({ ...base, dedupeKey: undefined, status: 'skipped', error: composed.skip });
      return { ok: false, status: 'skipped', reason: composed.skip };
    }
    try {
      log = await SmsLog.create({ ...base, status: 'sending', text: composed.text, templateId: composed.templateId });
    } catch (err) {
      if (duplicateKeyField(err)) return { ok: true, status: 'duplicate' };
      throw err;
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await provider.send({ to, text: composed.text, templateId: composed.templateId, event });
        await SmsLog.updateOne(
          { _id: log._id },
          {
            $set: {
              status: 'sent',
              attempts: attempt,
              sentAt: new Date(),
              submissionId: result.submissionId,
              messageId: result.messageId,
              error: null,
              ...(provider.live ? { delivery: { status: 'pending' } } : {}),
            },
          },
        );
        await NotificationLog.create({ recipient: to, channel: 'sms', event, provider: provider.name, status: 'sent', attempts: attempt });
        return { ok: true, status: 'sent' };
      } catch (err) {
        lastError = err;
        const retryable = !(err instanceof NetworkzError) || err.retryable;
        await SmsLog.updateOne({ _id: log._id }, { $set: { attempts: attempt, error: describe(err), httpStatus: err instanceof NetworkzError ? err.httpStatus : null } });
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
    await SmsLog.updateOne({ _id: log._id }, { $set: { status: 'failed' } });
    await NotificationLog.create({ recipient: to, channel: 'sms', event, provider: provider.name, status: 'failed', attempts: MAX_ATTEMPTS, error: describe(lastError) });
    console.error(`SMS ${event} to ${to} failed: ${describe(lastError)}`);
    return { ok: false, status: 'failed', reason: describe(lastError) };
  } catch (err) {
    console.error(`SMS ${event} could not be processed:`, err);
    if (log) await SmsLog.updateOne({ _id: log._id }, { $set: { status: 'failed', error: describe(err) } }).catch(() => undefined);
    return { ok: false, status: 'failed', reason: describe(err) };
  }
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/** The mobile OTP. Returns false when it could not be sent (the caller then asks the user to retry). */
export async function sendOtpSms(to: string, code: string, minutes: number): Promise<boolean> {
  const settings = await getSettings();
  const outcome = await sendEventSms('otp', to, { otp: code, minutes: String(minutes), organisation: settings.organisationName });
  return outcome.ok;
}

/** Applicant notifications, to the registered (login) mobile. Never throws and never blocks the workflow. */
export async function notifyApplicantBySms(
  event: Exclude<SmsEvent, 'otp'>,
  reg: { _id: Types.ObjectId; applicationId?: string | null; currentSubmissionVersion?: number | null; signatory?: { name?: string | null; mobile?: string | null } | null },
  extra: { referenceNo?: string | null; dedupe: 'once' | 'per_version' },
): Promise<void> {
  try {
    const mobile = reg.signatory?.mobile;
    if (!mobile) return;
    const settings = await getSettings();
    const key = extra.dedupe === 'once' ? `${event}:${reg._id}` : `${event}:${reg._id}:v${reg.currentSubmissionVersion ?? 1}`;
    await sendEventSms(
      event,
      mobile,
      {
        name: reg.signatory?.name ?? '',
        applicationId: reg.applicationId ?? '',
        referenceNo: extra.referenceNo ?? '',
        organisation: settings.organisationName,
      },
      { dedupeKey: key, registrationId: reg._id, applicationId: reg.applicationId ?? null },
    );
  } catch (err) {
    console.error(`SMS notification ${event} failed:`, err);
  }
}

// ---------- Delivery status ----------

const DLR_STATUS: Record<string, SmsDeliveryStatus> = { DELIVERED: 'delivered', PENDING: 'pending', REJECTED: 'rejected', FAILED: 'failed' };

/** Asks the gateway for delivery reports of recent live messages still marked pending. */
export async function refreshDeliveryStatus(): Promise<{ checked: number; updated: number; error: string | null }> {
  const creds = networkzCredentials();
  if (config.SMS_PROVIDER !== 'networkz' || !creds) return { checked: 0, updated: 0, error: 'Delivery reports are available only with the Networkz gateway configured.' };
  const since = new Date(Date.now() - 30 * 86_400_000);
  const pending = await SmsLog.find({ status: 'sent', submissionId: { $type: 'string' }, 'delivery.status': 'pending', sentAt: { $gte: since } }).sort({ sentAt: -1 }).limit(50);
  let updated = 0;
  let error: string | null = null;
  for (const submissionId of [...new Set(pending.map((p) => p.submissionId!))]) {
    try {
      const reports = await getNetworkzDeliveryReport(creds, submissionId);
      for (const log of pending.filter((p) => p.submissionId === submissionId)) {
        const r = reports.find((x) => (log.messageId && x.messageId === log.messageId) || x.phoneNumber.endsWith(log.recipient));
        const status = r ? DLR_STATUS[r.dlr] : undefined;
        if (!r || !status) continue;
        await SmsLog.updateOne({ _id: log._id }, { $set: { delivery: { status, code: r.statusCode, description: r.statusDescription, checkedAt: new Date() } } });
        updated++;
      }
    } catch (err) {
      error = describe(err);
    }
  }
  return { checked: pending.length, updated, error };
}

/** Delivery update pushed by the gateway webhook (event sms.v1_0.delivery-status-update). */
export async function applyDeliveryWebhook(payload: Record<string, unknown>): Promise<boolean> {
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const submissionId = data.submissionId != null ? String(data.submissionId) : null;
  const messageId = data.messageId != null ? String(data.messageId) : null;
  if (!submissionId && !messageId) return false;
  const short = String(data.shortDescription ?? '');
  const status: SmsDeliveryStatus =
    String(data.deliveredFlag) === '1' ? 'delivered' : /REJECT/i.test(short) ? 'rejected' : /PEND|SUBMIT|ACCEPT|ENROUTE/i.test(short) ? 'pending' : 'failed';
  const res = await SmsLog.updateOne(
    { ...(submissionId ? { submissionId } : {}), ...(messageId ? { messageId } : {}) },
    {
      $set: {
        delivery: {
          status,
          code: data.statusCode != null ? String(data.statusCode) : null,
          description: String(data.description ?? data.errorDescription ?? short ?? '') || null,
          checkedAt: new Date(),
        },
      },
    },
  );
  return res.matchedCount > 0;
}

// ---------- Gateway status for Admin ----------

export async function walletBalance(): Promise<{ ok: boolean; balance: string | null; currency: string | null; error: string | null } | null> {
  const creds = networkzCredentials();
  if (config.SMS_PROVIDER !== 'networkz' || !creds) return null;
  try {
    const w = await getNetworkzWalletBalance(creds);
    return { ok: true, balance: w.balance, currency: w.currency, error: null };
  } catch (err) {
    return { ok: false, balance: null, currency: null, error: describe(err) };
  }
}
