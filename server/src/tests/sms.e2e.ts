// End-to-end test for SMS notifications through the Networkz Systems gateway. A local stand-in
// implements the documented API (signature check, send-sms, get-delivery-report, wallet balance)
// so the real request format is verified without sending real SMS. Run with: npm test.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

// ---------- Stand-in gateway, written to the documentation ----------
const TOKEN = 'TEST_ACCESS_TOKEN_abc123';
const KEY = 'TEST_ACCESS_TOKEN_KEY_xyz789';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const expectedSignature = (requestFor: string, service: string, expire: string) => md5(md5(TOKEN + md5(`${requestFor}${service}@rits-v1.0${expire}`)) + KEY);

interface Received {
  path: string;
  method: string;
  params: Record<string, string>;
}
const received: Received[] = [];
/** Replies to use for the next send-sms calls (default: success). */
const sendPlan: { status: number; message: string }[] = [];
const delivery = new Map<string, string>(); // submissionId -> DLR
let seq = 0;

const readBody = (req: IncomingMessage) => new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

const gateway = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  const params = Object.fromEntries(req.method === 'GET' ? url.searchParams : new URLSearchParams(await readBody(req)));
  received.push({ path: url.pathname, method: req.method!, params });
  const reply = (status: number, body: Record<string, unknown>) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ apiVersion: '1.0', service: 'SMS', httpStatusCode: status, ...body }));
  };
  const m = /^\/api\/(sms|account)\/v1\.0\/([a-z-]+)$/.exec(url.pathname);
  if (!m) return reply(404, { status: 'failed', message: 'Not found.' });
  const [, service, requestFor] = m;
  if (params.accessToken !== TOKEN || params.authSignature !== expectedSignature(requestFor, service, params.expire ?? '')) {
    return reply(401, { status: 'failed', message: 'Authorization failed.' });
  }
  if (Number(params.expire) < Date.now() / 1000) return reply(408, { status: 'failed', message: 'Request Expired.' });
  if (requestFor === 'send-sms') {
    for (const p of ['route', 'smsHeader', 'messageContent', 'recipients', 'entityId', 'templateId']) if (!params[p]) return reply(400, { status: 'failed', message: `${p} missing.` });
    const plan = sendPlan.shift();
    if (plan) return reply(plan.status, { status: 'failed', message: plan.message });
    seq++;
    const submissionId = `SUB${seq}`;
    delivery.set(submissionId, 'DELIVERED');
    return reply(200, { status: 'success', data: { submissionId, messageIds: [`M${seq}`], smsCount: 1, amountUsed: '0.18', duplicatesRemoved: 0 }, message: 'Sent.' });
  }
  if (requestFor === 'get-delivery-report') {
    const id = params.submissionId;
    return reply(200, { status: 'success', data: { reports: id && delivery.has(id) ? [{ submissionId: id, messageId: `M${id.slice(3)}`, phoneNumber: '91XXXXXXXXXX', DLR: delivery.get(id), statusCode: 'G0E000', statusDescription: 'Delivered' }] : [], hasNextPage: 0 }, message: 'Success.' });
  }
  if (requestFor === 'get-wallet-balance') return reply(200, { status: 'success', data: { currency: 'rupees', walletBalance: '426.56' }, message: 'Success.' });
  reply(405, { status: 'failed', message: 'Method not allowed.' });
});
await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', () => r()));

// ---------- Portal under test ----------
const storageDir = mkdtempSync(path.join(tmpdir(), 'fap-test-'));
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: rs.getUri('sms_test'),
  LOCAL_STORAGE_DIR: storageDir,
  SMS_PROVIDER: 'networkz',
  // Never use a real email account from server/.env in tests.
  EMAIL_PROVIDER: 'dev_outbox',
  NETWORKZ_SMS_BASE_URL: `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`,
  NETWORKZ_SMS_ACCESS_TOKEN: TOKEN,
  NETWORKZ_SMS_ACCESS_TOKEN_KEY: KEY,
  NETWORKZ_SMS_ENTITY_ID: '1701158157975781029',
  NETWORKZ_SMS_SENDER_ID: 'NETSYS',
  NETWORKZ_SMS_WEBHOOK_ID: 'WH1',
  NETWORKZ_SMS_WEBHOOK_SECRET: 'test-webhook-secret-123',
});
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const agreements = await import('../services/agreement.service');
const { hashPassword } = await import('../services/auth.service');
const { notifyApplicantBySms } = await import('../services/sms.service');
const { networkzSignature } = await import('../lib/networkz-sms');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
const { SmsLog } = await import('../models/SmsLog');
const { getSettings } = await import('../models/Settings');

