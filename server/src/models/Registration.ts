import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { FIRM_TYPES, SIGNATORY_CAPACITIES, STATUSES } from '@fap/shared';

/**
 * A franchise application: its current details and workflow state. Every submission is
 * also kept as a permanent snapshot in `submissionversions`.
 */
const registrationSchema = new Schema(
  {
    // Issued once verification completes (build step 4).
    applicationId: { type: String, default: null },
    status: { type: String, enum: STATUSES, required: true },

    franchiseModel: { type: String, required: true },
    firmType: { type: String, enum: FIRM_TYPES, required: true },
    firmName: { type: String, required: true },
    pan: { type: String, required: true },
    gst: { type: String, default: null },
    /**
     * Set when the application leaves Pending Verification. Unique indexes on these fields
     * guarantee one registration per PAN / GST, while abandoned unverified attempts
     * never block anyone (CLAUDE.md rule 10).
     */
    panLock: { type: String },
    gstLock: { type: String },

    signatory: {
      name: { type: String, required: true },
      capacity: { type: String, enum: SIGNATORY_CAPACITIES, required: true },
      email: { type: String, required: true, lowercase: true },
      mobile: { type: String, required: true },
    },
    contacts: [
      {
        _id: false,
        name: { type: String, required: true },
        email: { type: String, required: true, lowercase: true },
        mobile: { type: String, required: true },
      },
    ],

    currentSubmissionVersion: { type: Number, required: true, default: 1 },
    // The registration stays on the agreement version it first accepted (PRD 10.4).
    agreementVersionId: { type: Schema.Types.ObjectId, ref: 'AgreementVersion', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    hasOpenDuplicateFlag: { type: Boolean, default: false },

    verification: {
      tokenHash: { type: String },
      expiresAt: { type: Date },
      emailVerifiedAt: { type: Date },
      mobileVerifiedAt: { type: Date },
    },
    submittedAt: { type: Date, required: true },
    // Set by the Manager's final approval (PRD 10.5): FRN/YYYY/NNNN, unique and never reused.
    agreementReferenceNo: { type: String },
    approvedAt: { type: Date },
    // Latest submit or resubmit (PRD A2 "Submitted / Resubmitted On").
    lastSubmittedAt: { type: Date },
    // When the application entered its current waiting stage; business-day reminders count from here (PRD 10.8).
    stageEnteredAt: { type: Date },
    // Set when the applicant's personal data was erased at their request (DPDP Act s.12).
    erasedAt: { type: Date },
  },
  { timestamps: true },
);

export type RegistrationDocument = HydratedDocument<InferSchemaType<typeof registrationSchema>>;
export const Registration = model('Registration', registrationSchema);
