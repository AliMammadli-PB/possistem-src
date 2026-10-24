import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setAdminSessionToken, setCsrfToken } from '../lib/api';
import { tellApp } from './android-app';

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
};

type AuthState = {
  user: SessionUser | null;
  insecureTransport: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [insecureTransport, setInsecureTransport] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{
        user: SessionUser;
        csrfToken: string;
        insecureTransport: boolean;
      }>('/auth/me');
      setUser(data.user);
      setCsrfToken(data.csrfToken);
      setInsecureTransport(data.insecureTransport);
    } catch {
      setUser(null);
      setCsrfToken(null);
      setAdminSessionToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onExpired = () => {
      setUser(null);
      setCsrfToken(null);
      setAdminSessionToken(null);
    };
    window.addEventListener('possistem:session-expired', onExpired);
    return () => window.removeEventListener('possistem:session-expired', onExpired);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    // Drop any orphaned admin CSRF before login (multi-tab / prior session).
    setCsrfToken(null);
    setAdminSessionToken(null);
    const data = await api<{
      user: SessionUser;
      csrfToken: string;
      sessionToken: string;
      insecureTransport: boolean;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user);
    setCsrfToken(data.csrfToken);
    setAdminSessionToken(data.sessionToken);
    setInsecureTransport(data.insecureTransport);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    // Explicit logout forgets the phone's saved login, otherwise the app would sign straight back in.
    tellApp({ type: 'clear-login' });
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      setUser(null);
      setCsrfToken(null);
      setAdminSessionToken(null);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    tellApp({ type: 'update-password', password: newPassword });
    setUser(null);
    setCsrfToken(null);
    setAdminSessionToken(null);
  }, []);

  const value = useMemo(
    () => ({ user, insecureTransport, loading, login, logout, changePassword, refresh }),
    [user, insecureTransport, loading, login, logout, changePassword, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
