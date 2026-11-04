import { Schema, model } from 'mongoose';

// Every email or SMS the portal attempts to send (PRD §11, §12).
const notificationLogSchema = new Schema({
  at: { type: Date, default: Date.now },
  recipient: { type: String, required: true },
  channel: { type: String, enum: ['email', 'sms'], required: true },
  event: { type: String, required: true },
  subject: { type: String },
  provider: { type: String },
  status: { type: String, enum: ['sent', 'failed'], required: true },
  attempts: { type: Number, default: 1 },
  error: { type: String },
});

export const NotificationLog = model('NotificationLog', notificationLogSchema);
