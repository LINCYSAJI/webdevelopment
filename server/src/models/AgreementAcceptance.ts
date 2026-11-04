import { Schema, model } from 'mongoose';
import { AGREEMENT_FORMATS } from '@fap/shared';

/**
 * One row each time an applicant ticks "I agree" and submits (PRD 10.4).
 * Rows are permanent: never changed or deleted, so every accepted version is preserved
 * even after Admin publishes a newer agreement.
 */
const agreementAcceptanceSchema = new Schema({
  registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
  submissionVersion: { type: Number, required: true, min: 1 },
  agreementVersionId: { type: Schema.Types.ObjectId, ref: 'AgreementVersion', required: true },
  versionNumber: { type: Number, required: true },
  title: { type: String, required: true },
  format: { type: String, enum: AGREEMENT_FORMATS, required: true },
  // Exactly what the applicant saw and accepted.
  snapshot: {
    // Text agreements: the personalised text.
    html: { type: String },
    // PDF agreements: the stored file, which is itself never changed or deleted.
    pdfKey: { type: String },
    pdfSha256: { type: String },
    pdfFileName: { type: String },
  },
  acceptedAt: { type: Date, required: true },
  ip: { type: String },
  userAgent: { type: String },
});

const blockChanges = function () {
  throw new Error('Agreement acceptances are permanent and cannot be changed or deleted.');
};
agreementAcceptanceSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
  blockChanges,
);
agreementAcceptanceSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], blockChanges);

export const AgreementAcceptance = model('AgreementAcceptance', agreementAcceptanceSchema);
