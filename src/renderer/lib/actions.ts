import { useState } from 'react';
import { call } from './api';
import { useUi } from './ui';

/** Wraps a mutation: busy flag, success toast and friendly error toast. */
export function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success, 'success');
      return r;
    } catch (e: any) {
      toast(e.message ?? String(e), 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export type DocType = 'quotation' | 'reservation' | 'invoice' | 'contract' | 'schedule' | 'receipt' | 'statement' | 'costcard' | 'purchase';

export function usePrint() {
  const { toast } = useUi();
  return async (type: DocType, id: number, mode: 'preview' | 'pdf' = 'preview', extra: Record<string, any> = {}) => {
    try {
      const r = await call('print.document', { type, id, mode, ...extra });
      if (mode === 'pdf' && r?.file) toast(`تم حفظ الملف: ${r.file}`);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const addDaysStr = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};

export const addMonthsStr = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
};
