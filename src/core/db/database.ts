import { DatabaseSync, StatementSync } from 'node:sqlite';
import { migrate } from './migrations';

export type SqlValue = string | number | null | Uint8Array | bigint;
export type Params = unknown[] | Record<string, unknown>;

function sanitize(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Invalid numeric value');
    return v;
  }
  if (typeof v === 'string' || typeof v === 'bigint' || v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/**
 * Thin wrapper over node:sqlite providing statement caching, parameter sanitation
 * and nested transactions (via SAVEPOINT). All business services talk to this class only.
 */
export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;
  private cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(path: string, opts: { migrate?: boolean } = {}) {
    this.path = path;
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON');
    if (path !== ':memory:') {
      this.raw.exec('PRAGMA journal_mode = WAL');
      this.raw.exec('PRAGMA synchronous = NORMAL');
    }
    this.raw.exec('PRAGMA busy_timeout = 5000');
    if (opts.migrate !== false) migrate(this);
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  private names = new Map<string, Set<string>>();

  /** node:sqlite rejects unknown named parameters, so only pass the names the SQL actually uses. */
  private bind(sql: string, params?: Params): any[] {
    if (params === undefined) return [];
    if (Array.isArray(params)) return params.map(sanitize);
    let used = this.names.get(sql);
    if (!used) {
      used = new Set([...sql.matchAll(/[:@$]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
      this.names.set(sql, used);
    }
    const o: Record<string, SqlValue> = {};
    for (const [k, v] of Object.entries(params)) if (used.has(k)) o[k] = sanitize(v);
    return [o];
  }

  run(sql: string, params?: Params): { changes: number; lastId: number } {
    const r = this.stmt(sql).run(...this.bind(sql, params));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  get<T = any>(sql: string, params?: Params): T | undefined {
    return this.stmt(sql).get(...this.bind(sql, params)) as T | undefined;
  }

  all<T = any>(sql: string, params?: Params): T[] {
    return this.stmt(sql).all(...this.bind(sql, params)) as T[];
  }

  /** Returns first column of first row. */
  scalar<T = number>(sql: string, params?: Params): T {
    const row = this.get<Record<string, unknown>>(sql, params);
    if (!row) return null as T;
    return Object.values(row)[0] as T;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Runs fn inside a transaction. Nested calls use savepoints so partial failures roll back correctly. */
  tx<T>(fn: () => T): T {
    const name = `sp_${this.depth}`;
    if (this.depth === 0) this.raw.exec('BEGIN IMMEDIATE');
    else this.raw.exec(`SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      if (this.depth === 0) this.raw.exec('COMMIT');
      else this.raw.exec(`RELEASE ${name}`);
      return result;
    } catch (e) {
      this.depth--;
      if (this.depth === 0) this.raw.exec('ROLLBACK');
      else {
        this.raw.exec(`ROLLBACK TO ${name}`);
        this.raw.exec(`RELEASE ${name}`);
      }
      throw e;
    }
  }

  close(): void {
    this.cache.clear();
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* ignore */
    }
    this.raw.close();
  }
}
