// Screen sweep (PRD §16 "Roles, security and quality"): with `npm run dev` running, opens every
// screen of every role at phone (360 px), tablet (768 px) and desktop (1366 px) widths and checks:
// no browser errors, no failed requests, no sideways scrolling, a page heading, and no leftover
// "planned" placeholder. It also checks the registration form's own rules (contacts, "Same as
// Signatory", Register disabled until the boxes are ticked, the agreement PDF readable on a phone).
//
// Read-only: it only logs in and looks. Results: e2e/results/sweep.json (+ screenshots of problems).
// Run: npm run sweep   (development only; uses the dev logins from npm run seed:dev)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'results', 'sweep');
const BASE = process.env.SWEEP_URL ?? 'http://localhost:5173';
const STAFF_PASSWORD = process.env.SWEEP_STAFF_PASSWORD ?? 'Portal@2026';
// Applicants created by `npm run walkthrough` use this password.
const APPLICANT_PASSWORD = process.env.SWEEP_APPLICANT_PASSWORD ?? 'Sunrise@2026';

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1366, height: 900 },
] as const;

interface Result {
  role: string;
  screen: string;
  path: string;
  viewport: string;
  ok: boolean;
  problems: string[];
}
const results: Result[] = [];
const extraChecks: { check: string; ok: boolean; detail?: string }[] = [];

const MAX_PER_PAGE = 20;

function watch(page: Page) {
  const list: string[] = [];
  let dropped = 0;
  // Capped, so a page that floods the console cannot exhaust memory (the flood is itself reported).
  const problems = {
    push(p: string) {
      if (list.length < MAX_PER_PAGE) list.push(p);
      else if (++dropped === 1) list.push('… many more errors (page keeps logging errors)');
    },
    get length() {
      return list.length;
    },
    slice(n: number) {
      return list.slice(n);
    },
  };
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    const url = r.url();
    // A logged-out session check answering 401 on purpose is not a problem; everything else >= 400 is.
    if (r.status() >= 400 && !url.includes('/api/auth/refresh')) problems.push(`HTTP ${r.status()} ${new URL(url).pathname}`);
  });
  page.on('requestfailed', (r) => {
    const reason = r.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(reason)) problems.push(`request failed: ${new URL(r.url()).pathname} ${reason}`);
  });
  return problems;
}
type Problems = ReturnType<typeof watch>;

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.body.innerText.includes('Loading…'), undefined, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function inspect(page: Page, role: string, screen: string, url: string, viewport: string, problems: Problems) {
  const before = problems.length;
  await page.goto(BASE + url);
  await settle(page);
  const found = [...problems.slice(before)];
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    width: document.documentElement.scrollWidth,
    heading: !!document.querySelector('h1'),
    placeholder: /planned for step/i.test(document.body.innerText),
    loadError: /could not be loaded/i.test(document.body.innerText),
  }));
  if (layout.overflow) found.push(`sideways scrolling (page is ${layout.width}px wide)`);
  if (!layout.heading) found.push('no page heading');
  if (layout.placeholder) found.push('placeholder screen');
  if (layout.loadError) found.push('page shows "could not be loaded"');
  const ok = found.length === 0;
  if (!ok) await page.screenshot({ path: path.join(OUT, `${role}-${screen.replace(/\W+/g, '_')}-${viewport}.png`), fullPage: true }).catch(() => undefined);
  results.push({ role, screen, path: url, viewport, ok, problems: found });
  console.log(`${ok ? 'ok  ' : 'PROB'} ${role} · ${screen} @ ${viewport}${ok ? '' : `: ${found.slice(0, 3).join('; ')}`}`);
}

async function login(browser: Browser, identifier: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('#identifier', identifier);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  const okLogin = await page.waitForURL(/\/app/, { timeout: 15000 }).then(
    () => true,
    () => false,
  );
  return { context, page, okLogin };
}

