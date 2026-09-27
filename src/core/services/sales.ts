import type { Db } from '../db/database';
import { type Ctx, can, requirePerm, today } from '../context';
import { AppError, fail } from '../errors';
import { V } from '../validate';
import { addDateRange, addEq, addSearch, audit, getSettingNum, nextNo, paged, type ListParams, type QuerySpec } from './common';
import { insertContract, insertPayment } from './installments';
import { acceptTradeInForSale, createTradeIn } from './tradeins';
import { SELLABLE_STATUSES } from './vehicles';
import { addDays, localDateTime } from '../calc/dates';
import { marginPct } from '../calc/money';

const PAY_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const;
export const SALE_TYPES = ['cash', 'installments', 'trade_in_cash', 'trade_in_installments'] as const;

function loadVehicle(db: Db, id: number) {
  const v = db.get<any>(`SELECT v.*, c.actual_cost FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id WHERE v.id = ? AND v.deleted_at IS NULL`, [id]);
  if (!v) fail('NOT_FOUND', 'السيارة غير موجودة.');
  return v;
}

function assertCustomer(db: Db, id: number) {
  if (!db.scalar('SELECT COUNT(*) FROM customers WHERE id = ? AND deleted_at IS NULL', [id])) fail('NOT_FOUND', 'العميل غير موجود.');
}

/** Expires active reservations / open quotations whose date passed. Idempotent; safe to call often. */
export function expireStale(db: Db, ctx: Ctx) {
  const t = today(ctx);
  const expired = db.all<any>(`SELECT id, vehicle_id, reservation_no FROM reservations WHERE status = 'active' AND expiry_date < ?`, [t]);
  if (expired.length) {
    db.tx(() => {
      for (const r of expired) {
        db.run(`UPDATE reservations SET status = 'expired', updated_at = ? WHERE id = ?`, [localDateTime(), r.id]);
        db.run(`UPDATE vehicles SET status = 'available', updated_at = ? WHERE id = ? AND status = 'reserved'`, [localDateTime(), r.vehicle_id]);
        audit(db, ctx, {
          action: 'expire',
          module: 'reservations',
          record_type: 'reservation',
          record_id: r.id,
          label: r.reservation_no,
          details: 'انتهاء مدة الحجز تلقائياً',
        });
      }
    });
  }
  db.run(`UPDATE quotations SET status = 'expired' WHERE status = 'open' AND valid_until < ?`, [t]);
  return { expiredReservations: expired.length };
}

// ================================================================== quotations

