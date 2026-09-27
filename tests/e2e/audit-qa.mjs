// Visual/functional QA for the Audit Log page.
// Generates a wide variety of real audit events (login/logout/failed login, demo data, backup with a long
// file name, payment with allocations, void, reschedule, early settlement, customer/lead/expense/vehicle/
// settings/permissions changes), then checks at several window sizes that:
//  - the page never overflows horizontally, and the table stays inside the content area,
//  - the table shows no raw JSON / technical values,
//  - "عرض التفاصيل" opens a structured modal that fits the window, wraps long values and keeps the
//    complete raw data in a collapsed «البيانات التقنية» section,
//  - search, filters and pagination still work.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, login, logout, go, setSize, ensureDir } from './lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-audit-'));
const shots = ensureDir(path.resolve('tests/e2e/output/audit'));
const { app, page, errors } = await launch(root);
const problems = [];
const notes = [];
const api = async (method, args) => {
  const r = await page.evaluate(([m, a]) => window.adp.call(m, a), [method, args]);
  if (!r.ok) throw new Error(`${method}: ${r.error.message}`);
  return r.data;
};
const today = new Date().toISOString().slice(0, 10);

async function measure(label, allowInnerScroll = false) {
  return page.evaluate(
    ([label, allowInnerScroll]) => {
      const out = [];
      const content = document.querySelector('.content');
      if (content.scrollWidth > content.clientWidth + 1) out.push(`${label}: page overflow ${content.scrollWidth} > ${content.clientWidth}`);
      const card = document.querySelector('.audit-table');
      if (!card) return { out: [`${label}: audit table not found`], tw: 0, ww: 0 };
      const wrap = card.querySelector('.table-wrap');
      const table = card.querySelector('table');
      const cr = content.getBoundingClientRect();
      const r = card.getBoundingClientRect();
      if (r.left < cr.left - 1 || r.right > cr.right + 1) out.push(`${label}: table card outside content area`);
      if (!allowInnerScroll && table.scrollWidth > wrap.clientWidth + 1)
        out.push(`${label}: table wider than its container ${table.scrollWidth} > ${wrap.clientWidth}`);
      const txt = card.querySelector('tbody').innerText;
      for (const bad of ['{"', '":', '[{', 'null', 'undefined', '.adpbak', 'installment_id', 'pay_date'])
        if (txt.includes(bad)) out.push(`${label}: raw value "${bad}" visible in table`);
      for (const td of card.querySelectorAll('tbody td'))
        if (td.getBoundingClientRect().height > 130)
          out.push(`${label}: tall cell (${Math.round(td.getBoundingClientRect().height)}px) "${td.innerText.slice(0, 40)}"`);
      return { out, tw: table.scrollWidth, ww: wrap.clientWidth };
    },
    [label, allowInnerScroll],
  );
}

async function checkModal(label) {
  return page.evaluate((label) => {
    const out = [];
    const m = document.querySelector('.modal.audit-modal');
    if (!m) return [`${label}: modal not open`];
    const r = m.getBoundingClientRect();
    if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) out.push(`${label}: modal outside window`);
    const b = m.querySelector('.modal-b');
    if (b.scrollWidth > b.clientWidth + 1) out.push(`${label}: modal horizontal overflow ${b.scrollWidth} > ${b.clientWidth}`);
    const tech = m.querySelector('details.audit-tech');
    if (!tech) out.push(`${label}: technical section missing`);
    else if (tech.open) out.push(`${label}: technical section not collapsed by default`);
    for (const s of ['معلومات أساسية', 'ملخص العملية']) if (!m.innerText.includes(s)) out.push(`${label}: section "${s}" missing`);
    const visible = [...m.querySelectorAll('.modal-b > *:not(details)')].map((e) => e.innerText).join('\n');
    for (const bad of ['{"', '[{', 'undefined', 'null']) if (visible.includes(bad)) out.push(`${label}: raw "${bad}" in business view`);
    return out;
  }, label);
}