/** Menu items plus the first detail page reachable from each list. */
async function screensFor(page: Page): Promise<{ name: string; url: string }[]> {
  await page.goto(`${BASE}/app`);
  await settle(page);
  const menu = await page.$$eval('nav a[href^="/app"]', (as) => [...new Map(as.map((a) => [a.getAttribute('href')!, (a.textContent ?? '').trim()])).entries()]);
  const screens = menu.map(([url, name]) => ({ name, url }));
  for (const { url } of [...screens]) {
    await page.goto(BASE + url);
    await settle(page);
    const detail = await page
      .$$eval('main a[href^="/app/"]', (as) => as.map((a) => a.getAttribute('href')!).find((h) => /\/[a-f0-9]{24}(\?|$|\/)/.test(h)) ?? null)
      .catch(() => null);
    if (detail && !screens.some((s) => s.url === detail)) screens.push({ name: `${url.split('/').pop()} detail`, url: detail });
  }
  return screens;
}

async function sweepRole(browser: Browser, role: string, identifier: string, password: string) {
  const { context, page, okLogin } = await login(browser, identifier, password);
  if (!okLogin) {
    results.push({ role, screen: 'login', path: '/login', viewport: '-', ok: false, problems: [`could not log in as ${identifier}`] });
    await context.close();
    return;
  }
  const screens = await screensFor(page);
  await page.close();
  for (const vp of VIEWPORTS) {
    for (const s of screens) {
      // A fresh tab for every check (same login), so memory never builds up across ~100 page loads.
      const tab = await context.newPage();
      await tab.setViewportSize({ width: vp.width, height: vp.height });
      await inspect(tab, role, s.name, s.url, vp.name, watch(tab));
      await tab.close();
    }
  }
  await context.close();
}

async function sweepPublic(browser: Browser) {
  const screens = [
    { name: 'Login', url: '/login' },
    { name: 'Registration', url: '/register' },
    { name: 'Forgot password', url: '/forgot-password' },
    { name: 'Privacy Policy', url: '/privacy-policy' },
    { name: 'Terms', url: '/terms' },
  ];
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    for (const s of screens) {
      const page = await context.newPage();
      await inspect(page, 'public', s.name, s.url, vp.name, watch(page));
      await page.close();
    }
    await context.close();
  }
}