await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
await runMigrations(mongoose.connection.db!);
await getSettings();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (label: string, cond: boolean, extra?: unknown) => {
  if (!cond) failures++;
  console.log(cond ? 'PASS' : 'FAIL', label, cond || extra === undefined ? '' : JSON.stringify(extra));
};

class Browser {
  cookies = new Map<string, string>();
  async call(method: string, url: string, body?: unknown, raw?: { data: Buffer; headers: Record<string, string> }, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { ...(raw?.headers ?? {}), ...extraHeaders };
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
    return { status: res.status, type, body: (type.includes('json') ? await res.json() : await res.text()) as any };
  }
}
const anon = new Browser();
const login = async (identifier: string) => {
  const b = new Browser();
  const r = await b.call('POST', '/auth/login', { identifier, password: 'Portal@2026' });
  if (r.status !== 200) throw new Error(`login ${identifier} failed`);
  return b;
};

// ---------- Signature (documented MD5 chain) ----------
ok('signature follows the documented MD5 chain', networkzSignature('send-sms', 'sms', 1724837770, TOKEN, KEY) === expectedSignature('send-sms', 'sms', '1724837770'));

// ---------- Setup ----------
const pw = await hashPassword('Portal@2026');
const admin = await User.create({ name: 'Admin', email: 'admin@check.local', username: 'admin', role: 'admin', passwordHash: pw });
await User.create({ name: 'Asha Accounts', email: 'asha@check.local', username: 'asha', role: 'accounts', passwordHash: pw });
await User.create({ name: 'Mira Manager', email: 'mira@check.local', username: 'mira', role: 'manager', passwordHash: pw });
const actor = { user: admin, ip: '127.0.0.1' } as never;
const pdfDoc = await PDFDocument.create();
pdfDoc.addPage().drawText('Franchise agreement terms', { x: 50, y: 700 });
const PDF = Buffer.from(await pdfDoc.save());
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const v1 = await agreements.createDraft({ title: 'Agreement', format: 'pdf', content: '' }, actor);
await agreements.uploadPdf(v1.id, PDF, 'a.pdf', actor);
await agreements.activateVersion(v1.id, actor);
const adminB = await login('admin');
const ashaB = await login('asha');
const miraB = await login('mira');

// ---------- Admin: permissions, status, templates ----------
for (const url of ['/admin/sms/status', '/admin/sms/settings', '/admin/sms/logs']) {
  ok(`${url}: Accounts refused, logged-out refused`, (await ashaB.call('GET', url)).status === 403 && (await anon.call('GET', url)).status === 401);
}
let r = await adminB.call('GET', '/admin/sms/status');
ok('status: Networkz configured, sender and entity shown, wallet balance read', r.body.status?.live === true && r.body.status.missing.length === 0 && r.body.status.senderId === 'NETSYS' && r.body.status.wallet?.balance === '426.56', r.body);
ok('status never contains the token or its key', !JSON.stringify(r.body).includes(TOKEN) && !JSON.stringify(r.body).includes(KEY));
r = await adminB.call('GET', '/admin/sms/settings');
ok('OTP template ID preset; other messages off until set up', r.body.settings.templates.otp.templateId === '1707161553278051772' && r.body.settings.templates.accounts_approved.enabled === false, r.body.settings);

