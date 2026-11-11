// End-to-end test for the Franchise Registration (build step 3): runs the real API against a
// throwaway in-memory database and temporary file folder. Never touches development data.
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
// Never use a real SMS gateway from server/.env in tests: every text goes to the test mailbox.
process.env.SMS_PROVIDER = 'dev_outbox';
// Never use a real email account from server/.env in tests either.
process.env.EMAIL_PROVIDER = 'dev_outbox';
process.env.MONGODB_URI = rs.getUri('registration_test');
process.env.LOCAL_STORAGE_DIR = storageDir;
process.env.JWT_ACCESS_SECRET ??= 'x'.repeat(40);

const mongoose = (await import('mongoose')).default;
const { runMigrations } = await import('../migrations/runner');
const { createApp } = await import('../app');
const agreements = await import('../services/agreement.service');
const { User } = await import('../models/User');
const { Registration } = await import('../models/Registration');
const { RegistrationDocument } = await import('../models/RegistrationDocument');
const { SubmissionVersion } = await import('../models/SubmissionVersion');
const { AgreementAcceptance } = await import('../models/AgreementAcceptance');
const { DuplicateFlag } = await import('../models/DuplicateFlag');
const { PendingUpload } = await import('../models/PendingUpload');

await mongoose.connect(process.env.MONGODB_URI!, { autoIndex: false });
await runMigrations(mongoose.connection.db!);
const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

let failures = 0;
const ok = (label: string, cond: boolean, extra?: unknown) => {
  if (!cond) failures++;
  console.log(cond ? 'PASS' : 'FAIL', label, cond || extra === undefined ? '' : JSON.stringify(extra));
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const pdfDoc = await PDFDocument.create();
pdfDoc.addPage();
const PDF = Buffer.from(await pdfDoc.save());

async function upload(kind: string, data: Buffer, name = 'file') {
  const r = await fetch(`${base}/public/uploads/${kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': name }, body: new Uint8Array(data) });
  return { status: r.status, body: (await r.json()) as any };
}
async function submit(body: unknown) {
  const r = await fetch(`${base}/public/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
}
const token = async (kind: string, data: Buffer) => (await upload(kind, data)).body.upload.token as string;

// ---- Registration closed when no agreement is active
let r = await upload('document', PDF);
ok('upload refused while registration is closed', r.status === 409, r.body);
let form = await (await fetch(`${base}/public/registration-form`)).json() as any;
ok('registration form reports closed (no agreement)', form.agreement === null && form.limits.maxPhotoSizeMB === 2, form);

// ---- Publish a PDF agreement
const admin = await User.create({ name: 'Check Admin', email: 'admin@check.local', username: 'admin', role: 'admin', passwordHash: 'x' });
const actor = { user: admin, ip: '127.0.0.1' } as never;
const v1 = await agreements.createDraft({ title: 'Agreement', format: 'pdf', content: '' }, actor);
await agreements.uploadPdf(v1.id, PDF, 'a.pdf', actor);
await agreements.activateVersion(v1.id, actor);
form = await (await fetch(`${base}/public/registration-form`)).json();
ok('registration form shows the active agreement', form.agreement?.id === v1.id);

// ---- Upload rules
r = await upload('photo', PDF);
ok('PDF refused as a photograph', r.status === 400 && /JPG or PNG/.test(r.body.error.message), r.body);
r = await upload('document', Buffer.from('just text pretending to be a pdf'), 'fake.pdf');
ok('fake file refused (content check)', r.status === 400, r.body);
r = await upload('document', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024)]));
ok('6 MB document refused (5 MB limit)', r.status === 413 && /limit is 5 MB/.test(r.body.error.message), r.body);
r = await upload('photo', Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]));
ok('3 MB photo refused (2 MB limit)', r.status === 413, r.body);
r = await upload('rental', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(8 * 1024 * 1024)]));
ok('8 MB rental agreement accepted (10 MB limit)', r.status === 201, r.body);
r = await upload('virus', PNG);
ok('unknown upload type refused', r.status === 404);
r = await upload('photo', JPG, encodeURIComponent('../../etc/passwd.jpg'));
ok('path in file name is stripped', r.status === 201 && r.body.upload.fileName === 'passwd.jpg', r.body);

