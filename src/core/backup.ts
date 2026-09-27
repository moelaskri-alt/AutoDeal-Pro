import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from './db/database';
import { SCHEMA_VERSION } from './db/migrations';
import { AppError, fail } from './errors';
import { localDateTime } from './calc/dates';

export const BACKUP_EXT = '.adpbak';

export interface BackupInfo {
  file: string;
  name: string;
  size: number;
  created_at: string;
  kind: string;
}

function stamp(): string {
  return localDateTime().replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');
}

/** Consistent online backup using SQLite's VACUUM INTO (works while the app is running). */
export function createBackup(
  db: Db,
  dir: string,
  kind: 'manual' | 'auto' | 'pre_restore',
  userId?: number | null,
  /** Runs before the snapshot so entries it writes (e.g. the audit log line) are included in the backup itself. */
  beforeSnapshot?: (file: string) => void,
): BackupInfo {
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `AutoDealPro-${kind}-${stamp()}${BACKUP_EXT}`);
  let n = 1;
  while (fs.existsSync(file)) file = path.join(dir, `AutoDealPro-${kind}-${stamp()}-${n++}${BACKUP_EXT}`);
  beforeSnapshot?.(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const size = fs.statSync(file).size;
  try {
    db.run('INSERT INTO backups(file_path, kind, size_bytes, created_by) VALUES (?,?,?,?)', [file, kind, size, userId ?? null]);
  } catch {
    /* logging only */
  }
  return { file, name: path.basename(file), size, created_at: localDateTime(), kind };
}

export function listBackups(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(BACKUP_EXT))
    .map((f) => {
      const file = path.join(dir, f);
      const st = fs.statSync(file);
      const kind = /-(manual|auto|pre_restore)-/.exec(f)?.[1] ?? 'manual';
      return { file, name: f, size: st.size, created_at: localDateTime(st.mtime), kind };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Keeps only the newest `keep` automatic backups. */
export function pruneAutoBackups(dir: string, keep: number): number {
  const autos = listBackups(dir).filter((b) => b.kind === 'auto');
  let removed = 0;
  for (const b of autos.slice(Math.max(1, keep))) {
    try {
      fs.unlinkSync(b.file);
      removed++;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/** Verifies a file is an intact AutoDeal Pro database that this version can open. */
export function validateBackupFile(file: string): { schema_version: number; vehicles: number; customers: number; sales: number } {
  if (!fs.existsSync(file)) fail('NOT_FOUND', 'ملف النسخة الاحتياطية غير موجود.');
  let raw: DatabaseSync | null = null;
  try {
    raw = new DatabaseSync(file, { readOnly: true });
    const ok = (raw.prepare('PRAGMA integrity_check').get() as any)?.integrity_check;
    if (ok !== 'ok') throw new AppError('BACKUP_CORRUPT', 'ملف النسخة الاحتياطية تالف ولا يمكن استعادته.');
    const hasTable = raw.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name IN ('schema_migrations','vehicles','sales','users')").get() as any;
    if (hasTable.c < 4) throw new AppError('BACKUP_INVALID', 'الملف المحدد ليس نسخة احتياطية صالحة لبرنامج AutoDeal Pro.');
    const v = (raw.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as any).v as number;
    if (v > SCHEMA_VERSION) throw new AppError('BACKUP_NEWER', 'هذه النسخة الاحتياطية من إصدار أحدث من البرنامج. يرجى تحديث البرنامج أولاً.');
    const count = (t: string) => (raw!.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c as number;
    return { schema_version: v, vehicles: count('vehicles'), customers: count('customers'), sales: count('sales') };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('BACKUP_INVALID', 'الملف المحدد ليس نسخة احتياطية صالحة لبرنامج AutoDeal Pro.');
  } finally {
    raw?.close();
  }
}

/**
 * Restores a backup over the live database file:
 *  1. validate the backup, 2. take a pre-restore safety backup, 3. close the live DB,
 *  4. replace the file (removing WAL/SHM), 5. reopen + run migrations.
 * If anything fails after closing, the safety backup is put back.
 */
export function restoreBackup(current: Db, dbPath: string, backupFile: string, backupDir: string, userId?: number | null): { db: Db; safety: BackupInfo } {
  validateBackupFile(backupFile);
  const safety = createBackup(current, backupDir, 'pre_restore', userId);
  current.close();
  const clean = () => {
    for (const ext of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + ext);
      } catch {
        /* not present */
      }
    }
  };
  try {
    clean();
    fs.copyFileSync(backupFile, dbPath);
    const db = new Db(dbPath);
    return { db, safety };
  } catch (e) {
    clean();
    fs.copyFileSync(safety.file, dbPath);
    throw e instanceof AppError ? e : new AppError('RESTORE_FAILED', 'فشلت الاستعادة وتمت إعادة البيانات السابقة كما كانت.');
  }
}
