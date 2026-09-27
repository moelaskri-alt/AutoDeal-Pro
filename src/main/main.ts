import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Db } from '../core/db/database';
import { callApi } from '../core/api';
import { AppError, toAppError } from '../core/errors';
import { buildCtx, ensureSecurity, login } from '../core/services/users';
import { audit, getSetting, getSettingNum, setSetting } from '../core/services/common';
import { createBackup, listBackups, pruneAutoBackups, restoreBackup, validateBackupFile, BACKUP_EXT } from '../core/backup';
import { buildDocument, buildReportHtml, type DocType } from '../core/print/documents';
import { runReport } from '../core/services/reports';
import { seedDemo } from '../core/seed/demo';
import { requirePerm, type Ctx } from '../core/context';
import { localDate, localDateTime } from '../core/calc/dates';
import { initLogger, log, logPath } from './logger';
import { chooseSavePath, htmlToPdf, openPreview, savePdfFrom, writeCsv, writeXlsx, type TableExport } from './output';

// node:sqlite prints an ExperimentalWarning; it is stable for our use – keep the console clean.
const origEmit = process.emitWarning;
process.emitWarning = ((w: any, ...rest: any[]) => {
  if (String(w).includes('SQLite')) return;
  return (origEmit as any).call(process, w, ...rest);
}) as typeof process.emitWarning;

const APP_NAME = 'AutoDeal Pro';
app.setName(APP_NAME);
// dd/mm/yyyy date inputs with Latin digits (clear for accounting use) while the UI itself is Arabic RTL.
app.commandLine.appendSwitch('lang', 'en-GB');
if (process.platform === 'win32') app.setAppUserModelId('com.autodeal.pro');

// ------------------------------------------------------------------ paths
const dataDir = process.env.AUTODEAL_DATA_DIR || path.join(app.getPath('userData'), 'data');
const dbPath = path.join(dataDir, 'autodeal.db');
initLogger(path.join(dataDir, '..', 'logs'));
const preload = path.join(__dirname, 'preload.js');
const printPreload = path.join(__dirname, 'print-preload.js');
const rendererIndex = path.join(__dirname, '..', 'renderer', 'index.html');
const iconPath = path.join(__dirname, '..', '..', 'build-resources', 'icon.png');

let db: Db;
let mainWin: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let sessionUserId: number | null = null;

function backupDir(): string {
  const custom = db ? getSetting(db, 'backup_dir') : '';
  return custom || path.join(dataDir, '..', 'backups');
}

function fontCss(): string {
  const dir = path.join(__dirname, 'fonts');
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.woff2'))
    .map((f) => {
      const weight = /-(\d{3})-/.exec(f)?.[1] ?? '400';
      const range = f.includes('arabic')
        ? 'U+0600-06FF,U+0750-077F,U+0870-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFC'
        : 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
      const url = 'file:///' + path.join(dir, f).replace(/\\/g, '/').replace(/^\/+/, '');
      return `@font-face{font-family:'Cairo';font-weight:${weight};unicode-range:${range};src:url('${url}') format('woff2');}`;
    })
    .join('');
}

function openDatabase() {
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Db(dbPath);
  ensureSecurity(db);
  log('INFO', `Database opened at ${dbPath}`);
}

