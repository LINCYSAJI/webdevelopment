import { Schema, model } from 'mongoose';

// Public holidays excluded from business-day counting (PRD §10.8).
const holidaySchema = new Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD in IST
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

export const Holiday = model('Holiday', holidaySchema);
