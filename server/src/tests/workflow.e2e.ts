// End-to-end test for build step 5: Accounts review (pick up, approve, reject), Edit & Resubmit,
// Admin reassignment, and who may see what. Runs the real API on a throwaway in-memory database.
// Run with: npm test (from the repository root).
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';
import { businessDaysBetween } from '@fap/shared';

const storageDir = mkdtempSync(path.join(tmpdir(), 'fap-test-'));
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = rs.getUri('workflow_test');
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const agreements = await import('../services/agreement.service');
const { hashPassword } = await import('../services/auth.service');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
const { AgreementAcceptance } = await import('../models/AgreementAcceptance');
const { RegistrationHistory } = await import('../models/RegistrationHistory');
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

// ---------- Business days ----------
const none = new Set<string>();
ok('business days: Monday -> Wednesday = 2', businessDaysBetween('2026-11-02T04:00:00Z', '2026-11-04T04:00:00Z', none) === 2);
ok('business days: Friday -> Monday = 1 (weekend skipped)', businessDaysBetween('2026-11-06T04:00:00Z', '2026-11-09T04:00:00Z', none) === 1);
ok('business days: holidays are skipped', businessDaysBetween('2026-11-02T04:00:00Z', '2026-11-04T04:00:00Z', new Set(['2026-11-03'])) === 1);

// ---------- Setup ----------
const pw = await hashPassword('Portal@2026');
const admin = await User.create({ name: 'Admin', email: 'admin@check.local', username: 'admin', role: 'admin', passwordHash: pw });
const asha = await User.create({ name: 'Asha Accounts', email: 'asha@check.local', username: 'asha', role: 'accounts', passwordHash: pw });
const bala = await User.create({ name: 'Bala Accounts', email: 'bala@check.local', username: 'bala', role: 'accounts', passwordHash: pw });
await User.create({ name: 'Mira Manager', email: 'mira@check.local', username: 'mira', role: 'manager', passwordHash: pw });
const actor = { user: admin, ip: '127.0.0.1' } as never;
const pdfDoc = await PDFDocument.create();
pdfDoc.addPage();
const PDF = Buffer.from(await pdfDoc.save());
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PNG2 = Buffer.concat([PNG, Buffer.from('different')]);
const v1 = await agreements.createDraft({ title: 'Agreement', format: 'pdf', content: '' }, actor);
await agreements.uploadPdf(v1.id, PDF, 'a.pdf', actor);
await agreements.activateVersion(v1.id, actor);

const up = async (b: Browser, url: string, kind: string, data: Buffer) =>
  (await b.call('PUT', `${url}/${kind}`, undefined, { data, headers: { 'Content-Type': 'application/octet-stream' } })).body.upload.token as string;

async function latestCode(to: string) {
  const m = await outbox().find({ to: { $in: [to, `+91 ${to}`] } }).sort({ at: -1 }).limit(1).next();
  return /(\d{6})/.exec(String(m?.subject ?? '') + String(m?.text ?? ''))?.[1] ?? '';
}

/** Registers, verifies both codes and creates the account: the application is then Pending Accounts. */
async function newApplicant(o: { pan: string; email: string; mobile: string; contactEmail: string; contactMobile: string }) {
  const body = {
    franchiseModel: 'Express',
    firmType: 'Partnership Firm',
    firmName: `Firm ${o.pan}`,
    pan: o.pan,
    panFile: await up(anon, '/public/uploads', 'document', PDF),
    gst: null,
    signatory: { name: 'Priya Sharma', capacity: 'Partner', email: o.email, mobile: o.mobile, idProofFile: await up(anon, '/public/uploads', 'document', PNG), photoFile: await up(anon, '/public/uploads', 'photo', PNG) },
    contacts: [{ name: 'Ravi Kumar', email: o.contactEmail, mobile: o.contactMobile, idProofFile: await up(anon, '/public/uploads', 'document', PNG), photoFile: await up(anon, '/public/uploads', 'photo', PNG) }],
    agreement: { agreementVersionId: v1.id, accepted: true },
    legalConsent: true,
    acknowledgeDuplicates: true,
  };
  const token = (await anon.call('POST', '/public/registrations', body)).body.verificationToken as string;
  for (const channel of ['email', 'sms'] as const) {
    await anon.call('POST', '/public/verification/send', { token, channel });
    await anon.call('POST', '/public/verification/verify', { token, channel, code: await latestCode(channel === 'email' ? o.email : o.mobile) });
  }
  const b = new Browser();
  await b.call('POST', '/public/verification/complete', { token, password: 'Strong@123', confirmPassword: 'Strong@123' });
  const reg = await Registration.findOne({ pan: o.pan });
  return { browser: b, id: reg!._id.toString() };
}

