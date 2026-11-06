import { z } from 'zod';
import { MOBILE_REGEX } from './validators';

// ---------- SMS notifications (DLT-registered templates, India) ----------

/** Every SMS the portal can send. `otp` is required for verification and cannot be switched off. */
export const SMS_EVENTS = [
  'otp',
  'registration_submitted',
  'accounts_approved',
  'accounts_rejected',
  'manager_approved',
  'manager_rejected',
  'agreement_generated',
] as const;
export type SmsEvent = (typeof SMS_EVENTS)[number];

/** Values a message can include. In the message format they are written as {otp}, {applicationId}, … */
export const SMS_VARIABLES = ['otp', 'minutes', 'name', 'applicationId', 'referenceNo', 'organisation'] as const;
export type SmsVariable = (typeof SMS_VARIABLES)[number];
export type SmsValues = Partial<Record<SmsVariable, string>>;

export const SMS_VARIABLE_LABELS: Record<SmsVariable, string> = {
  otp: 'One-time code',
  minutes: 'Code validity (minutes)',
  name: 'Applicant name',
  applicationId: 'Application ID',
  referenceNo: 'Agreement reference number',
  organisation: 'Organisation name',
};

export const SMS_EVENT_INFO: Record<SmsEvent, { label: string; when: string; variables: SmsVariable[]; required: boolean }> = {
  otp: { label: 'Mobile verification code (OTP)', when: 'Registration and mobile number change', variables: ['otp', 'minutes', 'organisation'], required: true },
  registration_submitted: { label: 'Registration successful', when: 'The applicant verifies and the application is submitted', variables: ['name', 'applicationId', 'organisation'], required: false },
  accounts_approved: { label: 'Accounts approval', when: 'Accounts approves the application', variables: ['name', 'applicationId', 'organisation'], required: false },
  accounts_rejected: { label: 'Accounts rejection', when: 'Accounts asks for changes', variables: ['name', 'applicationId', 'organisation'], required: false },
  manager_approved: { label: 'Manager (final) approval', when: 'The Manager gives final approval', variables: ['name', 'applicationId', 'referenceNo', 'organisation'], required: false },
  manager_rejected: { label: 'Manager rejection', when: 'The Manager asks for changes', variables: ['name', 'applicationId', 'organisation'], required: false },
  agreement_generated: { label: 'Agreement PDF generated', when: 'The agreement PDF is created after final approval', variables: ['name', 'applicationId', 'referenceNo', 'organisation'], required: false },
};

/** The DLT placeholder used in registered templates. */
export const DLT_VARIABLE = '{#var#}';
/** DLT allows at most 30 characters in each {#var#}. */
export const DLT_VARIABLE_MAX = 30;

const TAG = /\{([a-zA-Z]+)\}/g;

/**
 * Checks that a message format (with {tags}) produces exactly the registered DLT template
 * (with {#var#} placeholders): same fixed wording, one tag per placeholder, known tags only.
 */
export function checkSmsFormat(dltText: string, format: string, allowed: readonly SmsVariable[]): string | null {
  const dlt = dltText.replace(/\r\n/g, '\n');
  const fmt = format.replace(/\r\n/g, '\n');
  const dltParts = dlt.split(DLT_VARIABLE);
  const tags = [...fmt.matchAll(TAG)].map((m) => m[1]);
  const unknown = tags.filter((t) => !(allowed as readonly string[]).includes(t));
  if (unknown.length) return `Unknown or unavailable value: {${unknown[0]}}. This message can use ${allowed.map((v) => `{${v}}`).join(', ')}.`;
  const fmtParts = fmt.split(TAG).filter((_, i) => i % 2 === 0);
  if (fmtParts.length !== dltParts.length) {
    return `The DLT template has ${dltParts.length - 1} {#var#} placeholder(s) but the message format has ${tags.length} value(s).`;
  }
  for (let i = 0; i < dltParts.length; i++) {
    if (dltParts[i] !== fmtParts[i]) return 'The fixed wording of the message format must be exactly the same as the registered DLT template (spaces and punctuation included).';
  }
  return null;
}

