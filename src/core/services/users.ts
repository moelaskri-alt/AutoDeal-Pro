import type { Db } from '../db/database';
import { type Ctx, requirePerm, type SessionUser } from '../context';
import { AppError, fail } from '../errors';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from '../permissions';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../security';
import { V } from '../validate';
import { audit } from './common';
import { localDateTime } from '../calc/dates';

/** Idempotently installs permissions, roles, default matrix and the initial admin account. */
export function ensureSecurity(db: Db): void {
  db.tx(() => {
    for (const p of PERMISSIONS) {
      db.run(
        `INSERT INTO permissions(code, module, name_ar) VALUES (?,?,?)
         ON CONFLICT(code) DO UPDATE SET module = excluded.module, name_ar = excluded.name_ar`,
        [p.code, p.module, p.name_ar],
      );
    }
    for (const r of ROLES) {
      const existing = db.get<{ id: number }>('SELECT id FROM roles WHERE code = ?', [r.code]);
      if (!existing) {
        const id = db.run('INSERT INTO roles(code, name_ar) VALUES (?,?)', [r.code, r.name_ar]).lastId;
        for (const p of DEFAULT_ROLE_PERMISSIONS[r.code] ?? []) {
          db.run('INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?,?)', [id, p]);
        }
      }
    }
    // Admin always has every permission (including permissions added by later versions).
    const adminId = db.scalar<number>("SELECT id FROM roles WHERE code = 'admin'");
    for (const p of PERMISSIONS) db.run('INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?,?)', [adminId, p.code]);
    const users = db.scalar<number>('SELECT COUNT(*) FROM users');
    if (!users) {
      db.run('INSERT INTO users(username, full_name, password_hash, role_id) VALUES (?,?,?,?)', ['admin', 'مدير النظام', hashPassword('admin123'), adminId]);
    }
  });
}

function sessionUser(db: Db, userId: number): { user: SessionUser; perms: string[] } {
  const u = db.get<any>(
    `SELECT u.id, u.username, u.full_name, u.is_active, r.code AS role, r.name_ar AS role_name, r.id AS role_id
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [userId],
  );
  if (!u || !u.is_active) fail('AUTH', 'المستخدم غير موجود أو غير مفعل.');
  const perms = db
    .all<{ permission_code: string }>('SELECT permission_code FROM role_permissions WHERE role_id = ?', [u.role_id])
    .map((r) => r.permission_code);
  return { user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, role_name: u.role_name }, perms };
}

export function buildCtx(db: Db, userId: number): Ctx {
  const s = sessionUser(db, userId);
  return { user: s.user, perms: new Set(s.perms) };
}

export function login(db: Db, username: string, password: string): { user: SessionUser; perms: string[]; must_change_password: boolean } {
  const uname = V.reqStr(username, 'اسم المستخدم', 60);
  if (typeof password !== 'string' || !password) fail('AUTH', 'يرجى إدخال كلمة المرور.');
  const u = db.get<any>('SELECT id, password_hash, is_active, must_change_password FROM users WHERE username = ?', [uname]);
  if (!u || !verifyPassword(password, u.password_hash)) {
    if (u) db.run('UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ?', [u.id]);
    db.run(`INSERT INTO audit_logs(user_id, username, action, module, details) VALUES (?,?,?,?,?)`, [
      u?.id ?? null,
      uname,
      'login_failed',
      'auth',
      'محاولة دخول فاشلة',
    ]);
    fail('AUTH', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
  }
  if (!u.is_active) fail('AUTH', 'هذا الحساب موقوف. يرجى التواصل مع مدير النظام.');
  db.run('UPDATE users SET failed_logins = 0, last_login_at = ? WHERE id = ?', [localDateTime(), u.id]);
  const s = sessionUser(db, u.id);
  audit(db, { user: s.user, perms: new Set() }, { action: 'login', module: 'auth', record_type: 'user', record_id: u.id, label: s.user.username });
  return { ...s, must_change_password: !!u.must_change_password };
}

export function listUsers(db: Db, ctx: Ctx) {
  requirePerm(ctx, 'users.manage');
  return db.all(
    `SELECT u.id, u.username, u.full_name, u.phone, u.is_active, u.last_login_at, u.created_at, r.id AS role_id, r.code AS role, r.name_ar AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`,
  );
}

/** Users that can be assigned as salesperson (lightweight lookup, available to sales screens). */
export function listSalespeople(db: Db, ctx: Ctx) {
  requirePerm(ctx, 'sales.view');
  return db.all(`SELECT u.id, u.full_name FROM users u WHERE u.is_active = 1 ORDER BY u.full_name`);
}

export function createUser(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'users.manage');
  const username = V.reqStr(input.username, 'اسم المستخدم', 60);
  if (!/^[A-Za-z0-9_.-]{3,}$/.test(username)) fail('VALIDATION', 'اسم المستخدم يجب أن يتكون من 3 أحرف إنجليزية أو أرقام على الأقل.');
  const full_name = V.reqStr(input.full_name, 'الاسم الكامل', 120);
  const role_id = V.id(input.role_id, 'الدور');
  const pwErr = validatePasswordStrength(input.password);
  if (pwErr) fail('VALIDATION', pwErr);
  return db.tx(() => {
    const id = db.run('INSERT INTO users(username, full_name, password_hash, role_id, phone) VALUES (?,?,?,?,?)', [
      username,
      full_name,
      hashPassword(input.password),
      role_id,
      V.phone(input.phone),
    ]).lastId;
    audit(db, ctx, { action: 'create', module: 'users', record_type: 'user', record_id: id, label: username, new: { username, full_name, role_id } });
    return { id };
  });
}

function assertNotLastAdmin(db: Db, userId: number) {
  const admins = db.scalar<number>(`SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' AND u.is_active = 1 AND u.id <> ?`, [
    userId,
  ]);
  if (!admins) fail('LAST_ADMIN', 'لا يمكن تنفيذ العملية لأن هذا هو آخر مدير نظام مفعل.');
}

