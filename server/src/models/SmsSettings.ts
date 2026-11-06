import { Schema, model } from 'mongoose';
import { SMS_EVENTS } from '@fap/shared';

/** The OTP template ID registered for this portal's DLT entity (the wording is entered by Admin). */
export const DEFAULT_OTP_TEMPLATE_ID = '1707161553278051772';

const templateSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    templateId: { type: String, default: '' },
    dltText: { type: String, default: '' },
    format: { type: String, default: '' },
  },
  { _id: false },
);

/**
 * Admin-managed SMS settings (single document "global"): the on/off switch for notifications and,
 * per message, the DLT template ID, the approved wording and the message format. Credentials are
 * never stored here; they live in environment variables.
 */
const smsSettingsSchema = new Schema(
  {
    _id: { type: String, default: 'global' },
    enabled: { type: Boolean, default: true },
    templates: Object.fromEntries(SMS_EVENTS.map((e) => [e, { type: templateSchema, default: () => ({}) }])),
  },
  { timestamps: true },
);

export const SmsSettings = model('SmsSettings', smsSettingsSchema, 'smssettings');

export async function getSmsSettings() {
  const existing = await SmsSettings.findById('global');
  if (existing) return existing;
  try {
    return await SmsSettings.create({ _id: 'global', templates: { otp: { enabled: true, templateId: DEFAULT_OTP_TEMPLATE_ID } } });
  } catch {
    // Created by a parallel request.
    return (await SmsSettings.findById('global'))!;
  }
}