/** Fills a message format. Each value is cut to the DLT limit of 30 characters. */
export function renderSms(format: string, values: SmsValues): string {
  return format.replace(/\r\n/g, '\n').replace(TAG, (_, name: string) => (values[name as SmsVariable] ?? '').slice(0, DLT_VARIABLE_MAX));
}

/** Plain GSM text only: the gateway refuses Unicode in "text" messages (error 409). */
export const isPlainSmsText = (text: string) => /^[\x20-\x7E\n]*$/.test(text);

const templateSchema = z
  .object({
    enabled: z.boolean(),
    templateId: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{10,25}$/.test(v), 'Enter the DLT template ID (digits only)'),
    dltText: z.string().max(2000, 'At most 2000 characters'),
    format: z.string().max(2000, 'At most 2000 characters'),
  })
  .superRefine((t, ctx) => {
    if (!t.enabled) return;
    if (!t.templateId) ctx.addIssue({ code: 'custom', path: ['templateId'], message: 'Enter the DLT template ID to switch this message on' });
    if (!t.dltText.trim()) ctx.addIssue({ code: 'custom', path: ['dltText'], message: 'Paste the approved DLT template wording' });
    if (!t.format.trim()) ctx.addIssue({ code: 'custom', path: ['format'], message: 'Enter the message format' });
    if (t.format && !isPlainSmsText(t.format)) ctx.addIssue({ code: 'custom', path: ['format'], message: 'Use plain English characters only (no ₹, emoji or other scripts)' });
  });

export const smsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    templates: z.object(Object.fromEntries(SMS_EVENTS.map((e) => [e, templateSchema])) as Record<SmsEvent, typeof templateSchema>),
  })
  .superRefine((s, ctx) => {
    for (const e of SMS_EVENTS) {
      const t = s.templates[e];
      if (!t.dltText.trim() || !t.format.trim()) continue;
      const problem = checkSmsFormat(t.dltText, t.format, SMS_EVENT_INFO[e].variables);
      if (problem) ctx.addIssue({ code: 'custom', path: ['templates', e, 'format'], message: problem });
    }
  });
export type SmsSettingsInput = z.input<typeof smsSettingsSchema>;
export type SmsSettingsView = z.output<typeof smsSettingsSchema>;

export const smsTestSchema = z.object({
  mobile: z.string().trim().regex(MOBILE_REGEX, 'Enter a 10-digit Indian mobile number'),
  event: z.enum(SMS_EVENTS),
});

export const SMS_LOG_STATUSES = ['sending', 'sent', 'failed', 'skipped'] as const;
export type SmsLogStatus = (typeof SMS_LOG_STATUSES)[number];
export const SMS_DELIVERY_STATUSES = ['pending', 'delivered', 'failed', 'rejected'] as const;
export type SmsDeliveryStatus = (typeof SMS_DELIVERY_STATUSES)[number];

export const smsLogQuerySchema = z.object({
  status: z.enum(SMS_LOG_STATUSES).or(z.literal('').transform(() => undefined)).optional(),
  event: z.enum(SMS_EVENTS).or(z.literal('').transform(() => undefined)).optional(),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export interface SmsLogRow {
  id: string;
  at: string;
  event: SmsEvent | 'test';
  recipient: string;
  text: string | null;
  templateId: string | null;
  status: SmsLogStatus;
  provider: string;
  attempts: number;
  error: string | null;
  httpStatus: number | null;
  applicationId: string | null;
  submissionId: string | null;
  delivery: { status: SmsDeliveryStatus; code: string | null; description: string | null; checkedAt: string | null } | null;
  test: boolean;
}

export interface SmsStatusView {
  provider: string;
  /** Live gateway (not the development test mailbox). */
  live: boolean;
  /** Names of required settings that are missing (never their values). */
  missing: string[];
  entityId: string | null;
  senderId: string | null;
  route: string | null;
  webhookEnabled: boolean;
  enabled: boolean;
  wallet: { ok: boolean; balance: string | null; currency: string | null; error: string | null } | null;
  last24h: { sent: number; failed: number; skipped: number };
}
