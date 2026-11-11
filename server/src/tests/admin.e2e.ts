// End-to-end test for the Admin tools and the remaining PRD §16 acceptance items: editable email
// templates (§11, §14), agreement content management (AD7), older accepted versions, internal users
// and public sign-up roles, Settings taking effect (reminder intervals), holidays, forgot password
// and the audit log (AD10). Runs on a throwaway in-memory database. Run with: npm test.
import { mkdtempSync, rmSync } from 'node:fs';
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
// Never use a real email account from server/.env in tests either.
process.env.EMAIL_PROVIDER = 'dev_outbox';
process.env.MONGODB_URI = rs.getUri('admin_test');
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const { hashPassword } = await import('../services/auth.service');
const { runDailyCheck } = await import('../services/scheduler.service');
const { defaultAgreementEmailText } = await import('../services/email-templates');
const { EMAIL_TEMPLATES, fillEmailTemplate } = await import('@fap/shared');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
const { AuditLog } = await import('../models/AuditLog');
const { getSettings } = await import('../models/Settings');

await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
await runMigrations(mongoose.connection.db!);
await getSettings();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const db = mongoose.connection.db!;
const outbox = () => db.collection('dev_outbox');
const settle = () => new Promise((r) => setTimeout(r, 300));

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
    const payload = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, type, body: payload as any };
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
await User.create({ name: 'Admin', email: 'admin@check.local', username: 'admin', role: 'admin', passwordHash: pw });
await User.create({ name: 'Asha Accounts', email: 'asha@check.local', username: 'asha', role: 'accounts', passwordHash: pw });
await User.create({ name: 'Mira Manager', email: 'mira@check.local', username: 'mira', role: 'manager', passwordHash: pw });
const adminB = await login('admin');
const ashaB = await login('asha');
let miraB = await login('mira');

async function pdf(text: string) {
  const d = await PDFDocument.create();
  d.addPage().drawText(text, { x: 50, y: 700 });
  return Buffer.from(await d.save({ useObjectStreams: false }));
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const uploadPdf = (b: Browser, id: string, data: Buffer, name = 'agreement.pdf') =>
  b.call('PUT', `/admin/agreements/${id}/pdf`, undefined, { data, headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(name) } });

// ---------- AD7: Agreement content ----------
let r = await anon.call('GET', '/public/registration-form');
ok('registration is closed while no agreement is active', r.body.open === false || r.body.agreement === null || r.body.closed === true, r.body);

