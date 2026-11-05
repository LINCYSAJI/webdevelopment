// End-to-end test for build step 7: Admin oversight (dashboard, registrations + export, read-only
// detail, Duplicate Review, Approval Tracking, Approved / Rejected lists, agreement records) and
// who may see what. Runs the real API on a throwaway in-memory database. Run with: npm test.
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const storageDir = mkdtempSync(path.join(tmpdir(), 'fap-test-'));
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = rs.getUri('oversight_test');
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const agreements = await import('../services/agreement.service');
const { hashPassword } = await import('../services/auth.service');
const { toCsv } = await import('../lib/csv');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
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
    const payload = type.includes('json') ? await res.json() : type.includes('text/csv') ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer()) : await res.arrayBuffer();
    return { status: res.status, type, disposition: res.headers.get('content-disposition') ?? '', body: payload as any };
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

const up = async (kind: string, data: Buffer) =>
  (await anon.call('PUT', `/public/uploads/${kind}`, undefined, { data, headers: { 'Content-Type': 'application/octet-stream' } })).body.upload.token as string;

async function latestCode(to: string) {
  const m = await outbox().find({ to: { $in: [to, `+91 ${to}`] } }).sort({ at: -1 }).limit(1).next();
  return /(\d{6})/.exec(String(m?.subject ?? '') + String(m?.text ?? ''))?.[1] ?? '';
}

/** Registers, verifies both codes and creates the account: the application is then Pending Accounts. */
async function newApplicant(o: { pan: string; firm: string; email: string; mobile: string; contactEmail: string; contactMobile: string }) {
  const body = {
    franchiseModel: 'Express',
    firmType: 'Partnership Firm',
    firmName: o.firm,
    pan: o.pan,
    panFile: await up('document', PDF),
    gst: null,
    signatory: { name: 'Priya Sharma', capacity: 'Partner', email: o.email, mobile: o.mobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) },
    contacts: [{ name: 'Ravi Kumar', email: o.contactEmail, mobile: o.contactMobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) }],
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
  return { browser: b, id: reg!._id.toString(), applicationId: reg!.applicationId! };
}

const a = await newApplicant({ pan: 'AAAAA1111A', firm: 'Alpha Traders', email: 'a@example.com', mobile: '9100000001', contactEmail: 'shared@example.com', contactMobile: '9100000002' });
const b = await newApplicant({ pan: 'BBBBB2222B', firm: 'Beta Foods', email: 'b@example.com', mobile: '9200000001', contactEmail: 'shared@example.com', contactMobile: '9200000002' });
const c = await newApplicant({ pan: 'CCCCC3333C', firm: 'Gamma Stores', email: 'c@example.com', mobile: '9300000001', contactEmail: 'cc@example.com', contactMobile: '9100000002' });
const d = await newApplicant({ pan: 'DDDDD4444D', firm: 'Delta Retail', email: 'd@example.com', mobile: '9400000001', contactEmail: 'dc@example.com', contactMobile: '9400000002' });
const ashaB = await login('asha');
const miraB = await login('mira');
const adminB = await login('admin');

// ---------- Session check without errors ----------
let s0 = await anon.call('GET', '/auth/session');
ok('logged-out session check answers 200 with no user (no failed request)', s0.status === 200 && s0.body.user === null && s0.body.canRefresh === false, s0.body);
s0 = await adminB.call('GET', '/auth/session');
ok('logged-in session check returns the user', s0.status === 200 && s0.body.user?.role === 'admin', s0.body);

// ---------- Permissions ----------
for (const url of ['/admin/dashboard', '/admin/registrations', '/admin/registrations/export', `/admin/registrations/${a.id}`, '/admin/duplicates', '/admin/tracking', '/admin/approved', '/admin/rejected', '/admin/generated-agreements']) {
  const [x, y, z, w] = await Promise.all([anon.call('GET', url), ashaB.call('GET', url), miraB.call('GET', url), a.browser.call('GET', url)]);
  ok(`${url}: logged-out 401, Accounts / Manager / franchise user 403`, x.status === 401 && y.status === 403 && z.status === 403 && w.status === 403, [x.status, y.status, z.status, w.status]);
}