const T = (n: number) => `17071615532780517${70 + n}`;
const templates = {
  otp: { enabled: true, templateId: '1707161553278051772', dltText: '{#var#} is your {#var#} verification code. Valid for {#var#} minutes.', format: '{otp} is your {organisation} verification code. Valid for {minutes} minutes.' },
  registration_submitted: { enabled: true, templateId: T(1), dltText: 'Dear {#var#}, your application {#var#} has been submitted.', format: 'Dear {name}, your application {applicationId} has been submitted.' },
  accounts_approved: { enabled: true, templateId: T(2), dltText: 'Application {#var#} approved by Accounts.', format: 'Application {applicationId} approved by Accounts.' },
  accounts_rejected: { enabled: true, templateId: T(3), dltText: 'Changes requested on application {#var#}.', format: 'Changes requested on application {applicationId}.' },
  manager_approved: { enabled: true, templateId: T(4), dltText: 'Application {#var#} approved. Ref {#var#}.', format: 'Application {applicationId} approved. Ref {referenceNo}.' },
  manager_rejected: { enabled: true, templateId: T(5), dltText: 'Manager requested changes on {#var#}.', format: 'Manager requested changes on {applicationId}.' },
  agreement_generated: { enabled: true, templateId: T(6), dltText: 'Agreement {#var#} generated for {#var#}.', format: 'Agreement {referenceNo} generated for {applicationId}.' },
};
r = await adminB.call('PUT', '/admin/sms/settings', { enabled: true, templates: { ...templates, accounts_approved: { ...templates.accounts_approved, format: 'Application {applicationId} has been approved by Accounts.' } } });
ok('a message format that differs from the DLT wording is refused', r.status === 400 && !!r.body.error.fields?.['templates.accounts_approved.format'], r.body);
r = await adminB.call('PUT', '/admin/sms/settings', { enabled: true, templates: { ...templates, manager_rejected: { ...templates.manager_rejected, format: 'Manager requested changes on {pan}.' } } });
ok('an unknown value in the format is refused', r.status === 400, r.body);
r = await adminB.call('PUT', '/admin/sms/settings', { enabled: true, templates: { ...templates, otp: { ...templates.otp, enabled: false } } });
ok('templates saved; the OTP cannot be switched off', r.status === 200 && r.body.settings.templates.otp.enabled === true, r.body);

// ---------- Registration: OTP and "registration successful" ----------
const up = async (b: Browser, url: string, kind: string, data: Buffer) =>
  (await b.call('PUT', `${url}/${kind}`, undefined, { data, headers: { 'Content-Type': 'application/octet-stream' } })).body.upload.token as string;
const sendsTo = (mobile: string) => received.filter((x) => x.path.endsWith('/send-sms') && x.params.recipients === mobile);

async function newApplicant(pan: string, mobile: string, email: string) {
  const body = {
    franchiseModel: 'Express',
    firmType: 'Partnership Firm',
    firmName: `Firm ${pan}`,
    pan,
    panFile: await up(anon, '/public/uploads', 'document', PDF),
    gst: null,
    signatory: { name: 'Priya Sharma', capacity: 'Partner', email, mobile, idProofFile: await up(anon, '/public/uploads', 'document', PNG), photoFile: await up(anon, '/public/uploads', 'photo', PNG) },
    contacts: [{ name: 'Ravi Kumar', email: `c.${email}`, mobile: `8${mobile.slice(1)}`, idProofFile: await up(anon, '/public/uploads', 'document', PNG), photoFile: await up(anon, '/public/uploads', 'photo', PNG) }],
    agreement: { agreementVersionId: v1.id, accepted: true },
    legalConsent: true,
    acknowledgeDuplicates: true,
  };
  const token = (await anon.call('POST', '/public/registrations', body)).body.verificationToken as string;
  for (const channel of ['email', 'sms'] as const) await anon.call('POST', '/public/verification/send', { token, channel });
  const emailCode = /(\d{6})/.exec(String((await mongoose.connection.db!.collection('dev_outbox').find({ to: email }).sort({ at: -1 }).limit(1).next())?.subject))?.[1];
  const smsCode = /^(\d{6})/.exec(sendsTo(mobile).at(-1)?.params.messageContent ?? '')?.[1];
  await anon.call('POST', '/public/verification/verify', { token, channel: 'email', code: emailCode });
  await anon.call('POST', '/public/verification/verify', { token, channel: 'sms', code: smsCode });
  const b = new Browser();
  await b.call('POST', '/public/verification/complete', { token, password: 'Strong@123', confirmPassword: 'Strong@123' });
  const reg = await Registration.findOne({ pan });
  return { browser: b, id: reg!._id.toString(), appId: reg!.applicationId!, smsCode };
}

const a = await newApplicant('AAAAA1111A', '9100000001', 'a@example.com');
const otpCall = sendsTo('9100000001')[0];
ok('OTP sent through send-sms with the documented DLT parameters', otpCall?.method === 'POST' && otpCall.params.route === 'transactional' && otpCall.params.smsHeader === 'NETSYS' && otpCall.params.entityId === '1701158157975781029' && otpCall.params.templateId === '1707161553278051772' && otpCall.params.contentType === 'text', otpCall?.params);
ok('OTP text matches the registered template exactly', /^\d{6} is your Your Organisation verification code\. Valid for 10 minutes\.$/.test(otpCall?.params.messageContent ?? ''), otpCall?.params.messageContent);
ok('the token key is never sent over the wire', received.every((x) => !Object.values(x.params).includes(KEY)));
ok('the SMS code verified the mobile and the account was created', !!a.appId);
await settle();
const submitted = sendsTo('9100000001').find((x) => x.params.templateId === T(1));
ok('"registration successful" SMS sent to the registered mobile', submitted?.params.messageContent === `Dear Priya Sharma, your application ${a.appId} has been submitted.`, submitted?.params);

