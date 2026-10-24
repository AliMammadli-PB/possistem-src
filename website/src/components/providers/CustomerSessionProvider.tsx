'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type CustomerSessionState = {
  authenticated: boolean;
  email?: string;
  name?: string;
  customerId?: string;
  avatarUrl?: string | null;
  csrfToken: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setAvatarUrl: (url: string | null) => void;
};

const CustomerSessionContext = createContext<CustomerSessionState | null>(null);

export function CustomerSessionProvider({ children }: { children: ReactNode }) {
  const csrfRef = useRef<string | null>(null);
  const [session, setSession] = useState<
    Omit<CustomerSessionState, 'logout' | 'refresh' | 'setAvatarUrl'>
  >({
    authenticated: false,
    csrfToken: null,
    loading: true,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/pos/api/customer-auth/me', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        csrfRef.current = null;
        setSession({ authenticated: false, csrfToken: null, loading: false });
        return;
      }
      const data = (await res.json()) as {
        authenticated?: boolean;
        csrfToken?: string | null;
        customer?: {
          id?: string;
          email?: string;
          name?: string;
          contactPerson?: string | null;
          avatarUrl?: string | null;
        };
      };
      csrfRef.current = data.csrfToken ?? null;
      if (data.authenticated && data.customer) {
        setSession({
          authenticated: true,
          email: data.customer.email,
          name: data.customer.contactPerson || data.customer.name || data.customer.email,
          customerId: data.customer.id,
          avatarUrl: data.customer.avatarUrl ?? null,
          csrfToken: data.csrfToken ?? null,
          loading: false,
        });
        return;
      }
      setSession({ authenticated: false, csrfToken: null, loading: false });
    } catch {
      csrfRef.current = null;
      setSession({ authenticated: false, csrfToken: null, loading: false });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (csrfRef.current) headers['x-csrf-token'] = csrfRef.current;
      await fetch('/pos/api/customer-auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
    } catch {
      /* ignore */
    } finally {
      csrfRef.current = null;
      setSession({ authenticated: false, csrfToken: null, loading: false });
    }
  }, []);

  const setAvatarUrl = useCallback((url: string | null) => {
    setSession((current) => (current.authenticated ? { ...current, avatarUrl: url } : current));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      ...session,
      csrfToken: session.csrfToken ?? csrfRef.current,
      logout,
      refresh,
      setAvatarUrl,
    }),
    [session, logout, refresh, setAvatarUrl],
  );

  return <CustomerSessionContext.Provider value={value}>{children}</CustomerSessionContext.Provider>;
}

export function useCustomerSession(): CustomerSessionState {
  const ctx = useContext(CustomerSessionContext);
  if (!ctx) throw new Error('useCustomerSession must be used within CustomerSessionProvider');
  return ctx;
}
