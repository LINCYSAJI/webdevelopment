import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { AGREEMENT_FORMATS, AGREEMENT_STATUSES } from '@fap/shared';

/** The uploaded agreement PDF. The file itself is in private storage under `key`. */
const agreementPdfSchema = new Schema(
  {
    key: { type: String, required: true },
    fileName: { type: String, required: true },
    size: { type: Number, required: true },
    pageCount: { type: Number, required: true },
    sha256: { type: String, required: true },
    uploadedAt: { type: Date, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const agreementVersionSchema = new Schema(
  {
    versionNumber: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    format: { type: String, enum: AGREEMENT_FORMATS, default: 'text', required: true },
    // Text agreements: sanitised HTML containing {{merge_field}} tokens.
    content: { type: String, default: '' },
    // PDF agreements: the uploaded file.
    pdf: { type: agreementPdfSchema, default: null },
    status: { type: String, enum: AGREEMENT_STATUSES, default: 'draft', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date },
  },
  { timestamps: true },
);

export type AgreementVersionDocument = HydratedDocument<InferSchemaType<typeof agreementVersionSchema>>;
export const AgreementVersion = model('AgreementVersion', agreementVersionSchema);
