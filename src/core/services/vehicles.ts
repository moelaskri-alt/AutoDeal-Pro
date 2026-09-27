import type { Db } from '../db/database';
import { type Ctx, can, requirePerm, today } from '../context';
import { fail } from '../errors';
import { V } from '../validate';
import { addDateRange, addEq, addSearch, audit, diff, nextNo, paged, type ListParams, type QuerySpec } from './common';
import { daysBetween, localDateTime } from '../calc/dates';
import { marginPct } from '../calc/money';

export const VEHICLE_STATUSES = ['available', 'reserved', 'sold', 'delivered', 'preparation', 'maintenance', 'returned'] as const;
export const IN_STOCK_STATUSES = ['available', 'reserved', 'preparation', 'maintenance', 'returned'];
/** Statuses the user may set manually; the others are controlled by reservations/sales. */
export const MANUAL_STATUSES = ['available', 'preparation', 'maintenance', 'returned'];
export const SELLABLE_STATUSES = ['available', 'returned', 'preparation'];

export interface VehicleInput {
  condition: string;
  brand: string;
  model: string;
  trim?: string;
  model_year: number;
  color?: string;
  vin?: string;
  engine_no?: string;
  plate_no?: string;
  mileage?: number;
  transmission?: string;
  fuel_type?: string;
  body_type?: string;
  origin_country?: string;
  notes?: string;
}

/** Validates the descriptive vehicle fields (shared by vehicles, purchases and trade-ins). */
export function validateVehicleFields(input: any) {
  const year = new Date().getFullYear();
  const vin = V.str(input.vin, 'رقم الشاسيه (VIN)', { max: 40 });
  if (vin && !/^[A-Za-z0-9-]{5,40}$/.test(vin)) fail('VALIDATION', 'رقم الشاسيه (VIN) يجب أن يحتوي على حروف إنجليزية وأرقام فقط.');
  return {
    condition: V.oneOf(input.condition, ['new', 'used'] as const, 'حالة السيارة'),
    brand: V.reqStr(input.brand, 'الماركة', 60),
    model: V.reqStr(input.model, 'الموديل', 60),
    trim: V.str(input.trim, 'الفئة', { max: 60 }),
    model_year: V.int(input.model_year, 'سنة الصنع', { min: 1950, max: year + 2, required: true }) as number,
    color: V.str(input.color, 'اللون', { max: 40 }),
    vin: vin ? vin.toUpperCase() : null,
    engine_no: V.str(input.engine_no, 'رقم المحرك', { max: 40 })?.toUpperCase() ?? null,
    plate_no: V.str(input.plate_no, 'رقم اللوحة', { max: 30 }),
    mileage: V.int(input.mileage ?? 0, 'عداد الكيلومترات', { min: 0, max: 5_000_000 }) ?? 0,
    transmission: V.str(input.transmission, 'ناقل الحركة', { max: 30 }),
    fuel_type: V.str(input.fuel_type, 'نوع الوقود', { max: 30 }),
    body_type: V.str(input.body_type, 'نوع الهيكل', { max: 30 }),
    origin_country: V.str(input.origin_country, 'بلد المنشأ', { max: 40 }),
    notes: V.str(input.notes, 'ملاحظات', { max: 2000 }),
  };
}

export function assertUniqueIdentifiers(db: Db, vin: string | null, engine: string | null, exceptId?: number) {
  if (vin) {
    const dup = db.get<any>(`SELECT stock_no FROM vehicles WHERE vin = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?`, [vin, exceptId ?? 0]);
    if (dup) fail('DUPLICATE_VIN', `رقم الشاسيه (VIN) مسجل مسبقاً للسيارة ${dup.stock_no}.`);
  }
  if (engine) {
    const dup = db.get<any>(`SELECT stock_no FROM vehicles WHERE engine_no = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?`, [engine, exceptId ?? 0]);
    if (dup) fail('DUPLICATE_ENGINE', `رقم المحرك مسجل مسبقاً للسيارة ${dup.stock_no}.`);
  }
}

function validatePrices(asking: number, min: number) {
  if (asking && min > asking) fail('VALIDATION', 'الحد الأدنى لسعر البيع لا يمكن أن يتجاوز السعر المطلوب.');
}