/** PRD §16: contacts, "Same as Signatory", Register disabled until ticked, agreement on a phone. */
async function registrationFormChecks(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/register`);
  await settle(page);
  const check = (name: string, ok: boolean, detail?: string) => extraChecks.push({ check: name, ok, detail });
  if (await page.getByText(/registration is (currently )?closed/i).count()) {
    check('registration form available', false, 'Registration is closed: no active agreement in development');
    await context.close();
    return;
  }
  const field = (p: string) => page.locator(`[data-field="${p}"] input`).first();
  const contacts = page.locator('#contacts fieldset');
  check('Contact 1 has no Remove button', (await contacts.nth(0).getByRole('button', { name: 'Remove' }).count()) === 0);
  await page.getByRole('button', { name: '+ Add New Contact' }).click();
  await page.getByRole('button', { name: '+ Add New Contact' }).click();
  check('contacts can be added (3 shown)', (await contacts.count()) === 3);
  await contacts.nth(1).getByRole('button', { name: 'Remove' }).click();
  check('an added contact can be removed', (await contacts.count()) === 2);

  await field('signatory.name').fill('Priya Sharma');
  await field('signatory.email').fill('priya.sweep@example.com');
  await field('signatory.mobile').fill('9876543210');
  await page.getByLabel('Same as Applicant / Authorised Signatory').check();
  const copied = [await field('contacts.0.name').inputValue(), await field('contacts.0.email').inputValue(), await field('contacts.0.mobile').inputValue()];
  check('"Same as Signatory" copies the details', copied.join('|') === 'Priya Sharma|priya.sweep@example.com|9876543210', copied.join('|'));
  await field('signatory.name').fill('Priya S Sharma');
  check('…and keeps them in step when the signatory changes', (await field('contacts.0.name').inputValue()) === 'Priya S Sharma');

  const register = page.locator('button[type="submit"]');
  check('Register is disabled until the agreement and consent are ticked', await register.isDisabled());
  const boxes = page.locator('#agreement input[type="checkbox"]');
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  check('Register becomes available once both are ticked', await register.isEnabled());

  const pdf = page.locator('#agreement canvas').first();
  if (await pdf.count()) {
    await pdf.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const box = await pdf.boundingBox();
    const shot = path.join(OUT, 'agreement-on-phone.png');
    await pdf.screenshot({ path: shot }).catch(() => undefined);
    check('the agreement PDF is shown and fits a 360 px phone', !!box && box.width > 200 && box.x >= 0 && box.x + box.width <= 361, JSON.stringify(box));
  } else {
    check('the agreement is shown', (await page.locator('#agreement').innerText()).length > 50);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('registration form has no sideways scrolling on a phone', !overflow);
  // Nothing is submitted: the browser autosave is cleared so the next visit starts clean.
  await page.evaluate(() => localStorage.clear());
  await context.close();
}

/** An applicant created by the walkthrough, found through Admin's registration list. */
async function findApplicant(browser: Browser): Promise<string | null> {
  if (process.env.SWEEP_APPLICANT_LOGIN) return process.env.SWEEP_APPLICANT_LOGIN;
  const { context, page, okLogin } = await login(browser, 'admin@portal.local', STAFF_PASSWORD);
  if (!okLogin) return null;
  const list = await page.evaluate(async () => (await fetch('/api/admin/registrations?pageSize=50')).json());
  const ids: string[] = (list.items ?? []).map((r: { id: string }) => r.id);
  const emails: string[] = [];
  for (const id of ids) {
    const d = await page.evaluate(async (x) => (await fetch(`/api/admin/registrations/${x}`)).json(), id);
    const e = d.application?.submission?.signatory?.email;
    if (e && /^priya\.\d+/.test(e)) emails.push(e);
  }
  await context.close();
  return emails[0] ?? null;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    await sweepPublic(browser);
    await registrationFormChecks(browser);
    await sweepRole(browser, 'admin', 'admin@portal.local', STAFF_PASSWORD);
    await sweepRole(browser, 'accounts', 'accounts@portal.local', STAFF_PASSWORD);
    await sweepRole(browser, 'manager', 'manager@portal.local', STAFF_PASSWORD);
    const applicant = await findApplicant(browser);
    if (applicant) await sweepRole(browser, 'franchise_user', applicant, APPLICANT_PASSWORD);
    else extraChecks.push({ check: 'franchise user screens', ok: false, detail: 'No walkthrough applicant found; run npm run walkthrough first or set SWEEP_APPLICANT_LOGIN' });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  const failedChecks = extraChecks.filter((c) => !c.ok);
  const summary = {
    at: new Date().toISOString(),
    pagesChecked: results.length,
    screens: new Set(results.map((r) => `${r.role}:${r.path}`)).size,
    problems: failed.length,
    formChecks: extraChecks.length,
    formChecksFailed: failedChecks.length,
  };
  writeFileSync(path.join(OUT, '..', 'sweep.json'), JSON.stringify({ summary, results, extraChecks }, null, 2));
  for (const c of extraChecks) console.log(c.ok ? 'PASS' : 'FAIL', c.check, c.ok || !c.detail ? '' : c.detail);
  for (const r of failed) console.log('FAIL', `${r.role} · ${r.screen} (${r.path}) @ ${r.viewport}:`, r.problems.join('; '));
  console.log(`${summary.screens} screens × 3 widths = ${summary.pagesChecked} page checks, ${summary.problems} with problems; ${summary.formChecks - summary.formChecksFailed}/${summary.formChecks} form checks passed`);
  process.exit(failed.length || failedChecks.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
