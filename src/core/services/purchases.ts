import type { Db } from '../db/database';
import { type Ctx, requirePerm, today } from '../context';
import { fail } from '../errors';
import { V } from '../validate';
import { addDateRange, addEq, addSearch, audit, nextNo, paged, type ListParams, type QuerySpec } from './common';
import { insertCostLine, insertVehicle, validateVehicleFields } from './vehicles';
import { MANUAL_COST_CATEGORIES } from './costs';
import { localDateTime } from '../calc/dates';

const SUPPLIER_TYPES = ['company', 'individual', 'dealer', 'agent', 'workshop', 'other'] as const;
const PAY_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const;

// ------------------------------------------------------------------ suppliers

function validateSupplier(input: any) {
  return {
    name: V.reqStr(input.name, 'اسم المورد', 120),
    supplier_type: V.oneOf(input.supplier_type, SUPPLIER_TYPES, 'نوع المورد', 'company'),
    phone: V.phone(input.phone),
    national_id: V.str(input.national_id, 'الرقم القومي / السجل', { max: 30 }),
    address: V.str(input.address, 'العنوان', { max: 300 }),
    notes: V.str(input.notes, 'ملاحظات', { max: 1000 }),
  };
}

export function listSuppliers(db: Db, ctx: Ctx, p: ListParams = {}) {
  if (!ctx.perms.has('purchases.view') && !ctx.perms.has('costs.view')) requirePerm(ctx, 'purchases.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: `s.*, (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchases_count,
             (SELECT COALESCE(SUM(p.purchase_price),0) FROM purchases p WHERE p.supplier_id = s.id) AS purchases_total,
             (SELECT COALESCE(SUM(pp.amount),0) FROM purchase_payments pp JOIN purchases p ON p.id = pp.purchase_id WHERE p.supplier_id = s.id) AS paid_total`,
    from: 'suppliers s',
    where: ['s.deleted_at IS NULL'],
    params: {},
    sortable: { name: 's.name', purchases_total: 'purchases_total' },
    defaultSort: 's.name',
  };
  addSearch(q, p.search, ['s.name', 's.phone']);
  addEq(q, 's.supplier_type', 'supplier_type', f.supplier_type);
  return paged(db, q, p);
}

export function createSupplier(db: Db, ctx: Ctx, input: any) {
  if (!ctx.perms.has('purchases.manage') && !ctx.perms.has('costs.manage')) requirePerm(ctx, 'purchases.manage');
  const s = validateSupplier(input);
  return db.tx(() => {
    const id = db.run(
      'INSERT INTO suppliers(name, supplier_type, phone, national_id, address, notes) VALUES (:name,:supplier_type,:phone,:national_id,:address,:notes)',
      s,
    ).lastId;
    audit(db, ctx, { action: 'create', module: 'purchases', record_type: 'supplier', record_id: id, label: s.name, new: s });
    return { id };
  });
}

export function updateSupplier(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'purchases.manage');
  const id = V.id(input.id, 'المورد');
  const old = db.get<any>('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'المورد غير موجود.');
  const s = validateSupplier(input);
  return db.tx(() => {
    db.run(
      'UPDATE suppliers SET name=:name, supplier_type=:supplier_type, phone=:phone, national_id=:national_id, address=:address, notes=:notes WHERE id=:id',
      { ...s, id },
    );
    audit(db, ctx, { action: 'update', module: 'purchases', record_type: 'supplier', record_id: id, label: s.name, old, new: s });
    return { id };
  });
}

export function deleteSupplier(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'purchases.manage');
  const id = V.id(input.id, 'المورد');
  const old = db.get<any>('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'المورد غير موجود.');
  if (db.scalar('SELECT COUNT(*) FROM purchases WHERE supplier_id = ?', [id])) fail('IN_USE', 'لا يمكن حذف المورد لوجود عمليات شراء مرتبطة به.');
  if (db.scalar('SELECT COUNT(*) FROM vehicle_expenses WHERE supplier_id = ? AND deleted_at IS NULL', [id]))
    fail('IN_USE', 'لا يمكن حذف المورد لوجود تكاليف سيارات مرتبطة به.');
  return db.tx(() => {
    db.run('UPDATE suppliers SET deleted_at = ? WHERE id = ?', [localDateTime(), id]);
    audit(db, ctx, { action: 'delete', module: 'purchases', record_type: 'supplier', record_id: id, label: old.name, old });
    return { ok: true };
  });
}

// ------------------------------------------------------------------ purchases

/**
 * Registers the purchase of a vehicle: creates the vehicle, the purchase record, the Cost Card
 * acquisition line, optional initial direct costs and an optional payment to the seller – atomically.
 */
export function createPurchase(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'purchases.manage');
  const purchase_date = V.reqDate(input.purchase_date ?? today(ctx), 'تاريخ الشراء');
  const purchase_price = V.money(input.purchase_price, 'سعر الشراء');
  const invoice_no = V.str(input.invoice_no, 'رقم فاتورة الشراء', { max: 60 });
  const notes = V.str(input.notes, 'ملاحظات', { max: 2000 });
  const status = V.oneOf(input.status, ['available', 'preparation'] as const, 'حالة السيارة', 'preparation');
  const f = validateVehicleFields(input.vehicle ?? {});
  const asking_price = ctx.perms.has('vehicles.pricing') ? V.optMoney(input.vehicle?.asking_price, 'السعر المطلوب') : 0;
  const min_price = ctx.perms.has('vehicles.pricing') ? V.optMoney(input.vehicle?.min_price, 'الحد الأدنى للسعر') : 0;
  const extraCosts: any[] = Array.isArray(input.costs) ? input.costs : [];
  const costs = extraCosts
    .filter((c) => c && Number(c.amount) > 0)
    .map((c) => ({
      category: V.oneOf(c.category, MANUAL_COST_CATEGORIES, 'نوع التكلفة'),
      amount: V.money(c.amount, 'مبلغ التكلفة'),
      description: V.str(c.description, 'الوصف', { max: 300 }),
    }));
  const paid = V.optMoney(input.paid_amount, 'المبلغ المدفوع');
  if (paid > purchase_price) fail('VALIDATION', 'المبلغ المدفوع للبائع لا يمكن أن يتجاوز سعر الشراء.');
  const pay_method = V.oneOf(input.pay_method, PAY_METHODS, 'طريقة الدفع', 'cash');

  return db.tx(() => {
    let supplier_id = V.optId(input.supplier_id);
    if (!supplier_id) {
      if (!input.supplier) fail('VALIDATION', 'يرجى اختيار المورد / البائع.');
      const s = validateSupplier(input.supplier);
      supplier_id = db.run(
        'INSERT INTO suppliers(name, supplier_type, phone, national_id, address, notes) VALUES (:name,:supplier_type,:phone,:national_id,:address,:notes)',
        s,
      ).lastId;
    } else if (!db.scalar('SELECT COUNT(*) FROM suppliers WHERE id = ? AND deleted_at IS NULL', [supplier_id])) {
      fail('NOT_FOUND', 'المورد غير موجود.');
    }
    const v = insertVehicle(db, ctx, f, { status, acquisition_type: 'purchase', acquisition_date: purchase_date, supplier_id, asking_price, min_price });
    const purchase_no = nextNo(db, 'purchase', purchase_date);
    const pid = db.run(
      `INSERT INTO purchases(purchase_no, vehicle_id, supplier_id, purchase_date, invoice_no, purchase_price, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [purchase_no, v.id, supplier_id, purchase_date, invoice_no, purchase_price, notes, ctx.user.id || null],
    ).lastId;
    insertCostLine(db, ctx, {
      vehicle_id: v.id,
      expense_date: purchase_date,
      category: 'purchase',
      description: `سعر الشراء - ${purchase_no}`,
      amount: purchase_price,
      supplier_id,
      payment_method: 'credit',
      source_type: 'purchase',
      source_id: pid,
    });
    for (const c of costs) {
      insertCostLine(db, ctx, {
        vehicle_id: v.id,
        expense_date: purchase_date,
        category: c.category,
        description: c.description,
        amount: c.amount,
        payment_method: 'cash',
      });
    }
    if (paid > 0) {
      db.run('INSERT INTO purchase_payments(purchase_id, pay_date, amount, method, reference, created_by) VALUES (?,?,?,?,?,?)', [
        pid,
        purchase_date,
        paid,
        pay_method,
        V.str(input.pay_reference, 'المرجع', { max: 60 }),
        ctx.user.id || null,
      ]);
    }
    audit(db, ctx, {
      action: 'create',
      module: 'purchases',
      record_type: 'purchase',
      record_id: pid,
      label: `${purchase_no} / ${v.stock_no}`,
      new: { purchase_price, supplier_id, vehicle: f, costs, paid },
    });
    return { id: pid, purchase_no, vehicle_id: v.id, stock_no: v.stock_no };
  });
}

