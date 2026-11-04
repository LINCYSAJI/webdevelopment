// End-to-end test for build step 4: email/SMS codes, account creation, Franchise User screens
// and their permissions. Runs the real API on a throwaway in-memory database.
// Run with: npm test (from the repository root).
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const storageDir = mkdtempSync(path.join(tmpdir(), 'fap-test-'));
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = rs.getUri('verification_test');
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const agreements = await import('../services/agreement.service');
const { hashPassword } = await import('../services/auth.service');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
const { Settings, getSettings } = await import('../models/Settings');
const { Otp } = await import('../models/Otp');

await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
await runMigrations(mongoose.connection.db!);
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const outbox = () => mongoose.connection.db!.collection('dev_outbox');

let failures = 0;
const ok = (label: string, cond: boolean, extra?: unknown) => {
  if (!cond) failures++;
  console.log(cond ? 'PASS' : 'FAIL', label, cond || extra === undefined ? '' : JSON.stringify(extra));
};

// ---------- tiny HTTP client with a cookie jar per "browser" ----------
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
      const v = pair.slice(i + 1);
      if (v) this.cookies.set(pair.slice(0, i), v);
      else this.cookies.delete(pair.slice(0, i));
    }
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, body: (type.includes('json') ? await res.json() : await res.arrayBuffer()) as any };
  }
}
const anon = new Browser();

// ---------- setup: staff, agreement ----------
const pw = await hashPassword('Portal@2026');
const admin = await User.create({ name: 'Admin', email: 'admin@check.local', username: 'admin', role: 'admin', passwordHash: pw });
await User.create({ name: 'Acc One', email: 'acc@check.local', username: 'acc', role: 'accounts', passwordHash: pw });
const actor = { user: admin, ip: '127.0.0.1' } as never;
const pdfDoc = await PDFDocument.create();
pdfDoc.addPage();
const PDF = Buffer.from(await pdfDoc.save());
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const v1 = await agreements.createDraft({ title: 'Agreement', format: 'pdf', content: '' }, actor);
await agreements.uploadPdf(v1.id, PDF, 'a.pdf', actor);
await agreements.activateVersion(v1.id, actor);

const up = async (kind: string, data: Buffer) =>
  (await anon.call('PUT', `/public/uploads/${kind}`, undefined, { data, headers: { 'Content-Type': 'application/octet-stream' } })).body.upload.token as string;

async function register(o: { pan: string; email: string; mobile: string; contactEmail: string; contactMobile: string; acknowledge?: boolean }) {
  const r = await anon.call('POST', '/public/registrations', {
    franchiseModel: 'Express',
    firmType: 'Partnership Firm',
    firmName: `Firm ${o.pan}`,
    pan: o.pan,
    panFile: await up('document', PDF),
    gst: null,
    signatory: { name: 'Priya Sharma', capacity: 'Partner', email: o.email, mobile: o.mobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) },
    contacts: [{ name: 'Ravi Kumar', email: o.contactEmail, mobile: o.contactMobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) }],
    agreement: { agreementVersionId: v1.id, accepted: true },
    acknowledgeDuplicates: !!o.acknowledge,
  });
  return r;
}

async function latestCode(to: string) {
  const m = await outbox().find({ to: { $in: [to, `+91 ${to}`] } }).sort({ at: -1 }).limit(1).next();
  return /(\d{6})/.exec(String(m?.subject ?? '') + String(m?.text ?? ''))?.[1] ?? '';
}
const setCooldown = (seconds: number) => Settings.updateOne({ _id: 'global' }, { $set: { otpResendCooldownSeconds: seconds } });
await getSettings();

// ---------- P3: verification ----------
let r = await register({ pan: 'AAAAA1111A', email: 'priya@example.com', mobile: '9876543210', contactEmail: 'ravi@example.com', contactMobile: '9123456780' });
const tokenA = r.body.verificationToken as string;
ok('registration A submitted', r.status === 201 && !!tokenA, r.body);

