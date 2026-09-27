import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import ExcelJS from 'exceljs';
import { anyLabel, fmtDate } from '../core/format';

/**
 * Save-file helper. In automated E2E runs (AUTODEAL_E2E_OUT set) files are written
 * directly to that folder instead of opening a native dialog.
 */
export async function chooseSavePath(win: BrowserWindow | null, defaultName: string, filters: Electron.FileFilter[]): Promise<string | null> {
  const safeName = defaultName.replace(/[\\/:*?"<>|]/g, '-');
  if (process.env.AUTODEAL_E2E_OUT) {
    fs.mkdirSync(process.env.AUTODEAL_E2E_OUT, { recursive: true });
    return path.join(process.env.AUTODEAL_E2E_OUT, safeName);
  }
  const opts = { defaultPath: path.join(os.homedir(), 'Documents', safeName), filters };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  return r.canceled || !r.filePath ? null : r.filePath;
}

export interface TableExport {
  title: string;
  columns: { key: string; label: string; type?: string }[];
  rows: Record<string, any>[];
  totals?: Record<string, number>;
}

function cell(c: { type?: string }, v: any): string | number {
  if (v === null || v === undefined) return '';
  switch (c.type) {
    case 'money':
      return Number(v) / 100;
    case 'int':
    case 'pct':
      return Number(v);
    case 'date':
      return fmtDate(v);
    case 'status':
      return anyLabel(v);
    default:
      return String(v);
  }
}

/** CSV with UTF-8 BOM so Excel shows Arabic correctly. */
export function writeCsv(file: string, t: TableExport) {
  const q = (s: string | number) => {
    const str = String(s);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [t.columns.map((c) => q(c.label)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map((c) => q(cell(c, r[c.key]))).join(','));
  if (t.totals && Object.keys(t.totals).length) lines.push(t.columns.map((c, i) => (i === 0 ? 'الإجمالي' : t.totals![c.key] !== undefined ? q(cell(c, t.totals![c.key])) : '')).join(','));
  fs.writeFileSync(file, '﻿' + lines.join('\r\n'), 'utf8');
}

/** Real .xlsx workbook (RTL sheet, typed numeric columns, totals row). */
export async function writeXlsx(file: string, t: TableExport) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AutoDeal Pro';
  const ws = wb.addWorksheet(t.title.slice(0, 30).replace(/[\\/?*[\]:]/g, '-'), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = t.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(40, c.label.length + 6)),
    style: c.type === 'money' ? { numFmt: '#,##0.00' } : c.type === 'pct' ? { numFmt: '0.00"%"' } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
  for (const r of t.rows) {
    const o: Record<string, any> = {};
    for (const c of t.columns) o[c.key] = cell(c, r[c.key]);
    ws.addRow(o);
  }
  if (t.totals && Object.keys(t.totals).length) {
    const o: Record<string, any> = {};
    t.columns.forEach((c, i) => (o[c.key] = i === 0 ? 'الإجمالي' : t.totals![c.key] !== undefined ? cell(c, t.totals![c.key]) : ''));
    const row = ws.addRow(o);
    row.font = { bold: true };
  }
  await wb.xlsx.writeFile(file);
}

// ------------------------------------------------------------------ printing / PDF

const previews = new Set<BrowserWindow>();

/**
 * Opens a print preview window with a toolbar (print / save PDF / close).
 * The toolbar is injected here and hidden in print media.
 */
export async function openPreview(html: string, title: string, preloadPath: string, landscape = false): Promise<BrowserWindow> {
  const tmp = path.join(os.tmpdir(), `autodeal-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  const toolbar = `<div class="no-print" style="position:sticky;top:0;z-index:10;display:flex;gap:8px;align-items:center;padding:10px 14px;background:#1e3a5f;color:#fff;font-family:Cairo,Tahoma,sans-serif;direction:rtl">
    <b style="flex:1">${title.replace(/</g, '&lt;')}</b>
    <button id="adp-print" style="padding:6px 18px;border:0;border-radius:6px;background:#fff;color:#1e3a5f;font-weight:700;cursor:pointer;font-family:inherit">طباعة</button>
    <button id="adp-pdf" style="padding:6px 18px;border:0;border-radius:6px;background:#10b981;color:#fff;font-weight:700;cursor:pointer;font-family:inherit">حفظ PDF</button>
    <button id="adp-close" style="padding:6px 14px;border:1px solid #fff;border-radius:6px;background:transparent;color:#fff;cursor:pointer;font-family:inherit">إغلاق</button></div>
    <script>
      document.getElementById('adp-print').onclick=()=>window.print();
      document.getElementById('adp-pdf').onclick=()=>window.adpPrint.savePdf();
      document.getElementById('adp-close').onclick=()=>window.close();
    </script>`;
  fs.writeFileSync(tmp, html.replace('<body>', '<body>' + toolbar), 'utf8');
  const win = new BrowserWindow({
    width: landscape ? 1200 : 920,
    height: 900,
    title,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  (win as any).__adpLandscape = landscape;
  (win as any).__adpTitle = title;
  previews.add(win);
  win.on('closed', () => {
    previews.delete(win);
    fs.rm(tmp, () => undefined);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadFile(tmp);
  return win;
}

export async function savePdfFrom(win: BrowserWindow, suggestedName: string): Promise<string | null> {
  const file = await chooseSavePath(win, suggestedName.endsWith('.pdf') ? suggestedName : `${suggestedName}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
  if (!file) return null;
  await win.webContents.executeJavaScript(`document.querySelectorAll('.no-print').forEach(e=>e.style.display='none')`);
  const data = await win.webContents.printToPDF({ pageSize: 'A4', landscape: !!(win as any).__adpLandscape, printBackground: true, margins: { marginType: 'default' } });
  await win.webContents.executeJavaScript(`document.querySelectorAll('.no-print').forEach(e=>e.style.display='')`);
  fs.writeFileSync(file, data);
  if (!process.env.AUTODEAL_E2E_OUT) shell.showItemInFolder(file);
  return file;
}

/** Headless PDF export (used by the "PDF" buttons on reports without opening a preview). */
export async function htmlToPdf(html: string, file: string, landscape = false): Promise<void> {
  const tmp = path.join(os.tmpdir(), `autodeal-pdf-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await win.loadFile(tmp);
    const data = await win.webContents.printToPDF({ pageSize: 'A4', landscape, printBackground: true });
    fs.writeFileSync(file, data);
  } finally {
    win.destroy();
    fs.rm(tmp, () => undefined);
  }
}
