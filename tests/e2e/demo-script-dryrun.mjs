// Dry-run of the video demo story (docs: AUTODeal_Pro_Full_Demo_Script_AR.md) through the real UI,
// asserting every number the presenter says on camera.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, login, go, setSize, ensureDir, toast } from './lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-demo-'));
const shots = ensureDir(path.resolve('tests/e2e/output/demo-script'));
let page;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const field = (scope, t) =>
  scope
    .locator('.field')
    .filter({ has: page.locator('label', { hasText: new RegExp('^\\s*' + esc(t) + '\\s*\\*?\\s*$') }) })
    .first();
const money = async (loc, v) => {
  await loc.click();
  await loc.fill(String(v));
  await loc.blur();
};
const api = (m, a) => page.evaluate(([m, a]) => window.adp.call(m, a).then((r) => r.data ?? r), [m, a]);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const M = (x) => x * 100;
const checks = [];
const eq = (name, a, b) => {
  const ok = a === b;
  checks.push(`${ok ? '✔' : '✘'} ${name}: ${a}${ok ? '' : ' (expected ' + b + ')'}`);
  if (!ok) process.exitCode = 1;
};

let app, errors;
({ app, page, errors } = await launch(root));
try {
  await setSize(app, page, 1366, 768);
  await login(page, 'admin', 'admin123');
  await page.click('text=تحميل بيانات تجريبية');
  await page.click('.modal-f >> text=تحميل البيانات');
  await page.waitForSelector('.toast:has-text("تم تحميل")', { timeout: 30000 });

  // 1. purchase
  await go(page, '#/purchases');
  await page.click('.page-header >> text=تسجيل شراء سيارة');
  let m = page.locator('.modal');
  await field(m, 'المورد / البائع').locator('select').selectOption('new');
  await m.locator('input[name=supplier_name]').fill('محمود عبد الحميد');
  await field(m, 'نوع المورد').locator('select').selectOption('individual');
  await m.locator('input[name=purchase_date]').fill(daysAgo(21));
  await field(m, 'رقم فاتورة الشراء').locator('input').fill('عقد-2045');
  await money(m.locator('input[name=purchase_price]'), 780000);
  await m.locator('select[name=condition]').selectOption('used');
  await m.locator('input[name=brand]').fill('Toyota');
  await m.locator('input[name=model]').fill('Corolla');
  await m.locator('input[name=trim]').fill('XLi');
  await m.locator('input[name=model_year]').fill('2019');
  await m.locator('input[name=color]').fill('فضي');
  await m.locator('input[name=vin]').fill('JTDBR32E190112233');
  await m.locator('input[name=engine_no]').fill('2ZR4418833');
  await m.locator('input[name=mileage]').fill('85000');
  await money(m.locator('input[name=asking_price]'), 930000);
  await money(m.locator('input[name=min_price]'), 880000);
  await m.locator('text=إضافة تكلفة').click();
  await m.locator('.full select').first().selectOption('transport');
  await money(m.locator('.full input.num').first(), 4000);
  await money(m.locator('input[name=paid_amount]'), 700000);
  await field(m, 'طريقة الدفع').locator('select').selectOption('bank_transfer');
  await field(m, 'مرجع الدفع').locator('input').fill('TRX-2045');
  await page.screenshot({ path: path.join(shots, '01-purchase-form.png') });
  await m.locator('text=حفظ عملية الشراء').click();
  await page.waitForURL(/#\/vehicles\/\d+/);
  const vid = Number(page.url().split('/').pop());

  // 2. direct costs
  await page.click('.tabs >> text=بطاقة التكلفة');
  for (const [c, a] of [
    ['maintenance', 18000],
    ['bodywork', 9000],
    ['paint', 7500],
    ['tires', 14000],
    ['detailing', 2500],
  ]) {
    await page.click('text=إضافة تكلفة');
    m = page.locator('.modal');
    await m.locator('select[name=category]').selectOption(c);
    await money(m.locator('input[name=amount]'), a);
    await m.locator('.modal-f >> text=حفظ').click();
    await toast(page, 'تم تسجيل التكلفة');
    await page.waitForSelector('.modal', { state: 'detached' });
  }
  const card = await api('costs.card', { vehicle_id: vid });
  eq('actual cost', card.totals.actual_cost, M(835000));
  eq('direct costs', card.totals.direct_costs, M(55000));
  eq('expected profit at asking', card.totals.expected_profit, M(95000));
  eq('expected margin', card.totals.expected_margin, 10.22);
  await page.screenshot({ path: path.join(shots, '02-cost-card.png') });
  // status → available
  await page.click('.page-header >> text=تعديل');
  await page.locator('.modal select[name=status]').selectOption('available');
  await page.locator('.modal .modal-f >> text=حفظ').click();
  await toast(page, 'تم حفظ التعديلات');
  // duplicate VIN demo
  const dup = await page.evaluate(() =>
    window.adp.call('vehicles.create', { condition: 'used', brand: 'Toyota', model: 'Corolla', model_year: 2019, vin: 'JTDBR32E190112233' }),
  );
  checks.push('dup VIN message: ' + dup.error?.message);

  // 3. lead → follow-up → convert
  await go(page, '#/leads');
  await page.click('.page-header >> text=عميل محتمل جديد');
  m = page.locator('.modal');
  await m.locator('input[name=name]').fill('عمرو سعيد الشافعي');
  await m.locator('input[name=phone]').fill('01014567890');
  await field(m, 'المصدر').locator('select').selectOption('facebook');
  await m.locator('input[name=vehicle]').fill('Corolla');
  await page.click('.picker-item:has-text("XLi 2019")');
  await field(m, 'الاهتمام / المواصفات المطلوبة').locator('input').fill('كورولا أوتوماتيك بالتقسيط على سنة');
  await m.locator('.modal-f >> text=حفظ').click();
  await toast(page, 'تم الحفظ');
  await page.click('table.dt tbody tr:has-text("عمرو سعيد")');
  m = page.locator('.modal');
  await field(m, 'النتيجة').locator('textarea').fill('اتصل وسأل عن الكورولا، هيزور المعرض بكرة');
  await m.locator('text=حفظ المتابعة').click();
  await toast(page, 'تم تسجيل المتابعة');
  await m.locator('text=تحويل إلى عميل').click();
  await page.waitForURL(/#\/customers\/\d+/);
  const cid = Number(page.url().split('/').pop());
  await page.click('.page-header >> text=تعديل');
  m = page.locator('.modal');
  await m.locator('input[name=national_id]').fill('28803121401234');
  await field(m, 'العنوان').locator('input').fill('الجيزة - الهرم');
  await m.locator('.modal-f >> text=حفظ').click();
  await toast(page, 'تم حفظ بيانات العميل');

  // 4. quotation
  await page.click('.page-header >> text=عرض سعر');
  m = page.locator('.modal');
  await m.locator('input[name=vehicle]').fill('Corolla');
  await page.click('.picker-item:has-text("XLi 2019")');
  await page.waitForFunction(() => document.querySelector('input[name=asking_price]').value.includes('930,000'));
  await money(m.locator('input[name=discount]'), 20000);
  await field(m, 'طريقة الدفع').locator('select').selectOption('installments');
  await money(field(m, 'المقدم المقترح').locator('input'), 300000);
  await field(m, 'عدد الشهور').locator('input').fill('12');
  await page.waitForTimeout(300);
  checks.push(
    'quote modal text includes 910,000: ' + (await m.textContent()).includes('910,000') + ' / monthly 50,833: ' + (await m.textContent()).includes('50,833'),
  );
  await page.screenshot({ path: path.join(shots, '03-quote.png') });
  await m.locator('.modal-f >> text=حفظ').last().click();
  await toast(page, 'تم إنشاء عرض السعر');

  // 5. reservation from quote
  await go(page, '#/quotations');
  await page.click('table.dt tbody tr:has-text("عمرو") >> text=تحويل لحجز');
  m = page.locator('.modal');
  await m.locator('text=عمرو سعيد').first().waitFor();
  await m.locator('text=Corolla').first().waitFor();
  await money(m.locator('input[name=amount]'), 20000);
  await page.waitForTimeout(300);
  checks.push('agreed price prefilled: ' + (await field(m, 'السعر المتفق عليه').locator('input').inputValue()));
  await m.locator('text=حفظ وطباعة الإيصال').click();
  await toast(page, 'تم تسجيل الحجز');
  const lead1 = (await api('leads.list', { search: 'عمرو' })).rows[0];
  eq('lead status after reservation', lead1.status, 'reserved');

  // 6. sale from quote
  await go(page, '#/quotations');
  await page.click('table.dt tbody tr:has-text("عمرو") >> text=تحويل لبيع');
  await page.waitForURL(/sales\/new/);
  await page.waitForSelector('text=سيتم تحويل الحجز');
  await page.waitForTimeout(1200);
  checks.push(
    'prefill price/discount: ' +
      (await page.locator('input[name=list_price]').inputValue()) +
      ' / ' +
      (await page.locator('input[name=discount]').inputValue()),
  );
  // min price demo
  await money(page.locator('input[name=discount]'), 40000);
  await page.waitForSelector('text=أقل من الحد الأدنى');
  await page.screenshot({ path: path.join(shots, '04-sale-min-warning.png') });
  await money(page.locator('input[name=discount]'), 10000);
  await money(page.locator('input[name=fees]'), 5000);
  await page.locator('.field:has(label:text("مندوب المبيعات")) select').selectOption({ label: 'مندوب مبيعات - سارة' });
  await page.locator('select[name=sale_type]').selectOption('installments');
  await money(page.locator('input[name=down_payment]'), 285000);
  await page.locator('input[name=count]').fill('12');
  await page.waitForSelector('text=معاينة جدول الأقساط');
  await page.screenshot({ path: path.join(shots, '05-new-sale.png'), fullPage: true });
  // custom mismatch demo
  await page.locator('select[name=plan_type]').selectOption('custom');
  await page.locator('.schedule-editor tbody tr').first().locator('input.num').fill('60000');
  await page.locator('.schedule-editor tbody tr').first().locator('input.num').blur();
  await page.waitForSelector('text=لا يمكن الحفظ');
  await page.screenshot({ path: path.join(shots, '06-custom-mismatch.png'), fullPage: true });
  checks.push('submit disabled on mismatch: ' + (await page.locator('button:has-text("إتمام البيع")').isDisabled()));
  await page.locator('select[name=plan_type]').selectOption('equal');
  await page.locator('input[name=count]').fill('12');
  await page.waitForSelector('text=معاينة جدول الأقساط');
  await page.click('text=إتمام البيع');
  await page.waitForURL(/#\/sales\/\d+/);
  const sid = Number(page.url().split('/').pop().split('?')[0]);
  const s = await api('sales.get', { id: sid });
  eq('selling price', s.sale.selling_price, M(900000));
  eq('contract value', s.sale.total_contract_value, M(905000));
  eq('reservation credit', s.sale.reservation_credit, M(20000));
  eq('down payment', s.sale.down_payment, M(285000));
  eq('financed', s.sale.financed_amount, M(600000));
  eq('gross profit', s.profit.gross_profit, M(65000));
  eq('gross margin', s.profit.gross_margin, 7.22);
  const lead2 = (await api('leads.list', { search: 'عمرو' })).rows[0];
  eq('lead status after sale', lead2.status, 'won');
  await page.screenshot({ path: path.join(shots, '07-sale-detail.png') });
  const kid = s.sale.contract_id;
  let k = await api('installments.contract', { id: kid });
  eq('installments count', k.schedule.length, 12);
  eq('installment amount', k.schedule[0].amount, M(50000));

  // 7. collections
  await go(page, `#/installments/${kid}`);
  await page.click('.page-header >> text=تسجيل تحصيل');
  m = page.locator('.modal');
  await money(m.locator('input[name=amount]'), 20000);
  await m.locator('text=حفظ وطباعة الإيصال').click();
  await toast(page, 'تم تسجيل التحصيل');
  k = await api('installments.contract', { id: kid });
  eq('#1 status after 20k', k.schedule[0].status, 'partially_paid');
  eq('#1 remaining', k.schedule[0].remaining, M(30000));
  // overpayment demo
  const over = await page.evaluate((kid) => window.adp.call('payments.create', { contract_id: kid, amount: 60000000 }), kid);
  checks.push('overpay message: ' + over.error?.message);
  const cheque = await page.evaluate((kid) => window.adp.call('payments.create', { contract_id: kid, amount: 1000000, method: 'cheque' }), kid);
  checks.push('cheque w/o ref message: ' + cheque.error?.message);
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.locator('table.dt tbody tr').first().locator('text=تحصيل').click();
  m = page.locator('.modal');
  checks.push('prefilled amount for installment #1: ' + (await m.locator('input[name=amount]').inputValue()));
  await m.locator('text=حفظ وطباعة الإيصال').click();
  await toast(page, 'تم تسجيل التحصيل');
  k = await api('installments.contract', { id: kid });
  eq('#1 status', k.schedule[0].status, 'paid');
  eq('contract remaining', k.contract.remaining, M(550000));
  const st = await api('customers.statement', { id: cid });
  eq('statement closing', st.closing, M(550000));
  eq('statement debit', st.totalDebit, M(905000));

  // 8. sale-related expense and supplier payable
  const e = await api('expenses.create', {
    expense_date: daysAgo(0),
    scope: 'sale',
    sale_id: sid,
    category: 'commission',
    description: 'عمولة بيع الكورولا',
    amount: M(4000),
  });
  const s2 = await api('sales.get', { id: sid });
  eq('sale expenses', s2.profit.sale_expenses, M(4000));
  const pur = (await api('purchases.list', { search: 'محمود عبد الحميد' })).rows[0];
  eq('supplier balance', pur.balance, M(80000));

  // 9. reports and dashboard
  const prof = await api('reports.run', { id: 'vehicle_profitability', filters: {} });
  const row = prof.rows.find((r) => r.vehicle.includes('Corolla XLi'));
  eq('report actual cost', row.actual_cost, M(835000));
  eq('report profit', row.gross_profit, M(65000));
  eq('report margin', row.margin, 7.22);
  eq('report days', row.days, 21);
  const d = await api('dashboard.get');
  checks.push(`dashboard today sales: ${d.sales.today.revenue / 100} (${d.sales.today.count})`);
  checks.push(`dashboard overdue: ${d.receivables.overdue / 100} count ${d.receivables.overdue_count} customers ${d.receivables.overdue_customers}`);
  await go(page, '#/');
  await page.screenshot({ path: path.join(shots, '08-dashboard.png'), fullPage: true });
  // 10. customer delete blocked
  const del = await page.evaluate((cid) => window.adp.call('customers.delete', { id: cid }), cid);
  checks.push('delete customer message: ' + del.error?.message);
  const cancel = await page.evaluate((sid) => window.adp.call('sales.cancel', { id: sid, reason: 'x' }), sid);
  checks.push('cancel sale message: ' + cancel.error?.message);
  const resell = await page.evaluate((vid) => window.adp.call('sales.create', { customer_id: 1, vehicle_id: vid, sale_type: 'cash', list_price: 100 }), vid);
  checks.push('resell message: ' + resell.error?.message);
} catch (e) {
  checks.push('RUN FAILED: ' + e.message);
  process.exitCode = 1;
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => undefined);
} finally {
  await app.close();
}
console.log(checks.join('\n'));
console.log('JS errors:', errors.length);