export function createQuotation(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'quotations.manage');
  const customer_id = V.id(input.customer_id, 'العميل');
  const vehicle_id = V.id(input.vehicle_id, 'السيارة');
  assertCustomer(db, customer_id);
  const v = loadVehicle(db, vehicle_id);
  if (v.status === 'sold' || v.status === 'delivered') fail('VEHICLE_SOLD', 'لا يمكن إنشاء عرض سعر لسيارة مباعة.');
  const quote_date = V.reqDate(input.quote_date ?? today(ctx), 'تاريخ العرض');
  const asking_price = V.money(input.asking_price ?? v.asking_price, 'السعر المطلوب');
  const discount = V.optMoney(input.discount, 'الخصم');
  if (discount >= asking_price) fail('VALIDATION', 'الخصم يجب أن يكون أقل من السعر.');
  const final_price = asking_price - discount;
  const payment_method = V.oneOf(input.payment_method, SALE_TYPES, 'طريقة الدفع', 'cash');
  const valid_until = V.reqDate(input.valid_until ?? addDays(quote_date, getSettingNum(db, 'quotation_validity_days')), 'صالح حتى');
  if (valid_until < quote_date) fail('VALIDATION', 'تاريخ انتهاء العرض يجب أن يكون بعد تاريخ العرض.');
  const down_payment = input.down_payment ? V.money(input.down_payment, 'المقدم', { allowZero: true }) : null;
  if (down_payment && down_payment > final_price) fail('VALIDATION', 'المقدم لا يمكن أن يتجاوز السعر النهائي.');
  const months = input.months ? V.int(input.months, 'عدد الشهور', { min: 1, max: 360 }) : null;
  const below_min = v.min_price > 0 && final_price < v.min_price;
  if (below_min && !can(ctx, 'sales.override_min_price')) {
    throw new AppError('BELOW_MIN_PRICE', 'السعر النهائي أقل من الحد الأدنى المسموح لهذه السيارة. ليس لديك صلاحية تجاوز الحد الأدنى.', {
      min_price: v.min_price,
    });
  }
  return db.tx(() => {
    const quote_no = nextNo(db, 'quotation', quote_date);
    const id = db.run(
      `INSERT INTO quotations(quote_no, customer_id, vehicle_id, quote_date, asking_price, discount, final_price, payment_method, down_payment, months, valid_until, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        quote_no,
        customer_id,
        vehicle_id,
        quote_date,
        asking_price,
        discount,
        final_price,
        payment_method,
        down_payment,
        months,
        valid_until,
        V.str(input.notes, 'ملاحظات', { max: 2000 }),
        ctx.user.id || null,
      ],
    ).lastId;
    audit(db, ctx, {
      action: below_min ? 'override_min_price' : 'create',
      module: 'quotations',
      record_type: 'quotation',
      record_id: id,
      label: quote_no,
      new: { customer_id, vehicle_id, asking_price, discount, final_price, below_min },
    });
    return { id, quote_no, below_min };
  });
}

export function cancelQuotation(db: Db, ctx: Ctx, input: { id: number; reason?: string }) {
  requirePerm(ctx, 'quotations.manage');
  const id = V.id(input.id, 'عرض السعر');
  const q = db.get<any>('SELECT * FROM quotations WHERE id = ?', [id]);
  if (!q) fail('NOT_FOUND', 'عرض السعر غير موجود.');
  if (q.status !== 'open') fail('VALIDATION', 'لا يمكن إلغاء عرض سعر غير مفتوح.');
  return db.tx(() => {
    db.run(`UPDATE quotations SET status = 'cancelled' WHERE id = ?`, [id]);
    audit(db, ctx, { action: 'cancel', module: 'quotations', record_type: 'quotation', record_id: id, label: q.quote_no, details: input.reason ?? null });
    return { ok: true };
  });
}

const QUOTE_SELECT = `q.*, c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code, c.national_id, c.address AS customer_address,
  v.stock_no, v.brand, v.model, v.trim, v.model_year, v.color, v.vin, v.mileage, v.condition, v.status AS vehicle_status, v.transmission, v.fuel_type,
  u.full_name AS created_by_name`;
const QUOTE_FROM = 'quotations q JOIN customers c ON c.id = q.customer_id JOIN vehicles v ON v.id = q.vehicle_id LEFT JOIN users u ON u.id = q.created_by';

export function listQuotations(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'quotations.view');
  expireStale(db, ctx);
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: QUOTE_SELECT,
    from: QUOTE_FROM,
    where: [],
    params: {},
    sortable: { quote_date: 'q.quote_date', final_price: 'q.final_price', customer_name: 'c.name', valid_until: 'q.valid_until' },
    defaultSort: 'q.id DESC',
    totals: 'COUNT(*) AS count, SUM(q.final_price) AS final_price',
  };
  addSearch(q, p.search, ['q.quote_no', 'c.name', 'c.phone', 'v.stock_no', 'v.brand', 'v.model']);
  addEq(q, 'q.status', 'status', f.status);
  addEq(q, 'q.customer_id', 'customer_id', f.customer_id);
  addEq(q, 'v.brand', 'brand', f.brand);
  addEq(q, 'q.created_by', 'created_by', f.salesperson_id);
  addDateRange(q, 'q.quote_date', f.from, f.to);
  return paged(db, q, p);
}

export function getQuotation(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'quotations.view');
  const row = db.get<any>(`SELECT ${QUOTE_SELECT} FROM ${QUOTE_FROM} WHERE q.id = ?`, [V.id(input.id, 'عرض السعر')]);
  if (!row) fail('NOT_FOUND', 'عرض السعر غير موجود.');
  return row;
}

// ================================================================== reservations

export function createReservation(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'reservations.manage');
  expireStale(db, ctx);
  const customer_id = V.id(input.customer_id, 'العميل');
  const vehicle_id = V.id(input.vehicle_id, 'السيارة');
  assertCustomer(db, customer_id);
  const v = loadVehicle(db, vehicle_id);
  if (v.status === 'sold' || v.status === 'delivered') fail('VEHICLE_SOLD', 'لا يمكن حجز سيارة مباعة.');
  if (v.status === 'reserved') fail('VEHICLE_RESERVED', 'هذه السيارة محجوزة بالفعل لعميل آخر.');
  if (!SELLABLE_STATUSES.includes(v.status) && v.status !== 'maintenance') fail('VALIDATION', 'حالة السيارة لا تسمح بالحجز.');
  const reservation_date = V.reqDate(input.reservation_date ?? today(ctx), 'تاريخ الحجز');
  const expiry_date = V.reqDate(input.expiry_date ?? addDays(reservation_date, getSettingNum(db, 'reservation_default_days')), 'تاريخ انتهاء الحجز');
  if (expiry_date < reservation_date) fail('VALIDATION', 'تاريخ انتهاء الحجز يجب أن يكون بعد تاريخ الحجز.');
  const amount = V.optMoney(input.amount, 'مبلغ العربون');
  const agreed_price = input.agreed_price ? V.money(input.agreed_price, 'السعر المتفق عليه') : null;
  if (agreed_price && amount > agreed_price) fail('VALIDATION', 'العربون لا يمكن أن يتجاوز السعر المتفق عليه.');
  if (!agreed_price && v.asking_price && amount > v.asking_price) fail('VALIDATION', 'العربون لا يمكن أن يتجاوز سعر السيارة.');
  const method = V.oneOf(input.method, PAY_METHODS, 'طريقة الدفع', 'cash');
  const quotation_id = V.optId(input.quotation_id);
  return db.tx(() => {
    const reservation_no = nextNo(db, 'reservation', reservation_date);
    const id = db.run(
      `INSERT INTO reservations(reservation_no, customer_id, vehicle_id, quotation_id, reservation_date, amount, agreed_price, expiry_date, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        reservation_no,
        customer_id,
        vehicle_id,
        quotation_id,
        reservation_date,
        amount,
        agreed_price,
        expiry_date,
        V.str(input.notes, 'ملاحظات', { max: 2000 }),
        ctx.user.id || null,
      ],
    ).lastId;
    db.run(`UPDATE vehicles SET status = 'reserved', updated_at = ? WHERE id = ?`, [localDateTime(), vehicle_id]);
    let receipt: { id: number; receipt_no: string } | null = null;
    if (amount > 0) {
      receipt = insertPayment(db, ctx, {
        customer_id,
        reservation_id: id,
        kind: 'reservation',
        pay_date: reservation_date,
        amount,
        method,
        reference: V.str(input.reference, 'المرجع', { max: 80 }),
      });
    }
    if (quotation_id) db.run(`UPDATE quotations SET status = 'reserved' WHERE id = ? AND status IN ('open','expired')`, [quotation_id]);
    db.run(`UPDATE leads SET status = 'reserved', updated_at = ? WHERE customer_id = ? AND vehicle_id = ? AND status NOT IN ('won','lost')`, [
      localDateTime(),
      customer_id,
      vehicle_id,
    ]);
    audit(db, ctx, {
      action: 'create',
      module: 'reservations',
      record_type: 'reservation',
      record_id: id,
      label: `${reservation_no} / ${v.stock_no}`,
      new: { customer_id, vehicle_id, amount, expiry_date },
    });
    return { id, reservation_no, payment_id: receipt?.id ?? null, receipt_no: receipt?.receipt_no ?? null };
  });
}