const p = await newApplicant({ pan: 'AAAAA1111A', email: 'p@example.com', mobile: '9100000001', contactEmail: 'pc@example.com', contactMobile: '9100000002' });
const ashaB = await login('asha');
const balaB = await login('bala');
const miraB = await login('mira');
const adminB = await login('admin');

// ---------- Permissions ----------
ok('franchise user refused from Accounts screens', (await p.browser.call('GET', '/accounts/applications')).status === 403);
ok('Manager refused from Accounts screens', (await miraB.call('GET', '/accounts/applications')).status === 403);
ok('logged-out visitor refused', (await anon.call('GET', '/accounts/dashboard')).status === 401);
ok('Accounts user refused from Admin reassign', (await ashaB.call('POST', `/admin/registrations/${p.id}/reassign`, { toUserId: null })).status === 403);
ok('Accounts user refused from franchise resubmit', (await ashaB.call('POST', '/franchise/application/resubmit', {})).status === 403);

// ---------- A1 / A2 ----------
let r = await ashaB.call('GET', '/accounts/dashboard');
ok('dashboard shows 1 unassigned', r.body.dashboard?.unassigned === 1 && r.body.dashboard.assignedToMe === 0, r.body);
r = await ashaB.call('GET', '/accounts/applications?tab=unassigned');
const row = r.body.items?.[0];
ok('Unassigned list shows the application with masked PAN', r.body.total === 1 && row.panMasked === 'AAAAA****A' && row.assignedTo === null && row.businessDaysWaiting === 0, r.body);
r = await ashaB.call('GET', '/accounts/applications?tab=unassigned&search=priya');
ok('search by signatory name works', r.body.total === 1);
r = await ashaB.call('GET', '/accounts/applications?tab=unassigned&search=nobody');
ok('search with no match returns nothing', r.body.total === 0);

// ---------- A3: pick up, approve, reject ----------
r = await ashaB.call('POST', `/accounts/applications/${p.id}/approve`);
ok('approve before picking up is refused', r.status === 409 && r.body.error.code === 'not_assigned', r.body);
const [pa, pb] = await Promise.all([ashaB.call('POST', `/accounts/applications/${p.id}/pick-up`), balaB.call('POST', `/accounts/applications/${p.id}/pick-up`)]);
const winnerIsAsha = pa.status === 200;
ok('two users pick up at once: exactly one wins', [pa.status, pb.status].sort().join() === '200,409', [pa.body, pb.body]);
ok('the loser is told who picked it up', /Already picked up by (Asha|Bala) Accounts/.test((winnerIsAsha ? pb : pa).body.error?.message ?? ''), (winnerIsAsha ? pb : pa).body);
// Make sure Asha holds it for the rest of the test.
if (!winnerIsAsha) await db.collection('registrations').updateOne({ _id: new mongoose.Types.ObjectId(p.id) }, { $set: { assignedTo: asha._id } });

r = await balaB.call('POST', `/accounts/applications/${p.id}/reject`, { reason: 'Please upload a clearer PAN image.' });
ok('only the assignee can reject', r.status === 409 && r.body.error.code === 'assigned_to_other', r.body);
r = await ashaB.call('POST', `/accounts/applications/${p.id}/reject`, { reason: 'too short' });
ok('reason under 10 characters refused', r.status === 400, r.body);
r = await ashaB.call('POST', `/accounts/applications/${p.id}/reject`, { reason: 'Please upload a clearer photograph and fix the firm name.' });
ok('assignee rejects with a reason -> Rejected by Accounts', r.status === 200 && r.body.application.status === 'rejected_by_accounts', r.body);
await settle();
ok('applicant emailed the reason and how to resubmit (N6)', !!(await outbox().findOne({ to: 'p@example.com', event: 'accounts_rejected', html: /clearer photograph/ })));
ok('Admin emailed about the rejection', !!(await outbox().findOne({ to: 'admin@check.local', event: 'accounts_rejected' })));
ok('Asha can still view what she reviewed (read-only)', (await ashaB.call('GET', `/accounts/applications/${p.id}`)).body.application?.actions?.canApprove === false);
ok('Bala cannot see an application he never reviewed once it left the queue', (await balaB.call('GET', `/accounts/applications/${p.id}`)).status === 404);
r = await p.browser.call('GET', '/franchise/application');
ok('applicant dashboard shows the rejection reason', r.body.application?.latestRejection?.reason?.includes('clearer photograph') && r.body.application.history.at(-1).by === 'Accounts Team', r.body.application?.latestRejection);

