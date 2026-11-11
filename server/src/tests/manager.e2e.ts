// End-to-end test for build step 6: Manager review, the generated agreement PDF (content, footer on
// every page, failure + retry), sending it to the franchisee, and Manager-only access.
// Runs the real API on a throwaway in-memory database. Run with: npm test (from the repository root).
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { AGREEMENT_PDF_FOOTER } from '@fap/shared';

const storageDir = mkdtempSync(path.join(tmpdir(), 'fap-test-'));
const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
process.env.NODE_ENV = 'test';
// Never use a real SMS gateway from server/.env in tests: every text goes to the test mailbox.
process.env.SMS_PROVIDER = 'dev_outbox';
// Never use a real email account from server/.env in tests either.
process.env.EMAIL_PROVIDER = 'dev_outbox';
process.env.MONGODB_URI = rs.getUri('manager_test');
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const agreements = await import('../services/agreement.service');
const { hashPassword } = await import('../services/auth.service');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
const { AgreementVersion } = await import('../models/AgreementVersion');
const { getSettings } = await import('../models/Settings');
// The PDF text reader (pdf.js) needs Promise.withResolvers, built into Node 22+; add it for Node 20.
const P = Promise as unknown as { withResolvers?: () => unknown };
P.withResolvers ??= () => {
  let resolve: unknown;
  let reject: unknown;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
await runMigrations(mongoose.connection.db!);
await getSettings();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const db = mongoose.connection.db!;
const outbox = () => db.collection('dev_outbox');
const settle = () => new Promise((r) => setTimeout(r, 300));
const year = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date());

let failures = 0;
const ok = (label: string, cond: boolean, extra?: unknown) => {
  if (!cond) failures++;
  console.log(cond ? 'PASS' : 'FAIL', label, cond || extra === undefined ? '' : JSON.stringify(extra).slice(0, 600));
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
    return {
      status: res.status,
      type,
      disposition: res.headers.get('content-disposition') ?? '',
      body: (type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())) as any,
    };
  }
}
const anon = new Browser();
const login = async (identifier: string, password = 'Portal@2026') => {
  const b = new Browser();
  const r = await b.call('POST', '/auth/login', { identifier, password });
  if (r.status !== 200) throw new Error(`login ${identifier} failed: ${JSON.stringify(r.body)}`);
  return b;
};

/** Text of each page, as a reader would copy it. */
async function pdfPages(bytes: Buffer): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false } as never).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  return pages;
}

// ---------- Setup ----------
const pw = await hashPassword('Portal@2026');
const admin = await User.create({ name: 'Admin', email: 'admin@check.local', username: 'admin', role: 'admin', passwordHash: pw });
await User.create({ name: 'Asha Accounts', email: 'asha@check.local', username: 'asha', role: 'accounts', passwordHash: pw });
await User.create({ name: 'Mira Manager', email: 'mira@check.local', username: 'mira', role: 'manager', passwordHash: pw });
await User.create({ name: 'Mohan Manager', email: 'mohan@check.local', username: 'mohan', role: 'manager', passwordHash: pw });
const actor = { user: admin, ip: '127.0.0.1' } as never;

// A 2-page uploaded agreement with recognisable text.
const src = await PDFDocument.create();
const font = await src.embedFont(StandardFonts.Helvetica);
for (const n of [1, 2]) src.addPage([595, 842]).drawText(`UPLOADED CLAUSE PAGE ${n}`, { x: 60, y: 760, size: 14, font });
const PDF = Buffer.from(await src.save());
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const v1 = await agreements.createDraft({ title: 'Franchise Agreement', format: 'pdf', content: '' }, actor);
await agreements.uploadPdf(v1.id, PDF, 'agreement.pdf', actor);
await agreements.activateVersion(v1.id, actor);

const up = async (kind: string, data: Buffer) =>
  (await anon.call('PUT', `/public/uploads/${kind}`, undefined, { data, headers: { 'Content-Type': 'application/octet-stream' } })).body.upload.token as string;
