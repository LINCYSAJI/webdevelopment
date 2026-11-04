import { Schema, model } from 'mongoose';
import { ROLES } from '@fap/shared';
import { appendOnly } from './appendOnly';

/**
 * The application's timeline (PRD F2, A2/M2 history): submission, resubmissions and every
 * Accounts / Manager decision. Permanent: rows are never changed or deleted.
 */
const registrationHistorySchema = new Schema({
  registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
  at: { type: Date, required: true },
  // submitted | resubmitted | accounts_approved | accounts_rejected | manager_approved | manager_rejected | …
  event: { type: String, required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole: { type: String, enum: ROLES, default: null },
  fromStatus: { type: String, default: null },
  toStatus: { type: String, default: null },
  reason: { type: String, default: null },
  submissionVersion: { type: Number, default: null },
});
appendOnly(registrationHistorySchema, 'Registration history entries');

export const RegistrationHistory = model('RegistrationHistory', registrationHistorySchema);
