import { Schema, model } from 'mongoose';

export const PASSWORD_TOKEN_PURPOSES = ['set_password', 'reset_password'] as const;
export type PasswordTokenPurpose = (typeof PASSWORD_TOKEN_PURPOSES)[number];

// One-time links emailed to users. Only a hash of the token is stored.
const passwordTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },
  purpose: { type: String, enum: PASSWORD_TOKEN_PURPOSES, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date },
});

export const PasswordToken = model('PasswordToken', passwordTokenSchema);
