// Visual QA for the table search/filter toolbars on every table screen, at several window sizes.
// Checks: no overlapping controls, no toolbar overflow, select text + arrow fit inside the control,
// search placeholder readable, consistent gaps. Also re-checks one screen in LTR.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, login, go, setSize, ensureDir } from './lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-tb-'));
const shots = ensureDir(path.resolve('tests/e2e/output/toolbars'));
const { app, page, errors } = await launch(root);
const problems = [];
let checked = 0;

const SCREENS = [
  ['vehicles', '#/vehicles'],
  ['purchases', '#/purchases'],
  ['costs', '#/costs'],
  ['customers', '#/customers'],
  ['leads', '#/leads'],
  ['quotations', '#/quotations'],
  ['reservations', '#/reservations'],
  ['sales', '#/sales'],
  ['installments-overdue', '#/installments?tab=overdue'],
  ['installments-all', '#/installments?tab=all'],
  ['installments-contracts', '#/installments?tab=contracts'],
  ['installments-payments', '#/installments?tab=payments'],
  ['tradeins', '#/tradeins'],
  ['expenses', '#/expenses'],
  ['report-profitability', '#/reports?id=vehicle_profitability'],
  ['report-purchases', '#/reports?id=purchases_by_date'],
];

async function inspect(label) {
  return page.evaluate((label) => {
    const out = [];
    const canvas = document.createElement('canvas').getContext('2d');
    const textW = (el, t) => {
      const cs = getComputedStyle(el);
      canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return canvas.measureText(t).width;
    };
    const toolbars = [...document.querySelectorAll('.content .toolbar')];
    toolbars.forEach((tb, ti) => {
      const tr = tb.getBoundingClientRect();
      if (tb.scrollWidth > tb.clientWidth + 1) out.push(`${label} toolbar#${ti}: horizontal overflow ${tb.scrollWidth}>${tb.clientWidth}`);
      // leaf controls = everything the user sees as a separate box
      const ctrls = [...tb.querySelectorAll('input:not([type=checkbox]), select, button, .chip, label.checkbox')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !e.closest('.picker-list');
      });
      const rects = ctrls.map((e) => ({ e, r: e.getBoundingClientRect() }));
      for (const { e, r } of rects) {
        if (r.left < tr.left - 1 || r.right > tr.right + 1)
          out.push(`${label}: control outside toolbar "${e.getAttribute('aria-label') || e.textContent.trim().slice(0, 25)}"`);
      }
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i].r,
            b = rects[j].r;
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 0.5 && oy > 0.5) {
            const n = (x) => x.getAttribute('aria-label') || x.placeholder || x.textContent.trim().slice(0, 25);
            out.push(`${label}: OVERLAP "${n(rects[i].e)}" / "${n(rects[j].e)}" (${ox.toFixed(1)}px)`);
          }
        }
      for (const s of tb.querySelectorAll('select')) {
        const cs = getComputedStyle(s);
        const avail = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const t = s.options[s.selectedIndex]?.text ?? '';
        const w = textW(s, t);
        if (w > avail + 1) out.push(`${label}: select text clipped "${t}" (${w.toFixed(0)} > ${avail.toFixed(0)})`);
        const arrowPad = parseFloat(cs.direction === 'rtl' ? cs.paddingLeft : cs.paddingRight);
        if (arrowPad < 28) out.push(`${label}: select arrow padding too small (${arrowPad}px)`);
      }
      for (const inp of tb.querySelectorAll('.tb-search input, .picker input')) {
        const cs = getComputedStyle(inp);
        const avail = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const w = textW(inp, inp.placeholder);
        if (inp.getBoundingClientRect().width < 200) out.push(`${label}: search/picker too narrow (${inp.getBoundingClientRect().width.toFixed(0)}px)`);
        if (w > avail + 1) out.push(`${label}: placeholder truncated "${inp.placeholder}" (${w.toFixed(0)} > ${avail.toFixed(0)})`);
      }
      const g = parseFloat(getComputedStyle(tb).columnGap);
      if (!(g >= 8 && g <= 12)) out.push(`${label}: toolbar gap ${g}px`);
    });
    return { issues: out, count: toolbars.length };
  }, label);
}

try {
  await setSize(app, page, 1366, 768);
  await login(page, 'admin', 'admin123');
  await page.click('text=تحميل بيانات تجريبية');
  await page.click('.modal-f >> text=تحميل البيانات');
  await page.waitForSelector('.toast:has-text("تم تحميل")', { timeout: 30000 });

  for (const [w, h] of [
    [1100, 700],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await setSize(app, page, w, h);
    const dir = ensureDir(path.join(shots, `${w}x${h}`));
    for (const [name, hash] of SCREENS) {
      await go(page, hash);
      await page.waitForTimeout(250);
      const r = await inspect(`${w}x${h} ${name}`);
      checked += r.count;
      problems.push(...r.issues);
      const tb = await page.$('.content .toolbar');
      if (tb && (w === 1366 || w === 1100 || ['vehicles', 'purchases', 'sales'].includes(name))) await tb.screenshot({ path: path.join(dir, `${name}.png`) });
    }
  }
  // active-filter state (clear button + chosen values) and LTR check
  await setSize(app, page, 1366, 768);
  await go(page, '#/purchases');
  await page.selectOption('.tb-filter select >> nth=0', { index: 2 });
  await page.fill('.tb-search input', 'BMW');
  await page.waitForTimeout(400);
  problems.push(...(await inspect('1366 purchases filtered')).issues);
  await (await page.$('.content .toolbar')).screenshot({ path: path.join(shots, '1366x768', 'purchases-filtered.png') });
  await page.evaluate(() => (document.documentElement.dir = 'ltr'));
  await page.waitForTimeout(200);
  problems.push(...(await inspect('LTR purchases')).issues);
  await (await page.$('.content .toolbar')).screenshot({ path: path.join(shots, '1366x768', 'purchases-ltr.png') });
  await page.evaluate(() => (document.documentElement.dir = 'rtl'));
} catch (e) {
  problems.push('RUN FAILED: ' + e.message);
} finally {
  await app.close();
}
console.log(JSON.stringify({ toolbarsChecked: checked, problems, jsErrors: errors }, null, 2));
process.exit(problems.length || errors.length ? 1 : 0);
