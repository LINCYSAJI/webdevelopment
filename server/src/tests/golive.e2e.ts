// Go-live connections (build step 9): the private S3-compatible bucket and SMTP email.
// Both are exercised against stand-ins that run inside this test (nothing leaves this computer):
// a minimal S3 server (path-style PUT / GET / DELETE with "If-None-Match") and an SMTP server.
// Also checks the production start-up guards. Run with: npm test.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SMTPServer } from 'smtp-server';
import { S3Storage } from '../lib/s3-storage';
import { SmtpEmail } from '../lib/smtp-email';

let failures = 0;
const ok = (label: string, cond: boolean, extra?: unknown) => {
  if (!cond) failures++;
  console.log(cond ? 'PASS' : 'FAIL', label, cond || extra === undefined ? '' : JSON.stringify(extra));
};

// ---------- Stand-in S3 bucket ----------
const objects = new Map<string, Buffer>();
const seen: { method: string; headers: Record<string, string | string[] | undefined> }[] = [];
const s3 = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    seen.push({ method: req.method!, headers: req.headers });
    const key = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256')) {
      res.writeHead(403).end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }
    if (req.method === 'PUT') {
      if (req.headers['if-none-match'] === '*' && objects.has(key)) {
        res.writeHead(412, { 'Content-Type': 'application/xml' }).end('<Error><Code>PreconditionFailed</Code><Message>At least one of the pre-conditions you specified did not hold</Message></Error>');
        return;
      }
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200, { ETag: '"x"' }).end();
    } else if (req.method === 'GET') {
      const data = objects.get(key);
      if (!data) {
        res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
        return;
      }
      res.writeHead(200, { 'Content-Length': String(data.length), 'Content-Type': 'application/octet-stream' }).end(data);
    } else if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
    } else res.writeHead(405).end();
  });
});
await new Promise<void>((r) => s3.listen(0, '127.0.0.1', () => r()));
const storage = new S3Storage({
  bucket: 'portal-files',
  region: 'ap-south-1',
  endpoint: `http://127.0.0.1:${(s3.address() as AddressInfo).port}`,
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  forcePathStyle: true,
  serverSideEncryption: true,
});

const data = Buffer.from('%PDF-1.7 agreement bytes');
await storage.put('agreements/a.pdf', data);
ok('S3: a file is stored in the bucket (signed request)', Buffer.compare(objects.get('/portal-files/agreements/a.pdf') ?? Buffer.alloc(0), data) === 0);
ok('S3: uploads ask the bucket never to overwrite and to encrypt', seen.some((s) => s.method === 'PUT' && s.headers['if-none-match'] === '*' && s.headers['x-amz-server-side-encryption'] === 'AES256'));
const overwrite = await storage.put('agreements/a.pdf', Buffer.from('changed')).then(() => 'stored', (e: Error) => e.message);
ok('S3: an existing file is never overwritten', /Refusing to overwrite/.test(overwrite) && Buffer.compare(objects.get('/portal-files/agreements/a.pdf')!, data) === 0, overwrite);
ok('S3: read returns the same bytes', Buffer.compare(await storage.read('agreements/a.pdf'), data) === 0);
const opened = await storage.open('agreements/a.pdf');
const streamed: Buffer[] = [];
for await (const c of opened.stream) streamed.push(Buffer.from(c));
ok('S3: open streams the file with its size', opened.size === data.length && Buffer.compare(Buffer.concat(streamed), data) === 0);
await storage.remove('agreements/a.pdf');
ok('S3: remove deletes it (used only by erasure and clean-up)', !objects.has('/portal-files/agreements/a.pdf'));
ok('S3: a missing file is an error, not empty content', await storage.read('nope.pdf').then(() => false, () => true));
s3.close();

