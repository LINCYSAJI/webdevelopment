// End-to-end test for the legal / privacy features (DPDP Act 2023): Terms & Privacy consent,
// "Delete my account" requests, Admin erase / decline, and who may do what.
// Runs the real API on a throwaway in-memory database. Run with: npm test (from the repository root).
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
// Never use a real email account from server/.env in tests either.
process.env.EMAIL_PROVIDER = 'dev_outbox';
process.env.MONGODB_URI = rs.getUri('privacy_test');
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const agreements = await import('../services/agreement.service');
const { hashPassword } = await import('../services/auth.service');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
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
    return { status: res.status, type, body: (type.includes('json') ? await res.json() : await res.arrayBuffer()) as any };
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
await User.create({ name: 'Asha Accounts', email: 'asha@check.local', username: 'asha', role: 'accounts', passwordHash: pw });
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

async function latestCode(to: string) {
  const m = await outbox().find({ to: { $in: [to, `+91 ${to}`] } }).sort({ at: -1 }).limit(1).next();
  return /(\d{6})/.exec(String(m?.subject ?? '') + String(m?.text ?? ''))?.[1] ?? '';
}

async function body(o: { pan: string; email: string; mobile: string; contactEmail: string; contactMobile: string }, legalConsent: unknown = true) {
  return {
    franchiseModel: 'Express',
    firmType: 'Partnership Firm',
    firmName: `Firm ${o.pan}`,
    pan: o.pan,
    panFile: await up('document', PDF),
    gst: null,
    signatory: { name: 'Priya Sharma', capacity: 'Partner', email: o.email, mobile: o.mobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) },
    contacts: [{ name: 'Ravi Kumar', email: o.contactEmail, mobile: o.contactMobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) }],
    agreement: { agreementVersionId: v1.id, accepted: true },
    legalConsent,
    acknowledgeDuplicates: true,
  };
}

/** Registers, verifies both codes and creates the account: the application is then Pending Accounts. */
async function newApplicant(o: { pan: string; email: string; mobile: string; contactEmail: string; contactMobile: string }) {
  const token = (await anon.call('POST', '/public/registrations', await body(o))).body.verificationToken as string;
  for (const channel of ['email', 'sms'] as const) {
    await anon.call('POST', '/public/verification/send', { token, channel });
    await anon.call('POST', '/public/verification/verify', { token, channel, code: await latestCode(channel === 'email' ? o.email : o.mobile) });
  }
  const b = new Browser();
  await b.call('POST', '/public/verification/complete', { token, password: 'Strong@123', confirmPassword: 'Strong@123' });
  const reg = await Registration.findOne({ pan: o.pan });
  return { browser: b, id: reg!._id.toString() };
}

// ---------- Consent ----------
let r = await anon.call('POST', '/public/registrations', await body({ pan: 'ZZZZZ9999Z', email: 'z@example.com', mobile: '9300000001', contactEmail: 'zc@example.com', contactMobile: '9300000002' }, false));
ok('registration without Terms & Privacy consent is refused', r.status === 400 && !!r.body.error.fields?.legalConsent, r.body);
const { legalConsent: _omitted, ...withoutConsent } = await body({ pan: 'ZZZZZ9999Z', email: 'z@example.com', mobile: '9300000001', contactEmail: 'zc@example.com', contactMobile: '9300000002' });
r = await anon.call('POST', '/public/registrations', withoutConsent);
ok('registration with the consent field missing is refused', r.status === 400 && !!r.body.error.fields?.legalConsent, r.body);

const p = await newApplicant({ pan: 'AAAAA1111A', email: 'p@example.com', mobile: '9100000001', contactEmail: 'pc@example.com', contactMobile: '9100000002' });
const q = await newApplicant({ pan: 'BBBBB2222B', email: 'q@example.com', mobile: '9200000001', contactEmail: 'qc@example.com', contactMobile: '9200000002' });
const consent = await db.collection('consentrecords').findOne({ registrationId: new mongoose.Types.ObjectId(p.id) });
ok('consent record saved with both versions, the wording, time and IP', consent?.termsVersion === '1.0' && consent.privacyVersion === '1.0' && !!consent.text && !!consent.acceptedAt && !!consent.ip, consent);

