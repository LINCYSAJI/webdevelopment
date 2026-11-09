import { Schema, model } from 'mongoose';

/**
 * Admin's wording for one email (PRD §11, §14). `_id` is the template key from EMAIL_TEMPLATES in
 * @fap/shared. Only customised templates have a row; without one, the default wording is used.
 */
const emailTemplateSchema = new Schema(
  {
    _id: { type: String },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
);

export const EmailTemplate = model('EmailTemplate', emailTemplateSchema);