export function cancelReservation(db: Db, ctx: Ctx, input: { id: number; reason: string; refund_amount?: number; method?: string }) {
  requirePerm(ctx, 'reservations.cancel');
  const id = V.id(input.id, 'الحجز');
  const reason = V.reqStr(input.reason, 'سبب الإلغاء', 500);
  const r = db.get<any>('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!r) fail('NOT_FOUND', 'الحجز غير موجود.');
  if (!['active', 'expired'].includes(r.status)) fail('VALIDATION', 'لا يمكن إلغاء هذا الحجز.');
  const refund = V.optMoney(input.refund_amount, 'المبلغ المسترد');
  const paid = db.scalar<number>(`SELECT COALESCE(SUM(amount),0) FROM payments WHERE reservation_id = ? AND kind = 'reservation' AND status = 'valid'`, [id]);
  if (refund > paid) fail('VALIDATION', 'المبلغ المسترد لا يمكن أن يتجاوز العربون المدفوع.');
  return db.tx(() => {
    db.run(`UPDATE reservations SET status = 'cancelled', cancel_reason = ?, refund_amount = ?, updated_at = ? WHERE id = ?`, [
      reason,
      refund,
      localDateTime(),
      id,
    ]);
    if (r.status === 'active')
      db.run(`UPDATE vehicles SET status = 'available', updated_at = ? WHERE id = ? AND status = 'reserved'`, [localDateTime(), r.vehicle_id]);
    if (refund > 0) {
      insertPayment(db, ctx, {
        customer_id: r.customer_id,
        reservation_id: id,
        kind: 'refund',
        pay_date: today(ctx),
        amount: refund,
        method: V.oneOf(input.method, PAY_METHODS, 'طريقة الدفع', 'cash'),
        notes: `رد عربون الحجز ${r.reservation_no}`,
      });
    }
    audit(db, ctx, {
      action: 'cancel',
      module: 'reservations',
      record_type: 'reservation',
      record_id: id,
      label: r.reservation_no,
      old: { status: r.status },
      new: { status: 'cancelled', refund },
      details: reason,
    });
    return { ok: true };
  });
}

export function extendReservation(db: Db, ctx: Ctx, input: { id: number; expiry_date: string }) {
  requirePerm(ctx, 'reservations.manage');
  const id = V.id(input.id, 'الحجز');
  const r = db.get<any>('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!r) fail('NOT_FOUND', 'الحجز غير موجود.');
  if (r.status !== 'active') fail('VALIDATION', 'يمكن تمديد الحجوزات النشطة فقط.');
  const expiry = V.reqDate(input.expiry_date, 'تاريخ الانتهاء الجديد');
  if (expiry < r.reservation_date) fail('VALIDATION', 'تاريخ الانتهاء يجب أن يكون بعد تاريخ الحجز.');
  return db.tx(() => {
    db.run('UPDATE reservations SET expiry_date = ?, updated_at = ? WHERE id = ?', [expiry, localDateTime(), id]);
    audit(db, ctx, {
      action: 'extend',
      module: 'reservations',
      record_type: 'reservation',
      record_id: id,
      label: r.reservation_no,
      old: { expiry_date: r.expiry_date },
      new: { expiry_date: expiry },
    });
    return { ok: true };
  });
}

const RES_SELECT = `r.*, c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code, c.national_id,
  v.stock_no, v.brand, v.model, v.trim, v.model_year, v.color, v.vin, v.asking_price, u.full_name AS created_by_name,
  COALESCE((SELECT SUM(amount) FROM payments p WHERE p.reservation_id = r.id AND p.kind = 'reservation' AND p.status = 'valid'), 0) AS paid,
  (SELECT id FROM payments p WHERE p.reservation_id = r.id AND p.kind = 'reservation' ORDER BY id LIMIT 1) AS payment_id`;
const RES_FROM = 'reservations r JOIN customers c ON c.id = r.customer_id JOIN vehicles v ON v.id = r.vehicle_id LEFT JOIN users u ON u.id = r.created_by';

export function listReservations(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'reservations.view');
  expireStale(db, ctx);
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: RES_SELECT,
    from: RES_FROM,
    where: [],
    params: {},
    sortable: { reservation_date: 'r.reservation_date', expiry_date: 'r.expiry_date', amount: 'r.amount', customer_name: 'c.name' },
    defaultSort: 'r.id DESC',
    totals: 'COUNT(*) AS count, SUM(r.amount) AS amount',
  };
  addSearch(q, p.search, ['r.reservation_no', 'c.name', 'c.phone', 'v.stock_no', 'v.brand', 'v.model']);
  addEq(q, 'r.status', 'status', f.status);
  addEq(q, 'r.customer_id', 'customer_id', f.customer_id);
  addEq(q, 'v.brand', 'brand', f.brand);
  addEq(q, 'r.created_by', 'created_by', f.salesperson_id);
  addDateRange(q, 'r.reservation_date', f.from, f.to);
  return paged(db, q, p);
}

