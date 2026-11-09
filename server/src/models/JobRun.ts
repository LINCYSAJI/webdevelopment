import { Schema, model } from 'mongoose';

/**
 * One row per run of the daily automatic check (PRD 10.8). The scheduled run's `_id` is
 * "daily|YYYY-MM-DD" (IST day): creating it is the claim, so on several servers only the one
 * that creates it first runs the check that day. Admin "Run now" rows get a unique id.
 */
const jobRunSchema = new Schema(
  {
    _id: { type: String },
    job: { type: String, required: true },
    day: { type: String, required: true },
    trigger: { type: String, enum: ['schedule', 'admin'], required: true },
    triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    status: { type: String, enum: ['running', 'finished', 'failed'], required: true },
    summary: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  { versionKey: false },
);

export const JobRun = model('JobRun', jobRunSchema);
