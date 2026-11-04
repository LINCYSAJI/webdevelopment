import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ROLES, type PublicUser, type Role } from '@fap/shared';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    username: { type: String, lowercase: true, trim: true },
    mobile: { type: String, trim: true },
    passwordHash: { type: String },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastLoginAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    firstFailedLoginAt: { type: Date },
    lockedUntil: { type: Date },
  },
  { timestamps: true },
);

export type UserFields = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserFields>;

export const User = model('User', userSchema);

export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    mobile: user.mobile ?? null,
    username: user.username ?? null,
    role: user.role as Role,
  };
}