r = await adminB.call('POST', '/admin/agreements', { title: 'Franchise Agreement 2026', format: 'pdf', content: '' });
const v1 = r.body.version;
ok('Admin creates a PDF draft', r.status === 201 && v1.status === 'draft', r.body);
r = await uploadPdf(adminB, v1.id, PNG, 'photo.pdf');
ok('a non-PDF file is refused (content checked, not the name)', r.status === 400 && r.body.error.code === 'not_pdf', r.body);
const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(11 * 1024 * 1024)]);
r = await uploadPdf(adminB, v1.id, big);
ok('a PDF over 10 MB is refused', r.status === 413, [r.status, r.body.error?.code]);
const plain = await pdf('Agreement version 1');
const encrypted = Buffer.from(plain.toString('latin1').replace(/trailer\s*<</, 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>'), 'latin1');
r = await uploadPdf(adminB, v1.id, encrypted);
ok('a password-protected PDF is refused', r.status === 400 && /password-protected/.test(r.body.error.message), r.body);
r = await uploadPdf(adminB, v1.id, await pdf('First draft'));
ok('a valid PDF is uploaded to the draft', r.status === 200 && r.body.version.pdf?.pageCount === 1, r.body);
r = await uploadPdf(adminB, v1.id, plain);
ok('the draft PDF can be replaced', r.status === 200 && !!(await AuditLog.exists({ action: 'agreement_pdf_replaced', targetId: v1.id })), r.body);
r = await adminB.call('GET', `/admin/agreements/${v1.id}/pdf`);
ok('Admin can preview the uploaded PDF', r.status === 200 && r.type === 'application/pdf' && Buffer.compare(r.body, plain) === 0);
for (const [who, b] of [['Accounts', ashaB], ['Manager', miraB], ['logged-out', anon]] as const) {
  const x = await b.call('POST', '/admin/agreements', { title: 'Hack', format: 'pdf', content: '' });
  ok(`${who} cannot create agreement versions`, x.status === 401 || x.status === 403, x.status);
}
r = await adminB.call('POST', `/admin/agreements/${v1.id}/activate`);
ok('publishing makes it the active version', r.status === 200 && r.body.version.status === 'active', r.body);
r = await anon.call('GET', '/public/registration-form');
ok('registration opens once a version is published', r.status === 200 && JSON.stringify(r.body).includes(v1.id), r.body);
r = await uploadPdf(adminB, v1.id, await pdf('Sneaky change'));
ok('a published version cannot be replaced', r.status === 409, r.body);
r = await adminB.call('PUT', `/admin/agreements/${v1.id}`, { title: 'Changed', format: 'pdf', content: '' });
ok('a published version cannot be edited', r.status === 409, r.body);

// ---------- An applicant accepts version 1 ----------
const up = async (kind: string, data: Buffer) =>
  (await anon.call('PUT', `/public/uploads/${kind}`, undefined, { data, headers: { 'Content-Type': 'application/octet-stream' } })).body.upload.token as string;
async function latestCode(to: string) {
  const m = await outbox().find({ to: { $in: [to, `+91 ${to}`] } }).sort({ at: -1 }).limit(1).next();
  return /(\d{6})/.exec(String(m?.subject ?? '') + String(m?.text ?? ''))?.[1] ?? '';
}
async function newApplicant(o: { pan: string; firm: string; email: string; mobile: string; agreementVersionId: string; extra?: Record<string, unknown> }) {
  const body = {
    franchiseModel: 'Express',
    firmType: 'Partnership Firm',
    firmName: o.firm,
    pan: o.pan,
    panFile: await up('document', plain),
    gst: null,
    signatory: { name: 'Priya Sharma', capacity: 'Partner', email: o.email, mobile: o.mobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG), role: 'admin' },
    contacts: [{ name: 'Ravi Kumar', email: `c-${o.email}`, mobile: `7${o.mobile.slice(1)}`, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) }],
    agreement: { agreementVersionId: o.agreementVersionId, accepted: true },
    legalConsent: true,
    acknowledgeDuplicates: true,
    ...o.extra,
  };
  const submitted = await anon.call('POST', '/public/registrations', body);
  if (submitted.status !== 201) throw new Error(`register failed: ${JSON.stringify(submitted.body)}`);
  const token = submitted.body.verificationToken as string;
  for (const channel of ['email', 'sms'] as const) {
    await anon.call('POST', '/public/verification/send', { token, channel });
    await anon.call('POST', '/public/verification/verify', { token, channel, code: await latestCode(channel === 'email' ? o.email : o.mobile) });
  }
  const b = new Browser();
  const done = await b.call('POST', '/public/verification/complete', { token, password: 'Strong@123', confirmPassword: 'Strong@123', role: 'admin' });
  if (done.status !== 200 && done.status !== 201) throw new Error(`complete failed: ${JSON.stringify(done.body)}`);
  const reg = await Registration.findOne({ pan: o.pan });
  return { browser: b, reg: reg! };
}

