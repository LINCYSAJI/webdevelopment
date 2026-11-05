/**
 * Recorded end-to-end walkthrough of the Franchise Online Agreement Portal (development only).
 *
 * Drives a real Chromium browser through every main flow at a human pace — visible cursor,
 * a highlight on each control before it is used, and captions — records one continuous video,
 * and logs every browser error and failed request it sees.
 *
 *   npm run dev            (in another terminal: database, API and website)
 *   npm run walkthrough    (from the repository root)
 *
 * Output: portal-walkthrough.mp4 in the repository root, and e2e/results/report.json.
 * It creates one new test application in the DEVELOPMENT database (never run it against live data).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from 'playwright';
import ffmpegPath from 'ffmpeg-static';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RESULTS = path.join(HERE, 'results');
const BASE = process.env.WALKTHROUGH_URL ?? 'http://localhost:5173';
const OUTPUT = path.join(ROOT, 'portal-walkthrough.mp4');
const STAFF_PASSWORD = process.env.WALKTHROUGH_STAFF_PASSWORD ?? 'Portal@2026';
const VIEWPORT = { width: 1366, height: 768 };

// ---------- Unique test applicant (development data only) ----------
const rnd = (n: number, chars: string) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const run = rnd(4, '0123456789');
const applicant = {
  firm: `Sunrise Retail ${run}`,
  model: 'Express Store',
  pan: `${rnd(3, LETTERS)}P${rnd(1, LETTERS)}${rnd(4, '0123456789')}${rnd(1, LETTERS)}`,
  name: 'Priya Sharma',
  email: `priya.${run}@example.com`,
  mobile: `9${rnd(9, '0123456789')}`,
  password: 'Sunrise@2026',
};

// ---------- What the run found ----------
interface Problem {
  at: string;
  flow: string;
  kind: 'console' | 'pageerror' | 'http' | 'step';
  detail: string;
}
const problems: Problem[] = [];
const steps: { flow: string; step: string; ok: boolean; ms: number }[] = [];
let currentFlow = 'Start';

// Expected "errors" that are part of normal behaviour, not faults.
const EXPECTED_HTTP = [
  { status: 401, url: /\/api\/auth\/(me|refresh)$/ }, // checking for a session while logged out
];

// ---------- Overlay: cursor, highlight, captions, title cards ----------
const OVERLAY = `
(() => {
  const css = \`
  #__cur{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .05s linear;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
  #__ring{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #f59e0b;z-index:2147483646;pointer-events:none;opacity:0;transform:scale(.4)}
  #__ring.go{animation:__ring .5s ease-out}
  @keyframes __ring{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}
  #__hl{position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #f59e0b;border-radius:8px;box-shadow:0 0 0 4px rgba(245,158,11,.25),0 0 18px rgba(245,158,11,.55);opacity:0;transition:all .25s ease}
  #__cap{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:min(1100px,92vw);z-index:2147483644;pointer-events:none;background:rgba(15,18,32,.88);color:#fff;font:600 17px/1.4 Segoe UI,system-ui,sans-serif;padding:10px 18px;border-radius:10px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.3)}
  #__cap small{display:block;font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fbbf24;margin-bottom:2px}
  #__cap:empty{display:none}
  #__card{position:fixed;inset:0;z-index:2147483643;display:flex;align-items:center;justify-content:center;background:rgba(15,18,32,.92);color:#fff;font-family:Segoe UI,system-ui,sans-serif;text-align:center;opacity:0;pointer-events:none;transition:opacity .4s}
  #__card.on{opacity:1}
  #__card h1{font-size:40px;margin:0 0 10px} #__card p{font-size:20px;color:#cbd5e1;margin:0;max-width:900px} #__card .k{color:#fbbf24;font-size:15px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-bottom:14px}\`;
  const mount = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st);
    const cur = document.createElement('div'); cur.id = '__cur';
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ring = document.createElement('div'); ring.id = '__ring';
    const hl = document.createElement('div'); hl.id = '__hl';
    const cap = document.createElement('div'); cap.id = '__cap';
    const card = document.createElement('div'); card.id = '__card';
    document.body.append(hl, ring, cap, card, cur);
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem('__wt') || '{}'); } catch {}
    if (saved.cap) cap.innerHTML = saved.cap;
    const x = saved.x ?? innerWidth / 2, y = saved.y ?? innerHeight / 2;
    cur.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)';
    addEventListener('mousemove', (e) => {
      cur.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)';
      try { const s = JSON.parse(sessionStorage.getItem('__wt') || '{}'); s.x = e.clientX; s.y = e.clientY; sessionStorage.setItem('__wt', JSON.stringify(s)); } catch {}
    }, true);
    addEventListener('mousedown', (e) => { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); }, true);
    window.__wt = {
      caption(html) { cap.innerHTML = html; try { const s = JSON.parse(sessionStorage.getItem('__wt') || '{}'); s.cap = html; sessionStorage.setItem('__wt', JSON.stringify(s)); } catch {} },
      highlight(r) { if (!r) { hl.style.opacity = 0; return; } Object.assign(hl.style, { left: r.x - 6 + 'px', top: r.y - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px', opacity: 1 }); },
      card(kicker, title, text) { if (!title) { card.classList.remove('on'); return; } card.innerHTML = '<div><div class="k">' + kicker + '</div><h1>' + title + '</h1><p>' + text + '</p></div>'; card.classList.add('on'); },
    };
  };
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);
})();
`;

// ---------- Human-paced helpers ----------
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let page: Page;
const mouse = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

async function overlay<T>(fn: string, ...args: unknown[]): Promise<T | undefined> {
  try {
    await page.waitForFunction(() => !!(window as unknown as { __wt?: unknown }).__wt, undefined, { timeout: 5000 });
    return (await page.evaluate(([f, a]) => (window as any).__wt[f as string](...(a as unknown[])), [fn, args] as const)) as T;
  } catch {
    return undefined;
  }
}

async function caption(text: string) {
  await overlay('caption', `<small>${currentFlow}</small>${text}`);
  await wait(900);
}

async function titleCard(kicker: string, title: string, text: string, ms = 3200) {
  await overlay('card', kicker, title, text);
  await wait(ms);
  await overlay('card', '', '', '');
  await wait(450);
}

async function moveTo(x: number, y: number) {
  const dist = Math.hypot(x - mouse.x, y - mouse.y);
  const steps = Math.max(8, Math.min(45, Math.round(dist / 18)));
  // A slight curve so it feels hand-moved.
  const cx = (mouse.x + x) / 2 + (Math.random() - 0.5) * Math.min(120, dist / 4);
  const cy = (mouse.y + y) / 2 + (Math.random() - 0.5) * Math.min(80, dist / 5);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const px = (1 - e) ** 2 * mouse.x + 2 * (1 - e) * e * cx + e ** 2 * x;
    const py = (1 - e) ** 2 * mouse.y + 2 * (1 - e) * e * cy + e ** 2 * y;
    await page.mouse.move(px, py);
    await wait(14);
  }
  mouse.x = x;
  mouse.y = y;
}

async function scrollTo(target: Locator) {
  await target.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await wait(750);
}

/** Glide to an element, highlight it, and leave the cursor on it. */
async function point(target: Locator, { highlight = true, linger = 450 } = {}) {
  await target.waitFor({ state: 'visible', timeout: 20000 });
  await scrollTo(target);
  const box = await target.boundingBox();
  if (!box) throw new Error('Element has no position on screen');
  await moveTo(box.x + Math.min(box.width / 2, 60 + Math.random() * 30), box.y + box.height / 2);
  if (highlight) await overlay('highlight', box);
  await wait(linger);
}