function ctx(): Ctx {
  if (!sessionUserId) throw new AppError('AUTH', 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.');
  return buildCtx(db, sessionUserId); // rebuilt per call so permission changes apply immediately
}

// ------------------------------------------------------------------ auto backup
function runAutoBackup(reason: string) {
  try {
    if (!db || getSetting(db, 'auto_backup_enabled') !== '1') return;
    const last = getSetting(db, 'last_auto_backup_at');
    const hours = getSettingNum(db, 'auto_backup_interval_hours');
    if (last && Date.now() - new Date(last.replace(' ', 'T')).getTime() < hours * 3600 * 1000) return;
    if (!db.scalar<number>('SELECT COUNT(*) FROM vehicles') && !db.scalar<number>('SELECT COUNT(*) FROM customers')) return;
    const b = createBackup(db, backupDir(), 'auto', null);
    setSetting(db, 'last_auto_backup_at', localDateTime());
    pruneAutoBackups(backupDir(), getSettingNum(db, 'auto_backup_keep'));
    log('INFO', `Auto backup (${reason}) → ${b.file}`);
  } catch (e) {
    log('ERROR', 'Auto backup failed', e);
  }
}

// ------------------------------------------------------------------ IPC
const READ_PREFIXES = ['.list', '.get', '.lookup', '.brands', '.card', '.statement', '.contracts', '.contract', '.preview', '.getImage', '.salespeople', '.run'];
const isRead = (m: string) => READ_PREFIXES.some((p) => m.endsWith(p)) || m === 'dashboard.get';

function broadcastChange(method: string) {
  for (const w of BrowserWindow.getAllWindows()) if (w === mainWin) w.webContents.send('data:changed', method);
}

type Special = (args: any, event: Electron.IpcMainInvokeEvent) => unknown | Promise<unknown>;

const SPECIAL: Record<string, Special> = {
  'auth.login': (a) => {
    const r = login(db, a?.username, a?.password);
    sessionUserId = r.user.id;
    return { ...r, perms: r.perms };
  },
  'auth.logout': () => {
    if (sessionUserId) audit(db, ctx(), { action: 'logout', module: 'auth', record_type: 'user', record_id: sessionUserId });
    sessionUserId = null;
    return { ok: true };
  },
  'auth.session': () => {
    if (!sessionUserId) return null;
    const c = ctx();
    return { user: c.user, perms: [...c.perms] };
  },
  'app.info': () => ({
    name: APP_NAME,
    version: app.getVersion(),
    dataDir,
    dbPath,
    backupDir: backupDir(),
    logPath: logPath(),
    electron: process.versions.electron,
    sqlite: db.scalar<string>('SELECT sqlite_version()'),
    empty: !db.scalar<number>('SELECT COUNT(*) FROM vehicles') && !db.scalar<number>('SELECT COUNT(*) FROM customers'),
  }),
  'app.seedDemo': () => {
    const c = ctx();
    requirePerm(c, 'settings.manage');
    c.today = localDate();
    const r = seedDemo(db, c);
    audit(db, c, { action: 'seed_demo', module: 'settings', details: JSON.stringify(r) });
    return r;
  },
  'backup.list': () => {
    requirePerm(ctx(), 'backup.manage');
    return { dir: backupDir(), items: listBackups(backupDir()), auto: getSetting(db, 'auto_backup_enabled') === '1', last_auto: getSetting(db, 'last_auto_backup_at') };
  },
  'backup.create': () => {
    const c = ctx();
    requirePerm(c, 'backup.manage');
    return createBackup(db, backupDir(), 'manual', c.user.id, (file) =>
      audit(db, c, { action: 'backup', module: 'backup', label: path.basename(file), details: file }),
    );
  },
  'backup.chooseFile': async () => {
    requirePerm(ctx(), 'backup.manage');
    const r = await dialog.showOpenDialog(mainWin!, { title: 'اختر ملف النسخة الاحتياطية', defaultPath: backupDir(), filters: [{ name: 'AutoDeal Backup', extensions: [BACKUP_EXT.slice(1), 'db'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { file: r.filePaths[0], info: validateBackupFile(r.filePaths[0]) };
  },
  'backup.inspect': (a) => {
    requirePerm(ctx(), 'backup.manage');
    return validateBackupFile(String(a?.file ?? ''));
  },
  'backup.restore': (a) => {
    const c = ctx();
    requirePerm(c, 'backup.manage');
    if (a?.confirm !== 'RESTORE') throw new AppError('CONFIRM', 'يجب تأكيد عملية الاستعادة.');
    const file = String(a?.file ?? '');
    const res = restoreBackup(db, dbPath, file, backupDir(), c.user.id);
    db = res.db;
    ensureSecurity(db);
    const stillValid = db.get<any>('SELECT id FROM users WHERE id = ? AND is_active = 1', [c.user.id]);
    if (!stillValid) sessionUserId = null;
    else audit(db, buildCtx(db, c.user.id), { action: 'restore', module: 'backup', details: `${path.basename(file)} (نسخة أمان: ${res.safety.name})` });
    log('INFO', `Restored backup ${file}; safety copy ${res.safety.file}`);
    return { ok: true, safety: res.safety, loggedOut: !stillValid };
  },
  'backup.openFolder': () => {
    requirePerm(ctx(), 'backup.manage');
    fs.mkdirSync(backupDir(), { recursive: true });
    return shell.openPath(backupDir());
  },
  'backup.chooseDir': async () => {
    const c = ctx();
    requirePerm(c, 'settings.manage');
    const r = await dialog.showOpenDialog(mainWin!, { title: 'اختر مجلد النسخ الاحتياطي', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  },
  'print.document': async (a) => {
    const c = ctx();
    const doc = buildDocument(db, c, a.type as DocType, Number(a.id), { from: a.from, to: a.to, fontCss: fontCss() });
    if (a.mode === 'pdf') {
      const file = await chooseSavePath(mainWin, `${doc.title}-${a.id}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (!file) return null;
      await htmlToPdf(doc.html, file, doc.landscape);
      if (!process.env.AUTODEAL_E2E_OUT) shell.showItemInFolder(file);
      return { file };
    }
    await openPreview(doc.html, doc.title, printPreload, doc.landscape);
    return { ok: true };
  },
  'print.report': async (a) => {
    const c = ctx();
    const rep = runReport(db, c, { id: a.id, filters: a.filters ?? {} });
    const html = buildReportHtml(db, c, rep, fontCss());
    const landscape = rep.columns.length > 7;
    if (a.mode === 'pdf') {
      const file = await chooseSavePath(mainWin, `${rep.title}-${localDate()}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (!file) return null;
      await htmlToPdf(html, file, landscape);
      if (!process.env.AUTODEAL_E2E_OUT) shell.showItemInFolder(file);
      return { file };
    }
    await openPreview(html, rep.title, printPreload, landscape);
    return { ok: true };
  },
  'export.table': async (a) => {
    ctx();
    const t = a as TableExport & { format: 'csv' | 'xlsx' };
    if (!Array.isArray(t.columns) || !Array.isArray(t.rows)) throw new AppError('VALIDATION', 'لا توجد بيانات للتصدير.');
    const ext = t.format === 'xlsx' ? 'xlsx' : 'csv';
    const file = await chooseSavePath(mainWin, `${t.title}-${localDate()}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    if (!file) return null;
    if (ext === 'xlsx') await writeXlsx(file, t);
    else writeCsv(file, t);
    if (!process.env.AUTODEAL_E2E_OUT) shell.showItemInFolder(file);
    return { file };
  },
  'export.report': async (a) => {
    const c = ctx();
    const rep = runReport(db, c, { id: a.id, filters: a.filters ?? {} });
    return SPECIAL['export.table']({ title: rep.title, columns: rep.columns, rows: rep.rows, totals: rep.totals, format: a.format }, undefined as any);
  },
};

function registerIpc() {
  ipcMain.handle('api', async (event, method: string, args: unknown) => {
    const started = Date.now();
    try {
      let data: unknown;
      if (SPECIAL[method]) data = await SPECIAL[method](args, event);
      else {
        data = callApi(db, ctx(), method, args);
        if (!isRead(method)) broadcastChange(method);
      }
      if (method === 'backup.restore' || method === 'app.seedDemo') broadcastChange(method);
      const ms = Date.now() - started;
      if (ms > 500) log('WARN', `Slow call ${method} ${ms}ms`);
      return { ok: true, data };
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'UNEXPECTED') log('ERROR', `API ${method} failed`, e);
      else log('INFO', `API ${method} rejected: ${err.code} ${err.message}`);
      return { ok: false, error: { code: err.code, message: err.message, details: err.details ?? null } };
    }
  });
  ipcMain.handle('print:savePdf', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    try {
      return await savePdfFrom(win, (win as any).__adpTitle ?? 'document');
    } catch (e) {
      log('ERROR', 'savePdf failed', e);
      dialog.showErrorBox(APP_NAME, 'تعذر حفظ ملف PDF.');
      return null;
    }
  });
}

// ------------------------------------------------------------------ windows
function createSplash() {
  splash = new BrowserWindow({ width: 420, height: 260, frame: false, resizable: false, show: false, center: true, backgroundColor: '#1e3a5f', icon: fs.existsSync(iconPath) ? iconPath : undefined });
  const html = `<!doctype html><html dir="rtl"><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1e3a5f;color:#fff;font-family:'Segoe UI',Tahoma,sans-serif">
    <div style="width:64px;height:64px;border-radius:16px;background:#fff;color:#1e3a5f;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800">AD</div>
    <h1 style="margin:14px 0 2px;font-size:24px;letter-spacing:.5px">AutoDeal Pro</h1><div style="opacity:.8">نظام إدارة معارض السيارات</div>
    <div style="margin-top:20px;width:140px;height:4px;background:rgba(255,255,255,.2);border-radius:2px;overflow:hidden"><div style="width:40%;height:100%;background:#34d399;animation:m 1.1s infinite ease-in-out"></div></div>
    <style>@keyframes m{0%{transform:translateX(160%)}100%{transform:translateX(-260%)}}</style></body></html>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  splash.once('ready-to-show', () => splash?.show());
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f4f6f9',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  const reveal = () => {
    if (!mainWin || mainWin.isVisible()) return;
    if (!process.env.AUTODEAL_E2E) mainWin.maximize();
    mainWin.show();
    splash?.destroy();
    splash = null;
  };
  mainWin.once('ready-to-show', reveal);
  // Safety net: never leave the user with an invisible app if the GPU/compositor is slow to report readiness.
  setTimeout(() => {
    if (mainWin && !mainWin.isVisible()) log('WARN', 'ready-to-show not received after 10s – showing window anyway');
    reveal();
  }, 10000);
  mainWin.on('closed', () => (mainWin = null));
  mainWin.loadFile(rendererIndex);
}

// ------------------------------------------------------------------ lifecycle
log('INFO', `Starting ${APP_NAME} ${app.getVersion()} (pid ${process.pid}, electron ${process.versions.electron})`);
if (!app.requestSingleInstanceLock()) {
  log('INFO', 'Another instance is already running – focusing it and exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  process.on('uncaughtException', (e) => log('ERROR', 'uncaughtException', e));
  process.on('unhandledRejection', (e) => log('ERROR', 'unhandledRejection', e));

  app.whenReady().then(() => {
    log('INFO', 'App ready');
    Menu.setApplicationMenu(null);
    try {
      openDatabase();
    } catch (e) {
      log('ERROR', 'Failed to open database', e);
      dialog.showErrorBox(APP_NAME, 'تعذر فتح قاعدة البيانات. يرجى استعادة نسخة احتياطية أو التواصل مع الدعم الفني.\n' + logPath());
      app.quit();
      return;
    }
    registerIpc();
    if (!process.env.AUTODEAL_E2E) createSplash();
    runAutoBackup('startup');
    setInterval(() => runAutoBackup('interval'), 30 * 60 * 1000).unref();
    createMainWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    if (db) {
      runAutoBackup('quit');
      try {
        db.close();
      } catch (e) {
        log('WARN', 'close failed', e);
      }
    }
  });
}