// ---- Build a valid registration
const valid = async (over: Record<string, unknown> = {}) => ({
  franchiseModel: ' Express Store ',
  firmType: 'Private Limited Company',
  firmName: 'Sunrise Retail Pvt Ltd',
  pan: 'abcde1234f',
  panFile: await token('document', PDF),
  gst: '29ABCDE1234F1Z5',
  gstFile: await token('document', JPG),
  rentalFile: null,
  signatory: { name: 'Priya Sharma', capacity: 'Director', email: 'Priya@Example.com', mobile: '9876543210', idProofFile: await token('document', PNG), photoFile: await token('photo', JPG) },
  contacts: [
    { name: 'Ravi Kumar', email: 'ravi@example.com', mobile: '9123456780', idProofFile: await token('document', PNG), photoFile: await token('photo', PNG) },
    { name: "Anu D'Souza", email: 'anu@example.com', mobile: '8123456789', idProofFile: await token('document', PDF), photoFile: await token('photo', JPG) },
  ],
  agreement: { agreementVersionId: v1.id, accepted: true },
  legalConsent: true,
  ...over,
});

// ---- Validation (same rules as the browser)
const bad = await valid();
r = await submit({
  ...bad,
  pan: 'ABC123',
  gst: '29ABCDE9999F1Z5',
  signatory: { ...bad.signatory, email: 'not-an-email', mobile: '5123456789', name: 'P1' },
  contacts: [{ ...bad.contacts[0], idProofFile: '' }],
  agreement: { agreementVersionId: v1.id, accepted: false },
  legalConsent: false,
});
const f = r.body.error?.fields ?? {};
ok('invalid form refused with messages per field', r.status === 400 && !!f.pan && !!f['signatory.email'] && !!f['signatory.mobile'] && !!f['signatory.name'] && !!f['contacts.0.idProofFile'] && !!f['agreement.accepted'] && !!f.legalConsent, f);
ok('PAN message is specific', f.pan?.[0] === 'PAN must be 10 characters like ABCDE1234F', f.pan);
r = await submit({ ...(await valid()), gst: '29ABCDE9999F1Z5' });
ok('GST not matching PAN refused', r.status === 400 && r.body.error.fields.gst?.[0] === 'GST number does not belong to the PAN entered', r.body);
r = await submit({ ...(await valid()), gstFile: null });
ok('GST certificate required when GST entered', r.status === 400 && !!r.body.error.fields.gstFile, r.body);
r = await submit({ ...(await valid()), contacts: [] });
ok('at least one contact required', r.status === 400 && !!r.body.error.fields.contacts, r.body);
const swapped = await valid();
r = await submit({ ...swapped, signatory: { ...swapped.signatory, photoFile: swapped.panFile } });
ok('a document upload cannot be used as a photograph', r.status === 400 && !!r.body.error.fields['signatory.photoFile'], r.body);