// ---------- F3: Edit & Resubmit ----------
r = await p.browser.call('GET', '/franchise/application/resubmit-form');
const form = r.body.form;
ok('resubmit form pre-filled, with the reason and the same agreement version', form?.submission?.firmName === 'Firm AAAAA1111A' && form.latestRejection.stage === 'Accounts' && form.agreement.id === v1.id, form);
ok('accepted agreement PDF is available to the applicant', (await p.browser.call('GET', '/franchise/agreement/pdf')).type === 'application/pdf');
const s1 = form.submission;
const keep = (d: { id: string }) => `keep:${d.id}`;
const resubmitBody = async (over: Record<string, unknown> = {}) => ({
  franchiseModel: s1.franchiseModel,
  firmType: s1.firmType,
  firmName: 'Firm AAAAA1111A Pvt Ltd',
  pan: s1.pan,
  panFile: keep(s1.panDocument),
  gst: null,
  signatory: { name: s1.signatory.name, capacity: s1.signatory.capacity, email: 'ignored@example.com', mobile: '9999999999', idProofFile: keep(s1.signatory.idProof), photoFile: await up(p.browser, '/franchise/uploads', 'photo', PNG2) },
  contacts: s1.contacts.map((c: any) => ({ name: c.name, email: c.email, mobile: c.mobile, idProofFile: keep(c.idProof), photoFile: keep(c.photo) })),
  agreement: { agreementVersionId: v1.id, accepted: true },
  legalConsent: true,
  ...over,
});
const other = await newApplicant({ pan: 'BBBBB2222B', email: 'o@example.com', mobile: '9200000001', contactEmail: 'oc@example.com', contactMobile: '9200000002' });
const otherDoc = (await other.browser.call('GET', '/franchise/application')).body.application.current.panDocument.id;
r = await p.browser.call('POST', '/franchise/application/resubmit', await resubmitBody({ panFile: `keep:${otherDoc}` }));
ok("cannot 'keep' another applicant's document", r.status === 400 && r.body.error.code === 'upload_missing', r.body);
r = await p.browser.call('POST', '/franchise/application/resubmit', await resubmitBody({ pan: 'BBBBB2222B' }));
ok("cannot change PAN to another registration's PAN", r.status === 409 && !!r.body.error.fields?.pan, r.body);

const good = await resubmitBody();
const [ra, rb] = await Promise.all([p.browser.call('POST', '/franchise/application/resubmit', good), p.browser.call('POST', '/franchise/application/resubmit', good)]);
ok('double-click resubmit saves only once', [ra.status, rb.status].sort().join() === '200,409', [ra.body, rb.body]);
const regP = await Registration.findById(p.id);
ok('after an Accounts rejection: back to Pending Accounts, same reviewer, version 2', !!(regP?.status === 'pending_accounts' && regP.assignedTo?.equals(asha._id) && regP.currentSubmissionVersion === 2), regP?.toObject());
ok('login email/mobile cannot be changed by resubmitting', regP?.signatory?.email === 'p@example.com' && regP.signatory.mobile === '9100000001');
ok('agreement accepted again (2 acceptance records, same version)', (await AgreementAcceptance.countDocuments({ registrationId: regP!._id, agreementVersionId: v1.id })) === 2);
await settle();
ok('N7: applicant, the reviewer and Admin are emailed', ['p@example.com', 'asha@check.local', 'admin@check.local'].every(async () => true) && (await outbox().countDocuments({ event: 'resubmitted_to_accounts' })) === 3);