export function getReservation(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'reservations.view');
  const row = db.get<any>(`SELECT ${RES_SELECT} FROM ${RES_FROM} WHERE r.id = ?`, [V.id(input.id, 'الحجز')]);
  if (!row) fail('NOT_FOUND', 'الحجز غير موجود.');
  return row;
}

// ================================================================== sales

export interface SaleCalc {
  list_price: number;
  discount: number;
  selling_price: number;
  fees: number;
  total_contract_value: number;
  trade_in_value: number;
  reservation_credit: number;
  down_payment: number;
  financed_amount: number;
}

/** Pure computation of the sale financial breakdown (also used by the UI preview). */
export function computeSale(i: {
  list_price: number;
  discount: number;
  fees: number;
  trade_in_value: number;
  reservation_credit: number;
  down_payment: number;
  sale_type: string;
}): SaleCalc {
  const selling_price = i.list_price - i.discount;
  const total_contract_value = selling_price + i.fees;
  const isCash = i.sale_type === 'cash' || i.sale_type === 'trade_in_cash';
  const due = total_contract_value - i.trade_in_value - i.reservation_credit;
  const down_payment = isCash ? due : i.down_payment;
  return {
    list_price: i.list_price,
    discount: i.discount,
    selling_price,
    fees: i.fees,
    total_contract_value,
    trade_in_value: i.trade_in_value,
    reservation_credit: i.reservation_credit,
    down_payment,
    financed_amount: total_contract_value - i.trade_in_value - i.reservation_credit - down_payment,
  };
}

/**
 * Creates a sale (cash / installments / trade-in + cash / trade-in + installments) atomically:
 * sale record, vehicle → SOLD, reservation conversion, trade-in acceptance (vehicle into inventory),
 * payments (down payment / cash) and the installment contract + schedule.
 */
