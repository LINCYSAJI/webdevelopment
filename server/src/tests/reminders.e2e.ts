// End-to-end test for build step 8: the daily automatic check (PRD 10.8): business-day reminders
// (N13), Admin escalations (N14), exactly-once runs, holidays and weekends, the reminder history on
// Approval Tracking, and the clean-ups of unverified registrations and unused uploads.
// Runs on a throwaway in-memory database. Run with: npm test.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const storageDir = mkdtempSync(path.join(tmpdir(), 'fap-test-'));
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.NODE_ENV = 'test';
// Never use a real SMS gateway from server/.env in tests: every text goes to the test mailbox.
process.env.SMS_PROVIDER = 'dev_outbox';
process.env.MONGODB_URI = rs.getUri('reminders_test');
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const agreements = await import('../services/agreement.service');
const { hashPassword } = await import('../services/auth.service');
const { runDailyCheck } = await import('../services/scheduler.service');
const { dueReminderNumber } = await import('@fap/shared');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
const { ReminderLog } = await import('../models/ReminderLog');
const { RegistrationDocument } = await import('../models/RegistrationDocument');
const { SubmissionVersion } = await import('../models/SubmissionVersion');
const { AgreementAcceptance } = await import('../models/AgreementAcceptance');
const { ConsentRecord } = await import('../models/ConsentRecord');
const { PendingUpload } = await import('../models/PendingUpload');
const { Holiday } = await import('../models/Holiday');
const { AuditLog } = await import('../models/AuditLog');
const { getSettings } = await import('../models/Settings');

await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
await runMigrations(mongoose.connection.db!);
await getSettings();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const db = mongoose.connection.db!;
const outbox = () => db.collection('dev_outbox');

let failures = 0;
const ok = (label: string, cond: boolean, extra?: unknown) => {
  if (!cond) failures++;
  console.log(cond ? 'PASS' : 'FAIL', label, cond || extra === undefined ? '' : JSON.stringify(extra));
};

