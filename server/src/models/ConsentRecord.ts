import { Schema, model } from 'mongoose';
import { appendOnly } from './appendOnly';

/**
 * Proof of consent (DPDP Act s.6 and DPDP Rules): one permanent row each time an applicant
 * ticks the Terms & Conditions / Privacy Policy box and submits. Records exactly which
 * versions and wording they agreed to, when, and from where.
 */
const consentRecordSchema = new Schema({
  registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  submissionVersion: { type: Number, required: true, min: 1 },
  termsVersion: { type: String, required: true },
  privacyVersion: { type: String, required: true },
  text: { type: String, required: true },
  acceptedAt: { type: Date, required: true },
  ip: { type: String },
  userAgent: { type: String },
});
appendOnly(consentRecordSchema, 'Consent records');

export const ConsentRecord = model('ConsentRecord', consentRecordSchema);
