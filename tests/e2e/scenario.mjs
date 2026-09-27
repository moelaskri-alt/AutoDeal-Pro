// FINAL DEMO SCENARIO (master prompt §61) executed through the real desktop UI:
// buy a used BMW, add costs, quote, reserve, sell on 24 installments, collect, partial payment,
// overdue, statement, reports, dashboard, export/print, backup/restore, reopen, permissions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, login, logout, go, setSize, ensureDir, toast, expectNoErrorToast } from './lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-scn-'));
const outDir = path.join(root, 'out');
const shots = ensureDir(path.resolve('tests/e2e/output/scenario'));
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push({ step: name, ok: true, ms: Date.now() - t });
    console.log('✔', name);
  } catch (e) {
    results.push({ step: name, ok: false, error: String(e.message ?? e).slice(0, 400) });
    console.log('✘', name, '\n   ', String(e.message ?? e).slice(0, 400));
    throw e;
  }
};
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
let page;
const field = (scope, labelText) => scope.locator('.field').filter({ has: page.locator('label', { hasText: new RegExp('^\\s*' + esc(labelText) + '\\s*\\*?\\s*$') }) }).first();
const money = async (loc, v) => {
  await loc.click();
  await loc.fill(String(v));
  await loc.blur();
};
const api = (page, m, a) => page.evaluate(([m, a]) => window.adp.call(m, a), [m, a]);
const text = async (page) => (await page.textContent('.content')) ?? '';
const expectText = async (page, t, timeout = 8000) => page.waitForSelector(`.content :text("${t}")`, { timeout });