r = await anon.call('POST', '/public/verification/status', { token: tokenA });
ok('status shows masked email and mobile, nothing verified yet', r.body.status?.maskedEmail === 'pr***@example.com' && r.body.status.maskedMobile === '******3210' && !r.body.status.email.verified && !r.body.status.sms.active, r.body);
r = await anon.call('POST', '/public/verification/status', { token: 'x'.repeat(40) });
ok('unknown verification token refused', r.status === 404);

r = await anon.call('POST', '/public/verification/send', { token: tokenA, channel: 'email' });
const firstCode = await latestCode('priya@example.com');
ok('email code sent (6 digits) and code is active', r.status === 200 && r.body.status.email.active && /^\d{6}$/.test(firstCode), r.body);
ok('codes are stored only as a hash', !(await Otp.exists({ codeHash: firstCode })) && (await Otp.countDocuments()) === 1);
r = await anon.call('POST', '/public/verification/send', { token: tokenA, channel: 'email' });
ok('resend within the 60-second cooldown refused', r.status === 429 && r.body.error.code === 'otp_cooldown', r.body);

r = await anon.call('POST', '/public/verification/complete', { token: tokenA, password: 'Strong@123', confirmPassword: 'Strong@123' });
ok('account cannot be created before both codes are verified', r.status === 400 && r.body.error.code === 'not_verified', r.body);

const wrong = firstCode === '000000' ? '111111' : '000000';
const messages: string[] = [];
for (let i = 0; i < 5; i++) messages.push((await anon.call('POST', '/public/verification/verify', { token: tokenA, channel: 'email', code: wrong })).body.error?.message);
ok('wrong code shows attempts left', messages[0] === 'Incorrect code. You have 4 attempts left.', messages);
ok('5th wrong attempt invalidates the code', /Too many incorrect attempts/.test(messages[4]), messages);
r = await anon.call('POST', '/public/verification/verify', { token: tokenA, channel: 'email', code: firstCode });
ok('even the right code no longer works after 5 wrong attempts', r.status === 400 && r.body.error.code === 'otp_expired', r.body);