export function updateUser(db: Db, ctx: Ctx, input: any) {
  requirePerm(ctx, 'users.manage');
  const id = V.id(input.id, 'المستخدم');
  const old = db.get<any>('SELECT u.*, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [id]);
  if (!old) fail('NOT_FOUND', 'المستخدم غير موجود.');
  const full_name = V.reqStr(input.full_name, 'الاسم الكامل', 120);
  const role_id = V.id(input.role_id, 'الدور');
  const is_active = input.is_active ? 1 : 0;
  const newRole = db.scalar<string>('SELECT code FROM roles WHERE id = ?', [role_id]);
  if (!newRole) fail('VALIDATION', 'الدور غير موجود.');
  if (old.role === 'admin' && (newRole !== 'admin' || !is_active)) assertNotLastAdmin(db, id);
  if (id === ctx.user.id && !is_active) fail('VALIDATION', 'لا يمكنك إيقاف حسابك الحالي.');
  return db.tx(() => {
    db.run('UPDATE users SET full_name = ?, role_id = ?, is_active = ?, phone = ?, updated_at = ? WHERE id = ?', [
      full_name,
      role_id,
      is_active,
      V.phone(input.phone),
      localDateTime(),
      id,
    ]);
    audit(db, ctx, {
      action: 'update',
      module: 'users',
      record_type: 'user',
      record_id: id,
      label: old.username,
      old: { full_name: old.full_name, role_id: old.role_id, is_active: old.is_active },
      new: { full_name, role_id, is_active },
    });
    return { id };
  });
}

export function resetPassword(db: Db, ctx: Ctx, input: { id: number; password: string }) {
  requirePerm(ctx, 'users.manage');
  const id = V.id(input.id, 'المستخدم');
  const pwErr = validatePasswordStrength(input.password);
  if (pwErr) fail('VALIDATION', pwErr);
  const u = db.get<any>('SELECT username FROM users WHERE id = ?', [id]);
  if (!u) fail('NOT_FOUND', 'المستخدم غير موجود.');
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', [hashPassword(input.password), localDateTime(), id]);
    audit(db, ctx, { action: 'reset_password', module: 'users', record_type: 'user', record_id: id, label: u.username });
  });
  return { ok: true };
}

export function changeOwnPassword(db: Db, ctx: Ctx, input: { current: string; password: string }) {
  const u = db.get<any>('SELECT password_hash FROM users WHERE id = ?', [ctx.user.id]);
  if (!u || !verifyPassword(input.current ?? '', u.password_hash)) fail('VALIDATION', 'كلمة المرور الحالية غير صحيحة.');
  const pwErr = validatePasswordStrength(input.password);
  if (pwErr) fail('VALIDATION', pwErr);
  db.tx(() => {
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [
      hashPassword(input.password),
      localDateTime(),
      ctx.user.id,
    ]);
    audit(db, ctx, { action: 'change_password', module: 'users', record_type: 'user', record_id: ctx.user.id, label: ctx.user.username });
  });
  return { ok: true };
}

export function listRoles(db: Db, ctx: Ctx) {
  requirePerm(ctx, 'users.manage');
  const roles = db.all<any>('SELECT id, code, name_ar FROM roles ORDER BY id');
  const rp = db.all<{ role_id: number; permission_code: string }>('SELECT role_id, permission_code FROM role_permissions');
  return {
    roles: roles.map((r) => ({ ...r, permissions: rp.filter((x) => x.role_id === r.id).map((x) => x.permission_code) })),
    permissions: db.all('SELECT code, module, name_ar FROM permissions ORDER BY rowid'),
  };
}

export function setRolePermissions(db: Db, ctx: Ctx, input: { role_id: number; permissions: string[] }) {
  requirePerm(ctx, 'users.manage');
  const role = db.get<any>('SELECT id, code FROM roles WHERE id = ?', [V.id(input.role_id, 'الدور')]);
  if (!role) fail('NOT_FOUND', 'الدور غير موجود.');
  if (role.code === 'admin') fail('VALIDATION', 'صلاحيات مدير النظام ثابتة ولا يمكن تعديلها.');
  if (!Array.isArray(input.permissions)) fail('VALIDATION', 'قائمة الصلاحيات غير صحيحة.');
  const valid = new Set(PERMISSIONS.map((p) => p.code));
  for (const p of input.permissions) if (!valid.has(p)) throw new AppError('VALIDATION', `صلاحية غير معروفة: ${p}`);
  return db.tx(() => {
    const old = db.all<{ permission_code: string }>('SELECT permission_code FROM role_permissions WHERE role_id = ?', [role.id]).map((x) => x.permission_code);
    db.run('DELETE FROM role_permissions WHERE role_id = ?', [role.id]);
    for (const p of new Set(input.permissions)) db.run('INSERT INTO role_permissions(role_id, permission_code) VALUES (?,?)', [role.id, p]);
    audit(db, ctx, { action: 'update_permissions', module: 'users', record_type: 'role', record_id: role.id, label: role.code, old, new: input.permissions });
    return { ok: true };
  });
}