export function createSale(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'sales.create');
  expireStale(db, ctx);
  const customer_id = V.id(input.customer_id, 'العميل');
  const vehicle_id = V.id(input.vehicle_id, 'السيارة');
  assertCustomer(db, customer_id);
  const v = loadVehicle(db, vehicle_id);
  if (v.status === 'sold' || v.status === 'delivered') fail('VEHICLE_SOLD', 'هذه السيارة مباعة بالفعل ولا يمكن بيعها مرة أخرى.');
  const sale_type = V.oneOf(input.sale_type, SALE_TYPES, 'طريقة البيع');
  const sale_date = V.reqDate(input.sale_date ?? today(ctx), 'تاريخ البيع');
  if (sale_date < v.acquisition_date) fail('VALIDATION', 'تاريخ البيع لا يمكن أن يسبق تاريخ استلام السيارة.');

  // Reservation handling
  let reservation: any = null;
  const activeRes = db.get<any>(`SELECT * FROM reservations WHERE vehicle_id = ? AND status = 'active'`, [vehicle_id]);
  if (activeRes) {
    if (activeRes.customer_id !== customer_id) fail('VEHICLE_RESERVED', 'هذه السيارة محجوزة لعميل آخر. يجب إلغاء الحجز أولاً.');
    reservation = activeRes;
  } else if (input.reservation_id) {
    fail('VALIDATION', 'الحجز المحدد غير نشط.');
  }
  if (!reservation && !SELLABLE_STATUSES.includes(v.status)) fail('VALIDATION', 'حالة السيارة الحالية لا تسمح بالبيع (تحت الصيانة).');
  const reservation_credit = reservation
    ? db.scalar<number>(`SELECT COALESCE(SUM(amount),0) FROM payments WHERE reservation_id = ? AND kind = 'reservation' AND status = 'valid'`, [reservation.id])
    : 0;

  const list_price = V.money(input.list_price ?? v.asking_price, 'سعر البيع');
  const discount = V.optMoney(input.discount, 'الخصم');
  if (discount >= list_price) fail('VALIDATION', 'الخصم يجب أن يكون أقل من سعر البيع.');
  const fees = V.optMoney(input.fees, 'الرسوم');
  const isTradeIn = sale_type.startsWith('trade_in');
  const isInstallment = sale_type.endsWith('installments');

  // Trade-in value (validated again when accepted inside the transaction)
  let tradeInValue = 0;
  if (isTradeIn) {
    if (input.trade_in_id) {
      const t = db.get<any>('SELECT * FROM trade_ins WHERE id = ?', [V.id(input.trade_in_id, 'سيارة الاستبدال')]);
      if (!t) fail('NOT_FOUND', 'سيارة الاستبدال غير موجودة.');
      tradeInValue = t.trade_in_value;
    } else if (input.trade_in) {
      tradeInValue = V.money(input.trade_in.trade_in_value, 'قيمة الاستبدال');
    } else fail('VALIDATION', 'يرجى إدخال بيانات سيارة الاستبدال.');
  }

  const calc = computeSale({
    list_price,
    discount,
    fees,
    trade_in_value: tradeInValue,
    reservation_credit,
    down_payment: isInstallment ? V.optMoney(input.down_payment, 'المقدم') : 0,
    sale_type,
  });
  if (calc.trade_in_value + calc.reservation_credit > calc.total_contract_value) {
    fail('VALIDATION', 'قيمة الاستبدال والعربون تتجاوز قيمة العقد. يرجى مراجعة المبالغ.');
  }
  if (isInstallment && calc.financed_amount <= 0) fail('VALIDATION', 'لا يوجد مبلغ متبقٍ للتقسيط. اختر البيع النقدي بدلاً من ذلك.');
  if (calc.down_payment < 0 || calc.financed_amount < 0) fail('VALIDATION', 'المقدم يتجاوز المبلغ المستحق.');

  // Minimum price rule
  const belowMin = v.min_price > 0 && calc.selling_price < v.min_price;
  let override_reason: string | null = null;
  if (belowMin) {
    if (!can(ctx, 'sales.override_min_price')) {
      throw new AppError(
        'BELOW_MIN_PRICE',
        `سعر البيع (${calc.selling_price / 100}) أقل من الحد الأدنى المسموح (${v.min_price / 100}). ليس لديك صلاحية البيع بأقل من الحد الأدنى.`,
        {
          min_price: v.min_price,
        },
      );
    }
    if (!input.confirm_below_min) {
      throw new AppError('BELOW_MIN_PRICE_CONFIRM', `تحذير: سعر البيع أقل من الحد الأدنى المسموح (${v.min_price / 100}). يلزم تأكيد التجاوز مع ذكر السبب.`, {
        min_price: v.min_price,
      });
    }
    override_reason = V.reqStr(input.override_reason, 'سبب تجاوز الحد الأدنى', 500);
  }

  const method = V.oneOf(input.method, PAY_METHODS, 'طريقة الدفع', 'cash');
  const reference = V.str(input.reference, 'المرجع', { max: 80 });
  const salesperson_id = V.optId(input.salesperson_id) ?? (ctx.user.id || null);
  const quotation_id = V.optId(input.quotation_id);

  return db.tx(() => {
    const sale_no = nextNo(db, 'sale', sale_date);
    const saleId = db.run(
      `INSERT INTO sales(sale_no, customer_id, vehicle_id, quotation_id, reservation_id, sale_date, sale_type, list_price, discount, selling_price, fees,
         total_contract_value, trade_in_value, reservation_credit, down_payment, financed_amount, cost_at_sale, min_price_at_sale, min_price_override,
         override_reason, salesperson_id, notes, created_by)
       VALUES (:sale_no,:customer_id,:vehicle_id,:quotation_id,:reservation_id,:sale_date,:sale_type,:list_price,:discount,:selling_price,:fees,
         :total_contract_value,:trade_in_value,:reservation_credit,:down_payment,:financed_amount,:cost_at_sale,:min_price_at_sale,:min_price_override,
         :override_reason,:salesperson_id,:notes,:created_by)`,
      {
        sale_no,
        customer_id,
        vehicle_id,
        quotation_id,
        reservation_id: reservation?.id ?? null,
        sale_date,
        sale_type,
        ...calc,
        cost_at_sale: v.actual_cost,
        min_price_at_sale: v.min_price,
        min_price_override: belowMin ? 1 : 0,
        override_reason,
        salesperson_id,
        notes: V.str(input.notes, 'ملاحظات', { max: 2000 }),
        created_by: ctx.user.id || null,
      },
    ).lastId;

    db.run(`UPDATE vehicles SET status = 'sold', updated_at = ? WHERE id = ?`, [localDateTime(), vehicle_id]);
    if (reservation) {
      db.run(`UPDATE reservations SET status = 'converted', updated_at = ? WHERE id = ?`, [localDateTime(), reservation.id]);
      db.run(`UPDATE payments SET sale_id = ? WHERE reservation_id = ? AND kind = 'reservation'`, [saleId, reservation.id]);
    }
    if (quotation_id) db.run(`UPDATE quotations SET status = 'sold' WHERE id = ?`, [quotation_id]);
    if (reservation?.quotation_id) db.run(`UPDATE quotations SET status = 'sold' WHERE id = ?`, [reservation.quotation_id]);
    db.run(`UPDATE quotations SET status = 'cancelled' WHERE vehicle_id = ? AND status = 'open'`, [vehicle_id]);
    db.run(
      `UPDATE leads SET status = 'won', updated_at = ? WHERE customer_id = ? AND status NOT IN ('won','lost') AND (vehicle_id = ? OR vehicle_id IS NULL)`,
      [localDateTime(), customer_id, vehicle_id],
    );

    let tradeInVehicleId: number | null = null;
    if (isTradeIn) {
      requirePerm(ctx, 'tradeins.manage');
      let tid = input.trade_in_id ? Number(input.trade_in_id) : 0;
      if (!tid) tid = createTradeIn(db, ctx, { ...input.trade_in, customer_id, eval_date: sale_date }).id;
      const acc = acceptTradeInForSale(db, ctx, tid, saleId, sale_date, customer_id);
      if (acc.value !== calc.trade_in_value) throw new AppError('INVALID_DATA', 'قيمة الاستبدال تغيرت أثناء الحفظ.');
      tradeInVehicleId = acc.vehicle_id;
    }

    const receipts: string[] = [];
    if (calc.down_payment > 0) {
      const p = insertPayment(db, ctx, {
        customer_id,
        sale_id: saleId,
        kind: isInstallment ? 'down_payment' : 'cash_sale',
        pay_date: sale_date,
        amount: calc.down_payment,
        method,
        reference,
      });
      receipts.push(p.receipt_no);
    }
    let contract: { id: number; contract_no: string } | null = null;
    if (isInstallment) {
      contract = insertContract(db, ctx, { id: saleId, customer_id, sale_date }, calc.financed_amount, input.plan);
    }
    audit(db, ctx, {
      action: belowMin ? 'override_min_price' : 'create',
      module: 'sales',
      record_type: 'sale',
      record_id: saleId,
      label: `${sale_no} / ${v.stock_no}`,
      new: {
        ...calc,
        sale_type,
        customer_id,
        vehicle_id,
        cost_at_sale: v.actual_cost,
        min_price: v.min_price,
        override_reason,
        contract: contract?.contract_no,
      },
      details: belowMin ? `بيع بأقل من الحد الأدنى: ${override_reason}` : null,
    });
    return {
      id: saleId,
      sale_no,
      contract_id: contract?.id ?? null,
      contract_no: contract?.contract_no ?? null,
      receipts,
      trade_in_vehicle_id: tradeInVehicleId,
      ...calc,
    };
  });
}