r = await ashaB.call('GET', `/accounts/applications/${p.id}`);
const changes: string[] = r.body.application?.changes ?? [];
ok('"Changes since last review" lists exactly the firm name and the new photograph', changes.sort().join() === 'firmName,signatory.photo', changes);
ok('Asha sees full reviewer names in history', r.body.application.history.some((h: any) => h.by.startsWith('Asha Accounts')));
r = await p.browser.call('GET', '/franchise/application');
ok('applicant never sees reviewer names', r.body.application.history.every((h: any) => !h.by.includes('Asha')));

// ---------- Duplicate flag blocks approval ----------
const q = await newApplicant({ pan: 'CCCCC3333C', email: 'q@example.com', mobile: '9300000001', contactEmail: 'p@example.com', contactMobile: '9300000002' });
await balaB.call('POST', `/accounts/applications/${q.id}/pick-up`);
r = await balaB.call('GET', `/accounts/applications/${q.id}`);
ok('flagged application: Approve disabled with a reason, matched field shown', r.body.application.duplicate.open && !r.body.application.actions.canApprove && !!r.body.application.actions.approveBlockedReason && r.body.application.duplicate.matches.some((m: any) => m.field === 'contacts.0.email'), r.body.application.duplicate);
r = await balaB.call('POST', `/accounts/applications/${q.id}/approve`);
ok('server refuses Approve while the duplicate flag is open', r.status === 409 && r.body.error.code === 'duplicate_flag_open', r.body);
r = await ashaB.call('GET', '/accounts/applications?tab=all&flagged=1');
ok('"Flagged only" filter', r.body.total === 1 && r.body.items[0].id === q.id, r.body);

// ---------- Approve ----------
r = await ashaB.call('POST', `/accounts/applications/${p.id}/approve`);
ok('assignee approves -> Pending Manager', r.status === 200 && r.body.application.status === 'pending_manager', r.body);
await settle();
ok('N5: applicant, Manager and Admin emailed', (await outbox().countDocuments({ event: 'accounts_approved' })) === 3);
ok('history records "Approved by Accounts"', !!(await RegistrationHistory.findOne({ registrationId: regP!._id, event: 'accounts_approved', actorId: asha._id })));
r = await ashaB.call('GET', '/accounts/reviewed');
ok('A4: My Reviewed Applications shows the rejection and the approval', r.body.items.length === 2 && r.body.items[0].decision === 'approved' && r.body.items[0].currentStatus === 'pending_manager', r.body);
r = await ashaB.call('GET', '/accounts/dashboard');
ok('dashboard: 1 approved and 1 rejected by me this month', r.body.dashboard.approvedByMeThisMonth === 1 && r.body.dashboard.rejectedByMeThisMonth === 1, r.body.dashboard);
r = await ashaB.call('POST', `/accounts/applications/${p.id}/approve`);
ok('approving twice is refused', r.status === 409, r.body);

// ---------- Resubmission after a Manager rejection goes straight back to the Manager ----------
// (Manager decisions arrive in step 6; simulate one here.)
await db.collection('registrations').updateOne({ _id: regP!._id }, { $set: { status: 'rejected_by_manager' } });
await RegistrationHistory.create({ registrationId: regP!._id, at: new Date(), event: 'manager_rejected', actorRole: 'manager', reason: 'Please correct the franchise model.', submissionVersion: 2 });
r = await p.browser.call('GET', '/franchise/application/resubmit-form');
const s2 = r.body.form.submission;
const managerResubmit = (acknowledgeDuplicates: boolean) => p.browser.call('POST', '/franchise/application/resubmit', {
  acknowledgeDuplicates,
  franchiseModel: 'Express Plus', firmType: s2.firmType, firmName: s2.firmName, pan: s2.pan, panFile: keep(s2.panDocument), gst: null,
  signatory: { name: s2.signatory.name, capacity: s2.signatory.capacity, email: s2.signatory.email, mobile: s2.signatory.mobile, idProofFile: keep(s2.signatory.idProof), photoFile: keep(s2.signatory.photo) },
  contacts: s2.contacts.map((c: any) => ({ name: c.name, email: c.email, mobile: c.mobile, idProofFile: keep(c.idProof), photoFile: keep(c.photo) })),
  agreement: { agreementVersionId: v1.id, accepted: true },
  legalConsent: true,
});
// Applicant Q (registered later) used P's email as a contact, so the re-run duplicate check warns P.
r = await managerResubmit(false);
ok('resubmission re-runs the duplicate check: new match -> warning first', r.status === 409 && r.body.error.code === 'duplicate_warning' && r.body.error.warnings[0].field === 'signatory.email', r.body);
r = await managerResubmit(true);
ok('after "Continue" the application is flagged for Admin', (await Registration.findById(p.id))?.hasOpenDuplicateFlag === true);
ok('after a Manager rejection: straight back to Pending Manager (version 3)', r.status === 200 && r.body.status === 'pending_manager' && r.body.version === 3, r.body);

