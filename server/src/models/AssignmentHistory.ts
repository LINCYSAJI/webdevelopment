import { Schema, model } from 'mongoose';
import { appendOnly } from './appendOnly';

export const ASSIGNMENT_ACTIONS = ['pick_up', 'reassign', 'auto_reassign', 'release'] as const;

/**
 * Every change of the Accounts reviewer on an application (PRD 10.6, §12 "Assignment History"):
 * who it moved from and to, why, by whom and when. Permanent.
 */
const assignmentHistorySchema = new Schema({
  registrationId: { type: Schema.Types.ObjectId, ref: 'Registration', required: true },
  at: { type: Date, required: true },
  action: { type: String, enum: ASSIGNMENT_ACTIONS, required: true },
  fromUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  toUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  note: { type: String, default: '' },
});
appendOnly(assignmentHistorySchema, 'Assignment history entries');

export const AssignmentHistory = model('AssignmentHistory', assignmentHistorySchema);