export function cancelSale(db: Db, ctx: Ctx, input: { id: number; reason: string; refund_method?: string }) {
  requirePerm(ctx, 'sales.cancel');
  const id = V.id(input.id, 'البيع');
  const reason = V.reqStr(input.reason, 'سبب الإلغاء', 500);
  const s = db.get<any>('SELECT * FROM sales WHERE id = ?', [id]);
  if (!s) fail('NOT_FOUND', 'عملية البيع غير موجودة.');
  if (s.status !== 'active') fail('VALIDATION', 'عملية البيع ملغاة بالفعل.');
  const collections = db.scalar<number>(`SELECT COUNT(*) FROM payments WHERE sale_id = ? AND kind IN ('installment','early_settlement') AND status = 'valid'`, [
    id,
  ]);
  if (collections) fail('HAS_PAYMENTS', 'لا يمكن إلغاء البيع لوجود أقساط محصلة عليه. يجب إلغاء التحصيلات أولاً.');
  const ti = db.get<any>(
    `SELECT t.*, v.status AS vstatus, v.stock_no FROM trade_ins t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.sale_id = ? AND t.status = 'accepted'`,
    [id],
  );
  if (ti && !['available', 'preparation', 'maintenance', 'returned'].includes(ti.vstatus)) {
    fail('IN_USE', `لا يمكن إلغاء البيع لأن سيارة الاستبدال (${ti.stock_no}) تم حجزها أو بيعها.`);
  }
  if (
    ti &&
    db.scalar<number>(`SELECT COUNT(*) FROM vehicle_expenses WHERE vehicle_id = ? AND deleted_at IS NULL AND source_type = 'manual'`, [ti.vehicle_id])
  ) {
    fail('IN_USE', `لا يمكن إلغاء البيع لوجود تكاليف مسجلة على سيارة الاستبدال (${ti.stock_no}).`);
  }
  return db.tx(() => {
    const now = localDateTime();
    db.run(`UPDATE sales SET status = 'cancelled', cancel_reason = ?, cancelled_at = ? WHERE id = ?`, [reason, now, id]);
    db.run(`UPDATE vehicles SET status = ?, updated_at = ? WHERE id = ?`, [s.delivered_at ? 'returned' : 'available', now, s.vehicle_id]);
    const contract = db.get<any>('SELECT id FROM installment_contracts WHERE sale_id = ?', [id]);
    if (contract) {
      db.run(`UPDATE installment_contracts SET status = 'cancelled' WHERE id = ?`, [contract.id]);
      db.run(`UPDATE installments SET is_cancelled = 1, notes = 'ملغي بإلغاء البيع' WHERE contract_id = ?`, [contract.id]);
    }
    // Refund what the customer paid (reservation credit + down payment / cash).
    const paid = db.scalar<number>(
      `SELECT COALESCE(SUM(amount),0) FROM payments WHERE sale_id = ? AND kind IN ('reservation','down_payment','cash_sale') AND status = 'valid'`,
      [id],
    );
    if (paid > 0) {
      insertPayment(db, ctx, {
        customer_id: s.customer_id,
        sale_id: id,
        kind: 'refund',
        pay_date: today(ctx),
        amount: paid,
        method: V.oneOf(input.refund_method, PAY_METHODS, 'طريقة الرد', 'cash'),
        notes: `رد مبالغ البيع الملغي ${s.sale_no}`,
      });
    }
    if (ti) {
      db.run("UPDATE vehicles SET deleted_at = ?, notes = COALESCE(notes, '') || ? WHERE id = ?", [now, ' | أعيدت للعميل بإلغاء البيع', ti.vehicle_id]);
      db.run('UPDATE vehicle_expenses SET deleted_at = ? WHERE vehicle_id = ?', [now, ti.vehicle_id]);
      db.run(`UPDATE trade_ins SET status = 'rejected', notes = COALESCE(notes || ' | ', '') || 'أعيدت للعميل بإلغاء البيع' WHERE id = ?`, [ti.id]);
    }
    audit(db, ctx, {
      action: 'cancel',
      module: 'sales',
      record_type: 'sale',
      record_id: id,
      label: s.sale_no,
      old: { status: 'active' },
      new: { status: 'cancelled', refund: paid },
      details: reason,
    });
    return { ok: true, refunded: paid };
  });
}

