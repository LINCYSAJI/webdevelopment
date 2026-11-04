import { Schema, model } from 'mongoose';
import { OTP_CHANNELS } from '@fap/shared';

export const OTP_PURPOSES = ['registration', 'change_email', 'change_mobile'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/**
 * A one-time code sent by email or SMS (PRD 10.3, §12 "OTP Record"). Only a keyed hash of the
 * code is stored. Records are removed automatically a day after they expire.
 */
const otpSchema = new Schema({
  purpose: { type: String, enum: OTP_PURPOSES, required: true },
  channel: { type: String, enum: OTP_CHANNELS, required: true },
  // Who the code belongs to: "reg:<registrationId>" or "user:<userId>".
  subjectKey: { type: String, required: true },
  // Where it was sent (email address or mobile number).
  target: { type: String, required: true },
  codeHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  verifiedAt: { type: Date, default: null },
  invalidatedAt: { type: Date, default: null },
  deleteAt: { type: Date, required: true },
});

export const Otp = model('Otp', otpSchema);