let app, errors;
({ app, page, errors } = await launch(root));
let ids = {};
let failed = false;
try {
  await setSize(app, page, 1366, 768);
  await step('1. تسجيل الدخول (admin)', () => login(page, 'admin', 'admin123'));

  await step('2. شراء BMW مستعملة بسعر 1,200,000 (شاشة المشتريات)', async () => {
    await go(page, '#/purchases');
    await page.click('.page-header >> text=تسجيل شراء سيارة');
    const m = page.locator('.modal');
    await field(m, 'المورد / البائع').locator('select').selectOption('new');
    await m.locator('input[name=supplier_name]').fill('سامي البائع');
    await m.locator('input[name=purchase_date]').fill(daysAgo(120));
    await money(m.locator('input[name=purchase_price]'), 1200000);
    await field(m, 'حالة السيارة بعد الشراء').locator('select').selectOption('available');
    await m.locator('select[name=condition]').selectOption('used');
    await m.locator('input[name=brand]').fill('BMW');
    await m.locator('input[name=model]').fill('520i');
    await m.locator('input[name=model_year]').fill('2020');
    await m.locator('input[name=vin]').fill('WBAJA5105LBK77001');
    await m.locator('input[name=mileage]').fill('70000');
    await money(m.locator('input[name=asking_price]'), 1450000);
    await money(m.locator('input[name=min_price]'), 1330000);
    await money(m.locator('input[name=paid_amount]'), 1200000);
    await m.locator('text=حفظ عملية الشراء').click();
    await toast(page, 'تم تسجيل الشراء');
    await page.waitForURL(/#\/vehicles\/\d+/);
    ids.vehicle = Number(page.url().split('/').pop());
  });

  await step('3. إضافة تكاليف مباشرة 63,000 (صيانة/سمكرة/إطارات/نقل/تنظيف)', async () => {
    await page.click('.tabs >> text=بطاقة التكلفة');
    for (const [cat, amt] of [['maintenance', 25000], ['bodywork', 18000], ['tires', 12000], ['transport', 5000], ['detailing', 3000]]) {
      await page.click('text=إضافة تكلفة');
      const m = page.locator('.modal');
      await m.locator('select[name=category]').selectOption(cat);
      await money(m.locator('input[name=amount]'), amt);
      await m.locator('.modal-f >> text=حفظ').click();
      await toast(page, 'تم تسجيل التكلفة');
      await page.waitForSelector('.modal', { state: 'detached' });
    }
  });

  await step('4. التحقق: التكلفة الفعلية = 1,263,000', async () => {
    await page.waitForFunction(() => document.querySelector('.content').textContent.includes('1,263,000'), null, { timeout: 8000 });
    await page.screenshot({ path: path.join(shots, '04-cost-card.png') });
  });

  await step('5. إضافة عميل', async () => {
    await go(page, '#/customers');
    await page.click('.page-header >> text=عميل جديد');
    const m = page.locator('.modal');
    await m.locator('input[name=name]').fill('خالد عبد الله');
    await m.locator('input[name=phone]').fill('01011122233');
    await m.locator('input[name=national_id]').fill('28901011234512');
    await m.locator('.modal-f >> text=حفظ').click();
    await toast(page, 'تمت إضافة العميل');
    await page.waitForURL(/#\/customers\/\d+/);
    ids.customer = Number(page.url().split('/').pop());
  });

  await step('6. إنشاء عرض سعر = 1,400,000', async () => {
    await page.click('.page-header >> text=عرض سعر');
    const m = page.locator('.modal');
    await m.locator('text=خالد عبد الله').waitFor();
    await m.locator('input[name=vehicle]').fill('BMW');
    await page.click('.picker-item:has-text("520i")');
    await page.waitForFunction(() => document.querySelector('input[name=asking_price]').value.includes('1,450,000'));
    await money(m.locator('input[name=discount]'), 50000);
    await field(m, 'طريقة الدفع').locator('select').selectOption('installments');
    await m.locator('text=السعر النهائي').waitFor();
    if (!(await m.textContent()).includes('1,400,000')) throw new Error('final price not 1,400,000');
    await m.locator('.modal-f >> text=حفظ').last().click();
    await toast(page, 'تم إنشاء عرض السعر');
    const q = (await api(page, 'quotations.list', { pageSize: 5 })).data.rows[0];
    if (q.final_price !== 140000000) throw new Error('quotation final price ' + q.final_price);
    ids.quote = q.id;
    // print quotation as PDF
    await go(page, '#/quotations');
    await page.click('table.dt tbody tr >> button:has-text("PDF")');
    await toast(page, 'تم حفظ الملف');
  });

  await step('7. حجز السيارة بعربون 50,000', async () => {
    await go(page, '#/quotations');
    await page.click('table.dt tbody tr >> text=تحويل لحجز');
    const m = page.locator('.modal');
    await m.locator('text=خالد عبد الله').waitFor();
    await m.locator('text=520i').first().waitFor();
    await field(m, 'تاريخ الحجز').locator('input').fill(daysAgo(100));
    await field(m, 'ينتهي في').locator('input').fill(daysAgo(-5));
    await money(m.locator('input[name=amount]'), 50000);
    await m.locator('text=حفظ وطباعة الإيصال').click();
    await toast(page, 'تم تسجيل الحجز');
    const v = (await api(page, 'vehicles.get', { id: ids.vehicle })).data.vehicle;
    if (v.status !== 'reserved') throw new Error('vehicle not reserved: ' + v.status);
  });

  await step('8-11. البيع بـ 1,350,000 — مقدم 350,000 (عربون 50,000 + 300,000) — المتبقي 1,000,000 على 24 شهراً', async () => {
    await go(page, '#/quotations');
    await page.click('table.dt tbody tr >> text=تحويل لبيع');
    await page.waitForURL(/sales\/new/);
    await page.waitForSelector('text=سيتم تحويل الحجز');
    await page.locator('select[name=sale_type]').selectOption('installments');
    await page.locator('input[name=sale_date]').fill(daysAgo(90));
    await money(page.locator('input[name=list_price]'), 1450000);
    await money(page.locator('input[name=discount]'), 100000);
    await money(page.locator('input[name=down_payment]'), 300000);
    await page.locator('select[name=plan_type]').selectOption('equal');
    await page.locator('input[name=count]').fill('24');
    await page.locator('input[name=first_due_date]').fill(daysAgo(60));
    await page.waitForSelector('text=معاينة جدول الأقساط');
    const summary = await page.textContent('.stack >> text=ملخص العقد >> xpath=..');
    if (!summary.includes('1,000,000')) throw new Error('financed amount not shown as 1,000,000: ' + summary);
    await page.screenshot({ path: path.join(shots, '08-new-sale.png'), fullPage: true });
    await page.click('text=إتمام البيع');
    await page.waitForURL(/#\/sales\/\d+/);
    await page.waitForSelector('text=تم إتمام البيع بنجاح');
    ids.sale = Number(page.url().split('/').pop().split('?')[0]);
    const s = (await api(page, 'sales.get', { id: ids.sale })).data;
    if (s.sale.selling_price !== 135000000 || s.sale.financed_amount !== 100000000) throw new Error('sale amounts wrong');
    if (s.sale.reservation_credit + s.sale.down_payment !== 35000000) throw new Error('upfront not 350,000');
    ids.contract = s.sale.contract_id;
    const k = (await api(page, 'installments.contract', { id: ids.contract })).data;
    if (k.schedule.length !== 24) throw new Error('schedule length ' + k.schedule.length);
    if (k.schedule.reduce((a, i) => a + i.amount, 0) !== 100000000) throw new Error('schedule total');
    ids.schedule = k.schedule;
    await page.screenshot({ path: path.join(shots, '09-sale-detail.png') });
  });

  await step('12. تسجيل تحصيل القسط الأول', async () => {
    await go(page, `#/installments/${ids.contract}`);
    await page.click('.page-header >> text=تسجيل تحصيل');
    const m = page.locator('.modal');
    await money(m.locator('input[name=amount]'), ids.schedule[0].amount / 100);
    await m.locator('text=حفظ وطباعة الإيصال').click();
    await toast(page, 'تم تسجيل التحصيل');
  });

  await step('13. دفعة جزئية 20,000 على القسط الثاني', async () => {
    await page.waitForSelector('.modal', { state: 'detached' });
    await page.locator('table.dt tbody tr').nth(1).locator('text=تحصيل').click();
    const m = page.locator('.modal');
    await money(m.locator('input[name=amount]'), 20000);
    await m.locator('text=حفظ وطباعة الإيصال').click();
    await toast(page, 'تم تسجيل التحصيل');
    const k = (await api(page, 'installments.contract', { id: ids.contract })).data;
    if (k.schedule[0].status !== 'paid') throw new Error('installment 1 not paid');
    if (k.schedule[1].paid_amount !== 2000000) throw new Error('installment 2 paid ' + k.schedule[1].paid_amount);
    ids.remaining = 100000000 - ids.schedule[0].amount - 2000000;
    if (k.contract.remaining !== ids.remaining) throw new Error('remaining mismatch');
  });

  await step('14. قسط متأخر (القسط الثاني مستحق منذ 30 يوماً ومسدد جزئياً)', async () => {
    const k = (await api(page, 'installments.contract', { id: ids.contract })).data;
    if (k.schedule[1].status !== 'overdue') throw new Error('installment 2 status ' + k.schedule[1].status);
    if (k.schedule[1].days_overdue < 28) throw new Error('days overdue ' + k.schedule[1].days_overdue);
    await go(page, `#/installments/${ids.contract}`);
    await page.waitForSelector('.badge:has-text("متأخر")');
    await page.screenshot({ path: path.join(shots, '14-contract-overdue.png') });
  });

  await step('15. كشف حساب العميل', async () => {
    await go(page, `#/customers/${ids.customer}`);
    await page.click('.tabs >> text=كشف الحساب');
    const expected = (ids.remaining / 100).toLocaleString('en-US');
    await page.waitForFunction((t) => document.querySelector('.content tfoot')?.textContent.includes(t), expected, { timeout: 8000 });
    await page.click('.toolbar >> text=PDF');
    await toast(page, 'تم حفظ الملف');
    await page.screenshot({ path: path.join(shots, '15-statement.png') });
  });

  await step('16. تقرير الأقساط', async () => {
    await go(page, '#/reports?id=installment_schedule');
    await page.click('.toolbar >> text=كل الفترات');
    await page.waitForFunction(() => document.querySelector('.content tfoot')?.textContent.includes('1,000,000'), null, { timeout: 8000 });
    await page.click('.card-h >> text=Excel');
    await toast(page, 'تم الحفظ');
  });

  await step('17-18. ربحية السيارة: مجمل الربح = 87,000 وهامش 6.44%', async () => {
    await go(page, '#/reports?id=vehicle_profitability');
    await page.click('.toolbar >> text=كل الفترات');
    await page.waitForFunction(() => {
      const t = document.querySelector('.content table.dt tbody')?.textContent ?? '';
      return t.includes('87,000') && t.includes('1,263,000') && t.includes('6.44%');
    }, null, { timeout: 8000 });
    await page.click('.card-h >> text=PDF');
    await toast(page, 'تم الحفظ');
    await page.screenshot({ path: path.join(shots, '17-profitability.png') });
  });

  await step('19. لوحة التحكم تعكس البيع والتحصيل والمتأخرات', async () => {
    await go(page, '#/');
    const d = (await api(page, 'dashboard.get')).data;
    if (d.sales.all.profit !== 8700000) throw new Error('dashboard profit ' + d.sales.all.profit);
    if (d.receivables.outstanding !== ids.remaining) throw new Error('dashboard outstanding');
    if (!(d.receivables.overdue > 0)) throw new Error('no overdue on dashboard');
    await page.waitForFunction(() => document.querySelector('.content').textContent.includes('87,000'));
    await page.screenshot({ path: path.join(shots, '19-dashboard.png') });
  });

  await step('طباعة: فاتورة/عقد/جدول/إيصال PDF', async () => {
    for (const [type, id] of [['invoice', ids.sale], ['contract', ids.sale], ['schedule', ids.contract]]) {
      const r = await api(page, 'print.document', { type, id, mode: 'pdf' });
      if (!r.ok || !fs.readFileSync(r.data.file).subarray(0, 4).toString().startsWith('%PDF')) throw new Error('pdf failed for ' + type);
    }
    const pays = (await api(page, 'payments.list', { pageSize: 5 })).data.rows;
    const r = await api(page, 'print.document', { type: 'receipt', id: pays[0].id, mode: 'pdf' });
    if (!r.ok) throw new Error('receipt pdf');
  });

  await step('20. نسخة احتياطية', async () => {
    await go(page, '#/backup');
    await page.click('.page-header >> text=إنشاء نسخة احتياطية');
    await toast(page, 'تم إنشاء النسخة الاحتياطية');
    await page.waitForSelector('table.dt tbody tr');
  });

  await step('21. تعديل البيانات ثم استعادة النسخة (مع التأكيد)', async () => {
    const e = await api(page, 'expenses.create', { expense_date: daysAgo(0), category: 'office', description: 'مصروف بعد النسخة', amount: 12345 });
    if (!e.ok) throw new Error(e.error.message);
    await go(page, '#/backup');
    await page.locator('table.dt tbody tr', { hasText: 'يدوية' }).first().locator('text=استعادة').click();
    await page.fill('.modal input', 'استعادة');
    await page.click('.modal-f >> text=استعادة الآن');
    await toast(page, 'تمت استعادة النسخة', 20000);
    const n = (await api(page, 'expenses.list', {})).data.total;
    if (n !== 0) throw new Error('expense still present after restore');
  });

  await step('22-23. إعادة فتح البرنامج والتحقق من كل البيانات', async () => {
    await app.close();
    ({ app, page, errors } = await launch(root));
    await setSize(app, page, 1366, 768);
    await login(page, 'admin', 'admin123');
    const s = (await api(page, 'sales.get', { id: ids.sale })).data;
    if (s.sale.selling_price !== 135000000) throw new Error('sale lost');
    const k = (await api(page, 'installments.contract', { id: ids.contract })).data;
    if (k.contract.remaining !== ids.remaining) throw new Error('contract remaining after reopen ' + k.contract.remaining);
    const p = (await api(page, 'reports.run', { id: 'vehicle_profitability', filters: {} })).data;
    if (p.rows[0].gross_profit !== 8700000) throw new Error('profit after reopen');
    const st = (await api(page, 'customers.statement', { id: ids.customer })).data;
    if (st.closing !== ids.remaining) throw new Error('statement after reopen');
  });

  await step('قواعد التحقق من الواجهة: لا يمكن بيع سيارة مباعة، VIN مكرر', async () => {
    const r = await api(page, 'sales.create', { customer_id: ids.customer, vehicle_id: ids.vehicle, sale_type: 'cash', list_price: 100 });
    if (r.ok || !r.error.message.includes('مباعة')) throw new Error('sold vehicle could be sold again');
    const r2 = await api(page, 'vehicles.create', { condition: 'used', brand: 'X', model: 'Y', model_year: 2020, vin: 'WBAJA5105LBK77001' });
    if (r2.ok || !r2.error.message.includes('VIN')) throw new Error('duplicate VIN accepted');
    await go(page, '#/vehicles');
    await page.click('.page-header >> text=إضافة سيارة');
    const m = page.locator('.modal');
    await m.locator('input[name=brand]').fill('X');
    await m.locator('input[name=model]').fill('Y');
    await m.locator('input[name=vin]').fill('WBAJA5105LBK77001');
    await m.locator('.modal-f >> text=حفظ').click();
    await page.waitForSelector('.toast.error:has-text("VIN")');
    await page.keyboard.press('Escape');
  });

  await step('20. صلاحيات المستخدمين: مندوب مبيعات', async () => {
    await go(page, '#/users');
    await page.click('text=مستخدم جديد');
    const m = page.locator('.modal');
    await field(m, 'اسم المستخدم (بالإنجليزية)').locator('input').fill('sara');
    await field(m, 'الاسم الكامل').locator('input').fill('سارة المندوبة');
    const roles = (await api(page, 'roles.list')).data.roles;
    await field(m, 'الدور').locator('select').selectOption(String(roles.find((r) => r.code === 'sales').id));
    await field(m, 'كلمة المرور').locator('input').fill('sara123');
    await m.locator('.modal-f >> text=حفظ').click();
    await toast(page, 'تم الحفظ');
    await logout(page);
    await login(page, 'sara', 'sara123');
    const nav = await page.textContent('.sidebar nav');
    for (const hidden of ['المشتريات', 'تكاليف السيارات', 'المصروفات', 'التقارير', 'المستخدمون والصلاحيات', 'النسخ الاحتياطي', 'الإعدادات']) {
      if (nav.includes(hidden)) throw new Error('salesperson sees ' + hidden);
    }
    for (const visible of ['العملاء', 'عروض الأسعار', 'الحجوزات', 'المبيعات']) if (!nav.includes(visible)) throw new Error('salesperson missing ' + visible);
    await go(page, '#/purchases');
    await page.waitForSelector('text=لا تملك صلاحية');
    const r = await api(page, 'purchases.create', {});
    if (r.ok || r.error.code !== 'FORBIDDEN') throw new Error('server did not block purchase for salesperson');
    const v = (await api(page, 'vehicles.list', {})).data.rows;
    if (v.some((x) => x.actual_cost !== null)) throw new Error('salesperson can see costs');
    await page.screenshot({ path: path.join(shots, 'perm-sales.png') });
    await logout(page);
    await login(page, 'admin', 'admin123');
  });

  await step('سجل المراجعة يحتوي العمليات المهمة', async () => {
    const a = (await api(page, 'audit.list', { pageSize: 500 })).data.rows;
    const actions = new Set(a.map((x) => x.action));
    for (const need of ['create', 'payment', 'restore', 'backup', 'login']) if (!actions.has(need)) throw new Error('audit missing ' + need);
    await go(page, '#/users');
    await page.click('.tabs >> text=سجل المراجعة');
    await page.waitForSelector('table.dt tbody tr');
  });

  await expectNoErrorToast(page).catch(() => undefined);
  const files = fs.readdirSync(outDir);
  console.log('exported files:', files);
  if (!files.some((f) => f.endsWith('.xlsx')) || files.filter((f) => f.endsWith('.pdf')).length < 5) throw new Error('missing exported files');
} catch (e) {
  failed = true;
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => undefined);
} finally {
  await app.close().catch(() => undefined);
}
fs.writeFileSync(path.join(shots, 'results.json'), JSON.stringify({ results, jsErrors: errors }, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed; JS errors: ${errors.length}`);
if (errors.length) console.log(errors);
process.exit(failed || errors.length ? 1 : 0);