async function unhighlight() {
  await overlay('highlight', null);
}

async function click(target: Locator, opts: { linger?: number } = {}) {
  await point(target, opts);
  await page.mouse.down();
  await wait(90);
  await page.mouse.up();
  await unhighlight();
  await wait(550);
}

async function type(target: Locator, text: string, { clear = false } = {}) {
  await point(target);
  await page.mouse.down();
  await page.mouse.up();
  if (clear) {
    await target.press('Control+A');
    await wait(200);
    await target.press('Backspace');
    await wait(250);
  }
  await target.pressSequentially(text, { delay: 55 + Math.random() * 35 });
  await unhighlight();
  await wait(350);
}

async function choose(target: Locator, value: string) {
  await point(target);
  await target.selectOption(value);
  await unhighlight();
  await wait(500);
}

async function tick(target: Locator) {
  await click(target);
}

async function upload(field: string, file: string) {
  const wrap = page.locator(`[data-field="${field}"]`).first();
  const button = wrap.getByText(/Choose file|Replace/).first();
  await point(button);
  await page.mouse.down();
  await page.mouse.up();
  await wrap.locator('input[type="file"]').setInputFiles(file);
  await unhighlight();
  await wrap.getByText('Uploading…').waitFor({ state: 'detached', timeout: 20000 }).catch(() => undefined);
  await wait(700);
}

