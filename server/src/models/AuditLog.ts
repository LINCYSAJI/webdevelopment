import { Schema, model } from 'mongoose';
import { ROLES } from '@fap/shared';

const auditLogSchema = new Schema({
  at: { type: Date, default: Date.now, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  role: { type: String, enum: ROLES },
  action: { type: String, required: true },
  targetType: { type: String },
  targetId: { type: String },
  details: { type: Schema.Types.Mixed },
  ip: { type: String },
});

// The audit log is append-only (CLAUDE.md rule 9).
const blockChanges = function () {
  throw new Error('The audit log is append-only and cannot be changed or deleted.');
};
auditLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
  blockChanges,
);
auditLogSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], blockChanges);

export const AuditLog = model('AuditLog', auditLogSchema);