await setCooldown(0);
await anon.call('POST', '/public/verification/send', { token: tokenA, channel: 'email' });
const oldCode = await latestCode('priya@example.com');
await anon.call('POST', '/public/verification/send', { token: tokenA, channel: 'email' });
const newCode = await latestCode('priya@example.com');
if (oldCode !== newCode) {
  r = await anon.call('POST', '/public/verification/verify', { token: tokenA, channel: 'email', code: oldCode });
  ok('an older code stops working once a new one is sent', r.status === 400, r.body);
}
await Otp.updateMany({ channel: 'email', verifiedAt: null }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
r = await anon.call('POST', '/public/verification/verify', { token: tokenA, channel: 'email', code: newCode });
ok('expired code refused', r.status === 400 && r.body.error.code === 'otp_expired', r.body);

const hourly: number[] = [];
for (let i = 0; i < 7; i++) hourly.push((await anon.call('POST', '/public/verification/send', { token: tokenA, channel: 'sms' })).status);
ok('at most 6 codes per hour (first + 5 resends)', hourly.slice(0, 6).every((s) => s === 200) && hourly[6] === 429, hourly);
const smsCode = await latestCode('9876543210');
r = await anon.call('POST', '/public/verification/verify', { token: tokenA, channel: 'sms', code: smsCode });
ok('SMS code verifies the mobile', r.status === 200 && r.body.status.sms.verified, r.body);
r = await anon.call('POST', '/public/verification/verify', { token: tokenA, channel: 'sms', code: smsCode });
ok('a used code cannot be used again (already verified is fine)', r.status === 200 && r.body.status.sms.verified);

// Many guesses at the same moment must not get past the attempt limit.
await anon.call('POST', '/public/verification/send', { token: tokenA, channel: 'email' });
const raceCode = await latestCode('priya@example.com');
const guesses = Array.from({ length: 10 }, (_, i) => String((Number(raceCode) + 1 + i) % 1_000_000).padStart(6, '0'));
const raced = await Promise.all(guesses.map((code) => anon.call('POST', '/public/verification/verify', { token: tokenA, channel: 'email', code })));
const checkedGuesses = raced.filter((x) => ['otp_incorrect', 'otp_locked'].includes(x.body.error?.code)).length;
ok('10 parallel guesses: only 5 are ever checked', checkedGuesses === 5, raced.map((x) => x.body.error?.code));

// Email: hourly limit was not reached for email, so send one more.
const emailSendsLastHour = await Otp.countDocuments({ channel: 'email' });
if (emailSendsLastHour < 6) await anon.call('POST', '/public/verification/send', { token: tokenA, channel: 'email' });
r = await anon.call('POST', '/public/verification/verify', { token: tokenA, channel: 'email', code: await latestCode('priya@example.com') });
ok('email verified', r.status === 200 && r.body.status.email.verified, r.body);

// ---------- P4: set password, account created ----------
const browserA = new Browser();
r = await browserA.call('POST', '/public/verification/complete', { token: tokenA, password: 'weak', confirmPassword: 'weak' });
ok('weak password refused', r.status === 400 && !!r.body.error.fields?.password, r.body);
r = await browserA.call('POST', '/public/verification/complete', { token: tokenA, password: 'Strong@123', confirmPassword: 'Strong@124' });
ok('mismatched passwords refused', r.status === 400 && !!r.body.error.fields?.confirmPassword, r.body);
r = await browserA.call('POST', '/public/verification/complete', { token: tokenA, password: 'Strong@123', confirmPassword: 'Strong@123' });
const year = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date());
ok('account created, Application ID issued, logged in', r.status === 201 && r.body.applicationId === `APP-${year}-0001` && r.body.status === 'pending_accounts' && r.body.user.role === 'franchise_user' && browserA.cookies.has('fap_access'), r.body);
const regA = await Registration.findOne({ pan: 'AAAAA1111A' });
ok('application now Pending Accounts with PAN locked and owner linked', regA?.status === 'pending_accounts' && regA.panLock === 'AAAAA1111A' && !!regA.userId && !!regA.stageEnteredAt && !regA.verification?.tokenHash, regA?.toObject());
r = await browserA.call('POST', '/public/verification/complete', { token: tokenA, password: 'Strong@123', confirmPassword: 'Strong@123' });
ok('completing twice is refused', r.status === 404, r.body);

await new Promise((res) => setTimeout(res, 300));
const subjects = (await outbox().find({ event: 'application_submitted' }).toArray()).map((m) => `${m.to}: ${m.subject}`);
ok('N2 emails: applicant, Accounts and Admin', subjects.some((s) => s.startsWith('priya@example.com: Application submitted')) && subjects.some((s) => s.startsWith('acc@check.local')) && subjects.some((s) => s.startsWith('admin@check.local')), subjects);

r = await anon.call('POST', '/auth/login', { identifier: '9876543210', password: 'Strong@123' });
ok('franchise user can log in with mobile number', r.status === 200 && r.body.user.role === 'franchise_user', r.body);

// ---------- F1 / F2: own application ----------
r = await browserA.call('GET', '/franchise/application');
const app = r.body.application;
ok('My Application shows the submitted details', r.status === 200 && app.applicationId === `APP-${year}-0001` && app.current.firmName === 'Firm AAAAA1111A' && app.current.contacts.length === 1 && app.versions.join() === '1', app);
ok('agreement acceptance info shown (version and time)', app.agreement?.versionNumber === 1 && !!app.agreement.acceptedAt, app.agreement);
ok('history shows "Application submitted" by "You"', app.history.length === 1 && app.history[0].title === 'Application submitted' && app.history[0].by === 'You', app.history);
const docId = app.current.signatory.photo.id as string;
r = await browserA.call('GET', `/franchise/documents/${docId}`);
ok('own document opens (image/png)', r.status === 200 && r.type === 'image/png');
r = await browserA.call('GET', '/franchise/application/versions/1');
ok('version 1 can be viewed', r.status === 200 && r.body.submission.version === 1);
r = await browserA.call('GET', '/franchise/application/versions/2');
ok('missing version -> not found', r.status === 404);