// ---------- AD3: Duplicate Review ----------
let r = await adminB.call('GET', '/admin/duplicates');
const caseB = r.body.items?.find((i: any) => i.registration.id === b.id);
const caseC = r.body.items?.find((i: any) => i.registration.id === c.id);
ok('open duplicate cases listed with the matched field and registration', r.body.items?.length === 2 && caseB?.matches.some((m: any) => m.field === 'contacts.0.email' && m.matchedApplicationId === a.applicationId && m.matchedFirmName === 'Alpha Traders'), r.body);
r = await adminB.call('GET', `/admin/duplicates/${caseB.flagId}`);
ok('side-by-side comparison shows both registrations', r.body.comparison?.application.submission.firmName === 'Beta Foods' && r.body.comparison.others[0].submission.firmName === 'Alpha Traders', r.body);

await ashaB.call('POST', `/accounts/applications/${b.id}/pick-up`);
r = await ashaB.call('POST', `/accounts/applications/${b.id}/approve`);
ok('Accounts cannot approve while the flag is open', r.status === 409, r.body);
r = await adminB.call('POST', `/admin/duplicates/${caseB.flagId}/not-duplicate`, { note: 'short' });
ok('a note of 10+ characters is required', r.status === 400);
const [n1, n2] = await Promise.all([
  adminB.call('POST', `/admin/duplicates/${caseB.flagId}/not-duplicate`, { note: 'Same family business, different outlets.' }),
  adminB.call('POST', `/admin/duplicates/${caseB.flagId}/confirm`, { note: 'Same family business, different outlets.' }),
]);
ok('two decisions at once: exactly one wins', [n1.status, n2.status].sort().join() === '200,409', [n1.body, n2.body]);
// Make sure the "not a duplicate" decision is the one that stands for the rest of the test.
const winner = n1.status === 200 ? 'not_duplicate' : 'confirmed';
if (winner === 'confirmed') {
  await db.collection('duplicateflags').updateOne({ _id: new mongoose.Types.ObjectId(caseB.flagId) }, { $set: { status: 'not_duplicate' } });
  await Registration.updateOne({ _id: b.id }, { $set: { hasOpenDuplicateFlag: false } });
}
ok('cleared flag unblocks Accounts approval', (await ashaB.call('GET', `/accounts/applications/${b.id}`)).body.application?.actions?.canApprove === true);
r = await ashaB.call('GET', `/accounts/applications/${b.id}`);
ok('reviewers see the decision in the history', r.body.application.history.some((h: any) => h.event === (winner === 'not_duplicate' ? 'duplicate_cleared' : 'duplicate_confirmed')));
r = await b.browser.call('GET', '/franchise/application');
ok('the applicant does not see duplicate-check events', !r.body.application.history.some((h: any) => h.event.startsWith('duplicate_')), r.body.application.history);
ok('the decision is in the audit log', !!(await db.collection('auditlogs').findOne({ targetId: b.id, action: { $in: ['duplicate_cleared', 'duplicate_confirmed'] } })));

// Confirm Duplicate: assignee asked to reject; Approve stays blocked.
await ashaB.call('POST', `/accounts/applications/${c.id}/pick-up`);
r = await adminB.call('POST', `/admin/duplicates/${caseC.flagId}/confirm`, { note: 'Same contact mobile as Alpha Traders; same applicant.' });
ok('Admin confirms the duplicate', r.status === 200 && r.body.hasOpenDuplicateFlag === true, r.body);
r = await ashaB.call('GET', `/accounts/applications/${c.id}`);
ok('Approve stays blocked and the reviewer sees Admin\'s note', r.body.application.actions.canApprove === false && r.body.application.duplicate.confirmed?.note?.includes('same applicant'), r.body.application.duplicate);
await settle();
ok('assignee emailed to reject with the note', !!(await outbox().findOne({ to: 'asha@check.local', event: 'duplicate_confirmed', html: /same applicant/ })));
ok('a resolved case cannot be decided again', (await adminB.call('POST', `/admin/duplicates/${caseC.flagId}/not-duplicate`, { note: 'Changed my mind after all.' })).status === 409);
ok('resolved cases leave the open list', (await adminB.call('GET', '/admin/duplicates')).body.items.length === 0);

