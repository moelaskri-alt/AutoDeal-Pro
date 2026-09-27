// UI tour: loads demo data, visits every screen at 1366×768, 1920×1080 and 2560×1440,
// takes screenshots and checks for horizontal overflow, clipped text, overlaps and JS errors.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, login, go, setSize, layoutIssues, ensureDir } from './lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-tour-'));
const shots = ensureDir(path.resolve(process.env.SHOTS ?? 'tests/e2e/output/screens'));
const { app, page, errors } = await launch(root);
const report = [];
let failed = false;

try {
  await setSize(app, page, 1366, 768);
  await login(page, 'admin', 'admin123');
  await page.click('text=تحميل بيانات تجريبية');
  await page.click('.modal-f >> text=تحميل البيانات');
  await page.waitForSelector('.toast:has-text("تم تحميل")', { timeout: 30000 });

  const ids = await page.evaluate(async () => {
    const c = async (m, a) => (await window.adp.call(m, a)).data;
    const sales = await c('sales.list', { pageSize: 10 });
    const contracts = await c('installments.contracts', { pageSize: 10 });
    const customers = await c('customers.list', { pageSize: 10 });
    const veh = await c('vehicles.list', { pageSize: 10, filters: {} });
    return { sale: sales.rows[0].id, contract: contracts.rows.find((x) => x.overdue_amount > 0)?.id ?? contracts.rows[0].id, customer: customers.rows.find((x) => x.overdue > 0)?.id ?? customers.rows[0].id, vehicle: veh.rows.find((v) => v.status !== 'sold')?.id ?? veh.rows[0].id };
  });

  const screens = [
    ['dashboard', '#/'],
    ['vehicles', '#/vehicles'],
    ['vehicle-detail', `#/vehicles/${ids.vehicle}`],
    ['purchases', '#/purchases'],
    ['costs', '#/costs'],
    ['customers', '#/customers'],
    ['customer-360', `#/customers/${ids.customer}`],
    ['leads', '#/leads'],
    ['quotations', '#/quotations'],
    ['reservations', '#/reservations'],
    ['sales', '#/sales'],
    ['sale-new', '#/sales/new'],
    ['sale-detail', `#/sales/${ids.sale}`],
    ['installments', '#/installments'],
    ['contract-detail', `#/installments/${ids.contract}`],
    ['tradeins', '#/tradeins'],
    ['expenses', '#/expenses'],
    ['reports', '#/reports?id=vehicle_profitability'],
    ['report-aging', '#/reports?id=inventory_aging'],
    ['users', '#/users'],
    ['settings', '#/settings'],
    ['backup', '#/backup'],
  ];
  for (const [w, h] of [[1366, 768], [1920, 1080], [2560, 1440]]) {
    await setSize(app, page, w, h);
    const dir = ensureDir(path.join(shots, `${w}x${h}`));
    for (const [name, hash] of screens) {
      await go(page, hash);
      await page.waitForTimeout(300);
      const issues = await layoutIssues(page);
      if (issues.length) report.push({ size: `${w}x${h}`, screen: name, issues });
      if (w === 1366 || ['dashboard', 'vehicles', 'sale-new', 'contract-detail', 'reports'].includes(name)) await page.screenshot({ path: path.join(dir, `${name}.png`) });
    }
  }
  // Tabs on detail pages + modals at the smallest size
  await setSize(app, page, 1366, 768);
  const dir = path.join(shots, '1366x768');
  await go(page, `#/vehicles/${ids.vehicle}`);
  for (const t of ['بطاقة التكلفة', 'الصور', 'العروض والحجوزات والمبيعات', 'سجل التعديلات']) {
    await page.click(`.tabs >> text=${t}`);
    await page.waitForTimeout(400);
    const issues = await layoutIssues(page);
    if (issues.length) report.push({ size: '1366x768', screen: `vehicle-tab-${t}`, issues });
    await page.screenshot({ path: path.join(dir, `vehicle-tab-${t.split(' ')[0]}.png`) });
  }
  await go(page, `#/customers/${ids.customer}`);
  for (const t of ['الأقساط', 'كشف الحساب']) {
    await page.click(`.tabs >> text=${t}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, `customer-tab-${t.split(' ')[0]}.png`) });
  }
  await go(page, '#/purchases');
  await page.click('text=تسجيل شراء سيارة');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, 'modal-purchase.png') });
  const mi = await layoutIssues(page);
  if (mi.length) report.push({ size: '1366x768', screen: 'modal-purchase', issues: mi });
  await page.keyboard.press('Escape');
  await go(page, `#/installments/${ids.contract}`);
  await page.click('.page-header >> text=تسجيل تحصيل');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, 'modal-payment.png') });
  await page.keyboard.press('Escape');
  await page.click('.page-header >> text=إعادة جدولة');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(dir, 'modal-reschedule.png') });
  await page.keyboard.press('Escape');
  await go(page, '#/users');
  await page.click('.tabs >> text=الأدوار والصلاحيات');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, 'roles.png') });
  await page.click('.tabs >> text=سجل المراجعة');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, 'audit.png') });
} catch (e) {
  failed = true;
  console.error('TOUR FAILED', e);
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => undefined);
} finally {
  await app.close();
}
console.log(JSON.stringify({ layoutIssues: report, jsErrors: errors }, null, 2));
if (failed || errors.length) process.exit(1);
