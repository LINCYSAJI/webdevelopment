import type { FilterQuery } from 'mongoose';
import {
  SMS_EVENTS,
  type Paginated,
  type SmsDeliveryStatus,
  type SmsEvent,
  type SmsLogRow,
  type SmsLogStatus,
  type SmsSettingsView,
  type SmsStatusView,
  smsLogQuerySchema,
} from '@fap/shared';
import { config } from '../config';
import { getSettings } from '../models/Settings';
import { SmsLog } from '../models/SmsLog';
import { getSmsSettings } from '../models/SmsSettings';
import { audit } from './audit.service';
import { refreshDeliveryStatus, sendEventSms, smsProvider, walletBalance } from './sms.service';
import type { Actor } from './users.service';

/** Admin > SMS Notifications. Shows configuration status but never the credentials themselves. */

export async function status(): Promise<SmsStatusView> {
  const provider = smsProvider();
  const since = new Date(Date.now() - 86_400_000);
  const [sms, counts, wallet] = await Promise.all([
    getSmsSettings(),
    SmsLog.aggregate<{ _id: SmsLogStatus; n: number }>([{ $match: { createdAt: { $gte: since }, test: { $ne: true } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    walletBalance(),
  ]);
  const count = (s: SmsLogStatus) => counts.find((c) => c._id === s)?.n ?? 0;
  const live = provider.live;
  return {
    provider: provider.name,
    live,
    missing: provider.missing(),
    entityId: live ? config.NETWORKZ_SMS_ENTITY_ID ?? null : null,
    senderId: live ? config.NETWORKZ_SMS_SENDER_ID ?? null : null,
    route: live ? config.NETWORKZ_SMS_ROUTE : null,
    webhookEnabled: live && !!config.NETWORKZ_SMS_WEBHOOK_SECRET && !!config.NETWORKZ_SMS_WEBHOOK_ID,
    enabled: sms.enabled,
    wallet,
    last24h: { sent: count('sent'), failed: count('failed'), skipped: count('skipped') },
  };
}

export async function getSettingsView(): Promise<SmsSettingsView> {
  const sms = await getSmsSettings();
  return {
    enabled: sms.enabled,
    templates: Object.fromEntries(
      SMS_EVENTS.map((e) => {
        const t = sms.templates?.[e];
        return [e, { enabled: !!t?.enabled, templateId: t?.templateId ?? '', dltText: t?.dltText ?? '', format: t?.format ?? '' }];
      }),
    ) as SmsSettingsView['templates'],
  };
}

export async function updateSettings(input: SmsSettingsView, actor: Actor): Promise<SmsSettingsView> {
  const before = await getSettingsView();
  // The OTP is required for verification and cannot be switched off.
  const templates = { ...input.templates, otp: { ...input.templates.otp, enabled: true } };
  const sms = await getSmsSettings();
  sms.set({ enabled: input.enabled, templates });
  await sms.save();
  const changed = SMS_EVENTS.filter((e) => JSON.stringify(before.templates[e]) !== JSON.stringify(templates[e]));
  await audit({
    action: 'sms_settings_updated',
    userId: actor.user._id,
    role: 'admin',
    targetType: 'settings',
    details: { enabled: { from: before.enabled, to: input.enabled }, templatesChanged: changed },
    ip: actor.ip,
  });
  return getSettingsView();
}

/** Sends one message with sample values so Admin can check the gateway and a template. */
export async function sendTest(mobile: string, event: SmsEvent, actor: Actor) {
  const settings = await getSettings();
  const outcome = await sendEventSms(
    event,
    mobile,
    { otp: '123456', minutes: String(settings.otpExpiryMinutes), name: 'Test Applicant', applicationId: 'APP-TEST-0001', referenceNo: `${settings.agreementRefPrefix}/TEST/0001`, organisation: settings.organisationName },
    { test: true },
  );
  await audit({ action: 'sms_test_sent', userId: actor.user._id, role: 'admin', targetType: 'sms', details: { event, mobileEnding: mobile.slice(-4), status: outcome.status }, ip: actor.ip });
  return outcome;
}

const PAGE_SIZE = 25;

export async function listLogs(raw: unknown): Promise<Paginated<SmsLogRow>> {
  const q = smsLogQuerySchema.parse(raw);
  const filter: FilterQuery<unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.event) filter.event = q.event;
  if (q.search) {
    const digits = q.search.replace(/\D/g, '');
    filter.$or = [{ applicationId: q.search.toUpperCase() }, ...(digits.length >= 4 ? [{ recipient: { $regex: `${digits}$` } }] : [])];
  }
  const [rows, total] = await Promise.all([
    SmsLog.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    SmsLog.countDocuments(filter),
  ]);
  return {
    items: rows.map((r) => ({
      id: r._id.toString(),
      at: (r.get('createdAt') as Date).toISOString(),
      event: r.event as SmsEvent,
      recipient: r.recipient,
      text: r.text ?? null,
      templateId: r.templateId ?? null,
      status: r.status as SmsLogStatus,
      provider: r.provider,
      attempts: r.attempts ?? 0,
      error: r.error ?? null,
      httpStatus: r.httpStatus ?? null,
      applicationId: r.applicationId ?? null,
      submissionId: r.submissionId ?? null,
      delivery: r.delivery?.status
        ? { status: r.delivery.status as SmsDeliveryStatus, code: r.delivery.code ?? null, description: r.delivery.description ?? null, checkedAt: r.delivery.checkedAt?.toISOString() ?? null }
        : null,
      test: !!r.test,
    })),
    page: q.page,
    pageSize: PAGE_SIZE,
    total,
  };
}

export async function refreshDelivery(actor: Actor) {
  const result = await refreshDeliveryStatus();
  await audit({ action: 'sms_delivery_refreshed', userId: actor.user._id, role: 'admin', targetType: 'sms', details: result, ip: actor.ip });
  return result;
}
