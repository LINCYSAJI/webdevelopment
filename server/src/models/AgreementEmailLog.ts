import { Schema, model } from 'mongoose';
import { appendOnly } from './appendOnly';

/** Every time a Manager sends (or resends) an agreement PDF to the franchisee (PRD M5, §12). Permanent. */
const agreementEmailLogSchema = new Schema({
  generatedAgreementId: { type: Schema.Types.ObjectId, ref: 'GeneratedAgreement', required: true },
  registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
  at: { type: Date, required: true },
  recipient: { type: String, required: true },
  subject: { type: String, required: true },
  sentBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['sent', 'failed'], required: true },
  error: { type: String, default: null },
});
appendOnly(agreementEmailLogSchema, 'Agreement email log entries');

export const AgreementEmailLog = model('AgreementEmailLog', agreementEmailLogSchema);
