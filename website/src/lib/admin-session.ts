export const ADMIN_SESSION_KEY = 'possistem_admin_session';
export const ADMIN_SESSION_HEADER = 'x-admin-session';
export const ADMIN_CSRF_KEY = 'possistem_csrf';
export const ADMIN_CONSOLE_PATH = '/m-43dcc89574d90d1b1983a32c/';

export function getAdminSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem(ADMIN_SESSION_KEY); } catch { return null; }
}

export function getAdminCsrfToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem(ADMIN_CSRF_KEY); } catch { return null; }
}

export function adminAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extra,
  };
  const session = getAdminSessionToken();
  if (session) headers[ADMIN_SESSION_HEADER] = session;
  const csrf = getAdminCsrfToken();
  if (csrf) headers['x-csrf-token'] = csrf;
  return headers;
}
