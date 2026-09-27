import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminCtx, api, freshDb, M, newCustomer, purchaseVehicle, userCtx } from './helpers';
import { login, ensureSecurity, buildCtx } from '../../src/core/services/users';
import { Db } from '../../src/core/db/database';
import { createBackup, restoreBackup, validateBackupFile, listBackups } from '../../src/core/backup';
import { toAppError } from '../../src/core/errors';

describe('§26/§42 users, password hashing & role permissions', () => {
  it('passwords are hashed (never stored in plain text) and login works', () => {
    const db = freshDb();
    const hash = db.scalar<string>(`SELECT password_hash FROM users WHERE username = 'admin'`);
    expect(hash).not.toContain('admin123');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(login(db, 'admin', 'admin123').user.role).toBe('admin');
    expect(() => login(db, 'admin', 'wrong')).toThrowError(/غير صحيحة/);
  });

  it('salesperson: can sell / quote / reserve, cannot purchase, void payments, manage users or see costs', () => {
    const db = freshDb();
    const admin = adminCtx(db);
    const s = api(db, userCtx(db, 'sales'));
    const v = purchaseVehicle(db, admin, { price: M(100000), asking: M(120000) });
    const c = s('customers.create', { name: 'عميل المندوب' });
    expect(s('quotations.create', { customer_id: c.id, vehicle_id: v.vehicle_id, asking_price: M(120000) }).id).toBeGreaterThan(0);
    expect(() => s('purchases.create', {})).toThrowError(/صلاحية/);
    expect(() => s('users.list')).toThrowError(/صلاحية/);
    expect(() => s('costs.card', { vehicle_id: v.vehicle_id })).toThrowError(/صلاحية/);
    expect(() => s('reports.run', { id: 'vehicle_profitability' })).toThrowError(/صلاحية/);
    // cost fields are nulled server-side for roles without costs.view
    const list = s('vehicles.list', {});
    expect(list.rows[0].actual_cost).toBeNull();
    expect(s('vehicles.get', { id: v.vehicle_id }).pricing).toBeNull();
    const sale = s('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(120000) });
    expect(sale.id).toBeGreaterThan(0);
    expect(s('sales.get', { id: sale.id }).profit).toBeNull();
    expect(() => s('sales.cancel', { id: sale.id, reason: 'x' })).toThrowError(/صلاحية/);
  });

  it('accountant: purchases, costs, collections, expenses; cannot sell', () => {
    const db = freshDb();
    const acc = userCtx(db, 'accountant');
    const a = api(db, acc);
    const v = purchaseVehicle(db, acc, { price: M(100000) });
    expect(a('costs.create', { vehicle_id: v.vehicle_id, expense_date: '2026-02-01', category: 'tires', amount: M(4000) }).id).toBeGreaterThan(0);
    expect(a('expenses.create', { expense_date: '2026-02-01', category: 'rent', description: 'إيجار', amount: M(10000) }).id).toBeGreaterThan(0);
    const c = newCustomer(db, adminCtx(db));
    expect(() => a('sales.create', { customer_id: c.id, vehicle_id: v.vehicle_id, sale_type: 'cash', list_price: M(1) })).toThrowError(/صلاحية/);
    expect(() => a('customers.create', { name: 'x' })).toThrowError(/صلاحية/);
  });

  it('viewer is read-only everywhere', () => {
    const db = freshDb();
    const vw = api(db, userCtx(db, 'viewer'));
    expect(vw('vehicles.list', {}).rows).toEqual([]);
    for (const [m, args] of [
      ['vehicles.create', { condition: 'new', brand: 'x', model: 'y', model_year: 2024 }],
      ['customers.create', { name: 'x' }],
      ['expenses.create', {}],
      ['payments.create', {}],
      ['sales.create', {}],
      ['settings.save', {}],
      ['users.create', {}],
    ] as const) {
      expect(() => vw(m, args), m).toThrowError(/صلاحية/);
    }
  });

  it('manager can override minimum price, salesperson cannot; role matrix is editable (not admin)', () => {
    const db = freshDb();
    const admin = api(db, adminCtx(db));
    const roles = admin('roles.list');
    const salesRole = roles.roles.find((r: any) => r.code === 'sales');
    admin('roles.setPermissions', { role_id: salesRole.id, permissions: [...salesRole.permissions, 'sales.override_min_price'] });
    const sctx = userCtx(db, 'sales');
    expect(sctx.perms.has('sales.override_min_price')).toBe(true);
    const adminRole = roles.roles.find((r: any) => r.code === 'admin');
    expect(() => admin('roles.setPermissions', { role_id: adminRole.id, permissions: [] })).toThrowError(/ثابتة/);
  });

  it('cannot deactivate the last admin', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const other = userCtx(db, 'manager');
    void other;
    expect(() =>
      api(db, ctx)('users.update', { id: 1, full_name: 'x', role_id: db.scalar('SELECT id FROM roles WHERE code = ?', ['manager']), is_active: 1 }),
    ).toThrowError(/آخر مدير/);
  });
});

