import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-e2e-'));
const out = process.env.SHOTS ?? path.join(dir, 'shots');
fs.mkdirSync(out, { recursive: true });
const app = await electron.launch({
  executablePath: path.resolve('node_modules/electron/dist/electron'),
  args: ['.', '--no-sandbox'],
  env: { ...process.env, AUTODEAL_DATA_DIR: path.join(dir, 'data'), AUTODEAL_E2E: '1', AUTODEAL_E2E_OUT: path.join(dir, 'out') },
});
const page = await app.firstWindow();
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewportSize({ width: 1366, height: 768 });
await page.waitForSelector('#username', { timeout: 20000 });
await page.screenshot({ path: path.join(out, 'login.png') });
await page.fill('#username', 'admin');
await page.fill('#password', 'admin123');
await page.click('button[type=submit]');
await page.waitForSelector('text=لوحة التحكم');
await page.screenshot({ path: path.join(out, 'dashboard-empty.png') });
await page.click('text=تحميل بيانات تجريبية');
await page.click('.modal-f >> text=تحميل البيانات');
await page.waitForSelector('text=تم تحميل البيانات التجريبية', { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(out, 'dashboard.png'), fullPage: true });
console.log('OK', out);
await app.close();