export function deliverSale(db: Db, ctx: Ctx, input: { id: number; date?: string }) {
  requirePerm(ctx, 'sales.deliver');
  const id = V.id(input.id, 'البيع');
  const s = db.get<any>('SELECT * FROM sales WHERE id = ?', [id]);
  if (!s) fail('NOT_FOUND', 'عملية البيع غير موجودة.');
  if (s.status !== 'active') fail('VALIDATION', 'لا يمكن تسليم سيارة لبيع ملغي.');
  if (s.delivered_at) fail('VALIDATION', 'تم تسليم السيارة بالفعل.');
  const date = V.reqDate(input.date ?? today(ctx), 'تاريخ التسليم');
  return db.tx(() => {
    db.run('UPDATE sales SET delivered_at = ? WHERE id = ?', [date, id]);
    db.run(`UPDATE vehicles SET status = 'delivered', updated_at = ? WHERE id = ?`, [localDateTime(), s.vehicle_id]);
    audit(db, ctx, { action: 'deliver', module: 'sales', record_type: 'sale', record_id: id, label: s.sale_no, new: { delivered_at: date } });
    return { ok: true };
  });
}

const SALE_SELECT = (fin: boolean) => `s.id, s.sale_no, s.sale_date, s.sale_type, s.list_price, s.discount, s.selling_price, s.fees, s.total_contract_value,
  s.trade_in_value, s.reservation_credit, s.down_payment, s.financed_amount, s.min_price_override, s.override_reason, s.status, s.delivered_at,
  s.cancel_reason, s.notes, s.customer_id, s.vehicle_id, s.salesperson_id, s.min_price_at_sale,
  c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code, c.national_id, c.address AS customer_address,
  v.stock_no, v.brand, v.model, v.trim, v.model_year, v.color, v.vin, v.engine_no, v.plate_no, v.mileage, v.condition, v.acquisition_date,
  u.full_name AS salesperson, ic.id AS contract_id, ic.contract_no,
  CAST(julianday(s.sale_date) - julianday(v.acquisition_date) AS INTEGER) AS days_in_stock,
  ${fin ? 'vc.actual_cost, s.selling_price - vc.actual_cost AS gross_profit' : 'NULL AS actual_cost, NULL AS gross_profit'}`;