// ---------- Email templates: Admin edits N2 before the applicant registers ----------
r = await adminB.call('GET', '/admin/email-templates');
const codes = new Set((r.body.templates as { code: string }[]).flatMap((t) => t.code.split(' / ')));
ok('every notification N1–N15 has an editable template', ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10', 'N11', 'N12', 'N13', 'N14', 'N15'].every((c) => codes.has(c)), [...codes]);
ok('templates start with the default wording', r.body.templates.every((t: any) => !t.customised && t.subject === t.defaultSubject));
for (const [who, b] of [['Accounts', ashaB], ['Manager', miraB], ['logged-out', anon]] as const) {
  const [g, p] = await Promise.all([b.call('GET', '/admin/email-templates'), b.call('PUT', '/admin/email-templates/application_submitted', { subject: 'x x x', body: 'Hacked text here' })]);
  ok(`${who} cannot read or change email templates`, [g.status, p.status].every((s) => s === 401 || s === 403), [g.status, p.status]);
}
r = await adminB.call('PUT', '/admin/email-templates/application_submitted', { subject: 'Welcome {{bogus_field}}', body: 'Hello {{recipient_name}}, your id is {{application_id}}.' });
ok('an unknown merge field is refused', r.status === 400 && /bogus_field/.test(r.body.error.fields?.subject ?? ''), r.body);
r = await adminB.call('PUT', '/admin/email-templates/otp_registration', { subject: 'Your verification code', body: 'Please verify your email address now.' });
ok('removing the code from the OTP email is refused', r.status === 400 && /code/.test(r.body.error.fields?.body ?? ''), r.body);
const custom = {
  subject: 'Welcome aboard, {{firm_name}} – {{application_id}}',
  body: 'Dear {{recipient_name}},\n\nWe have your application {{application_id}} for {{firm_name}}. <b>Thanks</b>!\n\nTeam {{organisation_name}}',
};
r = await adminB.call('POST', '/admin/email-templates/application_submitted/preview', custom);
ok('preview fills example values', r.status === 200 && r.body.preview.subject === 'Welcome aboard, Sunrise Retail Pvt Ltd – APP-2026-0001', r.body);
ok('preview shows typed HTML as text (cannot inject markup)', r.body.preview.html.includes('&lt;b&gt;Thanks&lt;/b&gt;') && !r.body.preview.html.includes('<b>Thanks'));
r = await adminB.call('PUT', '/admin/email-templates/application_submitted', custom);
ok('Admin saves new wording', r.status === 200 && r.body.template.customised === true && r.body.template.updatedBy === 'Admin', r.body);

const a = await newApplicant({ pan: 'AAAAA1111A', firm: 'Alpha Traders', email: 'a@example.com', mobile: '9100000001', agreementVersionId: v1.id });
await settle();
const n2 = await outbox().findOne({ to: 'a@example.com', subject: /^Welcome aboard/ });
ok('the next N2 email uses the edited wording', n2?.subject === `Welcome aboard, Alpha Traders – ${a.reg.applicationId}` && /We have your application/.test(n2.text), n2?.subject);
ok('the button and link are still added', /View my application: http/.test(n2?.text ?? ''));
const staffN2 = await outbox().findOne({ to: 'asha@check.local', subject: /New application waiting for verification/ });
ok('other emails keep their default wording', !!staffN2);

ok('public sign-up creates only a franchise user, whatever the request says', (await User.findById(a.reg.userId))?.role === 'franchise_user');
ok('no staff account was created by sign-up', (await User.countDocuments({ role: { $in: ['admin', 'accounts', 'manager'] } })) === 3);

r = await adminB.call('DELETE', '/admin/email-templates/application_submitted');
ok('Reset brings back the default wording', r.status === 200 && r.body.template.customised === false && r.body.template.subject === 'Application submitted: {{application_id}}', r.body);
ok('template changes and resets are audited', !!(await AuditLog.exists({ action: 'email_template_updated', targetId: 'application_submitted' })) && !!(await AuditLog.exists({ action: 'email_template_reset' })));

const note = fillEmailTemplate('s', 'Assigned.\n\nNote from Admin: {{admin_note}}', { admin_note: '' });
ok('an empty optional field leaves its paragraph out', note.paragraphs.join('|') === 'Assigned.', note);
await adminB.call('PUT', '/admin/email-templates/agreement_email', { subject: 'Agreement {{agreement_reference_no}} for {{firm_name}}', body: 'Hi {{signatory_name}},\n\nAttached is {{agreement_reference_no}}.' });
const draft = await defaultAgreementEmailText('Priya', 'FRN/2026/0009', 'Org', 'APP-2026-0009', 'Alpha Traders');
ok("the Manager's Send dialog uses the edited N11 wording", draft.subject === 'Agreement FRN/2026/0009 for Alpha Traders' && draft.message === 'Hi Priya,\n\nAttached is FRN/2026/0009.', draft);
ok('the catalogue has no duplicate keys', new Set(EMAIL_TEMPLATES.map((t) => t.key)).size === EMAIL_TEMPLATES.length);

// ---------- A new agreement version never changes what was accepted ----------
r = await adminB.call('POST', `/admin/agreements/${v1.id}/duplicate`);
const v2 = r.body.version;
await uploadPdf(adminB, v2.id, await pdf('Agreement version 2'));
r = await adminB.call('POST', `/admin/agreements/${v2.id}/activate`);
ok('version 2 published; version 1 is no longer active', r.status === 200 && (await adminB.call('GET', `/admin/agreements/${v1.id}`)).body.version.status === 'inactive');
r = await a.browser.call('GET', '/franchise/agreement/pdf');
ok('the applicant still gets the version 1 PDF they accepted', r.status === 200 && Buffer.compare(r.body, plain) === 0);
r = await a.browser.call('GET', '/franchise/application');
ok('their application still shows version 1', JSON.stringify(r.body).includes('"versionNumber":1'), r.body.application?.agreement);
r = await anon.call('GET', `/public/agreements/${v1.id}/pdf`);
ok('the old version is no longer offered to new applicants', r.status === 404 || r.status === 410, r.status);
const b2 = await newApplicant({ pan: 'BBBBB2222B', firm: 'Beta Foods', email: 'b@example.com', mobile: '9200000001', agreementVersionId: v2.id });
ok('a new applicant accepts version 2', String(b2.reg.agreementVersionId) === v2.id);
r = await adminB.call('POST', `/admin/agreements/${v2.id}/deactivate`);
ok('deactivating closes registration', r.status === 200 && (await anon.call('PUT', '/public/uploads/document', undefined, { data: plain, headers: { 'Content-Type': 'application/octet-stream' } })).status !== 200);
await adminB.call('POST', `/admin/agreements/${v2.id}/activate`);

// ---------- Internal users (AD8, AD9, N15) ----------
r = await adminB.call('POST', '/admin/users/accounts', { name: 'Kiran Accounts', email: 'Kiran@Check.local', username: 'kiran', mobile: '' });
ok('Admin creates an Accounts user (email stored lowercase)', r.status === 201 && r.body.user.email === 'kiran@check.local' && r.body.user.role === 'accounts', r.body);
await settle();
const invite = await outbox().findOne({ to: 'kiran@check.local' });
ok('N15: the new user is emailed a set-password link', /Set your password/.test(invite?.subject ?? '') && /reset-password|set-password|password/.test(invite?.text ?? ''), invite?.subject);
r = await adminB.call('POST', '/admin/users/accounts', { name: 'Clash', email: 'kiran@check.local', username: 'kiran2', mobile: '' });
ok('a second account with the same email is refused', r.status === 409 || r.status === 400, r.body);
r = await adminB.call('POST', '/admin/users/admin', { name: 'Sneaky', email: 'sneaky@check.local', username: 'sneaky', mobile: '' });
ok('only Accounts and Manager users are managed here', r.status === 404 && !(await User.exists({ username: 'sneaky' })), r.status);
for (const [who, b] of [['Accounts', ashaB], ['Manager', miraB], ['franchise user', a.browser]] as const) {
  const x = await b.call('POST', '/admin/users/accounts', { name: 'Evil', email: `evil-${who.length}@x.local`, username: `evil${who.length}`, mobile: '' });
  ok(`${who} cannot create staff users`, x.status === 403, x.status);
}

// ---------- Forgot password (P6) ----------
r = await anon.call('POST', '/auth/forgot-password', { identifier: 'mira@check.local' });
await settle();
const reset = await outbox().findOne({ to: 'mira@check.local', subject: /Reset your/ });
const token = /token=([A-Za-z0-9_-]+)/.exec(reset?.text ?? '')?.[1] ?? /reset-password\/([A-Za-z0-9_-]+)/.exec(reset?.text ?? '')?.[1] ?? '';
ok('forgot password emails a reset link', r.status === 200 && !!token, reset?.text);
r = await anon.call('POST', '/auth/forgot-password', { identifier: 'nobody@nowhere.local' });
ok('an unknown address gets the same answer (no account probing)', r.status === 200);
r = await anon.call('POST', '/auth/set-password', { token, password: 'NewPass@2026', confirmPassword: 'NewPass@2026' });
ok('the link sets a new password', r.status === 200, r.body);
miraB = await login('mira', 'NewPass@2026');
ok('the new password works', miraB.cookies.size > 0);
r = await anon.call('POST', '/auth/set-password', { token, password: 'Other@2026x', confirmPassword: 'Other@2026x' });
ok('the link works only once', r.status >= 400, r.status);

// ---------- Settings take effect (AD11) ----------
r = await adminB.call('GET', '/admin/settings');
// The Settings form sends empty text for blank optional fields.
const settings = Object.fromEntries(Object.entries(r.body.settings).map(([k, v]) => [k, v === null && k !== 'logoUrl' ? '' : v]));
await Registration.updateOne({ _id: b2.reg._id }, { $set: { stageEnteredAt: new Date(Date.now() - 4 * 86_400_000) } });
const monday = new Date('2026-11-16T09:00:00+05:30');
const entered = new Date('2026-11-12T11:00:00+05:30'); // Thursday: 2 business days before Monday
await Registration.updateMany({ _id: { $in: [a.reg._id, b2.reg._id] } }, { $set: { stageEnteredAt: entered } });
let run = await runDailyCheck({ now: monday, trigger: 'admin', actor: { user: (await User.findOne({ username: 'admin' }))!, ip: '127.0.0.1' } as never });
ok('with the default 2 business days: no reminder yet after 2', run?.summary?.reminders === 0, run?.summary);
r = await adminB.call('PUT', '/admin/settings', { ...settings, reminderFirstAfterDays: 1, reminderRepeatEveryDays: 1, escalationAfterDays: 1 });
ok('Admin changes the reminder intervals', r.status === 200 && r.body.settings.reminderFirstAfterDays === 1, r.body);
run = await runDailyCheck({ now: monday, trigger: 'admin', actor: { user: (await User.findOne({ username: 'admin' }))!, ip: '127.0.0.1' } as never });
ok('the new intervals take effect: reminders and Admin alerts after 1 business day', run?.summary?.reminders === 2 && run.summary.escalations === 2, run?.summary);
r = await adminB.call('PUT', '/admin/settings', { ...settings, reminderFirstAfterDays: 5, escalationAfterDays: 2 });
ok('escalation before the first reminder is refused', r.status === 400, r.body);
r = await ashaB.call('PUT', '/admin/settings', { ...settings });
ok('Accounts cannot change Settings', r.status === 403);
r = await adminB.call('POST', '/admin/holidays', { date: '2026-12-25', name: 'Christmas' });
ok('Admin adds a public holiday', r.status === 201, r.body);
r = await adminB.call('DELETE', `/admin/holidays/${r.body.holiday.id}`);
ok('and removes it', r.status === 200 || r.status === 204, r.status);

// ---------- Email delivery: status and test email (Admin only) ----------
r = await adminB.call('GET', '/admin/email/status');
ok('Admin sees the email service status', r.status === 200 && r.body.status.provider === 'dev_outbox' && r.body.status.connection.ok === true, r.body);
ok('the status never contains a password', !/password/i.test(JSON.stringify(r.body)));
r = await adminB.call('POST', '/admin/email/test', { to: 'Owner@Example.com' });
await settle();
const testMail = await outbox().findOne({ to: 'owner@example.com', subject: 'Test email from the Franchise Agreement Portal' });
ok('Admin sends a branded test email', r.status === 200 && r.body.sent === true && !!testMail && /email delivery is working/.test(testMail.text) && /Franchise Agreement Portal/.test(testMail.html), r.body);
ok('the test email is audited', !!(await AuditLog.exists({ action: 'email_test_sent' })));
r = await adminB.call('POST', '/admin/email/test', { to: 'not-an-email' });
ok('a test email to an invalid address is refused', r.status === 400, r.status);
for (const [who, b] of [['Accounts', ashaB], ['Manager', miraB], ['franchise user', a.browser], ['logged-out', anon]] as const) {
  const [x, y] = await Promise.all([b.call('GET', '/admin/email/status'), b.call('POST', '/admin/email/test', { to: 'x@example.com' })]);
  ok(`${who} cannot see email settings or send test emails`, [x.status, y.status].every((st) => st === 401 || st === 403), [x.status, y.status]);
}

// Verification codes never appear in the server log.
const logged: string[] = [];
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  logged.push(args.map(String).join(' '));
};
const reg3 = await anon.call('POST', '/public/registrations', {
  franchiseModel: 'Express', firmType: 'Partnership Firm', firmName: 'Gamma Stores', pan: 'GGGGG3333G', panFile: await up('document', plain), gst: null,
  signatory: { name: 'Gita', capacity: 'Partner', email: 'g@example.com', mobile: '9300000001', idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) },
  contacts: [{ name: 'Ravi', email: 'gc@example.com', mobile: '7300000001', idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) }],
  agreement: { agreementVersionId: v2.id, accepted: true }, legalConsent: true, acknowledgeDuplicates: true,
});
for (const channel of ['email', 'sms'] as const) await anon.call('POST', '/public/verification/send', { token: reg3.body.verificationToken, channel });
await settle();
console.log = originalLog;
const sentCodes = [await latestCode('g@example.com'), await latestCode('9300000001')];
ok('verification codes were sent', sentCodes.every((c) => /^\d{6}$/.test(c)), sentCodes);
ok('the codes never appear in the server log', sentCodes.every((c) => !logged.some((l) => l.includes(c))), logged.filter((l) => sentCodes.some((c) => l.includes(c))));