// ---------- Stand-in SMTP server ----------
const received: { from: string; to: string[]; raw: string; user: string | undefined }[] = [];
const smtp = new SMTPServer({
  secure: false,
  authOptional: false,
  // No certificate here: the stand-in offers no TLS, so the portal's default (TLS required) must refuse it.
  disabledCommands: ['STARTTLS'],
  allowInsecureAuth: true,
  onAuth(auth, _session, cb) {
    if (auth.username === 'mailer' && auth.password === 'secret') return cb(null, { user: auth.username });
    return cb(new Error('Invalid login'));
  },
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      received.push({ from: String(session.envelope.mailFrom && session.envelope.mailFrom.address), to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString('utf8'), user: session.user as string | undefined });
      cb();
    });
  },
});
await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r()));
const smtpPort = (smtp.server.address() as AddressInfo).port;

// The stand-in has no TLS certificate, so for this local check only TLS is not required.
const allowPlain = (m: SmtpEmail) => {
  const o = (m as unknown as { transporter: { transporter: { options: { requireTLS: boolean; ignoreTLS: boolean } } } }).transporter.transporter.options;
  o.requireTLS = false;
  o.ignoreTLS = true;
};
const mailer = new SmtpEmail({ host: '127.0.0.1', port: smtpPort, user: 'mailer', password: 'secret', from: 'Franchise Portal <no-reply@example.com>', replyTo: 'support@example.com' });
allowPlain(mailer);
await mailer.send({
  to: 'priya@example.com',
  subject: 'Application submitted: APP-2026-0001',
  html: '<p>Hello Priya</p>',
  text: 'Hello Priya',
  attachments: [{ filename: 'FRN-2026-0001.pdf', content: data, contentType: 'application/pdf' }],
});
const mail = received[0];
ok('SMTP: email delivered to the recipient after logging in', mail?.to.join() === 'priya@example.com' && mail.user === 'mailer', mail && { to: mail.to, user: mail.user });
ok('SMTP: sender, reply-to and subject are set', !!mail && mail.from === 'no-reply@example.com' && /Reply-To: support@example\.com/i.test(mail.raw) && /Subject: Application submitted: APP-2026-0001/.test(mail.raw));
ok('SMTP: HTML and plain-text versions and the PDF attachment are included', !!mail && /text\/html/.test(mail.raw) && /text\/plain/.test(mail.raw) && /filename=FRN-2026-0001\.pdf/.test(mail.raw));
const wrong = new SmtpEmail({ host: '127.0.0.1', port: smtpPort, user: 'mailer', password: 'bad', from: 'x@example.com' });
allowPlain(wrong);
ok('SMTP: a wrong password is reported as a failure (retried and logged by the email service)', await wrong.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' }).then(() => false, () => true));
const plain = new SmtpEmail({ host: '127.0.0.1', port: smtpPort, user: 'mailer', password: 'secret', from: 'x@example.com' });
ok('SMTP: by default an email is never sent without TLS encryption', await plain.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' }).then(() => false, () => true));
smtp.close();

// ---------- Production start-up guards ----------
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function startWith(env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/config.ts').then(() => console.log('CONFIG OK'))"], {
    cwd: serverDir,
    env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', DOTENV_CONFIG_PATH: 'none.env', ...env },
    encoding: 'utf8',
  });
  return `${r.stdout}${r.stderr}`;
}
const live = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/franchise_portal',
  JWT_ACCESS_SECRET: 'p'.repeat(48),
  CLIENT_ORIGIN: 'https://portal.example.com',
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'secret',
  EMAIL_FROM: 'Franchise Portal <no-reply@example.com>',
  SMS_PROVIDER: 'networkz',
  NETWORKZ_SMS_ACCESS_TOKEN: 't',
  NETWORKZ_SMS_ACCESS_TOKEN_KEY: 'k',
  NETWORKZ_SMS_ENTITY_ID: '1701158157975781029',
  NETWORKZ_SMS_SENDER_ID: 'NETSYS',
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'portal-files',
  S3_REGION: 'ap-south-1',
  S3_ACCESS_KEY_ID: 'AKIA',
  S3_SECRET_ACCESS_KEY: 'secret',
};
ok('production starts with live settings', /CONFIG OK/.test(startWith(live)), startWith(live).slice(0, 400));
const refused = (label: string, env: Record<string, string>, expect: RegExp) => {
  const out = startWith({ ...live, ...env });
  ok(`production refuses ${label}`, !/CONFIG OK/.test(out) && expect.test(out), out.slice(0, 300));
};
refused('the test mailbox for email', { EMAIL_PROVIDER: 'dev_outbox' }, /EMAIL_PROVIDER/);
refused('the test mailbox for SMS', { SMS_PROVIDER: 'dev_outbox' }, /SMS_PROVIDER/);
refused('files on the server disk', { STORAGE_PROVIDER: 'local' }, /STORAGE_PROVIDER/);
refused('a website address without https', { CLIENT_ORIGIN: 'http://portal.example.com' }, /https/);
refused('a local database', { MONGODB_URI: 'mongodb://127.0.0.1:27017/?replicaSet=rs0' }, /MONGODB_URI/);
refused('SMTP without a sender address', { EMAIL_FROM: '' }, /EMAIL_FROM/);
refused('S3 without a bucket', { S3_BUCKET: '' }, /S3_BUCKET/);
refused('a short session secret', { JWT_ACCESS_SECRET: 'short' }, /JWT_ACCESS_SECRET/);