class Browser {
  cookies = new Map<string, string>();
  async call(method: string, url: string, body?: unknown, raw?: { data: Buffer; headers: Record<string, string> }) {
    const headers: Record<string, string> = { ...(raw?.headers ?? {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, { method, headers, body: raw ? new Uint8Array(raw.data) : body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (pair.slice(i + 1)) this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
      else this.cookies.delete(pair.slice(0, i));
    }
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, body: (type.includes('json') ? await res.json() : null) as any };
  }
}
const anon = new Browser();
const login = async (identifier: string, password = 'Portal@2026') => {
  const b = new Browser();
  const r = await b.call('POST', '/auth/login', { identifier, password });
  if (r.status !== 200) throw new Error(`login ${identifier} failed: ${JSON.stringify(r.body)}`);
  return b;
};

// ---------- Setup ----------
const pw = await hashPassword('Portal@2026');
const admin = await User.create({ name: 'Admin', email: 'admin@check.local', username: 'admin', role: 'admin', passwordHash: pw });
await User.create({ name: 'Former Admin', email: 'former@check.local', username: 'former', role: 'admin', passwordHash: pw, isActive: false });
const asha = await User.create({ name: 'Asha Accounts', email: 'asha@check.local', username: 'asha', role: 'accounts', passwordHash: pw });
await User.create({ name: 'Bala Accounts', email: 'bala@check.local', username: 'bala', role: 'accounts', passwordHash: pw });
await User.create({ name: 'Mira Manager', email: 'mira@check.local', username: 'mira', role: 'manager', passwordHash: pw });
const actor = { user: admin, ip: '127.0.0.1' } as never;
const pdfDoc = await PDFDocument.create();
pdfDoc.addPage().drawText('Franchise agreement terms', { x: 50, y: 700 });
const PDF = Buffer.from(await pdfDoc.save());
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const v1 = await agreements.createDraft({ title: 'Agreement', format: 'pdf', content: '' }, actor);
await agreements.uploadPdf(v1.id, PDF, 'a.pdf', actor);
await agreements.activateVersion(v1.id, actor);

/** 09:00 IST on the given day. */
const ist = (day: string, time = '09:00') => new Date(`${day}T${time}:00+05:30`);
const entered = ist('2026-11-02', '11:00'); // Monday

let n = 0;
async function waiting(status: string, opts: { assignedTo?: unknown; stageEnteredAt?: Date } = {}) {
  n++;
  return Registration.create({
    applicationId: `APP-2026-${String(n).padStart(4, '0')}`,
    status,
    franchiseModel: 'Express',
    firmType: 'Partnership Firm',
    firmName: `Firm ${n}`,
    pan: `ZZZZZ${String(1000 + n)}Z`,
    signatory: { name: `Applicant ${n}`, capacity: 'Partner', email: `app${n}@example.com`, mobile: `98000000${String(n).padStart(2, '0')}` },
    contacts: [],
    agreementVersionId: v1.id,
    assignedTo: opts.assignedTo ?? null,
    submittedAt: entered,
    lastSubmittedAt: entered,
    stageEnteredAt: opts.stageEnteredAt ?? entered,
  });
}
const r1 = await waiting('pending_accounts', { assignedTo: asha._id });
const r2 = await waiting('pending_accounts');
const r3 = await waiting('pending_manager');
await waiting('pending_accounts', { stageEnteredAt: ist('2026-11-05', '10:00') }); // arrived Thursday
await waiting('approved');

const mails = async (subject: RegExp, since: Date) => outbox().find({ subject, at: { $gte: since } }).toArray();
async function run(day: string, trigger: 'schedule' | 'admin' = 'admin') {
  const since = new Date();
  const result = await runDailyCheck({ now: ist(day), trigger, actor: trigger === 'admin' ? actor : undefined });
  return { result, since };
}

// ---------- Timing rule ----------
ok('timing: no reminder at 2 business days, first at 3, second at 5, third at 7', [2, 3, 4, 5, 6, 7].map((d) => dueReminderNumber(d, 2, 2)).join() === '0,1,1,2,2,3');
ok('timing: Admin alert only after more than 5 business days', [5, 6, 7, 8].map((d) => dueReminderNumber(d, 5, 2)).join() === '0,1,1,2');

// ---------- Wednesday: 2 business days, nothing yet ----------
let { result, since } = await run('2026-11-04');
ok('Wednesday (2 business days): no reminders', result?.status === 'finished' && result.summary?.reminders === 0 && result.summary.escalations === 0, result);

// ---------- Thursday: first reminders ----------
({ result, since } = await run('2026-11-05', 'schedule'));
ok('Thursday: 3 reminders (assigned, unassigned, Manager), no Admin alert', result?.summary?.reminders === 3 && result.summary.escalations === 0, result?.summary);
let sent = await mails(/^Reminder:/, since);
const to = (who: string) => sent.filter((m) => m.to === who);
ok('Asha (assignee) gets ONE email listing both her application and the unassigned one', to('asha@check.local').length === 1 && /APP-2026-0001/.test(to('asha@check.local')[0].text) && /APP-2026-0002/.test(to('asha@check.local')[0].text), sent.map((m) => [m.to, m.subject]));
ok('Bala gets only the unassigned application', to('bala@check.local').length === 1 && !/APP-2026-0001/.test(to('bala@check.local')[0].text) && /APP-2026-0002/.test(to('bala@check.local')[0].text));
ok('the Manager gets the Pending Manager application', to('mira@check.local').length === 1 && /APP-2026-0003/.test(to('mira@check.local')[0].text));
ok('the application that arrived on Thursday is not in any reminder', sent.every((m) => !/APP-2026-0004/.test(m.text)) && sent.every((m) => !/APP-2026-0005/.test(m.text)));
ok('reminder emails say they change nothing', sent.every((m) => /does not change anything/.test(m.text)));

const again = await runDailyCheck({ now: ist('2026-11-05', '09:01'), trigger: 'schedule' });
ok('the scheduled check runs only once a day (second claim refused)', again === null);
({ result, since } = await run('2026-11-05'));
ok('Admin "Run now" the same day sends nothing twice', result?.summary?.reminders === 0 && (await mails(/^Reminder:/, since)).length === 0, result?.summary);
const parallel = await Promise.all([run('2026-11-06'), run('2026-11-06')]);
ok('two checks at the same moment (two servers): each reminder still sent once', parallel.reduce((s, p) => s + (p.result?.summary?.reminders ?? 0), 0) === 0);

// ---------- Weekend and holiday ----------
({ result } = await run('2026-11-07'));
ok('Saturday: not a business day, no reminders', result?.summary?.businessDay === false && result.summary.reminders === 0, result?.summary);
await Holiday.create({ date: '2026-11-09', name: 'Test holiday' });
({ result } = await run('2026-11-09'));
ok('holiday Monday: no reminders', result?.summary?.businessDay === false && result.summary.reminders === 0, result?.summary);

// ---------- Tuesday: second reminders (holiday not counted) ----------
({ result, since } = await run('2026-11-10'));
ok('Tuesday (5 business days, holiday skipped): second reminders, no Admin alert yet', result?.summary?.reminders === 3 && result.summary.escalations === 0, result?.summary);

// ---------- Wednesday: Admin escalation ----------
({ result, since } = await run('2026-11-11'));
// The Thursday arrival has now waited 3 business days (Fri, Tue, Wed): its first reminder.
ok('Wednesday (6 business days): Admin alert for all three, first reminder for the Thursday arrival', result?.summary?.escalations === 3 && result.summary.reminders === 1, result?.summary);
sent = await mails(/^Overdue:/, since);
ok('one Admin alert email to the active Admin only, listing all three', sent.length === 1 && sent[0].to === 'admin@check.local' && ['0001', '0002', '0003'].every((x) => sent[0].text.includes(`APP-2026-${x}`)), sent.map((m) => m.to));

const statuses = (await Registration.find({ _id: { $in: [r1._id, r2._id, r3._id] } })).map((r) => r.status).join();
ok('reminders never change a status', statuses === 'pending_accounts,pending_accounts,pending_manager', statuses);
ok('reminder log is permanent', await ReminderLog.deleteMany({}).then(() => false, () => true));

// ---------- Approval Tracking shows the reminders ----------
const adminB = await login('admin');
const t = (await adminB.call('GET', '/admin/tracking')).body.tracking;
const row1 = t.overdue.find((r: any) => r.id === r1._id.toString());
ok('AD4 overdue list shows 2 reminders + 1 Admin alert with names', row1?.reminders.length === 3 && row1.reminders.filter((m: any) => m.kind === 'escalation').length === 1 && /Asha Accounts/.test(row1.reminders[0].to), row1?.reminders);
ok('AD4 shows the run time and the last check', t.dailyCheck.runTime === '09:00' && t.dailyCheck.lastRun?.status === 'finished', t.dailyCheck);

// A resubmission (or any new stage) restarts the clock: earlier reminders no longer count.
await Registration.updateOne({ _id: r1._id }, { $set: { stageEnteredAt: ist('2026-11-11', '15:00') } });
({ result } = await run('2026-11-12'));
ok('new stage visit restarts the clock: no reminder for it the next day', !(await ReminderLog.exists({ registrationId: r1._id, stageEnteredAt: ist('2026-11-11', '15:00') })));

// ---------- Permissions ----------
const ashaB = await login('asha');
const miraB = await login('mira');
const runs = await Promise.all([anon.call('POST', '/admin/daily-check/run'), ashaB.call('POST', '/admin/daily-check/run'), miraB.call('POST', '/admin/daily-check/run')]);
ok('Run now: logged-out 401, Accounts and Manager 403', runs.map((r) => r.status).join() === '401,403,403', runs.map((r) => r.status));
const mine = await adminB.call('POST', '/admin/daily-check/run');
ok('Run now works for Admin and is audited', mine.status === 200 && mine.body.run.trigger === 'admin' && !!(await AuditLog.exists({ action: 'daily_check_run', userId: admin._id })), mine.body);

// ---------- Clean-ups ----------
const up = async (kind: string, data: Buffer) =>
  (await anon.call('PUT', `/public/uploads/${kind}`, undefined, { data, headers: { 'Content-Type': 'application/octet-stream' } })).body.upload.token as string;
async function register(pan: string, email: string, mobile: string) {
  const body = {
    franchiseModel: 'Express',
    firmType: 'Partnership Firm',
    firmName: `Firm ${pan}`,
    pan,
    panFile: await up('document', PDF),
    gst: null,
    signatory: { name: 'Priya Sharma', capacity: 'Partner', email, mobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) },
    contacts: [{ name: 'Ravi Kumar', email: `c-${email}`, mobile: `7${mobile.slice(1)}`, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) }],
    agreement: { agreementVersionId: v1.id, accepted: true },
    legalConsent: true,
    acknowledgeDuplicates: true,
  };
  const r = await anon.call('POST', '/public/registrations', body);
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  return (await Registration.findOne({ pan }))!;
}
const old = await register('PPPPP1111P', 'old@example.com', '9500000001');
const fresh = await register('QQQQQ2222Q', 'fresh@example.com', '9600000001');
await Registration.updateOne({ _id: old._id }, { $set: { submittedAt: new Date(Date.now() - 8 * 86_400_000) } });
const oldFiles = (await RegistrationDocument.find({ registrationId: old._id })).map((d) => path.join(storageDir, d.storageKey));
ok('setup: the unverified registration has stored files', oldFiles.length > 0 && oldFiles.every((f) => existsSync(f)));

