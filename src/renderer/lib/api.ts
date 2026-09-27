import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    adp: {
      call: (method: string, args?: unknown) => Promise<{ ok: true; data: any } | { ok: false; error: { code: string; message: string; details: any } }>;
      onDataChanged: (cb: (method: string) => void) => () => void;
    };
  }
}

export class ApiError extends Error {
  code: string;
  details: any;
  constructor(code: string, message: string, details?: any) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const authListeners = new Set<() => void>();
export const onAuthExpired = (cb: () => void) => {
  authListeners.add(cb);
  return () => {
    authListeners.delete(cb);
  };
};

/** Calls a main-process API method. Throws ApiError with a user-friendly Arabic message. */
export async function call<T = any>(method: string, args?: unknown): Promise<T> {
  const r = await window.adp.call(method, args);
  if (!r.ok) {
    if (r.error.code === 'AUTH' && method !== 'auth.login') authListeners.forEach((f) => f());
    throw new ApiError(r.error.code, r.error.message, r.error.details);
  }
  return r.data as T;
}

/** Subscribes to "data changed" notifications so screens refresh after any mutation (dashboard real-time). */
export function useDataChanged(cb: (method: string) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => window.adp.onDataChanged((m) => ref.current(m)), []);
}

/** Loads data and reloads it automatically when anything changes in the database. */
export function useApi<T = any>(method: string | null, args?: unknown, opts: { live?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!method);
  const key = JSON.stringify(args ?? null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!method) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await call<T>(method, args);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e: any) {
      if (my === seq.current) setError(e.message ?? String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key]);
  useEffect(() => {
    load();
  }, [load]);
  useDataChanged(() => {
    if (opts.live !== false) load();
  });
  return { data, error, loading, reload: load, setData };
}