const PURCHASE_SELECT = `p.id, p.purchase_no, p.purchase_date, p.invoice_no, p.purchase_price, p.notes, p.vehicle_id, p.supplier_id,
  s.name AS supplier_name, s.supplier_type, v.stock_no, v.brand, v.model, v.model_year, v.condition, v.status AS vehicle_status,
  COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = p.id), 0) AS paid_amount`;

export function listPurchases(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'purchases.view');
  const f = p.filters ?? {};
  const q: QuerySpec = {
    select: `${PURCHASE_SELECT}, p.purchase_price - COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = p.id), 0) AS balance`,
    from: 'purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN vehicles v ON v.id = p.vehicle_id',
    where: [],
    params: {},
    sortable: { purchase_date: 'p.purchase_date', purchase_price: 'p.purchase_price', supplier_name: 's.name', purchase_no: 'p.purchase_no' },
    defaultSort: 'p.purchase_date DESC, p.id DESC',
    totals: `COUNT(*) AS count, SUM(p.purchase_price) AS purchase_price, SUM(COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = p.id),0)) AS paid_amount`,
  };
  addSearch(q, p.search, ['p.purchase_no', 'p.invoice_no', 's.name', 'v.stock_no', 'v.brand', 'v.model', 'v.vin']);
  addEq(q, 'p.supplier_id', 'supplier_id', f.supplier_id);
  addEq(q, 's.supplier_type', 'supplier_type', f.supplier_type);
  addEq(q, 'v.brand', 'brand', f.brand);
  addDateRange(q, 'p.purchase_date', f.from, f.to);
  if (f.unpaid) q.where.push('p.purchase_price > COALESCE((SELECT SUM(amount) FROM purchase_payments WHERE purchase_id = p.id), 0)');
  return paged(db, q, p);
}

