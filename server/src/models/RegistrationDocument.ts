import { Schema, model } from 'mongoose';
import { appendOnly } from './appendOnly';

export const DOCUMENT_TYPES = ['pan', 'gst', 'rental', 'id_proof', 'photo'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** One uploaded file belonging to a registration (PRD §12 "Document"). Permanent. */
const registrationDocumentSchema = new Schema({
  registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
  submissionVersion: { type: Number, required: true },
  type: { type: String, enum: DOCUMENT_TYPES, required: true },
  owner: {
    kind: { type: String, enum: ['registration', 'signatory', 'contact'], required: true },
    // Contact position (0 = Contact 1); only for contacts.
    index: { type: Number },
  },
  storageKey: { type: String, required: true },
  fileName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  sha256: { type: String, required: true },
  uploadedAt: { type: Date, required: true },
});
appendOnly(registrationDocumentSchema, 'Registration documents');

export const RegistrationDocument = model('RegistrationDocument', registrationDocumentSchema, 'documents');
