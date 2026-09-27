import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { call, onAuthExpired } from './api';

export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  role: string;
  role_name: string;
}

interface AuthState {
  user: SessionUser | null;
  perms: Set<string>;
  ready: boolean;
  can: (...p: string[]) => boolean;
  login: (u: string, p: string) => Promise<{ must_change_password: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await call<{ user: SessionUser; perms: string[] } | null>('auth.session');
      setUser(s?.user ?? null);
      setPerms(new Set(s?.perms ?? []));
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    return onAuthExpired(() => {
      setUser(null);
      setPerms(new Set());
    });
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const r = await call('auth.login', { username, password });
    setUser(r.user);
    setPerms(new Set(r.perms));
    return { must_change_password: r.must_change_password };
  };
  const logout = async () => {
    await call('auth.logout').catch(() => undefined);
    setUser(null);
    setPerms(new Set());
  };
  const can = (...p: string[]) => p.every((x) => perms.has(x));
  return <Ctx.Provider value={{ user, perms, ready, can, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