// ---------- Second applicant: duplicate flag + isolation ----------
r = await register({ pan: 'BBBBB2222B', email: 'second@example.com', mobile: '9000000002', contactEmail: 'priya@example.com', contactMobile: '9000000003' });
ok('contact email used by application A -> warning first', r.status === 409 && r.body.error.code === 'duplicate_warning', r.body);
r = await register({ pan: 'BBBBB2222B', email: 'second@example.com', mobile: '9000000002', contactEmail: 'priya@example.com', contactMobile: '9000000003', acknowledge: true });
const tokenB = r.body.verificationToken as string;
for (const channel of ['email', 'sms'] as const) {
  await anon.call('POST', '/public/verification/send', { token: tokenB, channel });
  await anon.call('POST', '/public/verification/verify', { token: tokenB, channel, code: await latestCode(channel === 'email' ? 'second@example.com' : '9000000002') });
}
const browserB = new Browser();
r = await browserB.call('POST', '/public/verification/complete', { token: tokenB, password: 'Second@123', confirmPassword: 'Second@123' });
ok('second account created with the next Application ID', r.status === 201 && r.body.applicationId === `APP-${year}-0002`, r.body);
await new Promise((res) => setTimeout(res, 300));
ok('N3 "possible duplicate" email sent to Admin', !!(await outbox().findOne({ to: 'admin@check.local', event: 'duplicate_flag' })));
ok('flagged application has an open duplicate flag', (await Registration.findOne({ pan: 'BBBBB2222B' }))?.hasOpenDuplicateFlag === true);

r = await browserB.call('GET', `/franchise/documents/${docId}`);
ok("another franchise user cannot open applicant A's document", r.status === 404);
r = await browserB.call('GET', '/franchise/application');
ok('each franchise user sees only their own application', r.body.application?.applicationId === `APP-${year}-0002`);

const accounts = new Browser();
await accounts.call('POST', '/auth/login', { identifier: 'acc', password: 'Portal@2026' });
r = await accounts.call('GET', '/franchise/application');
ok('Accounts user refused from franchise screens', r.status === 403);
r = await new Browser().call('GET', '/franchise/application');
ok('logged-out visitor refused', r.status === 401);
r = await new Browser().call('GET', `/franchise/documents/${docId}`);
ok('logged-out visitor cannot open documents', r.status === 401);

// ---------- Same PAN verified by two people at once ----------
r = await register({ pan: 'CCCCC3333C', email: 'c1@example.com', mobile: '9000000011', contactEmail: 'c1x@example.com', contactMobile: '9000000012' });
const tokenC1 = r.body.verificationToken as string;
r = await register({ pan: 'CCCCC3333C', email: 'c2@example.com', mobile: '9000000021', contactEmail: 'c2x@example.com', contactMobile: '9000000022' });
const tokenC2 = r.body.verificationToken as string;
ok('two unverified attempts with the same PAN are both accepted at Register', !!tokenC1 && !!tokenC2);
for (const [token, email, mobile] of [[tokenC1, 'c1@example.com', '9000000011'], [tokenC2, 'c2@example.com', '9000000021']]) {
  for (const channel of ['email', 'sms'] as const) {
    await anon.call('POST', '/public/verification/send', { token, channel });
    await anon.call('POST', '/public/verification/verify', { token, channel, code: await latestCode(channel === 'email' ? email : mobile) });
  }
}
r = await new Browser().call('POST', '/public/verification/complete', { token: tokenC1, password: 'Strong@123', confirmPassword: 'Strong@123' });
ok('first to verify gets the PAN', r.status === 201, r.body);
r = await new Browser().call('POST', '/public/verification/complete', { token: tokenC2, password: 'Strong@123', confirmPassword: 'Strong@123' });
ok('second is blocked by the database PAN rule, and no account is created', r.status === 409 && r.body.error.code === 'duplicate_pan' && !(await User.exists({ email: 'c2@example.com' })), r.body);

