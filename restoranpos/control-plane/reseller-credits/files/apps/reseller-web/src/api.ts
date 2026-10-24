const API = '/pos/api';
const TOKEN_KEY = 'reseller.token';
const EXPIRES_KEY = 'reseller.expiresAt';
const SLUG_KEY = 'reseller.slug';

export type Quota = { quota: number; used: number; remaining: number };

/** Kredit = ay: 1 kredit bir aylıq lisenziyadır. */
export type ResellerMe = Quota & {
  name: string;
  slug: string;
  email: string;
  trialLimit: number;
  trialsUsed: number;
  maxDevices: number;
};

export type Term = 'trial7' | 1 | 3 | 6 | 12;
export type Product = 'restaurant' | 'market';

export const TERMS: { value: Term; label: string; credits: number }[] = [
  { value: 'trial7', label: 'Sınaq 7 gün', credits: 0 },
  { value: 1, label: '1 ay', credits: 1 },
  { value: 3, label: '3 ay', credits: 3 },
  { value: 6, label: '6 ay', credits: 6 },
  { value: 12, label: '12 ay', credits: 12 },
];
export const RENEW_TERMS = TERMS.filter((t) => t.value !== 'trial7') as { value: 1 | 3 | 6 | 12; label: string; credits: number }[];

export type LedgerRow = {
  id: string;
  delta: number;
  reason: 'grant' | 'sale' | 'renew' | 'refund' | 'adjust';
  months: number | null;
  note: string | null;
  customerName: string | null;
  createdAt: string;
};

export type Sale = {
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  voen: string | null;
  contactPerson: string | null;
  createdAt: string;
  licenseId: string | null;
  isTrial: boolean | null;
  termMonths: number | null;
  product: Product | null;
  plan: string | null;
  status: string | null;
  validUntil: string | null;
  maxDevices: number | null;
  redeemCount: number | null;
  keyLabel: string | null;
};

export type SetupInfo = {
  version: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes: number | null;
  productName: string;
};

export function getToken(): string | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const exp = Number(sessionStorage.getItem(EXPIRES_KEY) || 0);
    if (!token || !exp || exp <= Date.now()) {
      clearToken();
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/** Hangi panel linkiyle giriş yapıldığı — başka slug'a geçişte oturum düşer. */
export function getTokenSlug(): string | null {
  try {
    return sessionStorage.getItem(SLUG_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string, expiresAt: number, slug: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(EXPIRES_KEY, String(expiresAt));
    sessionStorage.setItem(SLUG_KEY, slug);
  } catch {
    /* ignore */
  }
}

export function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
    sessionStorage.removeItem(SLUG_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data as { error?: string } | null;
    if (res.status === 401 && !path.startsWith('/reseller/login')) {
      clearToken();
      throw new Error('Sessiya bitib — yenidən daxil olun');
    }
    throw new Error(err?.error || `Xəta (${res.status})`);
  }
  return data as T;
}

export async function panelInfo(slug: string) {
  return request<{ name: string }>(`/reseller/public/${encodeURIComponent(slug)}`);
}

export async function login(slug: string, email: string, password: string) {
  return request<{
    token: string;
    expiresAt: number;
    reseller: ResellerMe;
  }>('/reseller/login', {
    method: 'POST',
    body: JSON.stringify({ slug, email, password }),
  });
}

export async function logout() {
  try {
    await request('/reseller/logout', { method: 'POST', body: '{}' });
  } finally {
    clearToken();
  }
}

export async function me() {
  return request<ResellerMe>('/reseller/me');
}

export async function createSale(input: {
  name: string;
  email: string;
  password: string;
  address: string;
  phone: string | null;
  voen: string | null;
  contactPerson: string | null;
  notes: string | null;
  term: Term;
  maxDevices: number;
  product: Product;
}) {
  return request<{
    customer: { id: string; name: string; email: string };
    days: number;
    expiresAt: string;
    activationKey: string;
    quota: Quota | null;
  }>('/reseller/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function renew(licenseId: string, term: 1 | 3 | 6 | 12) {
  return request<{ ok: true; validUntil: string; quota: Quota | null }>(
    `/reseller/licenses/${encodeURIComponent(licenseId)}/renew`,
    { method: 'POST', body: JSON.stringify({ term }) },
  );
}

export async function ledger() {
  return request<LedgerRow[]>('/reseller/ledger');
}

export async function sales() {
  return request<Sale[]>('/reseller/customers');
}

export async function setup() {
  return request<SetupInfo>('/reseller/setup');
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('az-AZ', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Neçə gün qalıb; bitibsə və ya tarix yoxdursa null. */
export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.ceil(ms / (24 * 3600_000));
}

export const LEDGER_REASON: Record<LedgerRow['reason'], string> = {
  grant: 'Kredit alındı',
  sale: 'Satış',
  renew: 'Uzatma',
  refund: 'Geri qaytarıldı',
  adjust: 'Düzəliş',
};

export function statusLabel(status: string | null): string {
  switch (status) {
    case 'active':
      return 'Aktiv';
    case 'expired':
      return 'Bitib';
    case 'suspended':
      return 'Dayandırılıb';
    case 'revoked':
      return 'Ləğv edilib';
    default:
      return '—';
  }
}
