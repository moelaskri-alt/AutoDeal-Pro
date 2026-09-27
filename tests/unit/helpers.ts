import { Db } from '../../src/core/db/database';
import { ensureSecurity, buildCtx, createUser } from '../../src/core/services/users';
import type { Ctx } from '../../src/core/context';
import { callApi } from '../../src/core/api';

process.removeAllListeners('warning');

/** Money helper: major units → minor units. */
export const M = (major: number) => Math.round(major * 100);

export function freshDb(): Db {
  const db = new Db(':memory:');
  ensureSecurity(db);
  return db;
}

export function adminCtx(db: Db, today = '2026-06-15'): Ctx {
  const ctx = buildCtx(db, 1);
  ctx.today = today;
  return ctx;
}

export function userCtx(db: Db, role: string, today = '2026-06-15'): Ctx {
  const admin = adminCtx(db, today);
  const roleId = db.scalar<number>('SELECT id FROM roles WHERE code = ?', [role]);
  const uname = `${role}_${Math.random().toString(36).slice(2, 8)}`;
  const { id } = createUser(db, admin, { username: uname, full_name: `مستخدم ${role}`, role_id: roleId, password: 'secret123' });
  const ctx = buildCtx(db, id);
  ctx.today = today;
  return ctx;
}

export const api = (db: Db, ctx: Ctx) => (method: string, args: any = {}) => callApi(db, ctx, method, args) as any;

let vinCounter = 0;
export function purchaseVehicle(db: Db, ctx: Ctx, opts: { price: number; brand?: string; model?: string; condition?: 'new' | 'used'; date?: string; asking?: number; min?: number; costs?: { category: string; amount: number }[] }) {
  const call = api(db, ctx);
  vinCounter++;
  return call('purchases.create', {
    purchase_date: opts.date ?? '2026-01-10',
    purchase_price: opts.price,
    supplier: { name: 'مورد اختبار', supplier_type: 'dealer' },
    status: 'available',
    vehicle: {
      condition: opts.condition ?? 'used',
      brand: opts.brand ?? 'BMW',
      model: opts.model ?? '520i',
      model_year: 2022,
      color: 'أسود',
      vin: `TESTVIN${String(vinCounter).padStart(10, '0')}`,
      mileage: 30000,
      asking_price: opts.asking ?? 0,
      min_price: opts.min ?? 0,
    },
    costs: opts.costs ?? [],
  });
}

export function newCustomer(db: Db, ctx: Ctx, name = 'أحمد محمود') {
  return api(db, ctx)('customers.create', { name, phone: '01000000000' });
}