// ---------- Gmail settings written with EMAIL_* names ----------
function configWith(env: Record<string, string>) {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', '-e', "import('./src/config.ts').then(({ config: c }) => console.log('CFG ' + JSON.stringify({ p: c.EMAIL_PROVIDER, h: c.SMTP_HOST, port: c.SMTP_PORT, u: c.SMTP_USER, pw: c.SMTP_PASSWORD, from: c.EMAIL_FROM })))"],
    { cwd: serverDir, env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', DOTENV_CONFIG_PATH: 'none.env', MONGODB_URI: 'mongodb://127.0.0.1:27017/x', JWT_ACCESS_SECRET: 'p'.repeat(40), ...env }, encoding: 'utf8' },
  );
  const line = /CFG (.*)/.exec(r.stdout)?.[1];
  return line ? JSON.parse(line) : { error: `${r.stdout}${r.stderr}`.slice(0, 300) };
}
const gmail = configWith({
  EMAIL_PROVIDER: 'gmail',
  EMAIL_HOST: 'smtp.gmail.com',
  EMAIL_PORT: '587',
  EMAIL_SECURE: 'false',
  EMAIL_USER: 'portal.mailer@gmail.com',
  EMAIL_PASSWORD: 'abcd efgh ijkl mnop',
  EMAIL_FROM_NAME: 'Franchise Agreement Portal',
  EMAIL_FROM_EMAIL: 'portal.mailer@gmail.com',
});
ok('Gmail: EMAIL_PROVIDER=gmail with EMAIL_* names becomes SMTP on smtp.gmail.com:587', gmail.p === 'smtp' && gmail.h === 'smtp.gmail.com' && gmail.port === 587 && gmail.u === 'portal.mailer@gmail.com', gmail);
ok('Gmail: the sender shows the portal name', gmail.from === '"Franchise Agreement Portal" <portal.mailer@gmail.com>', gmail.from);
ok('Gmail: spaces in the App Password are removed', gmail.pw === 'abcdefghijklmnop');
const gmailMinimal = configWith({ EMAIL_PROVIDER: 'gmail', EMAIL_USER: 'portal.mailer@gmail.com', EMAIL_PASSWORD: 'abcdefghijklmnop' });
ok('Gmail: host, port and sender default sensibly', gmailMinimal.h === 'smtp.gmail.com' && gmailMinimal.port === 587 && gmailMinimal.from === 'portal.mailer@gmail.com', gmailMinimal);
const noPassword = configWith({ EMAIL_PROVIDER: 'gmail', EMAIL_USER: 'portal.mailer@gmail.com' });
ok('Gmail: a missing password stops the server with a clear message', /EMAIL_PASSWORD/.test(noPassword.error ?? ''), noPassword);
const smtpNames = configWith({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASSWORD: 'p w', EMAIL_FROM: 'x@example.com', EMAIL_HOST: 'ignored.example.com' });
ok('the SMTP_* names still work and win over EMAIL_* names (spaces kept for non-Gmail)', smtpNames.h === 'smtp.example.com' && smtpNames.pw === 'p w', smtpNames);

console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
