import { Schema, model } from 'mongoose';
import { SMS_DELIVERY_STATUSES, SMS_LOG_STATUSES } from '@fap/shared';

/**
 * One row per SMS the portal tried to send (Admin > SMS Notifications history and error log).
 * `dedupeKey` (unique when set) guarantees each notification is sent at most once.
 */
const smsLogSchema = new Schema(
  {
    event: { type: String, required: true },
    recipient: { type: String, required: true },
    text: { type: String, default: null },
    templateId: { type: String, default: null },
    status: { type: String, enum: SMS_LOG_STATUSES, required: true },
    provider: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
    httpStatus: { type: Number, default: null },
    dedupeKey: { type: String },
    registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', default: null },
    applicationId: { type: String, default: null },
    test: { type: Boolean, default: false },
    sentAt: { type: Date, default: null },
    submissionId: { type: String, default: null },
    messageId: { type: String, default: null },
    delivery: {
      status: { type: String, enum: SMS_DELIVERY_STATUSES },
      code: { type: String },
      description: { type: String },
      checkedAt: { type: Date },
    },
  },
  { timestamps: true },
);

export const SmsLog = model('SmsLog', smsLogSchema);
