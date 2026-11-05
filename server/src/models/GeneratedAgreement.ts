import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { GENERATION_STATUSES } from '@fap/shared';

/**
 * The agreement PDF generated when the Manager approves (PRD §9, §12 "Generated Agreement").
 * One per registration. The file is private; only Managers may view, download or email it.
 * Files are never deleted: if generation is retried, earlier files stay in `previousFiles`.
 */
const fileSchema = new Schema(
  {
    storageKey: { type: String, required: true },
    fileName: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    pageCount: { type: Number, required: true },
    generatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const generatedAgreementSchema = new Schema(
  {
    registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
    referenceNumber: { type: String, required: true },
    agreementVersionId: { type: Schema.Types.ObjectId, ref: 'AgreementVersion', required: true },
    submissionVersion: { type: Number, required: true },
    approvedAt: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: GENERATION_STATUSES, required: true, default: 'pending' },
    file: { type: fileSchema, default: null },
    previousFiles: { type: [fileSchema], default: [] },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

export type GeneratedAgreementDocument = HydratedDocument<InferSchemaType<typeof generatedAgreementSchema>>;
export const GeneratedAgreement = model('GeneratedAgreement', generatedAgreementSchema);
