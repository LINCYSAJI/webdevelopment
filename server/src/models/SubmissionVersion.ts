import { Schema, model } from 'mongoose';
import { appendOnly } from './appendOnly';

/**
 * A permanent snapshot of everything submitted at each submit or resubmit (PRD 10.7):
 * details, signatory, contacts and document references. Never overwritten.
 */
const submissionVersionSchema = new Schema({
  registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
  version: { type: Number, required: true },
  data: { type: Schema.Types.Mixed, required: true },
  submittedAt: { type: Date, required: true },
  submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  ip: { type: String },
});
appendOnly(submissionVersionSchema, 'Submission versions');

export const SubmissionVersion = model('SubmissionVersion', submissionVersionSchema);
