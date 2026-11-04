import { Schema, model } from 'mongoose';

/**
 * Resend limits for one person + purpose + channel (PRD 10.3): when the last code was sent and
 * how many were sent in the current hour. Updated atomically so parallel "Resend" clicks cannot
 * get past the cooldown or the hourly limit. Rows expire automatically (TTL on lastSentAt).
 */
const otpThrottleSchema = new Schema({
  _id: { type: String }, // "<subjectKey>|<purpose>|<channel>"
  lastSentAt: { type: Date, required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, required: true },
});

export const OtpThrottle = model('OtpThrottle', otpThrottleSchema);