async function latestCode(to: string) {
  const m = await outbox().find({ to: { $in: [to, `+91 ${to}`] } }).sort({ at: -1 }).limit(1).next();
  return /(\d{6})/.exec(String(m?.subject ?? '') + String(m?.text ?? ''))?.[1] ?? '';
}
const ashaB = await login('asha');

/** Registers, verifies, creates the account and gets Accounts approval: the application is then Pending Manager. */
async function readyForManager(o: { pan: string; email: string; mobile: string; contactMobile: string; agreementId: string }) {
  const token = (
    await anon.call('POST', '/public/registrations', {
      franchiseModel: 'Express Store',
      firmType: 'Private Limited Company',
      firmName: `Sunrise ${o.pan} Pvt Ltd`,
      pan: o.pan,
      panFile: await up('document', PDF),
      gst: null,
      signatory: { name: 'Priya Sharma', capacity: 'Director', email: o.email, mobile: o.mobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) },
      contacts: [{ name: 'Ravi Kumar', email: `c.${o.email}`, mobile: o.contactMobile, idProofFile: await up('document', PNG), photoFile: await up('photo', PNG) }],
      agreement: { agreementVersionId: o.agreementId, accepted: true },
      legalConsent: true,
      acknowledgeDuplicates: true,
    })
  ).body.verificationToken as string;
  for (const channel of ['email', 'sms'] as const) {
    await anon.call('POST', '/public/verification/send', { token, channel });
    await anon.call('POST', '/public/verification/verify', { token, channel, code: await latestCode(channel === 'email' ? o.email : o.mobile) });
  }
  const applicant = new Browser();
  await applicant.call('POST', '/public/verification/complete', { token, password: 'Strong@123', confirmPassword: 'Strong@123' });
  const id = (await Registration.findOne({ pan: o.pan }))!._id.toString();
  await ashaB.call('POST', `/accounts/applications/${id}/pick-up`);
  await ashaB.call('POST', `/accounts/applications/${id}/approve`);
  return { id, applicant };
}

const a = await readyForManager({ pan: 'AAAAA1111A', email: 'a@example.com', mobile: '9100000001', contactMobile: '9100000002', agreementId: v1.id });
const miraB = await login('mira');
const mohanB = await login('mohan');
const adminB = await login('admin');

// ---------- Permissions ----------
ok('Accounts refused from Manager screens', (await ashaB.call('GET', '/manager/applications')).status === 403);
ok('franchise user refused from Manager screens', (await a.applicant.call('GET', '/manager/dashboard')).status === 403);
ok('Admin refused from Manager screens (PDF access is Manager only, PRD Q1)', (await adminB.call('GET', '/manager/agreements')).status === 403);
ok('logged-out visitor refused', (await anon.call('GET', '/manager/dashboard')).status === 401);

// ---------- M1 / M2 / M3 ----------
let r = await miraB.call('GET', '/manager/dashboard');
ok('dashboard: 1 pending approval', r.body.dashboard?.pendingApproval === 1, r.body);
r = await miraB.call('GET', '/manager/applications?list=pending');
ok('Pending Approvals shows who approved at Accounts and when', r.body.total === 1 && r.body.items[0].accountsApprovedBy === 'Asha Accounts' && !!r.body.items[0].accountsApprovedAt, r.body);
r = await miraB.call('GET', `/manager/applications/${a.id}`);
ok('review shows the Accounts decision and allows Approve / Reject', r.body.application?.accountsDecision?.by.startsWith('Asha Accounts') && r.body.application.actions.canApprove && r.body.application.actions.canReject, r.body.application?.actions);
const docId = r.body.application.submission.signatory.photo.id;
ok('Manager can open the documents', (await miraB.call('GET', `/manager/applications/${a.id}/documents/${docId}`)).type === 'image/png');

