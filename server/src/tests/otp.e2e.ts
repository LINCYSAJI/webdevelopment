// Tests for one-time codes when sending fails or "Resend" is clicked several times at once.
// Runs on a throwaway in-memory database. Run with: npm test (from the repository root).
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.NODE_ENV = 'test';
// Never use a real SMS gateway from server/.env in tests: every text goes to the test mailbox.
process.env.SMS_PROVIDER = 'dev_outbox';
process.env.MONGODB_URI = rs.getUri('otp_test');
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { issueOtp, verifyOtp } = await import('../services/otp.service');
const { getSettings, Settings } = await import('../models/Settings');
const { OtpThrottle } = await import('../models/OtpThrottle');
const { Otp } = await import('../models/Otp');

await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
await runMigrations(mongoose.connection.db!);
await getSettings();
const db = mongoose.connection.db!;
await db.createCollection('dev_outbox').catch(() => undefined);

let failures = 0;
const ok = (label: string, cond: boolean, extra?: unknown) => {
  if (!cond) failures++;
  console.log(cond ? 'PASS' : 'FAIL', label, cond || extra === undefined ? '' : JSON.stringify(extra));
};
const errorCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');
const latestCode = async (to: string) => {
  const m = await db.collection('dev_outbox').find({ to: { $in: [to, `+91 ${to}`] } }).sort({ at: -1 }).limit(1).next();
  return /(\d{6})/.exec(String(m?.subject ?? '') + String(m?.text ?? ''))?.[1] ?? '';
};
/** Makes the (development) email/SMS provider fail, like a real provider outage. */
const providerDown = (down: boolean) =>
  db.command({ collMod: 'dev_outbox', validator: down ? { _id: { $exists: false } } : {}, validationLevel: down ? 'strict' : 'off' });
/** Pretends the resend cooldown has passed. */
const skipCooldown = (subject: { subjectKey: string; purpose: string; channel: string }) =>
  OtpThrottle.updateOne({ _id: `${subject.subjectKey}|${subject.purpose}|${subject.channel}` }, { $set: { lastSentAt: new Date(Date.now() - 3600_000 + 60_000) } });

await Settings.updateOne({ _id: 'global' }, { $set: { otpResendCooldownSeconds: 60 } });

// ---- A failed send keeps the earlier code working
const email = { purpose: 'registration' as const, channel: 'email' as const, subjectKey: 'reg:test-1' };
await issueOtp(email, 'a@example.com');
const firstCode = await latestCode('a@example.com');
await skipCooldown(email);
await providerDown(true);
ok('resend during a provider outage reports the failure', (await errorCode(issueOtp(email, 'a@example.com'))) === 'otp_send_failed');
await providerDown(false);
ok('the earlier code still works after the failed resend', (await errorCode(verifyOtp(email, firstCode))) === 'ok');

// ---- A failed send gives back the cooldown and the hourly allowance
const sms = { purpose: 'registration' as const, channel: 'sms' as const, subjectKey: 'reg:test-2' };
await issueOtp(sms, '9876543210');
await skipCooldown(sms);
await providerDown(true);
await errorCode(issueOtp(sms, '9876543210'));
await providerDown(false);
ok('after a failed send the user can retry straight away (no cooldown)', (await errorCode(issueOtp(sms, '9876543210'))) === 'ok');
const row = await OtpThrottle.findById('reg:test-2|registration|sms');
ok('the failed send did not use up the hourly allowance (2 delivered = count 2)', row?.count === 2, row?.toObject());
ok('the new code works', (await errorCode(verifyOtp(sms, await latestCode('9876543210')))) === 'ok');

// ---- Several "Resend" clicks at the same moment send only one code
const burst = { purpose: 'registration' as const, channel: 'email' as const, subjectKey: 'reg:test-3' };
const results = await Promise.all(Array.from({ length: 8 }, () => errorCode(issueOtp(burst, 'b@example.com'))));
ok('8 parallel Resend clicks: exactly one code is sent', results.filter((r) => r === 'ok').length === 1 && results.filter((r) => r === 'otp_cooldown').length === 7, results);
ok('only one code was created', (await Otp.countDocuments({ subjectKey: 'reg:test-3' })) === 1);

// ---- Hourly limit: the first code plus 5 resends
await Settings.updateOne({ _id: 'global' }, { $set: { otpResendCooldownSeconds: 0 } });
const hourly = { purpose: 'registration' as const, channel: 'sms' as const, subjectKey: 'reg:test-4' };
const sends: string[] = [];
for (let i = 0; i < 7; i++) sends.push(await errorCode(issueOtp(hourly, '9000000009')));
ok('7th code within an hour is refused', sends.slice(0, 6).every((s) => s === 'ok') && sends[6] === 'otp_limit', sends);

// ---- Several server instances starting at once run migrations safely
const fresh = mongoose.connection.useDb('migration_race_test').db!;
const outcome = await Promise.all(Array.from({ length: 4 }, () => runMigrations(fresh).then(() => 'ok', (e: Error) => e.message)));
ok('4 servers starting together: all start, migrations applied once', outcome.every((o) => o === 'ok') && (await fresh.collection('_migrations').countDocuments()) > 0, outcome);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
await mongoose.disconnect();
await rs.stop();
process.exit(failures ? 1 : 0);
