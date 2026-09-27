import type { Db } from '../db/database';
import type { Ctx } from '../context';
import { requirePerm } from '../context';
import { fail } from '../errors';
import { allSettings } from '../services/common';
import { amountInWords, fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtPct, label, anyLabel } from '../format';
import { getQuotation, getReservation, getSale } from '../services/sales';
import { getContract, getPayment } from '../services/installments';
import { customerStatement } from '../services/customers';
import { costCard } from '../services/costs';
import { getPurchase } from '../services/purchases';
import { localDateTime } from '../calc/dates';

export type DocType = 'quotation' | 'reservation' | 'invoice' | 'contract' | 'schedule' | 'receipt' | 'statement' | 'costcard' | 'purchase';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const CSS = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color: #1f2937; font-size: 12.5px; line-height: 1.6; margin: 0; background: #fff; }
.doc { max-width: 190mm; margin: 0 auto; }
header.top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 14px; gap: 16px; }
.brand h1 { margin: 0; font-size: 21px; color: #1e3a5f; }
.brand .sub { color: #6b7280; font-size: 11.5px; }
.doc-title { text-align: left; }
.doc-title h2 { margin: 0; font-size: 19px; color: #111827; }
.doc-title .no { font-size: 12.5px; color: #374151; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.box { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px; }
.box h3 { margin: 0 0 6px; font-size: 13px; color: #1e3a5f; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; }
.kv .k { color: #6b7280; white-space: nowrap; }
.kv .v { font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; }
th, td { border: 1px solid #d1d5db; padding: 5px 7px; text-align: right; vertical-align: top; }
th { background: #eef2f7; color: #1e3a5f; font-weight: 700; font-size: 12px; }
td.num, th.num { text-align: left; direction: ltr; unicode-bidi: plaintext; white-space: nowrap; }
tr.total td { background: #f3f4f6; font-weight: 700; }
tr:nth-child(even) td { background: #fafafa; }
.summary { margin-right: auto; width: 55%; }
.summary td:first-child { color: #374151; }
.words { background: #f8fafc; border: 1px dashed #94a3b8; padding: 6px 10px; border-radius: 6px; margin: 8px 0; font-weight: 600; }
.terms { font-size: 11.5px; color: #374151; white-space: pre-wrap; border: 1px solid #e5e7eb; padding: 8px 10px; border-radius: 6px; }
.signs { display: flex; justify-content: space-between; margin-top: 36px; gap: 20px; }
.signs div { flex: 1; text-align: center; border-top: 1px solid #9ca3af; padding-top: 6px; color: #374151; }
footer { margin-top: 18px; border-top: 1px solid #e5e7eb; padding-top: 6px; color: #9ca3af; font-size: 10.5px; display: flex; justify-content: space-between; }
.badge { display: inline-block; padding: 0 8px; border-radius: 10px; font-size: 11px; background: #e5e7eb; }
.b-overdue { background: #fee2e2; color: #991b1b; } .b-paid { background: #dcfce7; color: #166534; } .b-partially_paid { background: #fef3c7; color: #92400e; }
.b-due_today { background: #dbeafe; color: #1e40af; } .b-cancelled { text-decoration: line-through; }
.muted { color: #6b7280; }
.neg { color: #b91c1c; } .pos { color: #047857; }
h4 { margin: 12px 0 4px; color: #1e3a5f; }
@media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

function layout(settings: Record<string, string>, title: string, no: string, date: string, body: string, fontCss: string, landscape = false) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)} ${esc(no)}</title>
<style>${fontCss}${CSS}${landscape ? '@page { size: A4 landscape; } .doc { max-width: 275mm; }' : ''}</style></head>
<body><div class="doc">
<header class="top">
  <div class="brand"><h1>${esc(settings.company_name)}</h1>
    <div class="sub">${esc(settings.company_address)}${settings.company_phone ? ' — هاتف: ' + esc(settings.company_phone) : ''}${settings.company_tax_no ? ' — رقم ضريبي: ' + esc(settings.company_tax_no) : ''}</div></div>
  <div class="doc-title"><h2>${esc(title)}</h2><div class="no">${no ? 'رقم: ' + esc(no) + '<br>' : ''}التاريخ: ${esc(fmtDate(date))}</div></div>
</header>
${body}
<footer><span>${esc(settings.receipt_footer)}</span><span>AutoDeal Pro — طُبع في <span dir="ltr">${esc(fmtDateTime(localDateTime()))}</span></span></footer>
</div></body></html>`;
}

const kv = (rows: [string, unknown][]) => `<div class="kv">${rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v ?? '—')}</div>`).join('')}</div>`;
const box = (title: string, content: string) => `<div class="box"><h3>${esc(title)}</h3>${content}</div>`;
const money = (m: number | null | undefined, cur: string) => fmtMoney(m, { currency: cur });

function customerBox(c: any) {
  return box('بيانات العميل', kv([
    ['الاسم', c.customer_name ?? c.name],
    ['الكود', c.customer_code ?? c.code],
    ['الهاتف', c.customer_phone ?? c.phone],
    ['الرقم القومي', c.national_id],
    ['العنوان', c.customer_address ?? c.address],
  ]));
}

function vehicleBox(v: any) {
  return box('بيانات السيارة', kv([
    ['السيارة', `${v.brand} ${v.model} ${v.trim ?? ''}`.trim()],
    ['سنة الصنع', v.model_year],
    ['اللون', v.color],
    ['رقم المخزون', v.stock_no],
    ['رقم الشاسيه', v.vin],
    ['الحالة / الكيلومترات', `${label('condition', v.condition)} — ${fmtNum(v.mileage)} كم`],
  ]));
}

function scheduleTable(rows: any[], cur: string, withPaid = true) {
  const active = rows.filter((r) => !r.is_cancelled);
  const tot = (k: string) => active.reduce((a, r) => a + (r[k] ?? 0), 0);
  return `<table><thead><tr><th>#</th><th>تاريخ الاستحقاق</th><th class="num">قيمة القسط</th>${withPaid ? '<th class="num">المدفوع</th><th class="num">المتبقي</th><th>الحالة</th><th class="num">أيام التأخير</th>' : ''}</tr></thead><tbody>
  ${rows
    .map(
      (r) => `<tr><td>${r.seq}</td><td>${fmtDate(r.due_date)}</td><td class="num">${fmtMoney(r.amount)}</td>${
        withPaid
          ? `<td class="num">${fmtMoney(r.paid_amount)}</td><td class="num">${fmtMoney(r.remaining)}</td><td><span class="badge b-${r.status}">${label('installment_status', r.status)}</span></td><td class="num">${r.days_overdue || ''}</td>`
          : ''
      }</tr>`,
    )
    .join('')}
  <tr class="total"><td colspan="2">الإجمالي (${cur})</td><td class="num">${fmtMoney(tot('amount'))}</td>${withPaid ? `<td class="num">${fmtMoney(tot('paid_amount'))}</td><td class="num">${fmtMoney(tot('remaining'))}</td><td></td><td></td>` : ''}</tr>
  </tbody></table>`;
}

function saleSummary(s: any, cur: string) {
  const rows: [string, number][] = [
    ['سعر السيارة', s.list_price],
    ['الخصم', -s.discount],
    ['صافي سعر البيع', s.selling_price],
    ['رسوم إضافية', s.fees],
    ['إجمالي قيمة العقد', s.total_contract_value],
  ];
  if (s.trade_in_value) rows.push(['قيمة سيارة الاستبدال', -s.trade_in_value]);
  if (s.reservation_credit) rows.push(['عربون الحجز', -s.reservation_credit]);
  rows.push([s.financed_amount ? 'المقدم المدفوع' : 'المبلغ المدفوع نقداً', -s.down_payment]);
  if (s.financed_amount) rows.push(['المبلغ المقسط', s.financed_amount]);
  return `<table class="summary"><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmtMoney(v)} ${cur}</td></tr>`).join('')}</tbody></table>`;
}

/** Builds a printable HTML document. Permission checks happen in the underlying services. */
export function buildDocument(db: Db, ctx: Ctx, type: DocType, id: number, opts: { from?: string; to?: string; fontCss?: string } = {}): { title: string; html: string; landscape?: boolean } {
  const st = allSettings(db);
  const cur = st.currency || 'ج.م';
  const fontCss = opts.fontCss ?? '';
  switch (type) {
    case 'quotation': {
      const q = getQuotation(db, ctx, { id });
      const body = `<div class="grid">${customerBox(q)}${vehicleBox(q)}</div>
        <table class="summary"><tbody>
          <tr><td>السعر المطلوب</td><td class="num">${money(q.asking_price, cur)}</td></tr>
          <tr><td>الخصم</td><td class="num">${money(q.discount, cur)}</td></tr>
          <tr class="total"><td>السعر النهائي</td><td class="num">${money(q.final_price, cur)}</td></tr>
          <tr><td>طريقة الدفع المقترحة</td><td>${label('sale_type', q.payment_method)}</td></tr>
          ${q.down_payment ? `<tr><td>المقدم المقترح</td><td class="num">${money(q.down_payment, cur)}</td></tr>` : ''}
          ${q.months ? `<tr><td>عدد الشهور</td><td class="num">${q.months}</td></tr>` : ''}
          ${q.down_payment && q.months ? `<tr><td>القسط الشهري التقريبي</td><td class="num">${money(Math.round((q.final_price - q.down_payment) / q.months), cur)}</td></tr>` : ''}
        </tbody></table>
        <div class="words">${amountInWords(q.final_price)}</div>
        <p><b>العرض صالح حتى:</b> ${fmtDate(q.valid_until)}</p>
        ${q.notes ? `<p><b>ملاحظات:</b> ${esc(q.notes)}</p>` : ''}
        <p class="muted">هذا العرض لا يعتبر حجزاً للسيارة، والأسعار قابلة للتغيير بعد انتهاء مدة صلاحية العرض.</p>
        <div class="signs"><div>مندوب المبيعات: ${esc(q.created_by_name)}</div><div>توقيع العميل</div><div>ختم المعرض</div></div>`;
      return { title: 'عرض سعر', html: layout(st, 'عرض سعر', q.quote_no, q.quote_date, body, fontCss) };
    }
    case 'reservation': {
      const r = getReservation(db, ctx, { id });
      const body = `<div class="grid">${customerBox(r)}${vehicleBox(r)}</div>
        ${box('تفاصيل الحجز', kv([
          ['تاريخ الحجز', fmtDate(r.reservation_date)],
          ['ينتهي في', fmtDate(r.expiry_date)],
          ['مبلغ العربون', money(r.amount, cur)],
          ['السعر المتفق عليه', r.agreed_price ? money(r.agreed_price, cur) : money(r.asking_price, cur)],
          ['الحالة', label('reservation_status', r.status)],
        ]))}
        <div class="words">استلمنا من السيد/ ${esc(r.customer_name)} مبلغ ${fmtMoney(r.amount)} ${cur} (${amountInWords(r.amount)}) كعربون حجز للسيارة الموضحة أعلاه.</div>
        ${r.notes ? `<p><b>ملاحظات:</b> ${esc(r.notes)}</p>` : ''}
        <p class="muted">في حالة عدم إتمام الشراء قبل تاريخ انتهاء الحجز يحق للمعرض إلغاء الحجز وفقاً للسياسة المتفق عليها.</p>
        <div class="signs"><div>المستلم: ${esc(r.created_by_name)}</div><div>توقيع العميل</div></div>`;
      return { title: 'إيصال حجز سيارة', html: layout(st, 'إيصال حجز سيارة', r.reservation_no, r.reservation_date, body, fontCss) };
    }
    case 'invoice': {
      const { sale: s, payments } = getSale(db, ctx, { id });
      const body = `<div class="grid">${customerBox(s)}${vehicleBox(s)}</div>
        <table><thead><tr><th>البيان</th><th>رقم الشاسيه</th><th>رقم المحرك</th><th class="num">السعر</th><th class="num">الخصم</th><th class="num">الصافي</th></tr></thead>
        <tbody><tr><td>${esc(`${s.brand} ${s.model} ${s.trim ?? ''} ${s.model_year} — ${s.color ?? ''}`)}</td><td>${esc(s.vin)}</td><td>${esc(s.engine_no)}</td>
          <td class="num">${fmtMoney(s.list_price)}</td><td class="num">${fmtMoney(s.discount)}</td><td class="num">${fmtMoney(s.selling_price)}</td></tr>
          ${s.fees ? `<tr><td colspan="5">رسوم إضافية (تسجيل / إدارية)</td><td class="num">${fmtMoney(s.fees)}</td></tr>` : ''}
          <tr class="total"><td colspan="5">الإجمالي (${cur})</td><td class="num">${fmtMoney(s.total_contract_value)}</td></tr></tbody></table>
        <div class="words">${amountInWords(s.total_contract_value)}</div>
        ${saleSummary(s, cur)}
        <h4>المدفوعات</h4>
        <table><thead><tr><th>رقم الإيصال</th><th>التاريخ</th><th>النوع</th><th>طريقة الدفع</th><th class="num">المبلغ</th></tr></thead><tbody>
        ${payments.filter((p: any) => p.status === 'valid').map((p: any) => `<tr><td>${esc(p.receipt_no)}</td><td>${fmtDate(p.pay_date)}</td><td>${label('payment_kind', p.kind)}</td><td>${label('pay_method', p.method)}</td><td class="num">${fmtMoney(p.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">لا توجد مدفوعات</td></tr>'}
        </tbody></table>
        <p>طريقة البيع: <b>${label('sale_type', s.sale_type)}</b> — مندوب المبيعات: <b>${esc(s.salesperson ?? '—')}</b></p>
        <div class="signs"><div>المحاسب</div><div>توقيع العميل</div><div>ختم المعرض</div></div>`;
      return { title: 'فاتورة بيع', html: layout(st, 'فاتورة بيع سيارة', s.sale_no, s.sale_date, body, fontCss) };
    }
    case 'contract': {
      const { sale: s, tradeIn } = getSale(db, ctx, { id });
      const k = s.contract_id ? getContract(db, ctx, { id: s.contract_id }) : null;
      const body = `<p>إنه في يوم ${fmtDate(s.sale_date)} تم الاتفاق بين كل من:</p>
        <p><b>الطرف الأول (البائع):</b> ${esc(st.company_name)} — ${esc(st.company_address)}</p>
        <p><b>الطرف الثاني (المشتري):</b> ${esc(s.customer_name)} — رقم قومي: ${esc(s.national_id ?? '—')} — العنوان: ${esc(s.customer_address ?? '—')} — هاتف: ${esc(s.customer_phone ?? '—')}</p>
        <p>على أن يبيع الطرف الأول للطرف الثاني السيارة الموضحة بياناتها أدناه بحالتها الراهنة التي عاينها الطرف الثاني المعاينة التامة النافية للجهالة:</p>
        <div class="grid">${vehicleBox(s)}${box('الشروط المالية', kv([
          ['طريقة البيع', label('sale_type', s.sale_type)],
          ['إجمالي قيمة العقد', money(s.total_contract_value, cur)],
          ['قيمة الاستبدال', s.trade_in_value ? money(s.trade_in_value, cur) : '—'],
          ['العربون + المقدم', money(s.reservation_credit + s.down_payment, cur)],
          ['المبلغ المقسط', s.financed_amount ? money(s.financed_amount, cur) : '—'],
          ['نظام التقسيط', k ? label('plan_type', k.contract.plan_type) : '—'],
        ]))}</div>
        <div class="words">إجمالي الثمن: ${amountInWords(s.total_contract_value)}</div>
        ${tradeIn ? `<p><b>سيارة الاستبدال:</b> ${esc(`${tradeIn.brand} ${tradeIn.model} ${tradeIn.model_year}`)} — شاسيه ${esc(tradeIn.vin ?? '—')} — بقيمة ${money(tradeIn.trade_in_value, cur)}</p>` : ''}
        ${k ? `<h4>جدول الأقساط — عقد رقم ${esc(k.contract.contract_no)}</h4>${scheduleTable(k.schedule.filter((r: any) => !r.is_cancelled), cur, false)}` : ''}
        <h4>الشروط والأحكام</h4><div class="terms">${esc(st.contract_terms)}</div>
        <div class="signs"><div>الطرف الأول (البائع)</div><div>الطرف الثاني (المشتري)</div><div>شاهد</div></div>`;
      return { title: 'عقد بيع سيارة', html: layout(st, 'عقد بيع سيارة', k?.contract.contract_no ?? s.sale_no, s.sale_date, body, fontCss) };
    }
    case 'schedule': {
      const k = getContract(db, ctx, { id });
      const c = k.contract;
      const body = `<div class="grid">${customerBox(c)}${box('بيانات العقد', kv([
          ['رقم العقد', c.contract_no],
          ['رقم البيع', c.sale_no],
          ['السيارة', `${c.brand} ${c.model} ${c.model_year} (${c.stock_no})`],
          ['المبلغ الممول', money(c.financed_amount, cur)],
          ['المحصل', money(c.paid, cur)],
          ['المتبقي', money(c.remaining, cur)],
          ['المتأخر', money(c.overdue_amount, cur)],
          ['الحالة', label('contract_status', c.status)],
        ]))}</div>${scheduleTable(k.schedule, cur)}
        ${k.reschedules.length ? `<p class="muted">تمت إعادة جدولة العقد ${k.reschedules.length} مرة. الأقساط الملغاة موضحة بخط مشطوب.</p>` : ''}`;
      return { title: 'جدول الأقساط', html: layout(st, 'جدول الأقساط', c.contract_no, localDateTime().slice(0, 10), body, fontCss) };
    }
    case 'receipt': {
      const { payment: p, allocations, contractRemaining } = getPayment(db, ctx, { id });
      const isRefund = p.kind === 'refund';
      const body = `${p.status === 'voided' ? '<p class="words neg">هذا الإيصال ملغي — السبب: ' + esc(p.void_reason) + '</p>' : ''}
        <div class="grid">${customerBox(p)}${box('بيانات الدفعة', kv([
          ['نوع الدفعة', label('payment_kind', p.kind)],
          ['طريقة الدفع', label('pay_method', p.method)],
          ['المرجع', p.reference],
          ['العقد / البيع', p.contract_no ?? p.sale_no ?? p.reservation_no],
          ['السيارة', p.brand ? `${p.brand} ${p.model} ${p.model_year}` : '—'],
        ]))}</div>
        <div class="words">${isRefund ? 'صرفنا إلى' : 'استلمنا من'} السيد/ ${esc(p.customer_name)} مبلغ ${fmtMoney(p.amount)} ${cur}<br>${amountInWords(p.amount)}</div>
        ${allocations.length ? `<h4>توزيع الدفعة على الأقساط</h4><table><thead><tr><th>القسط</th><th>تاريخ الاستحقاق</th><th class="num">قيمة القسط</th><th class="num">المسدد من هذه الدفعة</th></tr></thead><tbody>
          ${allocations.map((a: any) => `<tr><td>${a.seq}</td><td>${fmtDate(a.due_date)}</td><td class="num">${fmtMoney(a.installment_amount)}</td><td class="num">${fmtMoney(a.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${contractRemaining !== null ? `<p>الرصيد المتبقي على العقد بعد هذه الدفعة: <b>${money(contractRemaining, cur)}</b></p>` : ''}
        ${p.notes ? `<p><b>ملاحظات:</b> ${esc(p.notes)}</p>` : ''}
        <div class="signs"><div>المستلم: ${esc(p.user_name)}</div><div>توقيع العميل</div></div>`;
      return { title: isRefund ? 'إيصال صرف' : 'إيصال استلام نقدية', html: layout(st, isRefund ? 'إيصال صرف' : 'إيصال استلام نقدية', p.receipt_no, p.pay_date, body, fontCss) };
    }
    case 'statement': {
      const s = customerStatement(db, ctx, { id, from: opts.from, to: opts.to });
      const body = `<div class="grid">${customerBox(s.customer)}${box('الفترة', kv([
          ['من', opts.from ? fmtDate(opts.from) : 'بداية التعامل'],
          ['إلى', opts.to ? fmtDate(opts.to) : 'اليوم'],
          ['الرصيد الافتتاحي', money(s.opening, cur)],
          ['الرصيد الختامي', money(s.closing, cur)],
        ]))}</div>
        <table><thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th class="num">مدين</th><th class="num">دائن</th><th class="num">الرصيد</th></tr></thead><tbody>
        ${s.opening ? `<tr><td></td><td></td><td>رصيد افتتاحي</td><td></td><td></td><td class="num">${fmtMoney(s.opening)}</td></tr>` : ''}
        ${s.rows.map((r: any) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.ref)}</td><td>${esc(r.description)}</td><td class="num">${r.debit ? fmtMoney(r.debit) : ''}</td><td class="num">${r.credit ? fmtMoney(r.credit) : ''}</td><td class="num">${fmtMoney(r.balance)}</td></tr>`).join('')}
        <tr class="total"><td colspan="3">الإجمالي (${cur})</td><td class="num">${fmtMoney(s.totalDebit)}</td><td class="num">${fmtMoney(s.totalCredit)}</td><td class="num">${fmtMoney(s.closing)}</td></tr>
        </tbody></table>
        <p class="muted">الرصيد الموجب = مستحق على العميل، والرصيد السالب = رصيد دائن للعميل.</p>`;
      return { title: 'كشف حساب عميل', html: layout(st, 'كشف حساب عميل', s.customer.code, localDateTime().slice(0, 10), body, fontCss) };
    }
    case 'costcard': {
      const c = costCard(db, ctx, { vehicle_id: id });
      const v = c.vehicle;
      const t = c.totals;
      const body = `<div class="grid">${vehicleBox(v)}${box('ملخص التكلفة والتسعير', kv([
          ['تكلفة الاقتناء', money(t.acquisition_cost, cur)],
          ['التكاليف المباشرة', money(t.direct_costs, cur)],
          ['التكلفة الفعلية', money(t.actual_cost, cur)],
          ['السعر المطلوب', money(t.asking_price, cur)],
          ['الحد الأدنى', money(t.min_price, cur)],
          ['الربح المتوقع', t.expected_profit !== null ? `${money(t.expected_profit, cur)} (${fmtPct(t.expected_margin)})` : '—'],
          ['سعر البيع الفعلي', t.selling_price !== null ? money(t.selling_price, cur) : 'لم تُبع بعد'],
          ['مجمل الربح الفعلي', t.gross_profit !== null ? `${money(t.gross_profit, cur)} (${fmtPct(t.gross_margin)})` : '—'],
          ['أيام بالمخزون', v.days_in_stock],
        ]))}</div>
        <table><thead><tr><th>التاريخ</th><th>رقم البند</th><th>البند</th><th>الوصف</th><th>المورد</th><th class="num">المبلغ</th></tr></thead><tbody>
        ${c.lines.map((l: any) => `<tr><td>${fmtDate(l.expense_date)}</td><td>${esc(l.expense_no)}</td><td>${label('cost_category', l.category)}</td><td>${esc(l.description ?? '')}</td><td>${esc(l.supplier_name ?? '')}</td><td class="num">${fmtMoney(l.amount)}</td></tr>`).join('')}
        <tr class="total"><td colspan="5">التكلفة الفعلية (${cur})</td><td class="num">${fmtMoney(t.actual_cost)}</td></tr></tbody></table>`;
      return { title: 'بطاقة تكلفة سيارة', html: layout(st, 'بطاقة تكلفة سيارة', v.stock_no, localDateTime().slice(0, 10), body, fontCss) };
    }
    case 'purchase': {
      const p = getPurchase(db, ctx, { id });
      const body = `<div class="grid">${box('المورد / البائع', kv([['الاسم', p.supplier_name], ['النوع', label('supplier_type', p.supplier_type)], ['الهاتف', p.supplier_phone], ['العنوان', p.supplier_address]]))}
        ${box('السيارة', kv([['السيارة', `${p.brand} ${p.model} ${p.model_year}`], ['رقم المخزون', p.stock_no], ['الشاسيه', p.vin], ['اللون', p.color]]))}</div>
        <table class="summary"><tbody><tr><td>سعر الشراء</td><td class="num">${money(p.purchase_price, cur)}</td></tr><tr><td>المدفوع</td><td class="num">${money(p.paid_amount, cur)}</td></tr><tr class="total"><td>المتبقي للمورد</td><td class="num">${money(p.balance, cur)}</td></tr></tbody></table>
        <div class="words">${amountInWords(p.purchase_price)}</div>
        <div class="signs"><div>البائع</div><div>المشتري (المعرض)</div></div>`;
      return { title: 'مستند شراء', html: layout(st, 'مستند شراء سيارة', p.purchase_no, p.purchase_date, body, fontCss) };
    }
    default:
      return fail('NOT_FOUND', 'نوع المستند غير معروف.');
  }
}

/** Printable version of any report result (landscape when wide). */
export function buildReportHtml(db: Db, ctx: Ctx, report: { title: string; columns: any[]; rows: any[]; totals: Record<string, number>; filters?: any }, fontCss = '') {
  requirePerm(ctx, 'reports.view');
  const st = allSettings(db);
  const cur = st.currency || 'ج.م';
  const fmt = (c: any, v: any) => {
    if (v === null || v === undefined || v === '') return '';
    switch (c.type) {
      case 'money':
        return fmtMoney(v);
      case 'int':
        return fmtNum(v);
      case 'pct':
        return fmtPct(v);
      case 'date':
        return fmtDate(v);
      case 'status':
        return anyLabel(v);
      default:
        return esc(v);
    }
  };
  const f = report.filters ?? {};
  const period = f.from || f.to ? `<p class="muted">الفترة: ${f.from ? fmtDate(f.from) : '...'} إلى ${f.to ? fmtDate(f.to) : '...'}</p>` : '';
  const hasTotals = report.columns.some((c) => c.total);
  const body = `${period}<table><thead><tr>${report.columns.map((c) => `<th class="${['money', 'int', 'pct'].includes(c.type) ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
    ${report.rows.map((r) => `<tr>${report.columns.map((c) => `<td class="${['money', 'int', 'pct'].includes(c.type) ? 'num' : ''}">${fmt(c, r[c.key])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${report.columns.length}" class="muted">لا توجد بيانات في هذه الفترة</td></tr>`}
    ${hasTotals ? `<tr class="total">${report.columns.map((c, i) => `<td class="num">${i === 0 ? `الإجمالي (${cur})` : c.total || c.key === 'margin' ? fmt(c, report.totals[c.key]) : ''}</td>`).join('')}</tr>` : ''}
    </tbody></table><p class="muted">عدد السجلات: ${report.rows.length}</p>`;
  return layout(st, report.title, '', localDateTime().slice(0, 10), body, fontCss, report.columns.length > 7);
}
