// Shared helpers for the Electron end-to-end tests (Playwright driving the real app).
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export async function launch(dataRoot) {
  const app = await electron.launch({
    executablePath: path.resolve('node_modules/electron/dist/electron'),
    args: ['.', '--no-sandbox'],
    env: {
      ...process.env,
      AUTODEAL_DATA_DIR: path.join(dataRoot, 'data'),
      AUTODEAL_E2E: '1',
      AUTODEAL_E2E_OUT: path.join(dataRoot, 'out'),
    },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()));
  return { app, page, errors };
}

export async function setSize(app, page, w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows().find((x) => !x.getTitle().includes('طباعة')) ?? BrowserWindow.getAllWindows()[0];
    win.setContentSize(w, h);
  }, [w, h]);
  await page.waitForTimeout(300);
}

export async function login(page, user, pass) {
  await page.waitForSelector('#username', { timeout: 20000 });
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar', { timeout: 10000 });
}

export async function logout(page) {
  await page.click('.topbar >> text=خروج');
  await page.click('.modal-f >> text=تسجيل الخروج');
  await page.waitForSelector('#username');
}

export async function go(page, hash) {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForTimeout(250);
  await page.waitForFunction(() => !document.querySelector('.spinner'), null, { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(150);
}

/** Layout QA: horizontal overflow of the page and clipped text in key elements. */
export async function layoutIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const content = document.querySelector('.content');
    if (content && content.scrollWidth > content.clientWidth + 2) issues.push(`page horizontal overflow ${content.scrollWidth} > ${content.clientWidth}`);
    const sel = 'button, th, .badge, .k-value, .k-label, .field label, .sidebar nav a, .tabs button, .page-header h1, .chip';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') issues.push(`clipped: ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 40)}"`);
      if (el.scrollHeight > el.clientHeight + 4 && ['BUTTON', 'TH'].includes(el.tagName) && getComputedStyle(el).whiteSpace === 'nowrap') issues.push(`v-clipped: ${el.tagName} "${el.textContent.trim().slice(0, 40)}"`);
    }
    // Overlap check: KPI cards / buttons in the page header must not overlap each other.
    const boxes = [...document.querySelectorAll('.page-header .btn, .kpi')].map((e) => ({ e, r: e.getBoundingClientRect() })).filter((b) => b.r.width);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) issues.push(`overlap: "${boxes[i].e.textContent.trim().slice(0, 20)}" / "${boxes[j].e.textContent.trim().slice(0, 20)}"`);
      }
    return [...new Set(issues)];
  });
}

export function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export async function toast(page, text, timeout = 10000) {
  await page.waitForSelector(`.toast:has-text("${text}")`, { timeout });
}

export async function expectNoErrorToast(page) {
  const t = await page.$('.toast.error');
  if (t) throw new Error('Error toast: ' + (await t.textContent()));
}