r = await anon.call('GET', '/public/branding');
ok('branding includes the legal contact fields', 'grievanceOfficerEmail' in r.body.branding && 'registeredAddress' in r.body.branding, r.body);

const ashaB = await login('asha');
const adminB = await login('admin');

// ---------- Permissions ----------
ok('logged-out visitor cannot request deletion', (await anon.call('POST', '/franchise/profile/deletion-request', {})).status === 401);
ok('Accounts user cannot use the franchise deletion request', (await ashaB.call('GET', '/franchise/profile/deletion-request')).status === 403);
ok('franchise user cannot list deletion requests', (await p.browser.call('GET', '/admin/data-requests')).status === 403);
ok('Accounts user cannot list deletion requests', (await ashaB.call('GET', '/admin/data-requests')).status === 403);

// ---------- Request, cancel, request again ----------
r = await p.browser.call('GET', '/franchise/profile/deletion-request');
ok('no request yet, and erasure allowed for a pending application', r.status === 200 && r.body.request === null && r.body.eraseBlockedReason === null, r.body);
r = await p.browser.call('POST', '/franchise/profile/deletion-request', { currentPassword: 'Strong@123', reason: '', confirm: false });
ok('confirmation tick is required', r.status === 400 && !!r.body.error.fields?.confirm, r.body);
r = await p.browser.call('POST', '/franchise/profile/deletion-request', { currentPassword: 'Wrong@123', reason: '', confirm: true });
ok('wrong password refused', r.status === 400 && r.body.error.code === 'wrong_password', r.body);
r = await p.browser.call('POST', '/franchise/profile/deletion-request', { currentPassword: 'Strong@123', reason: 'Changed my mind', confirm: true });
ok('request accepted as Pending', r.status === 201 && r.body.request.status === 'pending', r.body);
r = await p.browser.call('POST', '/franchise/profile/deletion-request', { currentPassword: 'Strong@123', reason: '', confirm: true });
ok('only one pending request at a time', r.status === 409 && r.body.error.code === 'already_requested', r.body);
await settle();
ok('applicant emailed an acknowledgement', !!(await outbox().findOne({ to: 'p@example.com', event: 'data_request_received' })));
ok('Admin emailed about the new request', !!(await outbox().findOne({ to: 'admin@check.local', event: 'data_request_admin' })));
r = await p.browser.call('POST', '/franchise/profile/deletion-request/cancel');
ok('applicant can cancel a pending request', r.status === 200 && r.body.request.status === 'cancelled', r.body);
r = await p.browser.call('POST', '/franchise/profile/deletion-request/cancel');
ok('nothing left to cancel', r.status === 409);
r = await p.browser.call('POST', '/franchise/profile/deletion-request', { currentPassword: 'Strong@123', reason: 'Please delete my data', confirm: true });
ok('a new request can be made after cancelling', r.status === 201, r.body);

// ---------- Admin: list ----------
r = await adminB.call('GET', '/admin/data-requests?status=pending');
const pRow = r.body.items?.find((i: any) => i.userEmail === 'p@example.com');
ok('Admin sees the pending request with the applicant and application', r.body.total === 1 && pRow?.applicationId?.startsWith('APP-') && pRow.applicationStatus === 'pending_accounts' && pRow.eraseBlockedReason === null, r.body);
r = await adminB.call('GET', '/admin/data-requests?status=cancelled');
ok('cancelled requests listed separately', r.body.total === 1);