// ---------- AD10: the audit log ----------
await anon.call('POST', '/auth/login', { identifier: 'asha', password: 'wrong-password' });
r = await adminB.call('GET', '/admin/audit-logs/actions');
const actions: string[] = r.body.actions ?? r.body;
const needed = ['login', 'login_failed', 'registration_submitted', 'franchise_account_created', 'agreement_published', 'agreement_activated', 'agreement_deactivated', 'agreement_pdf_uploaded', 'user_created', 'settings_updated', 'holiday_added', 'holiday_removed', 'email_template_updated', 'password_reset', 'daily_check_run'];
const missing = needed.filter((x) => !actions.includes(x));
ok('the audit log records logins, failed logins, registrations, agreement changes, users, settings', missing.length === 0, missing);
r = await adminB.call('GET', '/admin/audit-logs?page=1&pageSize=5&action=login_failed');
ok('the audit log can be filtered, with user, role, IP and time', r.status === 200 && r.body.items?.length >= 1 && 'ip' in r.body.items[0] && 'at' in r.body.items[0], r.body.items?.[0]);
for (const [who, b] of [['Accounts', ashaB], ['Manager', miraB], ['franchise user', a.browser]] as const) {
  ok(`${who} cannot read the audit log`, (await b.call('GET', '/admin/audit-logs')).status === 403);
}
ok('audit rows cannot be changed or deleted', await AuditLog.deleteMany({}).then(() => false, () => true));

server.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
