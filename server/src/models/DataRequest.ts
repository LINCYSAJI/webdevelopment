import { Schema, model } from 'mongoose';
import { DATA_REQUEST_STATUSES } from '@fap/shared';

/**
 * "Delete my account" requests from Franchise Users (DPDP Act s.12 erasure, s.6(4) withdrawal
 * of consent). Admin either erases the data or declines with a reason (for example, a signed
 * agreement that the law requires us to keep). Only one request per user can be pending.
 */
const dataRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', default: null },
    type: { type: String, enum: ['erasure'], default: 'erasure', required: true },
    status: { type: String, enum: DATA_REQUEST_STATUSES, default: 'pending', required: true },
    reason: { type: String, default: '' },
    requestedAt: { type: Date, required: true },
    ip: { type: String },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    // Kept after erasure so Admin can still see which request this was, without personal data.
    applicationId: { type: String, default: null },
  },
  { timestamps: true },
);

export const DataRequest = model('DataRequest', dataRequestSchema);
