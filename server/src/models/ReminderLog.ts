import { Schema, model, type InferSchemaType } from 'mongoose';
import { REMINDER_KINDS } from '@fap/shared';
import { appendOnly } from './appendOnly';

/**
 * Every pending reminder (N13) and Admin escalation (N14) sent by the daily check (PRD 10.8, §12
 * "Reminder Log"). Shown on Approval Tracking (AD4). `dedupeKey` is unique, so each reminder for
 * a stage visit is sent at most once, even if the check runs twice or on two servers.
 */
const reminderLogSchema = new Schema(
  {
    registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
    applicationId: { type: String, required: true },
    stage: { type: String, enum: ['pending_accounts', 'pending_manager'], required: true },
    /** When the application entered this stage: identifies the stage visit. */
    stageEnteredAt: { type: Date, required: true },
    kind: { type: String, enum: REMINDER_KINDS, required: true },
    /** 1 for the first reminder of this kind in this stage visit, 2 for the next, ... */
    number: { type: Number, required: true },
    businessDaysWaiting: { type: Number, required: true },
    recipients: [{ _id: false, userId: { type: Schema.Types.ObjectId, ref: 'User' }, name: String, email: String }],
    dedupeKey: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
appendOnly(reminderLogSchema, 'Reminder log entries');

export type ReminderLogDoc = InferSchemaType<typeof reminderLogSchema>;
export const ReminderLog = model('ReminderLog', reminderLogSchema);