// ---- Happy path
const good = await valid();
r = await submit(good);
ok('valid registration accepted', r.status === 201 && r.body.status === 'pending_verification' && r.body.maskedEmail === 'pr***@example.com' && r.body.maskedMobile === '******3210', r.body);
const reg = await Registration.findOne({ pan: 'ABCDE1234F' });
ok('saved as Pending Verification with cleaned details', reg?.status === 'pending_verification' && reg.franchiseModel === 'Express Store' && reg.signatory?.email === 'priya@example.com' && reg.contacts.length === 2 && !reg.panLock && !reg.hasOpenDuplicateFlag, reg?.toObject());
const docs = await RegistrationDocument.find({ registrationId: reg!._id });
ok('8 documents stored (PAN, GST, signatory x2, contacts x4)', docs.length === 8, docs.map((d) => d.type));
const snap = await SubmissionVersion.findOne({ registrationId: reg!._id });
ok('submission version 1 snapshot with document references', snap?.version === 1 && !!snap.data.panDocumentId && snap.data.contacts.length === 2 && !!snap.data.contacts[1].photoDocumentId);
const acc = await AgreementAcceptance.findOne({ registrationId: reg!._id });
const consent = await mongoose.connection.db!.collection('consentrecords').findOne({ registrationId: reg!._id });
ok('Terms & Privacy consent saved with versions, wording and time', consent?.termsVersion === '1.0' && consent.privacyVersion === '1.0' && /Privacy Policy/.test(consent.text) && !!consent.acceptedAt, consent);
ok('agreement acceptance saved with version, time and PDF fingerprint', acc?.versionNumber === 1 && !!acc.acceptedAt && !!acc.snapshot?.pdfSha256 && acc.submissionVersion === 1);
r = await submit(good);
ok('the same uploaded files cannot be used twice', r.status === 400 && r.body.error.code === 'upload_missing', r.body);

// ---- "Same as Signatory": Contact 1 reuses the signatory's uploads
const same = await valid({ pan: 'AAAAA1111A', gst: null, gstFile: null });
r = await submit({ ...same, contacts: [{ name: same.signatory.name, email: same.signatory.email, mobile: same.signatory.mobile, idProofFile: same.signatory.idProofFile, photoFile: same.signatory.photoFile }] });
ok('"Same as Signatory" reusing the same files works', r.status === 201, r.body);

// ---- Duplicates: simulate that the first registration completed verification (build step 4 does this)
await mongoose.connection.db!.collection('registrations').updateOne({ _id: reg!._id }, { $set: { status: 'pending_accounts', panLock: 'ABCDE1234F', gstLock: '29ABCDE1234F1Z5', applicationId: 'APP-TEST-1' } });
await User.create({ name: 'Existing', email: 'existing@example.com', mobile: '9000000001', role: 'franchise_user', passwordHash: 'x' });

r = await submit(await valid());
ok('duplicate PAN blocked', r.status === 409 && /PAN already exists/.test(r.body.error.fields?.pan?.[0]), r.body);
r = await submit(await valid({ pan: 'ZZZZZ9999Z', gst: '29ABCDE1234F1Z5' }));
ok('duplicate GST blocked (GST/PAN mismatch caught first)', r.status === 400 || r.status === 409, r.body);
// GST owned by the existing registration but with matching PAN is the PAN case; test GST lock alone:
await mongoose.connection.db!.collection('registrations').updateOne({ _id: reg!._id }, { $set: { gstLock: '27BBBBB2222B1Z5' } });
r = await submit(await valid({ pan: 'BBBBB2222B', gst: '27BBBBB2222B1Z5' }));
ok('duplicate GST blocked', r.status === 409 && /GST number already exists/.test(r.body.error.fields?.gst?.[0]), r.body);

const withExisting = await valid({ pan: 'CCCCC3333C', gst: null, gstFile: null });
r = await submit({ ...withExisting, signatory: { ...withExisting.signatory, email: 'EXISTING@example.com', mobile: '9000000001' } });
ok('existing account email and mobile blocked ("log in instead")', r.status === 409 && /log in instead/.test(r.body.error.fields?.['signatory.email']?.[0]) && /log in instead/.test(r.body.error.fields?.['signatory.mobile']?.[0]), r.body);

