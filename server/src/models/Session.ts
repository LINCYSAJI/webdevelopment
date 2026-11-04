import { Schema, model } from 'mongoose';

// One document per signed-in browser. Holds only a hash of the refresh token.
const sessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  // Set when the token is rotated; presenting a rotated token again means it was stolen.
  replacedAt: { type: Date },
  revokedAt: { type: Date },
  ip: { type: String },
  userAgent: { type: String },
});

export const Session = model('Session', sessionSchema);