// ---------- Workflow so the lists have something in them ----------
await ashaB.call('POST', `/accounts/applications/${b.id}/approve`);
await miraB.call('POST', `/manager/applications/${b.id}/approve`);
await ashaB.call('POST', `/accounts/applications/${c.id}/reject`, { reason: 'Duplicate of Alpha Traders, please contact us.' });
await ashaB.call('POST', `/accounts/applications/${d.id}/pick-up`);
await ashaB.call('POST', `/accounts/applications/${d.id}/reject`, { reason: 'Please upload a clearer PAN image.' });
// d resubmits (the timeline entry is all the rejected list reads).
await RegistrationHistory.create({ registrationId: d.id, at: new Date(), event: 'resubmitted', actorRole: 'franchise_user', fromStatus: 'rejected_by_accounts', toStatus: 'pending_accounts', submissionVersion: 2 });
await Registration.updateOne({ _id: d.id }, { $set: { status: 'pending_accounts', assignedTo: asha._id, currentSubmissionVersion: 2, stageEnteredAt: new Date() } });

// ---------- AD1: Dashboard ----------
r = await adminB.call('GET', '/admin/dashboard');
const dash = r.body.dashboard;
ok(
  'dashboard counts by status',
  dash?.totalRegistrations === 4 && dash.pendingAccounts === 2 && dash.approved === 1 && dash.rejectedByAccounts === 1 && dash.duplicateCasesOpen === 0 && dash.accountsUsers === 2 && dash.managerUsers === 1,
  dash,
);
ok('dashboard agreement counts', dash.generatedAgreements === 1 && dash.agreementsNotYetEmailed === 1, dash);
ok('registrations per month: 12 months, this month counts 4', dash.registrationsPerMonth.length === 12 && dash.registrationsPerMonth.at(-1).count === 4, dash.registrationsPerMonth);
ok('average days per stage computed from the timeline', dash.averageStageDays.find((s: any) => s.stage === 'accounts').samples >= 3 && dash.averageStageDays.find((s: any) => s.stage === 'manager').samples === 1, dash.averageStageDays);
// Make "a" wait 10 business days.
await Registration.updateOne({ _id: a.id }, { $set: { stageEnteredAt: new Date(Date.now() - 20 * 86_400_000) } });
r = await adminB.call('GET', '/admin/dashboard');
ok('an application waiting more than 5 business days is an alert', r.body.dashboard.overdue === 1 && r.body.dashboard.alerts[0]?.id === a.id, r.body.dashboard.alerts);

// ---------- AD2: Registrations, export, detail ----------
r = await adminB.call('GET', '/admin/registrations');
ok('every registration listed, newest first', r.body.total === 4 && r.body.items[0].id === d.id, r.body.items?.map((i: any) => i.applicationId));
r = await adminB.call('GET', '/admin/registrations?status=approved');
ok('status filter', r.body.total === 1 && r.body.items[0].agreementReferenceNo?.startsWith('FRN/'), r.body);
r = await adminB.call(`GET`, `/admin/registrations?assignee=${asha._id}`);
ok('assigned reviewer filter', r.body.items.every((i: any) => i.assignedTo?.name === 'Asha Accounts') && r.body.total === 1, r.body);
r = await adminB.call('GET', '/admin/registrations?assignee=unassigned');
ok('unassigned filter', r.body.total === 1 && r.body.items[0].id === a.id, r.body);
r = await adminB.call('GET', '/admin/registrations?search=gamma&status=');
ok('search, with an empty filter ignored', r.body.total === 1 && r.body.items[0].id === c.id, r.body);
r = await adminB.call('GET', '/admin/registrations?overdue=1');
ok('overdue filter', r.body.total === 1 && r.body.items[0].id === a.id, r.body);