// ---------- Accounts reject, resubmit, approve; Manager reject, resubmit, approve ----------
await ashaB.call('POST', `/accounts/applications/${a.id}/pick-up`);
await ashaB.call('POST', `/accounts/applications/${a.id}/reject`, { reason: 'Please correct the firm name on the form.' });
await settle();
ok('Accounts rejection SMS', sendsTo('9100000001').some((x) => x.params.templateId === T(3) && x.params.messageContent === `Changes requested on application ${a.appId}.`));

const resubmit = async () => {
  const f = (await a.browser.call('GET', '/franchise/application/resubmit-form')).body.form.submission;
  const keep = (d: { id: string }) => `keep:${d.id}`;
  return a.browser.call('POST', '/franchise/application/resubmit', {
    franchiseModel: f.franchiseModel, firmType: f.firmType, firmName: `${f.firmName} X`, pan: f.pan, panFile: keep(f.panDocument), gst: null,
    signatory: { name: f.signatory.name, capacity: f.signatory.capacity, email: 'x@example.com', mobile: '9999999999', idProofFile: keep(f.signatory.idProof), photoFile: keep(f.signatory.photo) },
    contacts: f.contacts.map((c: any) => ({ name: c.name, email: c.email, mobile: c.mobile, idProofFile: keep(c.idProof), photoFile: keep(c.photo) })),
    agreement: { agreementVersionId: v1.id, accepted: true }, legalConsent: true, acknowledgeDuplicates: true,
  });
};
r = await resubmit();
ok('resubmitted', r.status === 200, r.body);
await ashaB.call('POST', `/accounts/applications/${a.id}/approve`);
await settle();
ok('Accounts approval SMS', sendsTo('9100000001').some((x) => x.params.templateId === T(2) && x.params.messageContent === `Application ${a.appId} approved by Accounts.`));

await miraB.call('POST', `/manager/applications/${a.id}/reject`, { reason: 'Please correct the franchise model name.' });
await settle();
ok('Manager rejection SMS', sendsTo('9100000001').some((x) => x.params.templateId === T(5)));
await resubmit();
r = await miraB.call('POST', `/manager/applications/${a.id}/approve`);
const ref = r.body.referenceNumber as string;
await settle(800);
ok('Manager approval SMS with the reference number', sendsTo('9100000001').some((x) => x.params.templateId === T(4) && x.params.messageContent === `Application ${a.appId} approved. Ref ${ref}.`), sendsTo('9100000001').map((x) => x.params.messageContent));
ok('Agreement generated SMS', sendsTo('9100000001').some((x) => x.params.templateId === T(6) && x.params.messageContent === `Agreement ${ref} generated for ${a.appId}.`));

// ---------- No duplicates ----------
const before = received.length;
const regA = (await Registration.findById(a.id))!;
await Promise.all([
  notifyApplicantBySms('manager_approved', regA, { referenceNo: ref, dedupe: 'once' }),
  notifyApplicantBySms('manager_approved', regA, { referenceNo: ref, dedupe: 'once' }),
]);
ok('the same notification is never sent twice (even when triggered twice at once)', received.length === before && (await SmsLog.countDocuments({ registrationId: regA._id, event: 'manager_approved' })) === 1);

// ---------- Failures never block the workflow ----------
const b = await newApplicant('BBBBB2222B', '9200000001', 'b@example.com');
await ashaB.call('POST', `/accounts/applications/${b.id}/pick-up`);
sendPlan.push({ status: 402, message: 'Insufficient balance please recharge your wallet.' });
r = await ashaB.call('POST', `/accounts/applications/${b.id}/approve`);
await settle();
let log = await SmsLog.findOne({ registrationId: b.id, event: 'accounts_approved' });
ok('approval succeeds even when the SMS gateway refuses (402)', r.status === 200 && (await Registration.findById(b.id))?.status === 'pending_manager', r.body);
ok('the failure is logged with its reason and not retried', log?.status === 'failed' && log.attempts === 1 && log.httpStatus === 402 && /recharge/i.test(log.error ?? ''), log?.toObject());