// ---------- Reject, then resubmit straight back to the Manager ----------
r = await miraB.call('POST', `/manager/applications/${a.id}/reject`, { reason: 'short' });
ok('reject needs a reason of 10+ characters', r.status === 400);
r = await miraB.call('POST', `/manager/applications/${a.id}/reject`, { reason: 'Please correct the franchise model to the approved name.' });
ok('Manager rejects -> Rejected by Manager', r.body.application?.status === 'rejected_by_manager', r.body);
await settle();
ok('N9: applicant gets the reason, Admin is told', !!(await outbox().findOne({ to: 'a@example.com', event: 'manager_rejected' })) && !!(await outbox().findOne({ to: 'admin@check.local', event: 'manager_rejected' })));
const form = (await a.applicant.call('GET', '/franchise/application/resubmit-form')).body.form.submission;
const keep = (d: { id: string }) => `keep:${d.id}`;
r = await a.applicant.call('POST', '/franchise/application/resubmit', {
  franchiseModel: 'Express Store Plus', firmType: form.firmType, firmName: form.firmName, pan: form.pan, panFile: keep(form.panDocument), gst: null,
  signatory: { name: form.signatory.name, capacity: form.signatory.capacity, email: form.signatory.email, mobile: form.signatory.mobile, idProofFile: keep(form.signatory.idProof), photoFile: keep(form.signatory.photo) },
  contacts: form.contacts.map((c: any) => ({ name: c.name, email: c.email, mobile: c.mobile, idProofFile: keep(c.idProof), photoFile: keep(c.photo) })),
  agreement: { agreementVersionId: v1.id, accepted: true },
  legalConsent: true,
});
ok('resubmission goes straight back to Pending Manager', r.body.status === 'pending_manager', r.body);
r = await miraB.call('GET', `/manager/applications/${a.id}`);
ok('Manager sees "changes since last review"', (r.body.application?.changes ?? []).includes('franchiseModel'), r.body.application?.changes);

// ---------- Approve (two Managers at once) ----------
const [x, y] = await Promise.all([miraB.call('POST', `/manager/applications/${a.id}/approve`), mohanB.call('POST', `/manager/applications/${a.id}/approve`)]);
const win = x.status === 200 ? x : y;
ok('two Managers approve at once: exactly one wins', [x.status, y.status].sort().join() === '200,409', [x.body, y.body]);
ok(`reference number FRN/${year}/0001 assigned and PDF generated`, win.body.referenceNumber === `FRN/${year}/0001` && win.body.generation?.status === 'generated', win.body);
const regA = await Registration.findById(a.id);
ok('application Approved with the reference number', regA?.status === 'approved' && regA.agreementReferenceNo === `FRN/${year}/0001`);
await settle();
ok('N8: applicant and Admin emailed', !!(await outbox().findOne({ to: 'a@example.com', event: 'manager_approved', subject: /approved/i })) && !!(await outbox().findOne({ to: 'admin@check.local', event: 'manager_approved', subject: /PDF generated/ })));

// ---------- The PDF ----------
r = await miraB.call('GET', '/manager/agreements');
const row = r.body.items?.[0];
ok('Generated Agreements lists it (not yet emailed)', row?.referenceNumber === `FRN/${year}/0001` && row.status === 'generated' && row.timesSent === 0, row);
const pdf = await miraB.call('GET', `/manager/agreements/${row.id}/pdf`);
ok('View: inline PDF', pdf.type === 'application/pdf' && pdf.disposition.startsWith('inline'));
const dl = await miraB.call('GET', `/manager/agreements/${row.id}/pdf?download=1`);
ok('Download: attachment named after the reference', dl.disposition.startsWith('attachment') && dl.disposition.includes(`FRN-${year}-0001.pdf`), dl.disposition);
const pages = await pdfPages(pdf.body as Buffer);
const all = pages.join(' | ');
ok('PDF is A4', (await PDFDocument.load(pdf.body as Buffer)).getPages().every((p) => Math.round(p.getWidth()) === 595 && Math.round(p.getHeight()) === 842));
ok('exact footer on EVERY page', pages.length >= 4 && pages.every((p) => p.includes(AGREEMENT_PDF_FOOTER)), pages.map((p) => p.slice(-200)));
ok('"Page X of Y" on every page', pages.every((p, i) => p.includes(`Page ${i + 1} of ${pages.length}`)));
ok('details pages: reference, version, firm, PAN, signatory, contact table', ['FRN/' + year + '/0001', 'Version 1', 'Sunrise AAAAA1111A Pvt Ltd', 'Express Store Plus', 'AAAAA1111A', 'Priya Sharma', 'Director', 'Ravi Kumar', '+91 9100000002'].every((t) => all.includes(t)), all.slice(0, 800));
ok('uploaded agreement pages included unchanged', all.includes('UPLOADED CLAUSE PAGE 1') && all.includes('UPLOADED CLAUSE PAGE 2'));
ok('acceptance record and dates', /Accepted online by Priya Sharma on \d{2}-\d{2}-\d{4}/.test(all) && all.includes('Manager approval date') && all.includes('Agreement generated on'), all.slice(-600));
ok('no signature fields', !/signature:|sign here/i.test(all.replace(AGREEMENT_PDF_FOOTER, '')));