const dupContact = await valid({ pan: 'DDDDD4444D', gst: null, gstFile: null });
const dupBody = {
  ...dupContact,
  signatory: { ...dupContact.signatory, email: 'new.person@example.com', mobile: '7000000007' },
  contacts: [{ ...dupContact.contacts[0], email: 'priya@example.com' }, dupContact.contacts[1]],
};
r = await submit(dupBody);
const warned = r.body.error?.warnings ?? [];
ok('email/mobile used in another registration -> warning (not saved yet)', r.status === 409 && r.body.error.code === 'duplicate_warning' && warned.some((w: any) => w.field === 'contacts.0.email') && warned.some((w: any) => w.field === 'contacts.0.mobile'), r.body);
ok('nothing saved before the applicant chooses to continue', !(await Registration.exists({ pan: 'DDDDD4444D' })));
r = await submit({ ...dupBody, acknowledgeDuplicates: true });
const flagged = await Registration.findOne({ pan: 'DDDDD4444D' });
const flag = await DuplicateFlag.findOne({ registrationId: flagged?._id });
ok('after "Continue": saved with an open duplicate flag for Admin', r.status === 201 && flagged?.hasOpenDuplicateFlag === true && flag?.status === 'open' && flag.matches.some((m) => m.matchedApplicationId === 'APP-TEST-1'), flag?.toObject());

// ---- Agreement changed while the form was open
const v2 = await agreements.createDraft({ title: 'Typed', format: 'text', content: '<p>For {{firm_name}}</p>' }, actor);
await agreements.activateVersion(v2.id, actor);
const stale = await valid({ pan: 'EEEEE5555E', gst: null, gstFile: null });
const regsBefore = await Registration.countDocuments();
const claimedBefore = await PendingUpload.countDocuments({ claimedBy: { $ne: null } });
r = await submit({ ...stale, signatory: { ...stale.signatory, email: 'stale@example.com', mobile: '7111111111' }, contacts: [{ ...stale.contacts[0], email: 'c1@example.com', mobile: '7222222222' }] });
ok('old agreement version refused with "read and accept the latest"', r.status === 409 && r.body.error.code === 'agreement_changed', r.body);
ok('nothing half-saved when refused (transaction rolled back)', (await Registration.countDocuments()) === regsBefore && (await PendingUpload.countDocuments({ claimedBy: { $ne: null } })) === claimedBefore);

const typed = await valid({ pan: 'FFFFF6666F', gst: null, gstFile: null, agreement: { agreementVersionId: v2.id, accepted: true } });
r = await submit({ ...typed, firmName: 'Acme & Co', signatory: { ...typed.signatory, email: 'acme@example.com', mobile: '7333333333' }, contacts: [{ ...typed.contacts[0], email: 'c2@example.com', mobile: '7444444444' }] });
const typedReg = await Registration.findOne({ pan: 'FFFFF6666F' });
const typedAcc = await AgreementAcceptance.findOne({ registrationId: typedReg?._id });
ok('typed agreement acceptance stores the personalised text', r.status === 201 && typedAcc?.snapshot?.html === '<p>For Acme &amp; Co</p>', typedAcc?.toObject());

// ---- Permanent records
let blocked = 0;
for (const attempt of [
  () => SubmissionVersion.updateOne({ _id: snap!._id }, { version: 9 }),
  () => SubmissionVersion.deleteOne({ _id: snap!._id }),
  () => RegistrationDocument.updateOne({ _id: docs[0]._id }, { fileName: 'x' }),
  () => RegistrationDocument.deleteMany({ registrationId: reg!._id }),
]) { try { await attempt(); } catch { blocked++; } }
ok('submission snapshots and documents cannot be changed or deleted', blocked === 4);

// ---- Audit
const audits = await mongoose.connection.db!.collection('auditlogs').find({ action: { $in: ['registration_submitted', 'duplicate_flag_raised'] } }).toArray();
ok('registrations and duplicate flags are in the audit log', audits.filter((a) => a.action === 'registration_submitted').length === 4 && audits.some((a) => a.action === 'duplicate_flag_raised'), audits.map((a) => a.action));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
server.close();
await mongoose.disconnect();
await rs.stop();
rmSync(storageDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
