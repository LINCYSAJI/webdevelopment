import { Schema, model } from 'mongoose';

/**
 * Raised when an email or mobile in an application matches another registration (PRD 10.1).
 * Admin resolves it in Duplicate Review (build step 7); Accounts cannot approve while it is open.
 */
const duplicateFlagSchema = new Schema(
  {
    registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
    submissionVersion: { type: Number, required: true },
    matches: [
      {
        _id: false,
        field: { type: String, required: true }, // e.g. "signatory.email", "contacts.1.mobile"
        value: { type: String, required: true },
        matchedRegistrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
        matchedApplicationId: { type: String, default: null },
      },
    ],
    status: { type: String, enum: ['open', 'not_duplicate', 'confirmed'], default: 'open', required: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    note: { type: String },
  },
  { timestamps: true },
);

export const DuplicateFlag = model('DuplicateFlag', duplicateFlagSchema);