/** Inserts a vehicle row (no permission checks – callers must check). Returns id. */
export function insertVehicle(
  db: Db,
  ctx: Ctx,
  f: ReturnType<typeof validateVehicleFields>,
  extra: { status: string; acquisition_type: string; acquisition_date: string; supplier_id?: number | null; asking_price: number; min_price: number },
): { id: number; stock_no: string } {
  assertUniqueIdentifiers(db, f.vin, f.engine_no);
  validatePrices(extra.asking_price, extra.min_price);
  const stock_no = nextNo(db, 'vehicle', extra.acquisition_date);
  const id = db.run(
    `INSERT INTO vehicles(stock_no, condition, brand, model, trim, model_year, color, vin, engine_no, plate_no, mileage, transmission,
       fuel_type, body_type, origin_country, status, acquisition_type, acquisition_date, supplier_id, asking_price, min_price, notes, created_by)
     VALUES (:stock_no,:condition,:brand,:model,:trim,:model_year,:color,:vin,:engine_no,:plate_no,:mileage,:transmission,
       :fuel_type,:body_type,:origin_country,:status,:acquisition_type,:acquisition_date,:supplier_id,:asking_price,:min_price,:notes,:created_by)`,
    { ...f, ...extra, stock_no, supplier_id: extra.supplier_id ?? null, created_by: ctx.user.id || null },
  ).lastId;
  return { id, stock_no };
}