// ---------- F4: profile ----------
r = await browserA.call('POST', '/franchise/profile/contact-change', { kind: 'email', value: 'priya.new@example.com', currentPassword: 'Strong@123' });
ok('email change blocked while the application is under review', r.status === 409 && r.body.error.code === 'under_review', r.body);
await mongoose.connection.db!.collection('registrations').updateOne({ _id: regA!._id }, { $set: { status: 'rejected_by_accounts' } });
r = await browserA.call('POST', '/franchise/profile/contact-change', { kind: 'email', value: 'priya.new@example.com', currentPassword: 'Wrong@123' });
ok('wrong current password refused', r.status === 400 && !!r.body.error.fields?.currentPassword, r.body);
r = await browserA.call('POST', '/franchise/profile/contact-change', { kind: 'email', value: 'second@example.com', currentPassword: 'Strong@123' });
ok("another account's email refused", r.status === 409, r.body);
r = await browserA.call('POST', '/franchise/profile/contact-change', { kind: 'email', value: 'Priya.New@example.com', currentPassword: 'Strong@123' });
ok('code sent to the NEW email', r.status === 200 && r.body.sentTo === 'pr***@example.com' && !!(await latestCode('priya.new@example.com')), r.body);
r = await browserA.call('POST', '/franchise/profile/contact-change/confirm', { kind: 'email', code: await latestCode('priya.new@example.com') });
ok('email changed after the code is confirmed', r.status === 200 && r.body.user.email === 'priya.new@example.com', r.body);
const regAfter = await Registration.findById(regA!._id);
ok('application signatory email updated too', regAfter?.signatory?.email === 'priya.new@example.com');
await new Promise((res) => setTimeout(res, 300));
ok('security notice emailed to the OLD address', !!(await outbox().findOne({ to: 'priya@example.com', event: 'email_changed' })));
r = await anon.call('POST', '/auth/login', { identifier: 'priya.new@example.com', password: 'Strong@123' });
ok('login works with the new email', r.status === 200);

r = await browserA.call('POST', '/franchise/profile/contact-change', { kind: 'mobile', value: '9000000002', currentPassword: 'Strong@123' });
ok("another account's mobile refused", r.status === 409, r.body);
r = await browserA.call('POST', '/franchise/profile/contact-change', { kind: 'mobile', value: '7000000077', currentPassword: 'Strong@123' });
r = await browserA.call('POST', '/franchise/profile/contact-change/confirm', { kind: 'mobile', code: await latestCode('7000000077') });
ok('mobile changed after SMS code', r.status === 200 && r.body.user.mobile === '7000000077', r.body);

// Changing to an email already used in another registration raises a duplicate flag.
ok('application A has no open duplicate flag yet', (await Registration.findById(regA!._id))?.hasOpenDuplicateFlag === false);
r = await browserA.call('POST', '/franchise/profile/contact-change', { kind: 'email', value: 'c1x@example.com', currentPassword: 'Strong@123' });
r = await browserA.call('POST', '/franchise/profile/contact-change/confirm', { kind: 'email', code: await latestCode('c1x@example.com') });
const flaggedA = await Registration.findById(regA!._id);
const flagA = await mongoose.connection.db!.collection('duplicateflags').findOne({ registrationId: regA!._id, status: 'open' });
ok('email changed to one used by another registration -> duplicate flag raised', r.status === 200 && flaggedA?.hasOpenDuplicateFlag === true && flagA?.matches?.[0]?.field === 'signatory.email', flagA);
await new Promise((res) => setTimeout(res, 300));
ok('Admin emailed about the new possible duplicate', (await outbox().countDocuments({ to: 'admin@check.local', event: 'duplicate_flag' })) >= 2);