r = await adminB.call('GET', '/admin/registrations/export?status=pending_accounts');
const lines = String(r.body).split('\r\n').filter(Boolean);
ok('CSV export: Excel-ready file with a header and the filtered rows', r.type.includes('text/csv') && /attachment; filename="registrations-/.test(r.disposition) && String(r.body).startsWith('﻿') && lines.length === 3 && lines[0].includes('"Application ID"'), [r.type, lines]);
ok('CSV export masks the PAN', lines.some((l) => l.includes('AAAAA****A')) && !String(r.body).includes('AAAAA1111A'));
ok('the export is in the audit log', !!(await db.collection('auditlogs').findOne({ action: 'registrations_exported' })));
ok('CSV cells that look like formulas are neutralised', toCsv(['x'], [['=HYPERLINK("http://bad")'], ['-1+2'], ['ok']]).includes('"\'=HYPERLINK(""http://bad"")"') && toCsv(['x'], [['-1+2']]).includes(`"'-1+2"`));

r = await adminB.call('GET', `/admin/registrations/${a.id}`);
const view = r.body.application;
ok('read-only detail: all sections, history, acceptance; only Reassign offered', view?.submission?.firmName === 'Alpha Traders' && view.agreement?.versionNumber === 1 && view.history.length >= 1 && !view.actions.canApprove && !view.actions.canReject && view.actions.canReassign === true, view?.actions);
const docId = view.submission.signatory.photo.id;
r = await adminB.call('GET', `/admin/registrations/${a.id}/documents/${docId}`);
ok('Admin can open uploaded documents', r.status === 200 && r.type === 'image/png', r.status);
ok('another application\'s document id is refused', (await adminB.call('GET', `/admin/registrations/${b.id}/documents/${docId}`)).status === 404);
r = await adminB.call('POST', `/admin/registrations/${a.id}/reassign`, { toUserId: asha._id.toString(), note: 'Asha has capacity this week.' });
ok('Admin reassigns from the detail page', r.status === 200 && (await Registration.findById(a.id))?.assignedTo?.equals(asha._id) === true, r.body);
r = await adminB.call('GET', `/admin/registrations/${b.id}`);
ok('approved application shows the agreement record (metadata only)', r.body.application.generatedAgreement?.status === 'generated' && r.body.application.actions.canReassign === false, r.body.application.generatedAgreement);

// ---------- AD4: Approval Tracking ----------
r = await adminB.call('GET', '/admin/tracking');
const col = (k: string) => r.body.tracking.columns.find((x: any) => x.key === k);
ok('pipeline columns with counts', col('pending_accounts').count === 2 && col('pending_manager').count === 0 && col('approved').count === 1 && col('rejected').count === 1, r.body.tracking.columns.map((x: any) => [x.key, x.count]));
ok('overdue list with days waiting', r.body.tracking.overdue.length === 1 && r.body.tracking.overdue[0].businessDaysWaiting > 5, r.body.tracking.overdue);

// ---------- AD5: Approved / Rejected ----------
r = await adminB.call('GET', '/admin/approved');
ok('approved list with reference and Accounts approver', r.body.total === 1 && r.body.items[0].accountsApprovedBy === 'Asha Accounts' && !!r.body.items[0].agreementReferenceNo, r.body);
r = await adminB.call('GET', '/admin/approved/export');
ok('approved export', String(r.body).includes('Beta Foods') && String(r.body).includes('FRN/'));
r = await adminB.call('GET', '/admin/rejected');
const rejD = r.body.items?.find((i: any) => i.id === d.id);
const rejC = r.body.items?.find((i: any) => i.id === c.id);
ok('rejected list shows stage, reason, reviewer', r.body.total === 2 && rejC?.stage === 'accounts' && rejC.reason.includes('Duplicate of Alpha') && rejC.reviewer === 'Asha Accounts', r.body);
ok('rejected list shows whether the applicant resubmitted', rejD?.resubmitted === true && rejC?.resubmitted === false);
r = await adminB.call('GET', '/admin/rejected?resubmitted=no');
ok('resubmitted filter', r.body.total === 1 && r.body.items[0].id === c.id, r.body);
r = await adminB.call('GET', '/admin/rejected?stage=manager');
ok('stage filter', r.body.total === 0);
r = await adminB.call('GET', '/admin/rejected/export');
ok('rejected export', String(r.body).includes('Please upload a clearer PAN image.') && String(r.body).includes('"Yes"'));

// ---------- AD6: agreement records only ----------
r = await adminB.call('GET', '/admin/generated-agreements');
const g = r.body.items?.[0];
ok('Admin sees the agreement records', r.body.items?.length === 1 && g.applicationId === b.applicationId && g.timesSent === 0, r.body);
ok('Admin sees the email history', (await adminB.call('GET', `/admin/generated-agreements/${g.id}/emails`)).status === 200);
ok('Admin has no route to the PDF itself (Q1 default)', (await adminB.call('GET', `/admin/generated-agreements/${g.id}/pdf`)).status === 404);
ok('the Manager PDF route refuses Admin', (await adminB.call('GET', `/manager/agreements/${g.id}/pdf`)).status === 403);
ok('Admin cannot send the agreement', (await adminB.call('POST', `/manager/agreements/${g.id}/send`, { subject: 'x', message: 'y' })).status === 403);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
server.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