const unusedToken = await up('document', PDF);
const unused = (await PendingUpload.findOne({ claimedBy: null }).sort({ createdAt: -1 }))!;
await PendingUpload.updateOne({ _id: unused._id }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
await up('document', PNG); // a recent upload that must be kept
ok('setup: unused upload token issued', !!unusedToken);

// Clean-ups use the real clock (uploads and registrations above were created just now).
result = await runDailyCheck({ trigger: 'admin', actor });
ok('clean-up: 1 unverified registration and 1 unused upload removed', result?.summary?.unverifiedRemoved === 1 && result.summary.uploadsRemoved === 1, result?.summary);
ok('the old unverified registration is gone with its records', !(await Registration.exists({ _id: old._id })) && !(await SubmissionVersion.exists({ registrationId: old._id })) && !(await RegistrationDocument.exists({ registrationId: old._id })) && !(await AgreementAcceptance.exists({ registrationId: old._id })) && !(await ConsentRecord.exists({ registrationId: old._id })));
ok('its stored files are deleted', oldFiles.every((f) => !existsSync(f)));
ok('the recent unverified registration is kept', !!(await Registration.exists({ _id: fresh._id })));
ok('verified applications are never touched', (await Registration.countDocuments({ status: { $ne: 'pending_verification' } })) === 5);
ok('the unused upload and its file are deleted', !(await PendingUpload.exists({ _id: unused._id })) && !existsSync(path.join(storageDir, unused.storageKey)));
ok('recent uploads are kept', (await PendingUpload.countDocuments({ claimedBy: null })) === 1);
ok('each removal is audited', !!(await AuditLog.exists({ action: 'unverified_registration_removed', targetId: old._id.toString() })));
const again2 = await register('PPPPP1111P', 'old@example.com', '9500000001').then(() => true, () => false);
ok('the same PAN can register again after the clean-up', again2);

server.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
