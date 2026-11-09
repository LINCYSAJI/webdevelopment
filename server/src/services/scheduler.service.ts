import { randomBytes } from 'node:crypto';
import { istDateKey, type DailyCheckRunView, type DailyCheckSummary } from '@fap/shared';
import { duplicateKeyField } from '../lib/mongo-errors';
import { JobRun } from '../models/JobRun';
import { getSettings } from '../models/Settings';
import { audit } from './audit.service';
import { runCleanups } from './cleanup.service';
import { sendDueReminders } from './reminder.service';
import { holidaySet } from './review.service';
import type { Actor } from './users.service';

/**
 * The daily automatic check (PRD 10.8, 15.1): pending reminders and Admin escalations on business
 * days, plus the clean-ups every day. Runs at the "Daily reminder run time" in Settings (IST).
 *
 * Exactly once per day, even with several servers: the run is claimed by creating the JobRun row
 * "daily|YYYY-MM-DD"; only one server can create it. Each reminder also has its own unique key, so
 * an Admin "Run now" or a retry never sends the same reminder twice.
 */

const JOB = 'daily';
const TICK_MS = 60_000;

const istTime = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

export async function isBusinessDay(now: Date): Promise<boolean> {
  const day = istDateKey(now);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !(await holidaySet()).has(day);
}

/**
 * Runs the check. A scheduled run returns null if this day's run was already claimed (by this or
 * another server). An Admin run always runs.
 */
export async function runDailyCheck(opts: { now?: Date; trigger: 'schedule' | 'admin'; actor?: Actor }): Promise<DailyCheckRunView | null> {
  const now = opts.now ?? new Date();
  const day = istDateKey(now);
  const id = opts.trigger === 'schedule' ? `${JOB}|${day}` : `${JOB}|${day}|admin|${randomBytes(6).toString('hex')}`;
  try {
    await JobRun.create({ _id: id, job: JOB, day, trigger: opts.trigger, triggeredBy: opts.actor?.user._id ?? null, startedAt: new Date(), status: 'running' });
  } catch (err) {
    if (duplicateKeyField(err)) return null;
    throw err;
  }

  try {
    const businessDay = await isBusinessDay(now);
    const reminders = businessDay ? await sendDueReminders(now) : { reminders: 0, escalations: 0, emailsSent: 0, emailsFailed: 0, problems: [] };
    const cleanups = await runCleanups(now);
    const summary: DailyCheckSummary = {
      businessDay,
      reminders: reminders.reminders,
      escalations: reminders.escalations,
      emailsSent: reminders.emailsSent,
      emailsFailed: reminders.emailsFailed,
      unverifiedRemoved: cleanups.unverifiedRemoved,
      uploadsRemoved: cleanups.uploadsRemoved,
      problems: [...reminders.problems, ...cleanups.problems],
    };
    await JobRun.updateOne({ _id: id }, { $set: { status: 'finished', finishedAt: new Date(), summary } });
    await audit({
      action: 'daily_check_run',
      userId: opts.actor?.user._id ?? null,
      role: opts.actor ? 'admin' : null,
      targetType: 'job',
      targetId: id,
      details: { ...summary },
      ip: opts.actor?.ip,
    });
    if (summary.problems.length) console.error(`Daily check ${day}: ${summary.problems.join('; ')}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Daily check ${day} failed:`, err);
    await JobRun.updateOne({ _id: id }, { $set: { status: 'failed', finishedAt: new Date(), error: message } });
    await audit({ action: 'daily_check_failed', targetType: 'job', targetId: id, details: { error: message } }).catch(() => undefined);
  }
  return toView((await JobRun.findById(id))!);
}

function toView(run: InstanceType<typeof JobRun>): DailyCheckRunView {
  return {
    day: run.day,
    trigger: run.trigger as DailyCheckRunView['trigger'],
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    status: run.status as DailyCheckRunView['status'],
    summary: (run.summary as DailyCheckSummary | null) ?? null,
  };
}

export async function lastDailyCheck(): Promise<DailyCheckRunView | null> {
  const run = await JobRun.findOne({ job: JOB }).sort({ startedAt: -1 });
  return run ? toView(run) : null;
}

/** Called every minute: runs today's check once the run time (IST) has passed, if not yet claimed. */
async function tick() {
  const now = new Date();
  const settings = await getSettings();
  if (istTime(now) < settings.reminderRunTime) return;
  if (await JobRun.exists({ _id: `${JOB}|${istDateKey(now)}` })) return;
  await runDailyCheck({ now, trigger: 'schedule' });
}

let timer: NodeJS.Timeout | null = null;

/** Starts the scheduler (server start-up only; tests call runDailyCheck directly). */
export function startScheduler() {
  if (timer) return;
  const safeTick = () => void tick().catch((err) => console.error('Scheduler check failed:', err));
  timer = setInterval(safeTick, TICK_MS);
  timer.unref();
  setTimeout(safeTick, 5_000).unref(); // catch up soon after a restart that missed today's time
  console.log('Daily check scheduled (reminders, escalations and clean-ups).');
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
