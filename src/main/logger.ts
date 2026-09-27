import fs from 'node:fs';
import path from 'node:path';

/** Minimal rotating file logger for technical details (never shown to end users). */
let logFile = '';

export function initLogger(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'app.log');
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
      fs.renameSync(logFile, path.join(dir, 'app.old.log'));
    }
  } catch {
    /* ignore */
  }
}

export function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, extra?: unknown) {
  const line = `[${new Date().toISOString()}] ${level} ${msg}${extra !== undefined ? ' ' + safe(extra) : ''}\n`;
  if (level === 'ERROR') process.stderr.write(line);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    /* ignore */
  }
}

function safe(x: unknown): string {
  if (x instanceof Error) return `${x.message}\n${x.stack ?? ''}`;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

export function logPath() {
  return logFile;
}
