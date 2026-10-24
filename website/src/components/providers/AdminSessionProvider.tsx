'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ADMIN_CSRF_KEY,
  ADMIN_SESSION_KEY,
  adminAuthHeaders,
  getAdminCsrfToken,
} from '@/lib/admin-session';

export type AdminSessionState = {
  authenticated: boolean;
  email?: string;
  role?: string;
  csrfToken: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionState | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Omit<AdminSessionState, 'logout' | 'refresh'>>({
    authenticated: false,
    csrfToken: null,
    loading: true,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/pos/api/auth/session', {
        credentials: 'include',
        cache: 'no-store',
        headers: adminAuthHeaders(),
      });
      if (!res.ok) {
        setSession({ authenticated: false, csrfToken: null, loading: false });
        return;
      }
      const data = (await res.json()) as {
        user?: { email?: string; role?: string };
        csrfToken?: string | null;
      };
      const csrf = data.csrfToken ?? null;
      try {
        if (csrf) sessionStorage.setItem(ADMIN_CSRF_KEY, csrf);
        else sessionStorage.removeItem(ADMIN_CSRF_KEY);
      } catch { /* A valid cookie session does not require browser storage. */ }

      if (data.user?.email) {
        setSession({
          authenticated: true,
          email: data.user.email,
          role: data.user.role,
          csrfToken: csrf,
          loading: false,
        });
        return;
      }
      setSession({ authenticated: false, csrfToken: null, loading: false });
    } catch {
      setSession({ authenticated: false, csrfToken: null, loading: false });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/pos/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: adminAuthHeaders(),
      });
    } catch {
      /* ignore */
    } finally {
      try { sessionStorage.removeItem(ADMIN_SESSION_KEY); sessionStorage.removeItem(ADMIN_CSRF_KEY); } catch { /* storage blocked */ }
      setSession({ authenticated: false, csrfToken: null, loading: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const value = useMemo(
    () => ({
      ...session,
      csrfToken: session.csrfToken ?? getAdminCsrfToken(),
      logout,
      refresh,
    }),
    [session, logout, refresh],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionState {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error('useAdminSession must be used within AdminSessionProvider');
  return ctx;
}
