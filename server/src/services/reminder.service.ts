import { businessDaysBetween, dueReminderNumber, type ReminderKind } from '@fap/shared';
import { config } from '../config';
import { duplicateKeyField } from '../lib/mongo-errors';
import { Registration, type RegistrationDocument } from '../models/Registration';
import { ReminderLog } from '../models/ReminderLog';
import { getSettings } from '../models/Settings';
import { User, type UserDocument } from '../models/User';
import { sendEmail } from './email.service';
import { escalationEmail, pendingReminderEmail, type ReminderLine } from './email-templates';
import { holidaySet, waitingSince } from './review.service';

/**
 * Pending reminders (N13) and Admin escalations (N14), PRD 10.8. Called by the daily check.
 *
 * - The clock starts when the application entered its current stage (including on resubmission).
 * - A reminder is due once it has waited MORE than "first reminder after" business days, then every
 *   "repeat every" business days; the Admin escalation likewise after "escalation after" days.
 * - Pending Accounts: the assigned Accounts user, or every active Accounts user if unassigned.
 *   Pending Manager: every active Manager. Escalations: every active Admin.
 * - Each reminder is logged first under a unique key, so it is never sent twice, then each person
 *   receives ONE email listing all their applications due that day.
 * - Reminders never change a status, approve or reject anything.
 */

type Recipient = Pick<UserDocument, '_id' | 'name' | 'email'>;
type WaitingStage = 'pending_accounts' | 'pending_manager';

export interface ReminderRunResult {
  reminders: number;
  escalations: number;
  emailsSent: number;
  emailsFailed: number;
  problems: string[];
}

const portalUrl = (path = '') => `${config.CLIENT_ORIGIN}/app${path}`;

export async function sendDueReminders(now = new Date()): Promise<ReminderRunResult> {
  const [settings, holidays] = await Promise.all([getSettings(), holidaySet()]);
  const [waiting, staff] = await Promise.all([
    Registration.find({ status: { $in: ['pending_accounts', 'pending_manager'] } }).sort({ stageEnteredAt: 1, _id: 1 }),
    User.find({ role: { $in: ['accounts', 'manager', 'admin'] }, isActive: true }, { name: 1, email: 1, role: 1 }),
  ]);
  const byRole = (role: string) => staff.filter((u) => u.role === role);
  const accounts = byRole('accounts');
  const managers = byRole('manager');
  const admins = byRole('admin');

  const result: ReminderRunResult = { reminders: 0, escalations: 0, emailsSent: 0, emailsFailed: 0, problems: [] };
  // Per person and kind: the applications to list in their single email.
  const outbox = new Map<string, { to: Recipient; kind: ReminderKind; lines: ReminderLine[] }>();

  async function logAndQueue(reg: RegistrationDocument, kind: ReminderKind, number: number, days: number, recipients: Recipient[]) {
    const stage = reg.status as WaitingStage;
    const enteredAt = waitingSince(reg);
    if (!recipients.length) {
      result.problems.push(`${reg.applicationId}: no active ${kind === 'escalation' ? 'Admin' : stage === 'pending_accounts' ? 'Accounts' : 'Manager'} user to remind`);
      return;
    }
    try {
      await ReminderLog.create({
        registrationId: reg._id,
        applicationId: reg.applicationId ?? '',
        stage,
        stageEnteredAt: enteredAt,
        kind,
        number,
        businessDaysWaiting: days,
        recipients: recipients.map((u) => ({ userId: u._id, name: u.name, email: u.email })),
        dedupeKey: `${reg._id}|${stage}|${enteredAt.toISOString()}|${kind}|${number}`,
        at: now,
      });
    } catch (err) {
      if (duplicateKeyField(err)) return; // already sent (an earlier run today, or another server)
      throw err;
    }
    if (kind === 'reminder') result.reminders++;
    else result.escalations++;
    for (const to of recipients) {
      const key = `${to._id}|${kind}`;
      const entry = outbox.get(key) ?? { to, kind, lines: [] };
      entry.lines.push({ applicationId: reg.applicationId ?? '', firmName: reg.firmName, stage, businessDaysWaiting: days });
      outbox.set(key, entry);
    }
  }

  for (const reg of waiting) {
    const days = businessDaysBetween(waitingSince(reg), now, holidays);
    const reminderNo = dueReminderNumber(days, settings.reminderFirstAfterDays, settings.reminderRepeatEveryDays);
    if (reminderNo) {
      let to: Recipient[] = managers;
      if (reg.status === 'pending_accounts') {
        const assignee = reg.assignedTo ? accounts.find((u) => u._id.equals(reg.assignedTo!)) : undefined;
        to = assignee ? [assignee] : accounts;
      }
      await logAndQueue(reg, 'reminder', reminderNo, days, to);
    }
    const escalationNo = dueReminderNumber(days, settings.escalationAfterDays, settings.reminderRepeatEveryDays);
    if (escalationNo) await logAndQueue(reg, 'escalation', escalationNo, days, admins);
  }

  for (const { to, kind, lines } of outbox.values()) {
    const message =
      kind === 'reminder'
        ? await pendingReminderEmail(to.name, lines, portalUrl())
        : await escalationEmail(to.name, lines, settings.escalationAfterDays, portalUrl('/admin/tracking'));
    const ok = await sendEmail({ to: to.email, event: kind === 'reminder' ? 'pending_reminder' : 'overdue_escalation', ...message });
    if (ok) result.emailsSent++;
    else result.emailsFailed++;
  }
  if (result.emailsFailed) result.problems.push(`${result.emailsFailed} reminder email(s) could not be sent; see the notification log`);
  return result;
}