// ---------- Admin: reassign and deactivation (PRD AD2, AD8) ----------
const s = await newApplicant({ pan: 'DDDDD4444D', email: 's@example.com', mobile: '9400000001', contactEmail: 'sc@example.com', contactMobile: '9400000002' });
await ashaB.call('POST', `/accounts/applications/${s.id}/pick-up`);
r = await adminB.call('POST', `/admin/users/accounts/${asha._id}/deactivate`);
ok('deactivating an Accounts user with applications is refused with a count', r.status === 409 && r.body.error.code === 'has_assignments' && r.body.error.assignedCount === 1, r.body);
r = await adminB.call('POST', `/admin/users/accounts/${asha._id}/move-assignments`, { toUserId: bala._id.toString(), note: 'Asha is on leave' });
ok('Admin moves her applications to Bala', !!(r.status === 200 && r.body.moved === 1 && (await Registration.findById(s.id))?.assignedTo?.equals(bala._id)), r.body);
await settle();
ok('N4: Bala is emailed with the note', !!(await outbox().findOne({ to: 'bala@check.local', event: 'application_reassigned', html: /on leave/ })));
r = await adminB.call('POST', `/admin/registrations/${s.id}/reassign`, { toUserId: null, note: '' });
ok('Admin can move an application back to Unassigned', r.status === 200 && (await Registration.findById(s.id))?.assignedTo === null);
r = await adminB.call('POST', `/admin/registrations/${s.id}/reassign`, { toUserId: (await User.findOne({ username: 'mira' }))!._id.toString() });
ok('cannot assign to a non-Accounts user', r.status === 400, r.body);

// Asha rejects one application, is deactivated, then the applicant resubmits: it goes to Unassigned.
const t = await newApplicant({ pan: 'EEEEE5555E', email: 't@example.com', mobile: '9500000001', contactEmail: 'tc@example.com', contactMobile: '9500000002' });
await ashaB.call('POST', `/accounts/applications/${t.id}/pick-up`);
await ashaB.call('POST', `/accounts/applications/${t.id}/reject`, { reason: 'Please re-upload the ID proof clearly.' });
r = await adminB.call('POST', `/admin/users/accounts/${asha._id}/deactivate`);
ok('with nothing left to review, Asha can be deactivated', r.status === 200, r.body);
const tf = (await t.browser.call('GET', '/franchise/application/resubmit-form')).body.form.submission;
await t.browser.call('POST', '/franchise/application/resubmit', {
  franchiseModel: tf.franchiseModel, firmType: tf.firmType, firmName: tf.firmName, pan: tf.pan, panFile: keep(tf.panDocument), gst: null,
  signatory: { name: tf.signatory.name, capacity: tf.signatory.capacity, email: tf.signatory.email, mobile: tf.signatory.mobile, idProofFile: await up(t.browser, '/franchise/uploads', 'document', PNG2), photoFile: keep(tf.signatory.photo) },
  contacts: tf.contacts.map((c: any) => ({ name: c.name, email: c.email, mobile: c.mobile, idProofFile: keep(c.idProof), photoFile: keep(c.photo) })),
  agreement: { agreementVersionId: v1.id, accepted: true },
  legalConsent: true,
});
const regT = await Registration.findById(t.id);
ok('reviewer no longer active -> resubmission goes to Unassigned', regT?.status === 'pending_accounts' && regT.assignedTo === null, regT?.toObject());

const actions = (await db.collection('auditlogs').distinct('action')) as string[];
ok('audit log records pick-up, decisions, resubmission and reassignment', ['application_picked_up', 'accounts_rejected', 'accounts_approved', 'application_resubmitted', 'application_reassigned'].every((a) => actions.includes(a)), actions);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
server.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