const field = (path: string) => page.locator(`[data-field="${path}"] input, [data-field="${path}"] select, [data-field="${path}"] textarea`).first();
const button = (name: string | RegExp) => page.getByRole('button', { name }).filter({ visible: true }).first();
const link = (name: string | RegExp) => page.getByRole('link', { name }).filter({ visible: true }).first();
const dialog = () => page.locator('[role="dialog"][aria-modal]').filter({ visible: true }).last();

async function step(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    steps.push({ flow: currentFlow, step: name, ok: true, ms: Date.now() - t });
  } catch (err) {
    steps.push({ flow: currentFlow, step: name, ok: false, ms: Date.now() - t });
    problems.push({ at: page.url(), flow: currentFlow, kind: 'step', detail: `${name}: ${(err as Error).message.split('\n')[0]}` });
    await page.screenshot({ path: path.join(RESULTS, `failed-${steps.length}.png`) }).catch(() => undefined);
    throw err;
  }
}

async function login(identifier: string, password: string, who: string) {
  await step(`Log in as ${who}`, async () => {
    if (!page.url().endsWith('/login')) await page.goto(`${BASE}/login`);
    await caption(`Logging in as <b>${who}</b>`);
    await type(page.locator('#identifier'), identifier);
    await type(page.locator('#password'), password);
    await click(page.locator('button[type="submit"]'));
    await page.waitForURL(/\/app/, { timeout: 20000 });
    await wait(1200);
  });
}

async function logout() {
  await step('Log out', async () => {
    await caption('Logging out');
    await click(button('Logout'));
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await wait(800);
  });
}

async function nav(label: string) {
  await click(page.locator('aside nav a').filter({ hasText: new RegExp(`^${label}$`) }).filter({ visible: true }).first());
  await wait(1200);
}

// ---------- Mailbox (development test mailbox, read through its API) ----------
async function latestCode(to: string[], since: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await page.request.get(`${BASE}/api/dev/outbox`);
    const { emails } = (await res.json()) as { emails: { to: string; subject: string; html: string; at: string }[] };
    const hit = emails.find((e) => to.includes(e.to) && new Date(e.at).getTime() >= since - 2000);
    if (hit) {
      const text = `${hit.subject} ${(hit.html ?? '').replace(/<[^>]+>/g, ' ')}`;
      const code = /\b(\d{6})\b/.exec(text)?.[1];
      if (code) return code;
    }
    await wait(500);
  }
  throw new Error(`No code arrived for ${to.join(' / ')}`);
}

// ---------- Test files ----------
async function makeFiles(browser: import('playwright').Browser) {
  const dir = path.join(RESULTS, 'files');
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const p = await ctx.newPage();
  const card = async (file: string, title: string, lines: string[], color: string) => {
    await p.setContent(`<body style="margin:0"><div style="width:640px;height:400px;box-sizing:border-box;padding:28px;font-family:Segoe UI,sans-serif;background:linear-gradient(135deg,${color},#fff);border:6px solid ${color}">
      <div style="font-size:30px;font-weight:800;color:#0f172a">${title}</div><div style="font-size:15px;color:#334155;margin-top:4px">SAMPLE · TEST DOCUMENT · NOT VALID</div>
      <div style="display:flex;gap:24px;margin-top:28px"><div style="width:130px;height:160px;border-radius:10px;background:#cbd5e1;display:flex;align-items:center;justify-content:center;font-size:60px">👤</div>
      <div style="font-size:20px;line-height:1.7;color:#0f172a">${lines.join('<br>')}</div></div></div></body>`);
    await p.screenshot({ path: path.join(dir, file) });
  };
  await card('pan-card.png', 'Permanent Account Number Card', [`Name: ${applicant.firm}`, `PAN: ${applicant.pan}`], '#93c5fd');
  await card('id-proof.png', 'Identity Proof', [`Name: ${applicant.name}`, 'ID: SAMPLE-0001'], '#86efac');
  await p.setContent('<body style="margin:0;display:flex;align-items:center;justify-content:center;width:640px;height:400px;background:#e0e7ff;font-size:220px">🧑‍💼</body>');
  await p.screenshot({ path: path.join(dir, 'photo.png') });
  await ctx.close();

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pg = pdf.addPage([595, 842]);
  pg.drawText('RENTAL AGREEMENT (SAMPLE TEST DOCUMENT)', { x: 60, y: 760, size: 16, font, color: rgb(0.1, 0.1, 0.3) });
  pg.drawText(`Premises let to ${applicant.firm}.`, { x: 60, y: 720, size: 12, font });
  writeFileSync(path.join(dir, 'rental.pdf'), await pdf.save());
  return {
    pan: path.join(dir, 'pan-card.png'),
    id: path.join(dir, 'id-proof.png'),
    photo: path.join(dir, 'photo.png'),
    rental: path.join(dir, 'rental.pdf'),
  };
}