try {
  await setSize(app, page, 1366, 768);
  await login(page, 'admin', 'admin123');
  await page.click('text=تحميل بيانات تجريبية');
  await page.click('.modal-f >> text=تحميل البيانات');
  await page.waitForSelector('.toast:has-text("تم تحميل")', { timeout: 30000 });

  // ---- generate events through the real API (same calls the screens make)
  const tryApi = async (name, m, a) => {
    try {
      return await api(m, a);
    } catch (e) {
      notes.push(`${name}: ${e.message}`);
    }
  };
  await tryApi('backup', 'backup.create', {});
  const contracts = await api('installments.contracts', { pageSize: 50 });
  const active = contracts.rows.filter((c) => c.status === 'active');
  const c1 = active[0];
  const pay = await tryApi('payment', 'payments.create', { contract_id: c1.id, amount: 3500000, pay_date: today, method: 'cash' });
  await tryApi('payment2', 'payments.create', { contract_id: c1.id, amount: 1000000, pay_date: today, method: 'cheque', reference: 'CHQ-778812' });
  if (pay?.id) await tryApi('void', 'payments.void', { id: pay.id, reason: 'تم التسجيل على العقد الخطأ' });
  if (active[1]) {
    const k = await api('installments.contract', { id: active[1].id });
    const outstanding = k.contract?.remaining ?? k.remaining ?? null;
    await tryApi('reschedule', 'installments.reschedule', {
      contract_id: active[1].id,
      reason: 'طلب العميل تخفيض القسط الشهري',
      plan: { plan_type: 'equal', count: 6, first_due_date: today },
      outstanding,
    });
  }
  if (active[2])
    await tryApi('early', 'installments.earlySettlement', { contract_id: active[2].id, discount: 500000, pay_date: today, method: 'bank_transfer' });

  const cust = (await api('customers.get', { id: 1 })).customer ?? (await api('customers.get', { id: 1 }));
  await tryApi('customer update', 'customers.update', { ...cust, id: 1, phone: '01009998887', address: 'القاهرة - التجمع الخامس', notes: 'عميل مميز' });
  const lead = (await api('leads.get', { id: 1 })).lead ?? (await api('leads.get', { id: 1 }));
  await tryApi('lead update', 'leads.update', { ...lead, id: 1, status: 'lost', lost_reason: 'اشترى من معرض آخر' });
  const ex = await tryApi('expense', 'expenses.create', {
    expense_date: today,
    scope: 'general',
    category: 'marketing',
    description: 'إعلانات ممولة على فيسبوك لشهر سبتمبر',
    amount: 750000,
    payment_method: 'bank_transfer',
  });
  if (ex?.id)
    await tryApi('expense update', 'expenses.update', {
      id: ex.id,
      expense_date: today,
      scope: 'general',
      category: 'marketing',
      description: 'إعلانات ممولة على فيسبوك وإنستجرام',
      amount: 900000,
      payment_method: 'cash',
    });
  const avail = (await api('vehicles.list', { pageSize: 50, filters: { status: 'available' } })).rows[0];
  if (avail) await tryApi('price', 'vehicles.setPrices', { id: avail.id, asking_price: avail.asking_price + 2000000, min_price: avail.min_price + 1000000 });
  await tryApi('settings', 'settings.save', { company_phone: '0223456789', receipt_footer: 'شكراً لثقتكم — معرض النخبة' });
  const roles = await api('roles.list', {});
  const sales = roles.roles.find((r) => r.code === 'sales');
  if (sales)
    await tryApi('perms', 'roles.setPermissions', {
      role_id: sales.id,
      permissions: [...sales.permissions.filter((p) => p !== 'leads.manage'), 'reports.view'],
    });
  // logout / failed login / login
  await logout(page);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'wrong-pass');
  await page.click('button[type=submit]');
  await page.waitForTimeout(500);
  await login(page, 'admin', 'admin123');

  // ---- table at every size
  for (const [w, h] of [
    [1024, 700],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await setSize(app, page, w, h);
    await go(page, '#/users');
    await page.click('.tabs >> text=سجل المراجعة');
    await page.waitForSelector('.audit-table tbody tr', { timeout: 10000 });
    await page.waitForTimeout(300);
    const m = await measure(`${w}x${h}`);
    problems.push(...m.out);
    notes.push(`${w}x${h}: table ${m.tw}px in ${m.ww}px container`);
    await page.screenshot({ path: path.join(shots, `table-${w}x${h}.png`) });
  }

  // ---- details modal for each event kind
  await setSize(app, page, 1366, 768);
  await go(page, '#/users');
  await page.click('.tabs >> text=سجل المراجعة');
  await page.waitForSelector('.audit-table tbody tr');
  const kinds = [
    ['login', 'auth', 'login'],
    ['login_failed', 'auth', 'login_failed'],
    ['payment', 'payments', 'payment'],
    ['void', 'payments', 'void'],
    ['reschedule', 'installments', 'reschedule'],
    ['early_settlement', 'installments', 'early_settlement'],
    ['customer-update', 'customers', 'update'],
    ['lead-update', 'leads', 'update'],
    ['expense-create', 'expenses', 'create'],
    ['expense-update', 'expenses', 'update'],
    ['price_change', 'vehicles', 'price_change'],
    ['backup', 'backup', 'backup'],
    ['seed_demo', 'settings', 'seed_demo'],
    ['settings-update', 'settings', 'update'],
    ['permissions', 'users', 'update_permissions'],
    ['purchase', 'purchases', 'create'],
    ['sale', 'sales', 'create'],
  ];
  for (const [name, mod, action] of kinds) {
    await page.selectOption('select[aria-label="الوحدة"]', mod);
    await page.selectOption('select[aria-label="العملية"]', action);
    await page.waitForTimeout(450);
    const row = await page.$('.audit-table tbody tr');
    if (!row) {
      problems.push(`${name}: no row after filtering`);
      continue;
    }
    const summary = await row.$eval('.audit-summary', (e) => e.innerText).catch(() => '(none)');
    const cells = await row.$$eval('td', (tds) => tds.map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
    notes.push(`${name}: ${cells.join(' | ')}`);
    await row.click('button:has-text("عرض التفاصيل")');
    await page.waitForSelector('.modal.audit-modal');
    problems.push(...(await checkModal(name)));
    await page.screenshot({ path: path.join(shots, `modal-${name}.png`) });
    // technical data: expand, check raw JSON is complete, screenshot
    await page.click('.audit-tech > summary');
    const tech = await page.$eval('.audit-tech', (e) => ({ open: e.open, text: e.innerText }));
    if (!tech.open) problems.push(`${name}: technical section did not expand`);
    const raw = (await api('audit.list', { page: 1, pageSize: 1, filters: { module: mod, action } })).rows[0];
    for (const k of ['old_value', 'new_value', 'details']) {
      if (
        raw[k] &&
        !tech.text.replace(/\s+/g, '').includes(
          JSON.stringify(raw[k].startsWith('{') || raw[k].startsWith('[') ? JSON.parse(raw[k]) : raw[k])
            .replace(/\s+/g, '')
            .replace(/^"|"$/g, '')
            .slice(0, 60),
        )
      )
        problems.push(`${name}: raw ${k} not fully shown in technical section`);
    }
    const mb = await page.$eval('.modal.audit-modal .modal-b', (b) => b.scrollWidth - b.clientWidth);
    if (mb > 1) problems.push(`${name}: technical section overflows modal (${mb}px)`);
    await page.screenshot({ path: path.join(shots, `modal-${name}-tech.png`) });
    if (!summary || summary === '(none)') problems.push(`${name}: no summary`);
    await page.click('.modal.audit-modal .modal-f >> text=إغلاق');
  }
  // narrow modal
  await setSize(app, page, 800, 600);
  await page.selectOption('select[aria-label="الوحدة"]', 'payments');
  await page.selectOption('select[aria-label="العملية"]', 'payment');
  await page.waitForTimeout(400);
  problems.push(...(await measure('800x600')).out);
  await page.screenshot({ path: path.join(shots, 'table-800x600.png') });
  await page.click('.audit-table tbody tr >> nth=0 >> button:has-text("عرض التفاصيل")');
  await page.click('.audit-tech > summary');
  problems.push(...(await checkModal('800x600 modal')).filter((x) => !x.includes('not collapsed')));
  await page.screenshot({ path: path.join(shots, 'modal-800x600.png') });
  await page.click('.modal.audit-modal .modal-f >> text=إغلاق');

  // ---- search / filters / pagination still work
  await setSize(app, page, 1366, 768);
  await page.click('text=مسح الفلاتر');
  await page.waitForTimeout(400);
  const total = await page.$eval('.pager b', (e) => Number(e.textContent.replace(/,/g, '')));
  await page.fill('.tb-search input', 'IC-2026');
  await page.waitForTimeout(600);
  const searched = await page.$eval('.pager b', (e) => Number(e.textContent.replace(/,/g, '')));
  if (!(searched > 0 && searched < total)) problems.push(`search did not filter (${searched} of ${total})`);
  await page.click('text=مسح الفلاتر');
  await page.waitForTimeout(400);
  const userSel = await page.$('select[aria-label="المستخدم"]');
  if (!userSel) problems.push('user filter missing');
  else {
    await page.selectOption('select[aria-label="المستخدم"]', { index: 1 });
    await page.waitForTimeout(500);
    const byUser = await page.$$eval('.audit-table tbody tr td:nth-child(2)', (t) => [...new Set(t.map((x) => x.innerText.trim()))]);
    if (byUser.length !== 1) problems.push(`user filter returned ${byUser.join(',')}`);
    await page.click('text=مسح الفلاتر');
    await page.waitForTimeout(400);
  }
  await page.fill('input[aria-label="من تاريخ"]', today);
  await page.fill('input[aria-label="إلى تاريخ"]', today);
  await page.waitForTimeout(500);
  const dated = await page.$eval('.pager b', (e) => Number(e.textContent.replace(/,/g, '')));
  if (!dated) problems.push('date filter returned nothing');
  await page.click('text=مسح الفلاتر');
  await page.waitForTimeout(400);
  const p1 = await page.$eval('.audit-table tbody tr td', (e) => e.innerText);
  await page.click('.pager >> text=التالي');
  await page.waitForTimeout(400);
  const pageLabel = await page.$$eval('.pager .small', (els) => els[els.length - 1].innerText);
  if (!/صفحة\s*2/.test(pageLabel)) problems.push(`pagination did not move: ${pageLabel}`);
  notes.push(`total audit rows ${total}; first row ${p1}`);
  // row click still opens the modal
  await page.click('.audit-table tbody tr >> nth=0 >> td >> nth=0');
  if (!(await page.$('.modal.audit-modal'))) problems.push('row click did not open the modal');
  else await page.click('.modal.audit-modal .modal-f >> text=إغلاق');

  // ---- vehicle page audit tab (reuses the same component)
  if (avail) {
    await go(page, `#/vehicles/${avail.id}`);
    await page.click('.tabs >> text=سجل');
    await page.waitForSelector('.audit-table tbody tr', { timeout: 10000 }).catch(() => problems.push('vehicle audit tab empty'));
    problems.push(...(await measure('vehicle tab')).out);
    await page.screenshot({ path: path.join(shots, 'vehicle-tab.png') });
  }
} catch (e) {
  problems.push('RUN FAILED: ' + e.message);
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => undefined);
} finally {
  await app.close();
}
console.log(JSON.stringify({ problems, notes, jsErrors: errors }, null, 2));
process.exit(problems.length || errors.length ? 1 : 0);