// The change is refused if the application went under review in the meantime.
r = await browserA.call('POST', '/franchise/profile/contact-change', { kind: 'email', value: 'priya.final@example.com', currentPassword: 'Strong@123' });
await mongoose.connection.db!.collection('registrations').updateOne({ _id: regA!._id }, { $set: { status: 'pending_accounts' } });
r = await browserA.call('POST', '/franchise/profile/contact-change/confirm', { kind: 'email', code: await latestCode('priya.final@example.com') });
ok('change refused once the application is under review', r.status === 409 && (await User.findById(regA!.userId))?.email === 'c1x@example.com', r.body);
await mongoose.connection.db!.collection('registrations').updateOne({ _id: regA!._id }, { $set: { status: 'rejected_by_accounts' } });

r = await browserA.call('POST', '/auth/change-password', { currentPassword: 'Nope@1234', password: 'Newer@1234', confirmPassword: 'Newer@1234' });
ok('change password: wrong current password refused', r.status === 400, r.body);
const otherSession = new Browser();
await otherSession.call('POST', '/auth/login', { identifier: '7000000077', password: 'Strong@123' });
r = await browserA.call('POST', '/auth/change-password', { currentPassword: 'Strong@123', password: 'Newer@1234', confirmPassword: 'Newer@1234' });
ok('password changed', r.status === 200, r.body);
ok('this browser stays logged in', (await browserA.call('GET', '/franchise/application')).status === 200);
ok('other browsers are logged out', (await otherSession.call('GET', '/franchise/application')).status === 401);
ok('new password works', (await anon.call('POST', '/auth/login', { identifier: '7000000077', password: 'Newer@1234' })).status === 200);

// ---------- Two tabs refreshing the login at the same moment ----------
const tabOne = new Browser();
await tabOne.call('POST', '/auth/login', { identifier: '7000000077', password: 'Newer@1234' });
const tabTwo = new Browser();
tabTwo.cookies = new Map(tabOne.cookies);
const [ra, rb] = await Promise.all([tabOne.call('POST', '/auth/refresh'), tabTwo.call('POST', '/auth/refresh')]);
const statuses = [ra.status, rb.status].sort().join(',');
ok('parallel refresh: one renews, the other is told to retry (no forced logout)', statuses === '200,409', [ra.body, rb.body]);
const winner = ra.status === 200 ? tabOne : tabTwo;
ok('the renewed login still works afterwards', (await winner.call('GET', '/franchise/application')).status === 200);
ok('no "stolen token" alarm was raised', !(await mongoose.connection.db!.collection('auditlogs').findOne({ action: 'session_token_reuse' })));

// ---------- Lockout cannot be dodged with parallel wrong passwords ----------
await User.create({ name: 'Lock Test', email: 'lock@check.local', username: 'locktest', role: 'accounts', passwordHash: pw });
await Promise.all(Array.from({ length: 10 }, () => new Browser().call('POST', '/auth/login', { identifier: 'locktest', password: 'Wrong@0000' })));
r = await new Browser().call('POST', '/auth/login', { identifier: 'locktest', password: 'Portal@2026' });
ok('10 parallel wrong passwords lock the account', r.status === 423, r.body);

const actions = (await mongoose.connection.db!.collection('auditlogs').distinct('action')) as string[];
ok('audit log records verification, account creation and profile changes', ['registration_email_verified', 'registration_mobile_verified', 'registration_verified', 'franchise_account_created', 'email_changed', 'mobile_changed', 'password_changed'].every((a) => actions.includes(a)), actions);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
server.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
