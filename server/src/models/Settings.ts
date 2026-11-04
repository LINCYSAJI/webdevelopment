import { Schema, model } from 'mongoose';

// A single document (_id "global") holding the Admin-editable settings (PRD §14).
const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'global' },
    // Branding
    organisationName: { type: String, default: 'Your Organisation' },
    portalName: { type: String, default: 'Franchise Agreement Portal' },
    logoUrl: { type: String, default: null },
    primaryColor: { type: String, default: '#1e3a8a' },
    secondaryColor: { type: String, default: '#0ea5e9' },
    supportEmail: { type: String, default: null },
    supportPhone: { type: String, default: null },
    // Agreement
    agreementRefPrefix: { type: String, default: 'FRN' },
    // Verification
    otpExpiryMinutes: { type: Number, default: 10 },
    otpResendCooldownSeconds: { type: Number, default: 60 },
    otpMaxAttempts: { type: Number, default: 5 },
    pendingVerificationRetentionDays: { type: Number, default: 7 },
    // Reminders (business days)
    reminderFirstAfterDays: { type: Number, default: 2 },
    reminderRepeatEveryDays: { type: Number, default: 2 },
    escalationAfterDays: { type: Number, default: 5 },
    reminderRunTime: { type: String, default: '09:00' },
    // Files
    maxDocumentSizeMB: { type: Number, default: 5 },
    maxPhotoSizeMB: { type: Number, default: 2 },
    maxRentalSizeMB: { type: Number, default: 10 },
    // Security
    sessionTimeoutMinutes: { type: Number, default: 30 },
  },
  { timestamps: true },
);

export const Settings = model('Settings', settingsSchema);

export async function getSettings() {
  const existing = await Settings.findById('global');
  if (existing) return existing;
  return Settings.create({ _id: 'global' });
}