// ---------- Nobody but the Manager can reach the PDF ----------
for (const [who, b] of [['Accounts', ashaB], ['franchise user', a.applicant], ['Admin', adminB]] as const) {
  ok(`${who} cannot open the PDF even with the direct link`, (await b.call('GET', `/manager/agreements/${row.id}/pdf`)).status === 403);
}
ok('logged-out visitor cannot open the PDF', (await anon.call('GET', `/manager/agreements/${row.id}/pdf`)).status === 401);

// ---------- Send / resend (M5, N11) ----------
r = await miraB.call('GET', `/manager/agreements/${row.id}/email-draft`);
ok('send dialog is prefilled with the registered email', r.body.draft?.recipient === 'a@example.com' && r.body.draft.subject.includes(`FRN/${year}/0001`), r.body);
r = await miraB.call('POST', `/manager/agreements/${row.id}/send`, { subject: r.body.draft.subject, message: 'Dear Priya,\n\nPlease find your agreement attached.' });
await settle();
const sentMail = await outbox().findOne({ event: 'agreement_sent' });
ok('agreement emailed with the PDF attached', r.status === 200 && sentMail?.to === 'a@example.com' && sentMail.attachments?.[0]?.filename === `Franchise-Agreement-FRN-${year}-0001.pdf`, sentMail);
await miraB.call('POST', `/manager/agreements/${row.id}/send`, { subject: 'Resend: your agreement', message: 'Sending again as requested.' });
await db.command({ collMod: 'dev_outbox', validator: { _id: { $exists: false } }, validationLevel: 'strict' });
r = await miraB.call('POST', `/manager/agreements/${row.id}/send`, { subject: 'Third try', message: 'Again.' });
await db.command({ collMod: 'dev_outbox', validator: {}, validationLevel: 'off' });
ok('a failed send reports the failure', r.status === 502, r.body);
r = await miraB.call('GET', `/manager/agreements/${row.id}/emails`);
ok('email history: 2 sent + 1 failed with error, sender recorded', r.body.items.length === 3 && r.body.items[0].status === 'failed' && !!r.body.items[0].error && r.body.items.filter((i: any) => i.status === 'sent').length === 2 && r.body.items[0].sentBy === 'Mira Manager', r.body.items);
r = await miraB.call('GET', '/manager/agreements');
ok('list shows times sent and last status', r.body.items[0].timesSent === 2 && r.body.items[0].lastEmailStatus === 'failed', r.body.items[0]);
r = await miraB.call('POST', `/manager/agreements/${row.id}/send`, { subject: 'x', message: 'y' });
ok('subject must be at least 3 characters', r.status === 400);