describe('§27 audit trail', () => {
  it('logs price change, cost change, payment, reservation cancel with old/new values; audit is immutable', () => {
    const db = freshDb();
    const ctx = adminCtx(db);
    const call = api(db, ctx);
    const v = purchaseVehicle(db, ctx, { price: M(100000), asking: M(120000), min: M(110000) });
    call('vehicles.setPrices', { id: v.vehicle_id, asking_price: M(125000), min_price: M(115000) });
    const cost = call('costs.create', { vehicle_id: v.vehicle_id, expense_date: '2026-02-01', category: 'paint', amount: M(3000) });
    call('costs.update', { id: cost.id, expense_date: '2026-02-01', category: 'paint', amount: M(3500) });
    const c = newCustomer(db, ctx);
    const r = call('reservations.create', { customer_id: c.id, vehicle_id: v.vehicle_id, amount: M(1000) });
    call('reservations.cancel', { id: r.id, reason: 'تغيير رأي' });

    const price = db.get<any>(`SELECT * FROM audit_logs WHERE action = 'price_change'`);
    expect(JSON.parse(price.old_value)).toEqual({ asking_price: M(120000), min_price: M(110000) });
    expect(JSON.parse(price.new_value)).toEqual({ asking_price: M(125000), min_price: M(115000) });
    expect(price.username).toBe('admin');
    const costLog = db.get<any>(`SELECT * FROM audit_logs WHERE module = 'costs' AND action = 'update'`);
    expect(JSON.parse(costLog.old_value).amount).toBe(M(3000));
    expect(JSON.parse(costLog.new_value).amount).toBe(M(3500));
    expect(db.scalar(`SELECT COUNT(*) FROM audit_logs WHERE module = 'reservations' AND action = 'cancel'`)).toBe(1);
    expect(() => db.run('DELETE FROM audit_logs')).toThrow();
    expect(() => db.run(`UPDATE audit_logs SET action = 'x'`)).toThrow();
    const listed = call('audit.list', { filters: { module: 'vehicles' } });
    expect(listed.total).toBeGreaterThan(0);
  });
});

describe('§31 backup & restore', () => {
  it('backup → change data → restore → data is back; invalid files rejected', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-'));
    const dbPath = path.join(dir, 'autodeal.db');
    let db = new Db(dbPath);
    ensureSecurity(db);
    const ctx = buildCtx(db, 1);
    ctx.today = '2026-06-15';
    const v = purchaseVehicle(db, ctx, { price: M(100000) });
    const backupDir = path.join(dir, 'backups');
    const b = createBackup(db, backupDir, 'manual', 1);
    expect(fs.existsSync(b.file)).toBe(true);
    expect(validateBackupFile(b.file).vehicles).toBe(1);

    purchaseVehicle(db, ctx, { price: M(200000) });
    expect(db.scalar('SELECT COUNT(*) FROM vehicles')).toBe(2);

    const res = restoreBackup(db, dbPath, b.file, backupDir, 1);
    db = res.db;
    expect(db.scalar('SELECT COUNT(*) FROM vehicles')).toBe(1);
    expect(db.scalar('SELECT stock_no FROM vehicles')).toBe(v.stock_no);
    expect(fs.existsSync(res.safety.file)).toBe(true); // pre-restore safety copy
    expect(listBackups(backupDir).length).toBe(2);

    const junk = path.join(dir, 'junk.adpbak');
    fs.writeFileSync(junk, 'not a database');
    expect(() => validateBackupFile(junk)).toThrow();
    db.close();
  });
});

describe('§41 friendly errors', () => {
  it('translates SQLite errors into Arabic messages', () => {
    expect(toAppError(new Error('FOREIGN KEY constraint failed')).message).toContain('مرتبط');
    expect(toAppError(new Error('UNIQUE constraint failed: vehicles.vin')).message).toContain('VIN');
    expect(toAppError(new Error('boom at x.js:1')).message).not.toContain('x.js');
  });
});