sendPlan.push({ status: 500, message: 'Internal server error' }, { status: 500, message: 'Internal server error' }, { status: 500, message: 'Internal server error' });
r = await miraB.call('POST', `/manager/applications/${b.id}/reject`, { reason: 'Please re-upload a clearer ID proof.' });
await settle(4500);
log = await SmsLog.findOne({ registrationId: b.id, event: 'manager_rejected' });
ok('gateway errors (500) are retried 3 times, then logged as failed; the rejection stands', r.status === 200 && log?.status === 'failed' && log.attempts === 3, log?.toObject());

// ---------- Switching notifications off ----------
const c = await newApplicant('CCCCC3333C', '9300000001', 'c@example.com');
ok('OTP still sent while notifications are on', sendsTo('9300000001').some((x) => x.params.templateId === '1707161553278051772'));
await adminB.call('PUT', '/admin/sms/settings', { enabled: false, templates });
await ashaB.call('POST', `/accounts/applications/${c.id}/pick-up`);
const sendsBefore = received.length;
await ashaB.call('POST', `/accounts/applications/${c.id}/approve`);
await settle();
log = await SmsLog.findOne({ registrationId: c.id, event: 'accounts_approved' });
ok('with notifications off, the message is skipped (logged with the reason) and nothing is sent', received.length === sendsBefore && log?.status === 'skipped' && /switched off/.test(log.error ?? ''), log?.toObject());
const d = await newApplicant('DDDDD4444D', '9400000001', 'd@example.com');
ok('the OTP is still sent with notifications off', !!d.appId && sendsTo('9400000001').some((x) => x.params.templateId === '1707161553278051772'));
await adminB.call('PUT', '/admin/sms/settings', { enabled: true, templates });

// ---------- Test SMS, history, delivery status, webhook ----------
r = await adminB.call('POST', '/admin/sms/test', { mobile: '9876543210', event: 'manager_approved' });
ok('Admin test SMS uses the template with sample values', r.body.outcome?.ok === true && sendsTo('9876543210')[0]?.params.messageContent === 'Application APP-TEST-0001 approved. Ref FRN/TEST/0001.', r.body);
ok('test SMS refused for an invalid number', (await adminB.call('POST', '/admin/sms/test', { mobile: '12345', event: 'otp' })).status === 400);
r = await adminB.call('GET', '/admin/sms/logs?status=failed');
ok('error log lists the failed messages with their errors', r.body.total === 2 && r.body.items.every((i: any) => i.error), r.body);
r = await adminB.call('POST', '/admin/sms/logs/refresh-delivery');
ok('delivery status refreshed from get-delivery-report', r.status === 200 && r.body.updated > 0, r.body);
const delivered = await SmsLog.findOne({ registrationId: a.id, event: 'agreement_generated' });
ok('a sent message is now marked delivered', delivered?.delivery?.status === 'delivered', delivered?.toObject());

const target = await SmsLog.findOne({ registrationId: a.id, event: 'manager_approved' });
const hook = { webhookEvent: 'sms.v1_0.delivery-status-update', webhookID: 'WH1', data: { submissionId: target!.submissionId, messageId: target!.messageId, phoneNumber: '919100000001', deliveredFlag: 0, statusCode: 'G0E003', shortDescription: 'FAILED', description: 'UNKNOWN_SUBSCRIBER' }, timestamp: 1727944204 };
ok('webhook without the secret is refused', (await anon.call('POST', '/webhooks/networkz-sms', hook)).status === 401);
r = await anon.call('POST', '/webhooks/networkz-sms', hook, undefined, { 'X-Webhook-Secret': 'test-webhook-secret-123' });
const after = await SmsLog.findById(target!._id);
ok('webhook with the secret updates the delivery status', r.status === 200 && r.body.matched === true && after?.delivery?.status === 'failed' && after.delivery.description === 'UNKNOWN_SUBSCRIBER', after?.toObject());
ok('settings changes and tests are audited', !!(await mongoose.connection.db!.collection('auditlogs').findOne({ action: 'sms_settings_updated' })) && !!(await mongoose.connection.db!.collection('auditlogs').findOne({ action: 'sms_test_sent' })));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
server.close();
gateway.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
