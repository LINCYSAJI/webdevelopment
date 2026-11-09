import {
  EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_BY_KEY,
  checkEmailTemplate,
  type EmailPreview,
  type EmailTemplateDef,
  type EmailTemplateUpdate,
  type EmailTemplateView,
} from '@fap/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { EmailTemplate } from '../models/EmailTemplate';
import { User } from '../models/User';
import { audit } from './audit.service';
import { renderTemplate } from './email-templates';
import type { Actor } from './users.service';

/** Admin › Email Templates (PRD §11, §14): list, edit, preview and reset the email wording. */

function find(key: string): EmailTemplateDef {
  const def = EMAIL_TEMPLATE_BY_KEY[key];
  if (!def) throw new AppError(404, 'Email template not found.', 'not_found');
  return def;
}

export async function listTemplates(): Promise<EmailTemplateView[]> {
  const custom = new Map((await EmailTemplate.find()).map((t) => [t._id, t]));
  const editors = new Map(
    (await User.find({ _id: { $in: [...custom.values()].map((t) => t.updatedBy) } }, { name: 1 })).map((u) => [u._id.toString(), u.name]),
  );
  return EMAIL_TEMPLATES.map((def) => {
    const c = custom.get(def.key);
    return {
      ...def,
      subject: c?.subject ?? def.subject,
      body: c?.body ?? def.body,
      defaultSubject: def.subject,
      defaultBody: def.body,
      customised: !!c,
      updatedAt: c?.updatedAt.toISOString() ?? null,
      updatedBy: c ? (editors.get(c.updatedBy.toString()) ?? null) : null,
    };
  });
}

function validate(def: EmailTemplateDef, input: EmailTemplateUpdate) {
  const errors = checkEmailTemplate(def, input.subject, input.body);
  if (Object.keys(errors).length) {
    throw new AppError(400, 'Please correct the highlighted fields.', 'validation', { fields: errors as Record<string, string> });
  }
}

export async function updateTemplate(key: string, input: EmailTemplateUpdate, actor: Actor) {
  const def = find(key);
  validate(def, input);
  await EmailTemplate.updateOne({ _id: key }, { $set: { subject: input.subject, body: input.body, updatedBy: actor.user._id, updatedAt: new Date() } }, { upsert: true });
  await audit({ action: 'email_template_updated', userId: actor.user._id, role: 'admin', targetType: 'email_template', targetId: key, details: { subject: input.subject }, ip: actor.ip });
  return (await listTemplates()).find((t) => t.key === key)!;
}

/** Back to the default wording. */
export async function resetTemplate(key: string, actor: Actor) {
  find(key);
  const res = await EmailTemplate.deleteOne({ _id: key });
  if (res.deletedCount) {
    await audit({ action: 'email_template_reset', userId: actor.user._id, role: 'admin', targetType: 'email_template', targetId: key, ip: actor.ip });
  }
  return (await listTemplates()).find((t) => t.key === key)!;
}

/** The email as it would be sent, filled with sample values (unsaved wording allowed). */
export async function previewTemplate(key: string, input: EmailTemplateUpdate): Promise<EmailPreview> {
  const def = find(key);
  validate(def, input);
  const samples = Object.fromEntries(def.fields.filter((f) => f.key !== 'organisation_name' && f.key !== 'portal_name').map((f) => [f.key, f.sample]));
  const rendered = await renderTemplate(key, samples, def.key.startsWith('otp_') || def.key.startsWith('data_') || def.key === 'contact_changed' ? undefined : { label: 'Open the portal', url: `${config.CLIENT_ORIGIN}/app` }, input);
  return { subject: rendered.subject, html: rendered.html };
}