/** Adds a direct cost line to a vehicle (no permission checks). */
export function insertCostLine(
  db: Db,
  ctx: Ctx,
  line: {
    vehicle_id: number;
    expense_date: string;
    category: string;
    description?: string | null;
    amount: number;
    supplier_id?: number | null;
    payment_method?: string | null;
    source_type?: string;
    source_id?: number | null;
    notes?: string | null;
  },
): number {
  const expense_no = nextNo(db, 'vexpense', line.expense_date);
  return db.run(
    `INSERT INTO vehicle_expenses(expense_no, vehicle_id, expense_date, category, description, amount, supplier_id, payment_method,
       source_type, source_id, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      expense_no,
      line.vehicle_id,
      line.expense_date,
      line.category,
      line.description ?? null,
      line.amount,
      line.supplier_id ?? null,
      line.payment_method ?? null,
      line.source_type ?? 'manual',
      line.source_id ?? null,
      line.notes ?? null,
      ctx.user.id || null,
    ],
  ).lastId;
}

export function createVehicle(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'vehicles.manage');
  const f = validateVehicleFields(input);
  const acquisition_date = V.reqDate(input.acquisition_date ?? today(ctx), 'تاريخ الاستلام');
  const status = V.oneOf(input.status, MANUAL_STATUSES as any, 'الحالة', 'available');
  const canPrice = can(ctx, 'vehicles.pricing');
  const asking_price = canPrice ? V.optMoney(input.asking_price, 'السعر المطلوب') : 0;
  const min_price = canPrice ? V.optMoney(input.min_price, 'الحد الأدنى للسعر') : 0;
  const opening_cost = V.optMoney(input.opening_cost, 'تكلفة الاقتناء');
  if (opening_cost && !can(ctx, 'costs.manage') && !can(ctx, 'purchases.manage')) fail('FORBIDDEN', 'ليس لديك صلاحية تسجيل التكاليف.');
  return db.tx(() => {
    const v = insertVehicle(db, ctx, f, { status, acquisition_type: 'opening', acquisition_date, asking_price, min_price });
    if (opening_cost) {
      insertCostLine(db, ctx, {
        vehicle_id: v.id,
        expense_date: acquisition_date,
        category: 'purchase',
        description: 'تكلفة اقتناء (رصيد افتتاحي)',
        amount: opening_cost,
      });
    }
    audit(db, ctx, { action: 'create', module: 'vehicles', record_type: 'vehicle', record_id: v.id, label: `${v.stock_no} ${f.brand} ${f.model}`, new: { ...f, asking_price, min_price, opening_cost } });
    return v;
  });
}

export function updateVehicle(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'vehicles.manage');
  const id = V.id(input.id, 'السيارة');
  const old = db.get<any>('SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'السيارة غير موجودة.');
  const f = validateVehicleFields(input);
  assertUniqueIdentifiers(db, f.vin, f.engine_no, id);
  const acquisition_date = V.reqDate(input.acquisition_date ?? old.acquisition_date, 'تاريخ الاستلام');
  let status = old.status;
  if (input.status && input.status !== old.status) {
    if (!MANUAL_STATUSES.includes(old.status) || !MANUAL_STATUSES.includes(input.status)) {
      fail('VALIDATION', 'لا يمكن تغيير حالة السيارة يدوياً من/إلى محجوزة أو مباعة أو مُسلّمة؛ استخدم شاشة الحجوزات أو المبيعات.');
    }
    status = input.status;
  }
  return db.tx(() => {
    const newRow = { ...f, acquisition_date, status };
    db.run(
      `UPDATE vehicles SET condition=:condition, brand=:brand, model=:model, trim=:trim, model_year=:model_year, color=:color, vin=:vin,
         engine_no=:engine_no, plate_no=:plate_no, mileage=:mileage, transmission=:transmission, fuel_type=:fuel_type, body_type=:body_type,
         origin_country=:origin_country, notes=:notes, acquisition_date=:acquisition_date, status=:status, updated_at=:now WHERE id=:id`,
      { ...newRow, now: localDateTime(), id },
    );
    const d = diff(old, newRow);
    if (d) audit(db, ctx, { action: 'update', module: 'vehicles', record_type: 'vehicle', record_id: id, label: old.stock_no, ...d });
    if (input.asking_price !== undefined || input.min_price !== undefined) {
      if (input.asking_price !== old.asking_price || input.min_price !== old.min_price) {
        setPrices(db, ctx, { id, asking_price: input.asking_price ?? old.asking_price, min_price: input.min_price ?? old.min_price });
      }
    }
    return { id };
  });
}

export function setPrices(db: Db, ctx: Ctx, input: { id: number; asking_price: number; min_price: number }) {
  requirePerm(ctx, 'vehicles.pricing');
  const id = V.id(input.id, 'السيارة');
  const old = db.get<any>('SELECT id, stock_no, status, asking_price, min_price FROM vehicles WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!old) fail('NOT_FOUND', 'السيارة غير موجودة.');
  if (old.status === 'sold' || old.status === 'delivered') fail('VALIDATION', 'لا يمكن تعديل سعر سيارة مباعة.');
  const asking_price = V.money(input.asking_price, 'السعر المطلوب', { allowZero: true });
  const min_price = V.money(input.min_price, 'الحد الأدنى للسعر', { allowZero: true });
  validatePrices(asking_price, min_price);
  return db.tx(() => {
    db.run('UPDATE vehicles SET asking_price = ?, min_price = ?, updated_at = ? WHERE id = ?', [asking_price, min_price, localDateTime(), id]);
    audit(db, ctx, {
      action: 'price_change',
      module: 'vehicles',
      record_type: 'vehicle',
      record_id: id,
      label: old.stock_no,
      old: { asking_price: old.asking_price, min_price: old.min_price },
      new: { asking_price, min_price },
    });
    return { id };
  });
}

export function deleteVehicle(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'vehicles.delete');
  const id = V.id(input.id, 'السيارة');
  const v = db.get<any>('SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!v) fail('NOT_FOUND', 'السيارة غير موجودة.');
  if (db.scalar('SELECT COUNT(*) FROM sales WHERE vehicle_id = ?', [id])) fail('IN_USE', 'لا يمكن حذف السيارة لأنها مرتبطة بعملية بيع.');
  if (db.scalar('SELECT COUNT(*) FROM reservations WHERE vehicle_id = ?', [id])) fail('IN_USE', 'لا يمكن حذف السيارة لأنها مرتبطة بحجز.');
  if (db.scalar('SELECT COUNT(*) FROM purchases WHERE vehicle_id = ?', [id])) fail('IN_USE', 'لا يمكن حذف السيارة لأنها مرتبطة بفاتورة شراء. يمكنك تغيير حالتها بدلاً من حذفها.');
  if (db.scalar('SELECT COUNT(*) FROM trade_ins WHERE vehicle_id = ?', [id])) fail('IN_USE', 'لا يمكن حذف السيارة لأنها مستلمة كاستبدال من عميل.');
  if (db.scalar("SELECT COUNT(*) FROM quotations WHERE vehicle_id = ? AND status = 'open'", [id])) fail('IN_USE', 'لا يمكن حذف السيارة لوجود عرض سعر مفتوح عليها.');
  return db.tx(() => {
    db.run('UPDATE vehicles SET deleted_at = ? WHERE id = ?', [localDateTime(), id]);
    db.run('UPDATE vehicle_expenses SET deleted_at = ? WHERE vehicle_id = ? AND deleted_at IS NULL', [localDateTime(), id]);
    audit(db, ctx, { action: 'delete', module: 'vehicles', record_type: 'vehicle', record_id: id, label: `${v.stock_no} ${v.brand} ${v.model}`, old: v });
    return { ok: true };
  });
}

const VEHICLE_SELECT = (showCost: boolean) => `
  v.id, v.stock_no, v.condition, v.brand, v.model, v.trim, v.model_year, v.color, v.vin, v.engine_no, v.plate_no, v.mileage,
  v.transmission, v.fuel_type, v.body_type, v.origin_country, v.status, v.acquisition_type, v.acquisition_date, v.supplier_id,
  v.asking_price, v.min_price, v.notes, v.created_at,
  ${showCost ? 'c.actual_cost, c.acquisition_cost, c.direct_costs,' : 'NULL AS actual_cost, NULL AS acquisition_cost, NULL AS direct_costs,'}
  s.id AS sale_id, s.sale_no, s.selling_price, s.sale_date,
  CAST(julianday(COALESCE(s.sale_date, :today)) - julianday(v.acquisition_date) AS INTEGER) AS days_in_stock,
  (SELECT id FROM vehicle_images WHERE vehicle_id = v.id ORDER BY is_primary DESC, id LIMIT 1) AS image_id`;

export function listVehicles(db: Db, ctx: Ctx, p: ListParams = {}) {
  requirePerm(ctx, 'vehicles.view');
  const f = p.filters ?? {};
  const showCost = can(ctx, 'costs.view');
  const q: QuerySpec = {
    select: VEHICLE_SELECT(showCost),
    from: `vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id LEFT JOIN sales s ON s.vehicle_id = v.id AND s.status = 'active'`,
    where: ['v.deleted_at IS NULL'],
    params: { today: today(ctx) },
    sortable: {
      stock_no: 'v.stock_no',
      brand: 'v.brand, v.model',
      model_year: 'v.model_year',
      asking_price: 'v.asking_price',
      actual_cost: showCost ? 'c.actual_cost' : 'v.id',
      acquisition_date: 'v.acquisition_date',
      days_in_stock: 'days_in_stock',
      status: 'v.status',
      mileage: 'v.mileage',
    },
    defaultSort: 'v.id DESC',
    totals: showCost ? 'COUNT(*) AS count, SUM(c.actual_cost) AS actual_cost, SUM(v.asking_price) AS asking_price' : 'COUNT(*) AS count, SUM(v.asking_price) AS asking_price',
  };
  addSearch(q, p.search, ['v.stock_no', 'v.vin', 'v.brand', 'v.model', 'v.plate_no', 'v.color', 'v.engine_no']);
  if (f.status === 'in_stock') q.where.push(`v.status IN ('available','reserved','preparation','maintenance','returned')`);
  else addEq(q, 'v.status', 'status', f.status);
  addEq(q, 'v.condition', 'condition', f.condition);
  addEq(q, 'v.brand', 'brand', f.brand);
  addDateRange(q, 'v.acquisition_date', f.from, f.to);
  if (f.min_days) {
    q.where.push(`julianday(:today) - julianday(v.acquisition_date) >= :min_days AND v.status IN ('available','reserved','preparation','maintenance','returned')`);
    q.params.min_days = Number(f.min_days);
  }
  if (f.sellable) {
    q.where.push(`v.status IN ('available','returned','preparation','reserved')`);
  }
  return paged(db, q, p);
}

export function brands(db: Db, ctx: Ctx) {
  requirePerm(ctx, 'vehicles.view');
  return db.all<{ brand: string }>('SELECT DISTINCT brand FROM vehicles WHERE deleted_at IS NULL ORDER BY brand').map((r) => r.brand);
}

export function getVehicle(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'vehicles.view');
  const id = V.id(input.id, 'السيارة');
  const showCost = can(ctx, 'costs.view');
  const v = db.get<any>(
    `SELECT ${VEHICLE_SELECT(showCost)}, sp.name AS supplier_name
     FROM vehicles v JOIN v_vehicle_cost c ON c.vehicle_id = v.id
     LEFT JOIN sales s ON s.vehicle_id = v.id AND s.status = 'active'
     LEFT JOIN suppliers sp ON sp.id = v.supplier_id
     WHERE v.id = :id`,
    { id, today: today(ctx) },
  );
  if (!v) fail('NOT_FOUND', 'السيارة غير موجودة.');
  const pricing = showCost
    ? {
        actual_cost: v.actual_cost,
        expected_profit: v.asking_price ? v.asking_price - v.actual_cost : null,
        expected_margin: v.asking_price ? marginPct(v.asking_price - v.actual_cost, v.asking_price) : null,
        min_profit: v.min_price ? v.min_price - v.actual_cost : null,
        actual_profit: v.selling_price != null ? v.selling_price - v.actual_cost : null,
        actual_margin: v.selling_price != null ? marginPct(v.selling_price - v.actual_cost, v.selling_price) : null,
      }
    : null;
  const images = db.all('SELECT id, mime, is_primary, created_at FROM vehicle_images WHERE vehicle_id = ? ORDER BY is_primary DESC, id', [id]);
  const purchase = db.get<any>(
    `SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.vehicle_id = ?`,
    [id],
  );
  const tradeIn = db.get<any>(`SELECT t.id, t.trade_no, t.trade_in_value, c.name AS customer_name FROM trade_ins t JOIN customers c ON c.id = t.customer_id WHERE t.vehicle_id = ?`, [id]);
  const quotations = db.all(
    `SELECT q.id, q.quote_no, q.quote_date, q.final_price, q.status, c.name AS customer_name FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.vehicle_id = ? ORDER BY q.id DESC`,
    [id],
  );
  const reservations = db.all(
    `SELECT r.id, r.reservation_no, r.reservation_date, r.expiry_date, r.amount, r.status, c.name AS customer_name FROM reservations r JOIN customers c ON c.id = r.customer_id WHERE r.vehicle_id = ? ORDER BY r.id DESC`,
    [id],
  );
  const sales = db.all(
    `SELECT s.id, s.sale_no, s.sale_date, s.selling_price, s.sale_type, s.status, c.name AS customer_name, u.full_name AS salesperson
     FROM sales s JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.salesperson_id WHERE s.vehicle_id = ? ORDER BY s.id DESC`,
    [id],
  );
  return { vehicle: v, pricing, images, purchase: showCost ? purchase : purchase ? { ...purchase, purchase_price: null } : null, tradeIn, quotations, reservations, sales };
}

// ------------------------------------------------------------------ images

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export function addImage(db: Db, ctx: Ctx, input: { vehicle_id: number; mime: string; base64: string }) {
  requirePerm(ctx, 'vehicles.manage');
  const vehicle_id = V.id(input.vehicle_id, 'السيارة');
  if (!db.scalar('SELECT COUNT(*) FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicle_id])) fail('NOT_FOUND', 'السيارة غير موجودة.');
  const mime = V.oneOf(input.mime, ['image/jpeg', 'image/png', 'image/webp'] as const, 'نوع الصورة');
  const data = Buffer.from(String(input.base64 ?? ''), 'base64');
  if (!data.length) fail('VALIDATION', 'ملف الصورة فارغ.');
  if (data.length > MAX_IMAGE_BYTES) fail('VALIDATION', 'حجم الصورة كبير جداً (الحد الأقصى 3 ميجابايت).');
  if (db.scalar<number>('SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = ?', [vehicle_id]) >= 20) fail('VALIDATION', 'الحد الأقصى 20 صورة لكل سيارة.');
  return db.tx(() => {
    const hasPrimary = db.scalar<number>('SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = ? AND is_primary = 1', [vehicle_id]);
    const id = db.run('INSERT INTO vehicle_images(vehicle_id, mime, data, is_primary) VALUES (?,?,?,?)', [vehicle_id, mime, new Uint8Array(data), hasPrimary ? 0 : 1]).lastId;
    audit(db, ctx, { action: 'add_image', module: 'vehicles', record_type: 'vehicle', record_id: vehicle_id });
    return { id };
  });
}

export function getImage(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'vehicles.view');
  const r = db.get<any>('SELECT mime, data FROM vehicle_images WHERE id = ?', [V.id(input.id, 'الصورة')]);
  if (!r) fail('NOT_FOUND', 'الصورة غير موجودة.');
  return { mime: r.mime, base64: Buffer.from(r.data).toString('base64') };
}

export function deleteImage(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'vehicles.manage');
  const r = db.get<any>('SELECT id, vehicle_id, is_primary FROM vehicle_images WHERE id = ?', [V.id(input.id, 'الصورة')]);
  if (!r) fail('NOT_FOUND', 'الصورة غير موجودة.');
  return db.tx(() => {
    db.run('DELETE FROM vehicle_images WHERE id = ?', [r.id]);
    if (r.is_primary) db.run('UPDATE vehicle_images SET is_primary = 1 WHERE id = (SELECT MIN(id) FROM vehicle_images WHERE vehicle_id = ?)', [r.vehicle_id]);
    audit(db, ctx, { action: 'delete_image', module: 'vehicles', record_type: 'vehicle', record_id: r.vehicle_id });
    return { ok: true };
  });
}

export function setPrimaryImage(db: Db, ctx: Ctx, input: { id: number }) {
  requirePerm(ctx, 'vehicles.manage');
  const r = db.get<any>('SELECT id, vehicle_id FROM vehicle_images WHERE id = ?', [V.id(input.id, 'الصورة')]);
  if (!r) fail('NOT_FOUND', 'الصورة غير موجودة.');
  db.tx(() => {
    db.run('UPDATE vehicle_images SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE vehicle_id = ?', [r.id, r.vehicle_id]);
  });
  return { ok: true };
}

export function daysInStock(acq: string, end: string): number {
  return Math.max(0, daysBetween(acq, end));
}