// =====================================================================================
async function main() {
  rmSync(RESULTS, { recursive: true, force: true });
  mkdirSync(path.join(RESULTS, 'video'), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const files = await makeFiles(browser);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: path.join(RESULTS, 'video'), size: VIEWPORT },
    acceptDownloads: true,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
  await context.addInitScript(OVERLAY);
  page = await context.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') problems.push({ at: page.url(), flow: currentFlow, kind: 'console', detail: m.text().slice(0, 400) });
  });
  page.on('pageerror', (e) => problems.push({ at: page.url(), flow: currentFlow, kind: 'pageerror', detail: e.message.slice(0, 400) }));
  page.on('response', (r) => {
    const url = r.url();
    if (r.status() < 400 || !url.includes('/api/')) return;
    if (EXPECTED_HTTP.some((e) => e.status === r.status() && e.url.test(new URL(url).pathname))) return;
    problems.push({ at: page.url(), flow: currentFlow, kind: 'http', detail: `${r.request().method()} ${new URL(url).pathname} → ${r.status()}` });
  });

  let applicationId = '';
  let reference = '';
  let failed: Error | null = null;

  try {
    await page.goto(`${BASE}/login`);
    await wait(800);
    await titleCard('Franchise Online Agreement Portal', 'End-to-end walkthrough', 'A real browser, driven step by step: registration, verification, Accounts review, resubmission, Manager approval with the agreement PDF, Admin oversight and privacy controls.', 4500);

    // ---------------- Flow 1: public pages ----------------
    currentFlow = 'Flow 1 · Public pages';
    await titleCard('Flow 1 of 8', 'Public pages', 'The login page, the legal footer and the Privacy Policy.');
    await step('Footer links to the legal pages', async () => {
      await caption('The login page. Every page has a footer with the Privacy Policy and Terms &amp; Conditions');
      await point(page.locator('footer'));
      await unhighlight();
      await click(link('Privacy Policy'));
      await page.waitForURL(/privacy-policy/);
      await caption('The Privacy Policy, written for the DPDP Act 2023, with business details from Settings');
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 420);
        await wait(700);
      }
      await click(link('Terms & Conditions'));
      await page.waitForURL(/terms/);
      await caption('The Terms &amp; Conditions page');
      await page.mouse.wheel(0, 500);
      await wait(1200);
      await page.goto(`${BASE}/login`);
      await wait(900);
    });

    // ---------------- Flow 2: registration ----------------
    currentFlow = 'Flow 2 · New franchise registration';
    await titleCard('Flow 2 of 8', 'A new franchise partner registers', `${applicant.name} registers “${applicant.firm}”, uploads documents and accepts the agreement.`);
    await step('Open the registration form', async () => {
      await caption('Opening the public registration form');
      await click(link(/Register as a Franchise Partner/));
      await page.waitForURL(/\/register/);
      await field('franchiseModel').waitFor();
    });
    await step('Section 1: Franchise details', async () => {
      await caption('Section 1 · Franchise details');
      await type(field('franchiseModel'), applicant.model);
      await choose(field('firmType'), 'Partnership Firm');
      await type(field('firmName'), applicant.firm);
    });
    await step('Section 2: PAN validation and documents', async () => {
      await caption('Section 2 · A wrong PAN shows a clear message straight away');
      await type(field('pan'), 'ABC12');
      await page.locator('#firm').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
      await point(page.locator('[data-field="pan"]'));
      await wait(1400);
      await unhighlight();
      await caption('Correcting the PAN');
      await type(field('pan'), applicant.pan, { clear: true });
      await caption('Uploading the PAN card image (each file is checked by its content, not its name)');
      await upload('panFile', files.pan);
      await caption('Uploading the optional rental agreement (PDF)');
      await upload('rentalFile', files.rental);
    });
    await step('Section 3: Applicant / signatory', async () => {
      await caption('Section 3 · The applicant, who will own the login');
      await type(field('signatory.name'), applicant.name);
      await choose(field('signatory.capacity'), 'Partner');
      await type(field('signatory.email'), applicant.email);
      await type(field('signatory.mobile'), applicant.mobile);
      await caption('ID proof and photograph');
      await upload('signatory.idProofFile', files.id);
      await upload('signatory.photoFile', files.photo);
    });
    await step('Section 4: Contact person', async () => {
      await caption('Section 4 · “Same as Applicant” copies the signatory’s details into Contact 1');
      await tick(page.getByLabel('Same as Applicant / Authorised Signatory'));
      await point(page.locator('fieldset').first(), { linger: 1200 });
      await unhighlight();
    });
    await step('Section 5: Agreement and consent', async () => {
      await caption('Section 5 · The active franchise agreement, shown page by page');
      const viewer = page.locator('#agreement');
      await point(viewer.locator('canvas, iframe, [role="document"]').first(), { highlight: false });
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 350);
        await wait(650);
      }
      await caption('Register stays disabled until both boxes are ticked');
      await point(button(/^Register$/), { linger: 900 });
      await unhighlight();
      await caption('Accepting the franchise agreement');
      await tick(page.locator('[data-field="agreement.accepted"] input'));
      await caption('Consent to the Terms &amp; Conditions and Privacy Policy (DPDP Act), with links to both');
      await tick(page.locator('[data-field="legalConsent"] input'));
    });
    await step('Submit the registration', async () => {
      await caption('Submitting the registration');
      const since = Date.now();
      await click(button(/^Register$/));
      const warn = page.getByText('Some details are already in use');
      await Promise.race([page.waitForURL(/\/register\/verify/, { timeout: 30000 }), warn.waitFor({ timeout: 30000 })]);
      if (await warn.isVisible().catch(() => false)) {
        await caption('A possible duplicate was found; continuing so Admin can review it');
        await click(dialog().getByRole('button', { name: /Continue/ }));
        await page.waitForURL(/\/register\/verify/, { timeout: 30000 });
      }
      (globalThis as any).__codesSince = since;
    });

    // ---------------- Flow 3: verification ----------------
    currentFlow = 'Flow 3 · Email and mobile verification';
    await titleCard('Flow 3 of 8', 'Verifying email and mobile', 'Codes are sent automatically. In development they arrive in the test mailbox.');
    await step('Verify the email code', async () => {
      const since = (globalThis as any).__codesSince as number;
      const emailBox = page.locator('form').filter({ hasText: 'Email verification' });
      await emailBox.locator('input').waitFor();
      await page.waitForFunction(() => !document.querySelector('form input[autocomplete="one-time-code"]:disabled'), undefined, { timeout: 30000 }).catch(() => undefined);
      const code = await latestCode([applicant.email], since);
      await caption(`The email code (read from the development test mailbox) is <b>${code}</b>`);
      await type(emailBox.locator('input'), code);
      await click(emailBox.getByRole('button', { name: 'Verify' }));
      await page.getByText('✅ Verified').first().waitFor({ timeout: 20000 });
    });
    await step('Verify the SMS code', async () => {
      const since = (globalThis as any).__codesSince as number;
      const smsBox = page.locator('form').filter({ hasText: 'Mobile verification' });
      const code = await latestCode([applicant.mobile, `+91 ${applicant.mobile}`], since);
      await caption(`The SMS code is <b>${code}</b>`);
      await type(smsBox.locator('input'), code);
      await click(smsBox.getByRole('button', { name: 'Verify' }));
    });
    await step('Set a password and create the account', async () => {
      await page.getByText('Choose a password').waitFor({ timeout: 20000 });
      await caption('Both verified. Choosing a password creates the account and submits the application');
      const pw = page.locator('input[type="password"]');
      await type(pw.nth(0), applicant.password);
      await type(pw.nth(1), applicant.password);
      await click(button('Create Account'));
      await page.waitForURL(/\/register\/success/, { timeout: 30000 });
      applicationId = ((await page.getByText(/APP-\d{4}-\d{4}/).first().textContent()) ?? '').match(/APP-\d{4}-\d{4}/)?.[0] ?? '';
      await caption(`Application submitted: <b>${applicationId}</b>`);
      await point(page.getByText(applicationId).first(), { linger: 1800 });
      await unhighlight();
    });
    await step('Applicant dashboard and My Application', async () => {
      await click(link(/dashboard/i).or(button(/dashboard/i)).first());
      await page.waitForURL(/\/app$/, { timeout: 15000 });
      await caption('The applicant’s dashboard shows the status and what happens next');
      await wait(1800);
      await nav('My Application');
      await caption('My Application: every detail, document and the history');
      await page.mouse.wheel(0, 500);
      await wait(1500);
    });
    await logout();

    // ---------------- Flow 4: Accounts rejects ----------------
    currentFlow = 'Flow 4 · Accounts review: changes requested';
    await titleCard('Flow 4 of 8', 'Accounts review', 'An Accounts reviewer picks up the new application and asks for a correction.');
    await login('accounts@portal.local', STAFF_PASSWORD, 'Accounts');
    await step('Pick up from the Unassigned queue', async () => {
      await caption('The Accounts dashboard');
      await wait(1500);
      await nav('Pending Applications');
      await caption(`Finding ${applicationId} in the Unassigned queue`);
      const row = page.locator('tr').filter({ hasText: applicationId });
      await point(row, { linger: 900 });
      await caption('Pick Up assigns it to me; two reviewers can never pick up the same one');
      await click(row.getByRole('button', { name: 'Pick Up' }));
      await page.waitForURL(/\/accounts\/applications\//, { timeout: 15000 });
    });
    await step('Review documents and reject with a reason', async () => {
      await caption('Reviewing the details and documents');
      await page.mouse.wheel(0, 600);
      await wait(1400);
      await page.mouse.wheel(0, -600);
      await wait(800);
      await caption('Reject requires a reason the applicant will see');
      await click(button(/^Reject$/));
      await type(page.locator('#reason'), 'Please change the franchise model to “Express Store Plus” as agreed.');
      await click(dialog().getByRole('button', { name: /^Reject$/ }));
      await page.getByText(/Rejected\. The applicant has been emailed/).waitFor({ timeout: 20000 });
      await caption('Rejected. The applicant is emailed the reason and how to resubmit');
      await wait(1500);
    });
    await logout();

    // ---------------- Flow 5: applicant resubmits ----------------
    currentFlow = 'Flow 5 · Applicant edits and resubmits';
    await titleCard('Flow 5 of 8', 'Edit & Resubmit', 'The applicant sees the reason, corrects the form and sends it back.');
    await login(applicant.email, applicant.password, 'the applicant');
    await step('See the reason and open Edit & Resubmit', async () => {
      await caption('The dashboard shows what Accounts asked to change');
      await point(page.getByText(/Express Store Plus/).first(), { linger: 1500 });
      await unhighlight();
      await click(link(/Edit & Resubmit/));
      await page.waitForURL(/resubmit/);
      await field('franchiseModel').waitFor({ timeout: 20000 });
    });
    await step('Correct the franchise model and resubmit', async () => {
      await caption('Everything is pre-filled; documents are kept unless replaced');
      await type(field('franchiseModel'), 'Express Store Plus', { clear: true });
      await caption('Accepting the same agreement version again, and the consent');
      await tick(page.locator('[data-field="agreement.accepted"] input'));
      await tick(page.locator('[data-field="legalConsent"] input'));
      await click(button(/^Resubmit$/));
      const warn = page.getByText('Some details are already in use');
      await Promise.race([page.getByText(/resubmitted/i).first().waitFor({ timeout: 30000 }), warn.waitFor({ timeout: 30000 })]);
      if (await warn.isVisible().catch(() => false)) await click(dialog().getByRole('button', { name: /Continue/ }));
      await caption('Resubmitted. It goes back to the same Accounts reviewer');
      await wait(1800);
    });
    await logout();

    // ---------------- Flow 6: Accounts approves ----------------
    currentFlow = 'Flow 6 · Accounts approves the resubmission';
    await titleCard('Flow 6 of 8', 'Accounts approval', 'The same reviewer sees exactly what changed, then approves.');
    await login('accounts@portal.local', STAFF_PASSWORD, 'Accounts');
    await step('Open from Assigned to Me', async () => {
      await nav('Pending Applications');
      await click(page.getByRole('tab', { name: 'Assigned to Me' }));
      await wait(1000);
      await click(page.locator('tr').filter({ hasText: applicationId }).getByRole('link', { name: applicationId }));
      await page.waitForURL(/\/accounts\/applications\//);
    });
    await step('See the changes and approve', async () => {
      await caption('“Changes since last review” lists exactly what the applicant changed');
      await point(page.getByText('Changes since last review').first(), { linger: 1600 });
      await unhighlight();
      await click(button(/^Approve$/));
      await caption('Approving sends it to the Manager for final approval');
      await click(dialog().getByRole('button', { name: /^Approve$/ }));
      await page.getByText(/now with the Manager/).waitFor({ timeout: 20000 });
      await wait(1500);
    });
    await logout();

    // ---------------- Flow 7: Manager approves, PDF, send ----------------
    currentFlow = 'Flow 7 · Manager approval and the agreement PDF';
    await titleCard('Flow 7 of 8', 'Final approval and the agreement', 'The Manager approves; the reference number and PDF are created automatically, then emailed.');
    await login('manager@portal.local', STAFF_PASSWORD, 'the Manager');
    await step('Open from Pending Approvals', async () => {
      await caption('The Manager dashboard');
      await wait(1400);
      await nav('Pending Approvals');
      await click(page.locator('tr').filter({ hasText: applicationId }).getByRole('link', { name: applicationId }));
      await page.waitForURL(/\/manager\/applications\//);
      await caption('The Manager also sees who approved at Accounts, and when');
      await point(page.getByText('Accounts Decision').locator('..'), { linger: 1400 });
      await unhighlight();
    });
    await step('Final approval generates the PDF', async () => {
      await click(button(/^Approve$/));
      await caption('Final approval: the reference number is assigned and the agreement PDF is generated');
      await click(dialog().getByRole('button', { name: /^Approve$/ }));
      const notice = page.getByText(/Approved with reference number/);
      await notice.waitFor({ timeout: 60000 });
      reference = ((await notice.textContent()) ?? '').match(/[A-Z]{2,6}\/\d{4}\/\d{4}/)?.[0] ?? '';
      await caption(`Approved with reference <b>${reference}</b>`);
      await point(notice, { linger: 1800 });
      await unhighlight();
    });
    await step('View the agreement PDF', async () => {
      await click(link('Go to Generated Agreements'));
      await page.waitForURL(/\/manager\/agreements/);
      const row = page.locator('tr').filter({ hasText: reference });
      await caption('Generated Agreements: only Managers can open, download or send these');
      await point(row, { linger: 1000 });
      await click(row.getByRole('button', { name: 'View' }));
      await caption('The generated agreement, with the required footer on every page');
      await wait(2500);
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 500);
        await wait(800);
      }
      await click(dialog().getByRole('button', { name: 'Close' }));
    });
    await step('Send the agreement to the franchisee', async () => {
      const row = page.locator('tr').filter({ hasText: reference });
      await caption('Sending it to the franchisee. The recipient is always the registered email');
      await click(row.getByRole('button', { name: /Send to Franchisee/ }));
      await dialog().getByRole('button', { name: /^Send$/ }).waitFor();
      await wait(1200);
      await click(dialog().getByRole('button', { name: /^Send$/ }));
      await page.getByText(/sent to|emailed/i).first().waitFor({ timeout: 30000 });
      await wait(1200);
      await caption('Every send is recorded in the email history');
      await click(page.locator('tr').filter({ hasText: reference }).getByRole('button', { name: 'Email History' }));
      await wait(2200);
      await click(dialog().getByRole('button', { name: 'Close' }));
    });
    await logout();

    // ---------------- Flow 8: Admin oversight ----------------
    currentFlow = 'Flow 8 · Admin oversight';
    await titleCard('Flow 8 of 8', 'Admin oversight', 'Dashboard, all registrations, duplicate review, tracking, exports and privacy requests.');
    await login('admin@portal.local', STAFF_PASSWORD, 'Admin');
    await step('Admin dashboard', async () => {
      await caption('The Admin dashboard: counts, registrations per month and average days per stage');
      await wait(1500);
      const lastBar = page.locator('[aria-label^="Registrations per month"] [tabindex="0"]').last();
      await point(lastBar, { highlight: false, linger: 1500 });
      await page.mouse.wheel(0, 500);
      await wait(1500);
    });
    await step('Find the application in Franchise Registrations', async () => {
      await nav('Franchise Registrations');
      await caption('Every registration, with search and filters');
      await type(page.locator('#search'), applicant.firm);
      await page.locator('#search').press('Enter');
      await wait(1500);
      await click(page.locator('tr').filter({ hasText: applicationId }).getByRole('link').first());
      await page.waitForURL(/\/admin\/registrations\//);
      await caption('Read-only for Admin: all sections, documents, the history and the agreement record');
      await page.mouse.wheel(0, 700);
      await wait(1600);
      await page.mouse.wheel(0, -700);
      await wait(800);
    });
    await step('Duplicate Review and Approval Tracking', async () => {
      await nav('Duplicate Review');
      await caption('Duplicate Review: applications sharing an email or mobile with another one');
      await wait(1800);
      await nav('Approval Tracking');
      await caption('Approval Tracking: where every application is, and how long it has waited');
      await wait(2000);
    });
    await step('Approved list and Excel export', async () => {
      await nav('Approved Applications');
      await caption('Approved Applications, with the agreement reference');
      await wait(1200);
      const download = page.waitForEvent('download', { timeout: 20000 });
      await caption('Export to Excel follows the filters on screen and masks the PAN');
      await click(link(/Export to Excel/));
      const file = await download;
      await file.saveAs(path.join(RESULTS, file.suggestedFilename()));
      await wait(1000);
    });
    await step('Agreement records (no PDF access for Admin)', async () => {
      await nav('Generated Agreements');
      await caption('Admin sees agreement records and email history only — never the PDF itself');
      await wait(1800);
    });
    await logout();

    // ---------------- Closing: privacy request ----------------
    currentFlow = 'Bonus · Privacy controls';
    await titleCard('Bonus', 'Delete my account', 'The applicant can ask for their data to be erased from My Profile, and cancel while it is pending.');
    await login(applicant.email, applicant.password, 'the applicant');
    await step('Request and cancel account deletion', async () => {
      await nav('My Profile');
      const card = page.locator('section[aria-labelledby="delete-account-heading"]');
      await caption('My Profile → Delete my account and personal data');
      await click(card.getByRole('button', { name: /Delete my account/ }));
      await caption('The approved agreement must be kept by law, which the page explains');
      await type(card.locator('textarea'), 'Testing the deletion request.');
      await type(card.locator('input[type="password"]'), applicant.password);
      await tick(card.locator('input[type="checkbox"]'));
      await click(card.getByRole('button', { name: 'Request deletion' }));
      await card.getByText(/We received your request/).waitFor({ timeout: 20000 });
      await caption('Request received. Admin is emailed; it can be cancelled until it is handled');
      await wait(1500);
      await click(card.getByRole('button', { name: 'Cancel my request' }));
      await wait(1500);
    });
    await logout();

    currentFlow = 'Done';
    await caption('');
    await titleCard('Walkthrough complete', `${applicationId} · ${reference}`, 'Registered, verified, rejected, resubmitted, approved twice, PDF generated and emailed, reviewed by Admin.', 4500);
  } catch (err) {
    failed = err as Error;
    await overlay('caption', `<small>Stopped</small>The walkthrough stopped: ${(err as Error).message.split('\n')[0].replace(/</g, '&lt;')}`);
    await wait(4000);
  }

  const video = page.video();
  await context.close();
  await browser.close();

  // ---------- MP4 for any player ----------
  const webm = await video!.path();
  execFileSync(ffmpegPath as unknown as string, ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUTPUT]);

  const report = { when: new Date().toISOString(), applicant: { ...applicant, password: '(hidden)' }, applicationId, reference, passed: !failed, error: failed?.message ?? null, steps, problems };
  writeFileSync(path.join(RESULTS, 'report.json'), JSON.stringify(report, null, 2));
  for (const f of readdirSync(path.join(RESULTS, 'video'))) rmSync(path.join(RESULTS, 'video', f));

  console.log(`\nVideo: ${OUTPUT}`);
  console.log(`Steps: ${steps.filter((s) => s.ok).length}/${steps.length} passed${failed ? ` — stopped: ${failed.message.split('\n')[0]}` : ''}`);
  console.log(`Problems logged: ${problems.length}`);
  for (const p of problems) console.log(`  [${p.kind}] ${p.flow} — ${p.detail}`);
  process.exit(failed ? 1 : 0);
}

void main();
