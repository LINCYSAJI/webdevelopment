import { Schema, model } from 'mongoose';
import { UPLOAD_KINDS } from '@fap/shared';

/**
 * A file an applicant uploaded on the registration page but has not yet submitted.
 * The browser holds a secret token; only its hash is stored. Unclaimed uploads expire
 * after 24 hours; the daily clean-up (cleanup.service.ts) deletes their stored file and the row.
 * As a fallback the row itself expires 7 days later (TTL, migration 012).
 */
const pendingUploadSchema = new Schema({
  tokenHash: { type: String, required: true },
  kind: { type: String, enum: UPLOAD_KINDS, required: true },
  storageKey: { type: String, required: true },
  fileName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  ip: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  claimedBy: { type: Schema.Types.ObjectId, ref: 'Registration', default: null },
});

export const PendingUpload = model('PendingUpload', pendingUploadSchema);