const SALE_FROM = `sales s JOIN customers c ON c.id = s.customer_id JOIN vehicles v ON v.id = s.vehicle_id JOIN v_vehicle_cost vc ON vc.vehicle_id = s.vehicle_id
  LEFT JOIN users u ON u.id = s.salesperson_id LEFT JOIN installment_contracts ic ON ic.sale_id = s.id`;

export function listSales(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'sales.view');
  const fin = can(ctx, 'reports.financial');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: SALE_SELECT(fin),
    from: SALE_FROM,
    where: [],
    params: {},
    sortable: {
      sale_date: 's.sale_date',
      selling_price: 's.selling_price',
      customer_name: 'c.name',
      gross_profit: fin ? 'gross_profit' : 's.id',
      sale_no: 's.sale_no',
    },
    defaultSort: 's.sale_date DESC, s.id DESC',
    totals: fin
      ? `COUNT(*) AS count, SUM(s.selling_price) AS selling_price, SUM(s.total_contract_value) AS total_contract_value, SUM(vc.actual_cost) AS actual_cost, SUM(s.selling_price - vc.actual_cost) AS gross_profit`
      : 'COUNT(*) AS count, SUM(s.selling_price) AS selling_price, SUM(s.total_contract_value) AS total_contract_value',
  };
  addSearch(q, p.search, ['s.sale_no', 'c.name', 'c.phone', 'v.stock_no', 'v.brand', 'v.model', 'v.vin']);
  if (f.status) addEq(q, 's.status', 'status', f.status);
  addEq(q, 's.sale_type', 'sale_type', f.sale_type);
  addEq(q, 's.customer_id', 'customer_id', f.customer_id);
  addEq(q, 's.salesperson_id', 'salesperson_id', f.salesperson_id);
  addEq(q, 'v.brand', 'brand', f.brand);
  addDateRange(q, 's.sale_date', f.from, f.to);
  return paged(db, q, p);
}

export function getSale(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'sales.view');
  const fin = can(ctx, 'reports.financial');
  const id = V.id(input.id, 'البيع');
  const sale = db.get<any>(`SELECT ${SALE_SELECT(fin)}, v.transmission, v.fuel_type, v.body_type, v.origin_country FROM ${SALE_FROM} WHERE s.id = ?`, [id]);
  if (!sale) fail('NOT_FOUND', 'عملية البيع غير موجودة.');
  const payments = db.all(
    `SELECT p.id, p.receipt_no, p.pay_date, p.kind, p.amount, p.method, p.reference, p.status FROM payments p WHERE p.sale_id = ? ORDER BY p.pay_date, p.id`,
    [id],
  );
  const tradeIn = db.get<any>(`SELECT t.*, v.stock_no AS new_stock_no FROM trade_ins t LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE t.sale_id = ?`, [id]);
  const expenses = db.all(`SELECT id, expense_no, expense_date, category, description, amount FROM expenses WHERE sale_id = ? AND deleted_at IS NULL`, [id]);
  const contract = sale.contract_id
    ? db.get<any>(
        `SELECT ic.*, COALESCE(SUM(CASE WHEN i.is_cancelled = 0 THEN i.amount - i.paid_amount - i.waived_amount END),0) AS remaining, COALESCE(SUM(i.paid_amount),0) AS paid
         FROM installment_contracts ic LEFT JOIN installments i ON i.contract_id = ic.id WHERE ic.id = ? GROUP BY ic.id`,
        [sale.contract_id],
      )
    : null;
  const profit = fin
    ? {
        actual_cost: sale.actual_cost,
        gross_profit: sale.gross_profit,
        gross_margin: marginPct(sale.gross_profit, sale.selling_price),
        sale_expenses: expenses.reduce((a: number, e: any) => a + e.amount, 0),
      }
    : null;
  return { sale, payments, tradeIn, contract, expenses, profit };
}