export function getPurchase(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'purchases.view');
  const id = V.id(input.id, 'عملية الشراء');
  const row = db.get<any>(
    `SELECT ${PURCHASE_SELECT}, s.phone AS supplier_phone, s.address AS supplier_address, v.vin, v.color FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN vehicles v ON v.id = p.vehicle_id WHERE p.id = ?`,
    [id],
  );
  if (!row) fail('NOT_FOUND', 'عملية الشراء غير موجودة.');
  const payments = db.all('SELECT * FROM purchase_payments WHERE purchase_id = ? ORDER BY pay_date, id', [id]);
  return { ...row, balance: row.purchase_price - row.paid_amount, payments };
}

export function addPurchasePayment(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'purchases.manage');
  const id = V.id(input.purchase_id, 'عملية الشراء');
  const pur = getPurchase(db, ctx, { id });
  const amount = V.money(input.amount, 'المبلغ');
  if (amount > pur.balance) fail('OVERPAYMENT', 'المبلغ يتجاوز الرصيد المتبقي للمورد.');
  const pay_date = V.reqDate(input.pay_date ?? today(ctx), 'تاريخ الدفع');
  const method = V.oneOf(input.method, PAY_METHODS, 'طريقة الدفع', 'cash');
  return db.tx(() => {
    const pid = db.run('INSERT INTO purchase_payments(purchase_id, pay_date, amount, method, reference, notes, created_by) VALUES (?,?,?,?,?,?,?)', [
      id,
      pay_date,
      amount,
      method,
      V.str(input.reference, 'المرجع', { max: 60 }),
      V.str(input.notes, 'ملاحظات', { max: 500 }),
      ctx.user.id || null,
    ]).lastId;
    audit(db, ctx, {
      action: 'supplier_payment',
      module: 'purchases',
      record_type: 'purchase',
      record_id: id,
      label: pur.purchase_no,
      new: { amount, pay_date, method },
    });
    return { id: pid };
  });
}

/** Corrects the purchase price; the Cost Card acquisition line is updated in the same transaction. */
export function updatePurchasePrice(db: Db, ctx: Ctx, input: { id: number; purchase_price: number; reason: string }) {
  requirePerm(ctx, 'purchases.manage');
  const id = V.id(input.id, 'عملية الشراء');
  const pur = getPurchase(db, ctx, { id });
  const price = V.money(input.purchase_price, 'سعر الشراء');
  const reason = V.reqStr(input.reason, 'سبب التعديل', 300);
  if (price < pur.paid_amount) fail('VALIDATION', 'سعر الشراء لا يمكن أن يقل عن المبلغ المدفوع للمورد.');
  return db.tx(() => {
    db.run('UPDATE purchases SET purchase_price = ? WHERE id = ?', [price, id]);
    db.run(`UPDATE vehicle_expenses SET amount = ?, updated_at = ? WHERE source_type = 'purchase' AND source_id = ? AND deleted_at IS NULL`, [
      price,
      localDateTime(),
      id,
    ]);
    audit(db, ctx, {
      action: 'cost_change',
      module: 'purchases',
      record_type: 'purchase',
      record_id: id,
      label: pur.purchase_no,
      old: { purchase_price: pur.purchase_price },
      new: { purchase_price: price },
      details: reason,
    });
    return { id };
  });
}
