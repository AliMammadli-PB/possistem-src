import { coalesceWrite } from './inflight';
import { beginAdminRequest } from './live';
const API_BASE = '/pos/api';
const ADMIN_SESSION_KEY = 'possistem_admin_session';
const ADMIN_SESSION_HEADER = 'x-admin-session';

/** Login must not send/retry CSRF — a stale token (or customer-portal CSRF) can 403 it. */
const CSRF_SKIP_PATHS = new Set(['/auth/login']);

let csrfToken: string | null = null;
let adminSessionToken: string | null = null;

export function setAdminSessionToken(token: string | null) {
  adminSessionToken = token;
  if (token) sessionStorage.setItem(ADMIN_SESSION_KEY, token);
  else sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export function getAdminSessionToken(): string | null {
  return adminSessionToken ?? sessionStorage.getItem(ADMIN_SESSION_KEY);
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
  if (token) sessionStorage.setItem('possistem_csrf', token);
  else sessionStorage.removeItem('possistem_csrf');
}

export function getCsrfToken(): string | null {
  return csrfToken ?? sessionStorage.getItem('possistem_csrf');
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

/** Session probe — 401 here means "not logged in", not "session expired". */
const SESSION_PROBE_PATHS = new Set(['/auth/me']);

export function notifySessionExpired() {
  window.dispatchEvent(new CustomEvent('possistem:session-expired'));
}

function isCsrfFailure(status: number, data: unknown): boolean {
  if (status !== 403 || !data || typeof data !== 'object') return false;
  const error = 'error' in data ? String((data as { error: unknown }).error) : '';
  return /csrf/i.test(error);
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function refreshCsrfFromSession(): Promise<string | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const session = getAdminSessionToken();
  if (session) headers[ADMIN_SESSION_HEADER] = session;

  const res = await fetch(`${API_BASE}/auth/me`, {
    method: 'GET',
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    setCsrfToken(null);
    return null;
  }
  const data = (await parseBody(res)) as { csrfToken?: string } | null;
  const next = typeof data?.csrfToken === 'string' ? data.csrfToken : null;
  setCsrfToken(next);
  return next;
}

async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  allowRetry = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  // FormData must keep the boundary the browser generates; forcing
  // application/json onto it makes the server read an empty multipart body.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!headers.has('Content-Type') && options.body && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !CSRF_SKIP_PATHS.has(path)) {
    const csrf = getCsrfToken();
    if (csrf) headers.set('x-csrf-token', csrf);
  }

  const session = getAdminSessionToken();
  if (session) headers.set(ADMIN_SESSION_HEADER, session);

  try{const device=localStorage.getItem('possistem-support-device-id');if(device)headers.set('x-support-device',device);}catch{/* Optional device identity. */}
  const finishRequest = beginAdminRequest(method);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
    });
  } catch (error) { finishRequest(false); throw error; }
  // Only a validated successful response can settle a draft.
  let data: unknown;
  try { data = await parseBody(res); } catch (error) { finishRequest(false); throw error; }
  finishRequest(res.ok);

  if (
    !res.ok &&
    allowRetry &&
    isCsrfFailure(res.status, data) &&
    path !== '/auth/me' &&
    !CSRF_SKIP_PATHS.has(path)
  ) {
    const next = await refreshCsrfFromSession();
    if (next) {
      return request<T>(path, options, false);
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : res.statusText;
    if (res.status === 401 && path !== '/auth/login' && !SESSION_PROBE_PATHS.has(path)) {
      notifySessionExpired();
    }
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers({ Accept: '*/*' });
  const session = getAdminSessionToken();
  if (session) headers.set(ADMIN_SESSION_HEADER, session);
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers });
  if (!res.ok) throw new ApiError(res.status, 'Fayl açılmadı');
  return res.blob();
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && (typeof options.body === 'string' || options.body == null)) {
    const key = `${getAdminSessionToken() ?? 'cookie'}:${method}:${path}:${options.body ?? ''}`;
    return coalesceWrite(key, () => request<T>(path, options));
  }
  return request<T>(path, options);
}