// ---------- Approved agreements cannot be erased ----------
await Registration.updateOne({ _id: q.id }, { $set: { status: 'approved' } });
r = await q.browser.call('GET', '/franchise/profile/deletion-request');
ok('applicant with an approved agreement is told it must be kept', typeof r.body.eraseBlockedReason === 'string', r.body);
r = await q.browser.call('POST', '/franchise/profile/deletion-request', { currentPassword: 'Strong@123', reason: '', confirm: true });
const qReq = r.body.request.id as string;
r = await adminB.call('POST', `/admin/data-requests/${qReq}/erase`);
ok('erasing an approved agreement is refused', r.status === 409 && r.body.error.code === 'retention_required', r.body);
r = await adminB.call('POST', `/admin/data-requests/${qReq}/decline`, { note: 'short' });
ok('decline needs a reason of 10+ characters', r.status === 400);
r = await adminB.call('POST', `/admin/data-requests/${qReq}/decline`, { note: 'Your approved agreement must be kept by law.' });
ok('Admin declines with a reason', r.status === 200 && r.body.request.status === 'declined', r.body);
await settle();
ok('applicant emailed the reason', !!(await outbox().findOne({ to: 'q@example.com', event: 'data_request_declined', html: /must be kept by law/ })));
r = await adminB.call('POST', `/admin/data-requests/${qReq}/erase`);
ok('a handled request cannot be erased afterwards', r.status === 409 && r.body.error.code === 'already_handled', r.body);

// ---------- Admin: erase ----------
const files = await db.collection('documents').find({ registrationId: new mongoose.Types.ObjectId(p.id) }).toArray();
ok('applicant files exist before erasure', files.length > 0 && files.every((f) => existsSync(path.join(storageDir, f.storageKey))));
const pReq = pRow.id as string;
const [e1, e2] = await Promise.all([adminB.call('POST', `/admin/data-requests/${pReq}/erase`), adminB.call('POST', `/admin/data-requests/${pReq}/erase`)]);
ok('two clicks at once: erased exactly once', [e1.status, e2.status].sort().join() === '200,409', [e1.body, e2.body]);

const reg = await Registration.findById(p.id);
ok('application withdrawn and details erased', reg?.status === 'withdrawn' && reg.firmName === '[erased]' && reg.pan === '[erased]' && reg.contacts.length === 0 && reg.signatory?.name === '[erased]' && !!reg.erasedAt, reg?.toObject());
ok('PAN lock released (can register again)', !reg?.panLock);
const snaps = await db.collection('submissionversions').find({ registrationId: reg!._id }).toArray();
ok('every submission snapshot erased', snaps.length > 0 && snaps.every((s) => s.data?.erased === true && !s.ip));
ok('uploaded files deleted from storage', files.every((f) => !existsSync(path.join(storageDir, f.storageKey))));
const docsAfter = await db.collection('documents').find({ registrationId: reg!._id }).toArray();
ok('document records marked erased', docsAfter.every((d) => d.fileName === '[erased]' && !!d.erasedAt));
const userAfter = await User.findById(reg!.userId);
ok('login closed and contact details removed', userAfter?.isActive === false && !userAfter.passwordHash && !userAfter.mobile && userAfter.email.endsWith('@erased.invalid'), userAfter?.toObject());
ok('applicant logged out everywhere', (await p.browser.call('GET', '/franchise/application')).status === 401);
r = await new Browser().call('POST', '/auth/login', { identifier: 'p@example.com', password: 'Strong@123' });
ok('cannot log in with the old email', r.status === 401, r.body);
ok('consent record kept as proof', !!(await db.collection('consentrecords').findOne({ registrationId: reg!._id })));
ok('erasure written to the audit log', !!(await db.collection('auditlogs').findOne({ action: 'data_erased', targetId: pReq })));
ok('history shows the withdrawal', !!(await db.collection('registrationhistories').findOne({ registrationId: reg!._id, event: 'withdrawn_erased' })));
await settle();
ok('final confirmation emailed to the former address', !!(await outbox().findOne({ to: 'p@example.com', event: 'data_erased' })));
ok('former email removed from the notification log', !(await db.collection('notificationlogs').findOne({ recipient: 'p@example.com' })));
r = await adminB.call('GET', '/admin/data-requests?status=completed');
ok('completed request still listed (without personal data)', r.body.total === 1 && r.body.items[0].applicationId === reg!.applicationId && r.body.items[0].applicationStatus === 'withdrawn', r.body);

const p2 = await newApplicant({ pan: 'AAAAA1111A', email: 'p@example.com', mobile: '9100000001', contactEmail: 'pc2@example.com', contactMobile: '9100000003' });
ok('the same person can register afresh with the same PAN, email and mobile', !!p2.id && p2.id !== p.id);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
server.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