// ---------- Typed agreement: merge fields filled from approved data, reference and approval date included ----------
const v2 = await agreements.createDraft(
  { title: 'Typed Franchise Agreement', format: 'text', content: '<h2>Agreement</h2><p>This agreement <strong>{{agreement_reference_no}}</strong> is made with {{firm_name}} on {{approval_date}}.</p><ol><li><p>First clause.</p></li><li><p>Second clause.</p></li></ol>' },
  actor,
);
await agreements.activateVersion(v2.id, actor);
const b = await readyForManager({ pan: 'BBBBB2222B', email: 'b@example.com', mobile: '9200000001', contactMobile: '9200000002', agreementId: v2.id });
r = await mohanB.call('POST', `/manager/applications/${b.id}/approve`);
ok(`next approval gets FRN/${year}/0002 (no number lost to the race)`, r.body.referenceNumber === `FRN/${year}/0002`, r.body);
const typedRow = (await mohanB.call('GET', '/manager/agreements')).body.items.find((i: any) => i.referenceNumber === `FRN/${year}/0002`);
const typedText = (await pdfPages((await mohanB.call('GET', `/manager/agreements/${typedRow.id}/pdf`)).body)).join(' | ');
ok('typed agreement: merge fields filled with the reference and firm name', typedText.includes(`This agreement FRN/${year}/0002 is made with Sunrise BBBBB2222B Pvt Ltd on`) && /1\.\s*First clause\./.test(typedText) && /2\.\s*Second clause\./.test(typedText), typedText.slice(0, 1200));

// ---------- Generation failure: approval stands, alerts, retry ----------
await AgreementVersion.updateOne({ _id: v2.id }, { $set: { content: '<p>Broken</p>' } }); // harmless edit
const c = await readyForManager({ pan: 'CCCCC3333C', email: 'cc@example.com', mobile: '9300000001', contactMobile: '9300000002', agreementId: v2.id });
const realVersion = await AgreementVersion.findById(v2.id);
// Simulate a missing stored file / broken data: point the record at a version that cannot be loaded.
await db.collection('registrations').updateOne({ _id: new mongoose.Types.ObjectId(c.id) }, { $set: { agreementVersionId: new mongoose.Types.ObjectId() } });
r = await miraB.call('POST', `/manager/applications/${c.id}/approve`);
ok('generation failure: the approval still stands', r.status === 200 && r.body.generation?.status === 'failed' && (await Registration.findById(c.id))?.status === 'approved', r.body);
await settle();
ok('N12: Managers and Admin alerted', (await outbox().countDocuments({ event: 'pdf_generation_failed' })) === 3);
const failedRow = (await miraB.call('GET', '/manager/agreements')).body.items.find((i: any) => i.status === 'failed');
ok('the list shows Generation Failed', !!failedRow?.error);
ok('PDF not available while failed', (await miraB.call('GET', `/manager/agreements/${failedRow.id}/pdf`)).status === 409);
await db.collection('generatedagreements').updateOne({ _id: new mongoose.Types.ObjectId(failedRow.id) }, { $set: { agreementVersionId: realVersion!._id } });
r = await miraB.call('POST', `/manager/agreements/${failedRow.id}/retry`);
ok('Retry Generation succeeds once the problem is fixed', r.body.generation?.status === 'generated', r.body);
ok('retry only for failed agreements', (await miraB.call('POST', `/manager/agreements/${failedRow.id}/retry`)).status === 409);

// ---------- Applicant view ----------
r = await a.applicant.call('GET', '/franchise/application');
ok('applicant sees Approved and "Final approval given" by Manager', r.body.application.status === 'approved' && r.body.application.history.at(-1).title === 'Final approval given' && r.body.application.history.at(-1).by === 'Manager', r.body.application.history.at(-1));

r = await miraB.call('GET', '/manager/applications?list=approved');
ok('Approved list shows the reference numbers', r.body.total === 3 && r.body.items.every((i: any) => /^FRN\//.test(i.agreementReferenceNo)), r.body.items?.map((i: any) => i.agreementReferenceNo));
r = await miraB.call('GET', '/manager/dashboard');
ok('dashboard: 3 approved this month, 1 rejected, 2 agreements not yet emailed', r.body.dashboard.approvedThisMonth === 3 && r.body.dashboard.rejectedThisMonth === 1 && r.body.dashboard.agreementsNotYetEmailed === 2, r.body.dashboard);

const actions = (await db.collection('auditlogs').distinct('action')) as string[];
ok('audit log: approval, rejection, PDF viewed, downloaded, emailed, failed, retried', ['manager_approved', 'manager_rejected', 'agreement_pdf_viewed', 'agreement_pdf_downloaded', 'agreement_emailed', 'agreement_email_failed', 'agreement_pdf_failed', 'agreement_pdf_retry'].every((x) => actions.includes(x)), actions);

await settle();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
server.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
