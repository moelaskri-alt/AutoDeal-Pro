import { AppError } from './errors';
import { localDate } from './calc/dates';

export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  role: string;
  role_name: string;
}

/** Per-call execution context: who is acting, what they may do and "today" for date-based logic. */
export interface Ctx {
  user: SessionUser;
  perms: Set<string>;
  /** Override for tests/demo. Defaults to local date at call time. */
  today?: string;
}

export function today(ctx: Ctx): string {
  return ctx.today ?? localDate();
}

export function can(ctx: Ctx, perm: string): boolean {
  return ctx.perms.has(perm);
}

export function requirePerm(ctx: Ctx, ...perms: string[]): void {
  for (const p of perms) {
    if (!ctx.perms.has(p)) throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لتنفيذ هذه العملية.', { permission: p });
  }
}

/** A system context used for migrations/seed/automatic jobs. */
export function systemCtx(perms: string[], todayOverride?: string): Ctx {
  return {
    user: { id: 0, username: 'system', full_name: 'النظام', role: 'admin', role_name: 'النظام' },
    perms: new Set(perms),
    today: todayOverride,
  };
}
