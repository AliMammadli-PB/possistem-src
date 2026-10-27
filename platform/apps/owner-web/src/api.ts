export type OwnerProduct='restaurant'|'market'|'geyim'|'aptek'|'topdan';
export const ownerProductLabels:Record<OwnerProduct,string>={restaurant:'Restoran POS',market:'Market POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS'};
let portalProduct:OwnerProduct|null=null;
export function setPortalProduct(value:OwnerProduct|null){portalProduct=value;}
const API = '/pos/api';
let csrfToken: string | null = null;

export type ApiProblem = {
  error: string;
  code?: string;
  details?: unknown;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, problem?: ApiProblem) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem?.code;
    this.details = problem?.details;
  }
}

export type Customer = {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  voen: string | null;
  notifyEmail: string | null;
  emailVerified: boolean;
  avatarUrl?: string | null;
};

export type OnboardingState = {
  currentStep: number;
  completedSteps: number[];
  installationStatus:
    | 'not_started'
    | 'downloaded'
    | 'installing'
    | 'awaiting_connection'
    | 'verified'
    | 'error';
  downloadedVersion: string | null;
  installedVersion: string | null;
  lastDownloadAt: string | null;
  lastCheckAt: string | null;
  verifiedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
};

export type LicenseInfo = {
  id: string;
  plan: string;
  product?: OwnerProduct;
  availableProducts?: Array<OwnerProduct>;
  seats: number;
  status: string;
  validFrom: string;
  validUntil: string | null;
  features: Record<string, unknown>;
};

export type SetupInfo = {
  version: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes: number | null;
  sha512: string | null;
  releaseDate: string | null;
  feedUrl: string;
  platform: 'windows';
  productName: string;
  requirements: {
    operatingSystem: string;
    architecture: string;
    cpu?:string;gpu?:string;display?:string;
    memory: string;
    diskSpace: string;
    internet: string;
  };
};

export type SessionPayload = {
  authenticated?: true;
  customer: Customer;
  csrfToken: string;
  onboardingComplete: boolean;
  currentStep?: number;
  redirectTo?: string;
  licenseProduct?: OwnerProduct | null;
  availableProducts?: Array<OwnerProduct>;
};

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const problem = (data ?? {}) as ApiProblem;
    if (response.status === 401) {
      setCsrfToken(null);
      window.dispatchEvent(new CustomEvent('possistem:unauthorized'));
    }
    throw new ApiError(
      problem.error || 'Sorğu tamamlanmadı. Yenidən cəhd edin.',
      response.status,
      problem,
    );
  }
  return data as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if(portalProduct&&['/customer/onboarding','/customer/dashboard','/customer/downloads/latest','/customer/onboarding/download','/customer/onboarding/verify','/owner/market-overview','/customer/tables','/customer/activity'].includes(path.split('?')[0])&&!/[?&]product=/.test(path))path+=(path.includes('?')?'&':'?')+'product='+portalProduct;
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (csrfToken && init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  return parseResponse<T>(response);
}

export function login(email: string, password: string, rememberMe: boolean) {
  return request<SessionPayload>('/customer-auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, rememberMe }),
  }).then((payload) => {
    setCsrfToken(payload.csrfToken);
    return payload;
  });
}

export function checkEmail(email: string) {
  return request<{ exists: boolean; message: string }>('/customer-auth/check-email', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function sendOtp(email: string, purpose: 'login' | 'register' | 'reset') {
  return request<{ ok: boolean; message: string; devCode?: string }>('/customer-auth/otp/send', {
    method: 'POST',
    body: JSON.stringify({ email, purpose }),
  });
}

export function loginWithOtp(email: string, code: string, rememberMe: boolean) {
  return request<SessionPayload>('/customer-auth/login-otp', {
    method: 'POST',
    body: JSON.stringify({ email, code, rememberMe }),
  }).then((payload) => {
    setCsrfToken(payload.csrfToken);
    return payload;
  });
}

export function register(input: {
  name: string;
  businessName: string;
  email: string;
  password: string;
  termsAccepted: boolean;
  otpCode: string;
}) {
  return request<SessionPayload>('/customer-auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((payload) => {
    setCsrfToken(payload.csrfToken);
    return payload;
  });
}

export function session() {
  return request<SessionPayload | { authenticated: false }>('/customer-auth/me').then((payload) => {
    if (payload.authenticated === false) {
      throw new ApiError('Unauthorized', 401, { error: 'Unauthorized' });
    }
    setCsrfToken(payload.csrfToken);
    return payload;
  });
}

export function logout() {
  return request<{ ok: boolean }>('/customer-auth/logout', { method: 'POST' }).finally(() =>
    setCsrfToken(null),
  );
}

export function forgotPassword(email: string) {
  return request<{ ok: boolean; message: string }>('/customer-auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, password: string) {
  return request<{ ok: boolean }>('/customer-auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ ok: boolean; reauth: boolean }>('/customer-auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  }).finally(() => setCsrfToken(null));
}

export function uploadAvatar(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<{ avatarUrl: string }>('/public/chat/avatar', {
    method: 'POST',
    body: form,
  }).then((data) => `${data.avatarUrl}?v=${Date.now()}`);
}

export function removeAvatar() {
  return request<{ ok: boolean }>('/public/chat/avatar', { method: 'DELETE' });
}

export type OnboardingPayload = {
  customer: {
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
    voen: string;
    notifyEmail: string;
  };
  onboarding: OnboardingState;
  license: LicenseInfo | null;
  setup: SetupInfo | null;
  setupError: string | null;
};

export function getOnboarding() {
  return request<OnboardingPayload>('/customer/onboarding');
}

export function saveProfile(input: {
  businessName: string;
  contactPerson: string;
  phone: string;
  address: string;
  voen?: string;
  notifyEmail: string;
}) {
  return request<{ customer: Partial<Customer> }>('/customer/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function saveOnboardingProgress(completedStep: number) {
  return request<{ onboarding: OnboardingState }>('/customer/onboarding/progress', {
    method: 'POST',
    body: JSON.stringify({ completedStep }),
  });
}

export function latestSetup(product?: OwnerProduct) {
  const query = product ? `?product=${product}` : '';
  return request<SetupInfo>(`/customer/downloads/latest${query}`);
}

export function recordSetupDownload() {
  return request<{ setup: SetupInfo; onboarding: OnboardingState }>(
    '/customer/onboarding/download',
    { method: 'POST' },
  );
}

export function verifySetup() {
  return request<{
    verified: boolean;
    reason?: string;
    connection: {
      connected: boolean;
      everConnected: boolean;
      lastSeenAt: string | null;
      appVersion: string | null;
      hostname: string | null;
    };
    onboarding: OnboardingState;
  }>('/customer/onboarding/verify', { method: 'POST' });
}

export function completeOnboarding() {
  return request<{ onboarding: OnboardingState }>('/customer/onboarding/complete', {
    method: 'POST',
  });
}

export type DashboardPayload = {
  customer: { id: string; name: string; email: string };
  onboarding: OnboardingState;
  license: LicenseInfo | null;
  connection: {
    connected: boolean;
    everConnected: boolean;
    lastSeenAt: string | null;
    appVersion: string | null;
    hostname: string | null;
  };
  update: {
    latestVersion: string;
    installedVersion: string | null;
    available: boolean;
  } | null;
  floor: {
    tables: Array<{
      id?: string;
      label?: string;
      status?: string;
      areaName?: string;
      totalMinor?: number;
      paidMinor?: number;
      orderId?: string | null;
    }>;
    openTables: number;
    openTotalMinor: number;
    todaySalesMinor: number;
    updatedAt: string | null;
    hasSnapshot: boolean;
  };
  notifications: NotificationItem[];
};

export const isMarketPortal = String(import.meta.env.BASE_URL).includes('marketpos');

export function isMarketOnlySurface(
  licenseProduct?: OwnerProduct | null,
  availableProducts?: Array<OwnerProduct>,
) {
  if (portalProduct) return portalProduct!=='restaurant';
  if (isMarketPortal) return true;
  return licenseProduct === 'market' && !(availableProducts ?? []).includes('restaurant');
}

export function dashboard(product?: OwnerProduct) {
  const query = product ? `?product=${product}` : '';
  return request<DashboardPayload>(`/customer/dashboard${query}`);
}

export type LiveTable = {
  id: string;
  label: string;
  status: string;
  areaName?: string;
  orderId: string | null;
  guestCount?: number;
  itemCount?: number;
  totalMinor: number;
  paidMinor: number;
  waiterName?: string;
  openedAt?: string;
  items?: Array<{ name: string; quantity: number; status: string }>;
};

export function customerTables() {
  return request<{
    connected: boolean;
    tables: LiveTable[];
    openTables: number;
    openTotalMinor: number;
    updatedAt: string | null;
  }>('/customer/tables');
}

export type MarketProductImage =
  | { kind: 'sprite'; index?: number }
  | { kind: 'url'; url: string; remoteUrl?: string };

export type MarketProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  stock: number;
  minStock: number;
  priceMinor: number;
  costMinor?: number;
  active: boolean;
  warehouseStock?: Record<string, number>;
  unit?: string;
  category?: string;
  image?: MarketProductImage | null;
  lastMovement?: { at: string; deviceId: string; delta: number; kind?: string } | null;
  soldTodayQty?: number;
  soldAllQty?: number;
  revenueTodayMinor?: number;
  revenueAllMinor?: number;
  profitTodayMinor?: number;
  profitAllMinor?: number;
};

export type MarketWarehouse = { id: string; code?: string; name?: string };

export type MarketRegister = {
  id: string;
  name: string;
  status: 'open' | 'closed' | string;
  operatorName: string | null;
  salesMinor: number;
  deviceId?: string;
  lastSeenAt?: string | null;
  connected?: boolean;
  terminalName?: string | null;
};

export type MarketOverviewPayload = {
  market: {
    available: boolean;
    connected: boolean;
    lastSeenAt: string | null;
    appVersion?: string | null;
    storeName: string;
    terminalName?: string | null;
    dailySalesMinor: number;
    transactionCount: number;
    cashMinor: number;
    cardMinor: number;
    openRegisters: number;
    registers: MarketRegister[];
    productCount: number;
    activeProductCount: number;
    stockUnitCount: number;
    criticalStock: number;
    catalogRevision: number;
    centralUpdatedAt: string | null;
    pendingDevices: string[];
    warehouses?: MarketWarehouse[];
    products: MarketProduct[];
    topProducts?: Array<{ id: string; name: string; qty?: number; revenueMinor?: number }>;
    lowStock?: Array<{ id: string; name: string; sku?: string; stock?: number; minStock?: number }>;
    queue?: number;
  };
};

export function marketOverview() {
  return request<MarketOverviewPayload>('/owner/market-overview');
}

export type MarketInventoryPage = {
  products: MarketProduct[];
  total: number;
  page: number;
  limit: number;
  warehouses: MarketWarehouse[];
  totals: { all: number; instock: number; out: number; critical: number; units: number };
  catalogRevision: number;
  updatedAt: string | null;
};

export function ownerMarketInventory(params: {
  q?: string;
  filter?: 'all' | 'instock' | 'out' | 'critical';
  page?: number;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.filter && params.filter !== 'all') query.set('filter', params.filter);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString() ? `?${query.toString()}` : '';
  return request<MarketInventoryPage>(`/owner/market/inventory${qs}`);
}

export type MarketBranchStock = {
  deviceId: string;
  branchId: string | null;
  branchName: string;
  hostname: string;
  online: boolean;
  updatedAt: number;
  /** The branch's warehouse object id (needed for price edits); null until its till is 1.5.42+. */
  objectId: string | null;
  warehouses: Array<{ id: string; name: string }>;
  lines: Array<{
    goodId: string;
    name: string;
    barcode: string;
    unit: string;
    warehouseId: string;
    qtyMilli: number;
    salePriceMinor: number;
  }>;
};

export function ownerMarketBranchStock() {
  return request<{ branches: MarketBranchStock[] }>('/owner/market/branch-stock');
}

export type MarketBranchEdit =
  | { kind: 'qty'; goodId: string; warehouseId: string; deltaMilli: number }
  | { kind: 'price'; goodId: string; salePriceMinor: number };

export type MarketBranchEditCommand = {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  edits: MarketBranchEdit[];
  note: string | null;
  /** Per edit, once the till has run the batch. */
  results: Array<{ success: boolean; error: string | null }> | null;
};

/** Queue warehouse edits for a branch; its warehouse PC applies them on its next sync. */
export function queueMarketBranchEdits(input: { deviceId: string; requestId: string; edits: MarketBranchEdit[]; note?: string }) {
  return request<{ queued: true; online: boolean; commandIds: string[] }>('/owner/market/branch-edits', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function ownerMarketBranchEdits(deviceId: string) {
  return request<{ commands: MarketBranchEditCommand[] }>(`/owner/market/branch-edits?deviceId=${encodeURIComponent(deviceId)}`);
}

export function cancelMarketBranchEdit(id: string) {
  return request<{ ok: true; status: 'cancelled' }>(`/owner/market/branch-edits/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export function createMarketProduct(input: {
  id?: string;
  name: string;
  sku: string;
  barcode?: string;
  priceMinor: number;
  costMinor?: number;
  minStock?: number;
  active?: boolean;
  warehouseStock?: Record<string, number>;
}) {
  return request<{ ok: true; product: Record<string, unknown> }>('/owner/market/products', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateMarketProduct(
  id: string,
  input: {
    name: string;
    sku: string;
    barcode?: string;
    priceMinor: number;
    costMinor?: number;
    minStock?: number;
    active?: boolean;
    warehouseStock?: Record<string, number>;
  },
) {
  return request<{ ok: true; product: Record<string, unknown> }>(`/owner/market/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteMarketProduct(id: string, password: string) {
  return request<{ ok: true }>(`/owner/market/products/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
}

export function uploadMarketProductImage(id: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<{ ok: true; imageUrl: string; product: Record<string, unknown> }>(
    `/owner/market/products/${encodeURIComponent(id)}/image`,
    { method: 'POST', body: form },
  );
}

export function marketProductPhotoUrl(product: { image?: MarketProductImage | null }): string | null {
  const image = product.image;
  if (!image || image.kind !== 'url') return null;
  const remote = String(image.remoteUrl || '').trim();
  const url = String(image.url || '').trim();
  const http = [remote, url].find((value) => /^https?:\/\//i.test(value));
  if (http) return http;
  if (url.startsWith('data:')) return url;
  if (!url || url.startsWith('market-pos://')) return null;
  return url;
}

export function adjustMarketStock(id: string, input: { warehouseId?: string; delta: number }) {
  return request<{ ok: true; qty: number; applied: number; warehouseId: string }>(
    `/owner/market/products/${encodeURIComponent(id)}/stock`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export type MarketPosCommand = {
  id: string;
  kind: 'x_report' | 'z_report' | string;
  status: string;
  deviceId: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export function ownerMarketCommands() {
  return request<{ commands: MarketPosCommand[] }>('/owner/market/commands');
}

export function sendMarketCommand(input: {
  kind: 'x_report' | 'z_report';
  actualCashMinor?: number;
}) {
  return request<{ ok: true; command: { id: string; kind: string; status: string; createdAt: string } }>(
    '/owner/market/commands',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  payload?: {orderId?:unknown;url?:unknown};
};

export function activity() {
  return request<{
    notifications: NotificationItem[];
    events: Array<{
      id: string;
      action: string;
      entityType: string | null;
      meta: Record<string, unknown>;
      createdAt: string;
    }>;
  }>('/customer/activity');
}

export function markNotificationRead(id?: string) {
  return request<{ ok: boolean }>('/customer/billing/notifications/read', {
    method: 'POST',
    body: JSON.stringify(id ? { id } : {}),
  });
}

export function getSettings() {
  return request<{ notifyEmail: string; email: string; boundHwid: string | null }>(
    '/owner/settings',
  );
}

export function saveNotificationEmail(notifyEmail: string) {
  return request<{ notifyEmail: string }>('/owner/settings', {
    method: 'PATCH',
    body: JSON.stringify({ notifyEmail }),
  });
}

export function vapidPublicKey() {
  return request<{ publicKey: string | null }>('/owner/vapid-public-key');
}

export function pushSubscribe(subscription: PushSubscriptionJSON) {
  return request<{ ok: boolean }>('/owner/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.keys }),
  });
}

export type WhatsappConfig = {
  enabled: boolean;
  recipientPhone: string;
  adminName: string;
  messageTemplate: string;
  waStatus: string;
  waUser: string | null;
  runtime: {
    status: string;
    qrDataUrl: string | null;
    lastError: string | null;
  };
};

export function getWhatsapp() {
  return request<WhatsappConfig>('/owner/whatsapp');
}

export function saveWhatsapp(input: {
  enabled: boolean;
  recipientPhone: string;
  adminName: string;
  messageTemplate: string;
}) {
  return request<WhatsappConfig>('/owner/whatsapp', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function connectWhatsapp() {
  return request<{
    status: string;
    qrDataUrl: string | null;
    waUser: string | null;
    lastError: string | null;
  }>('/owner/whatsapp/connect', { method: 'POST' });
}

export function whatsappStatus() {
  return request<{
    status: string;
    qrDataUrl: string | null;
    waUser: string | null;
    lastError: string | null;
  }>('/owner/whatsapp/status');
}

export function disconnectWhatsapp() {
  return request<{ ok: boolean }>('/owner/whatsapp/disconnect', { method: 'POST' });
}

export function testWhatsapp(phone?: string) {
  return request<{ ok: boolean; phone?: string }>('/owner/whatsapp/test', {
    method: 'POST',
    body: JSON.stringify(phone ? { phone } : {}),
  });
}

export type ChatMessage = {
  id: string;
  role: 'user' | 'bot' | 'system';
  body: string;
  clientMessageId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

export type ChatQuickAction = { label: string; text: string };

export type ChatPayload = {
  messages: ChatMessage[];
  quickActions: ChatQuickAction[];
  diagnostics: {
    liveDatabase: boolean;
    deviceRegistered: boolean;
    deviceOnline: boolean;
    deviceLastSeenAt: string | null;
    botEnabled: boolean;
  };
};

export function botChat(after?: string | null) {
  const query = after ? `?after=${encodeURIComponent(after)}` : '';
  return request<ChatPayload>(`/owner/bot/chat${query}`);
}

export function botMessage(text: string, clientMessageId?: string) {
  return request<{
    ok: boolean;
    userMessage: ChatMessage;
    botMessages: ChatMessage[];
  }>('/owner/bot/message', {
    method: 'POST',
    body: JSON.stringify({ text, clientMessageId }),
  });
}

export type SupportUpload = {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
  status: string;
  expiresAt: string;
  createdAt: string;
};

export function supportUploads() {
  return request<{ uploads: SupportUpload[] }>('/customer/support/uploads');
}

export function deleteSupportUpload(id: string) {
  return request<{ ok: boolean }>(`/customer/support/uploads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function uploadSupportFile(
  file: File,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<SupportUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/customer/support/upload`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('accept', 'application/json');
    if (csrfToken) xhr.setRequestHeader('x-csrf-token', csrfToken);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      const response = new Response(xhr.responseText, {
        status: xhr.status,
        headers: { 'content-type': xhr.getResponseHeader('content-type') ?? 'application/json' },
      });
      void parseResponse<{ upload: SupportUpload }>(response)
        .then((payload) => resolve(payload.upload))
        .catch(reject);
    });
    xhr.addEventListener('error', () =>
      reject(new ApiError('Fayl yüklənmədi. İnternet bağlantısını yoxlayın.', 0)),
    );
    xhr.addEventListener('abort', () => reject(new DOMException('Upload canceled', 'AbortError')));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export function formatMoney(minor = 0): string {
  const amount = Math.abs(Math.trunc(minor));
  if(!Number.isFinite(amount))return '—';
  const manat = String(Math.floor(amount / 100)).replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0');
  const qepik = String(amount % 100).padStart(2, '0');
  return `${minor < 0 ? '-' : ''}${manat},${qepik} ₼`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Live support chat.
//
// The endpoints existed on the API from the start but nothing ever called them,
// so a paying customer had no way to reach support beyond a WhatsApp deep link
// that produced no ticket and no record.
// ---------------------------------------------------------------------------

export type SupportMessage = {
  id: string;
  ticketId: string;
  authorKind: 'customer' | 'admin' | 'system';
  body: string;
  meta?: { attachment?: { id?: string; fileName?: string; mimeType?: string } };
  createdAt: string;
};

export type SupportTicketInfo = {
  id: string;
  status: string;
  subject: string | null;
  claimedAt: string | null;
  lastMessageAt: string;
};

export type SupportThread = {
  ticket: SupportTicketInfo | null;
  messages: SupportMessage[];
};

export function supportThread() {
  return request<SupportThread>('/customer/support/active');
}

/** Opens a ticket, or appends to the one already open. */
export function supportRequest(message: string) {
  return request<{ ticket: SupportTicketInfo; message: SupportMessage }>(
    '/customer/support/request',
    { method: 'POST', body: JSON.stringify({ message }) },
  );
}

export function supportReply(ticketId: string, body: string) {
  return request<SupportMessage>(`/customer/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function supportAttach(ticketId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<{ message: SupportMessage | null }>(`/customer/support/tickets/${ticketId}/attachments`, {
    method: 'POST',
    body: form,
  });
}

export type RolePolicyRole = { name: string; permissions: string[] };
export type RolePolicy = {
  roles: RolePolicyRole[];
  version: number;
  updatedAt: string | null;
  updatedByKind: 'customer' | 'admin' | null;
};

export type PosProduct = OwnerProduct;

/**
 * Staff roles and permissions the tills pull on their heartbeat.
 *
 * Per product: the two tills check different permission vocabularies, so one
 * policy cannot serve both.
 */
export function getRolePolicy(product: PosProduct = 'restaurant') {
  return request<RolePolicy>(`/customer/pos/roles?product=${product}`);
}

export function saveRolePolicy(roles: RolePolicyRole[], product: PosProduct = 'restaurant') {
  return request<RolePolicy>(`/customer/pos/roles?product=${product}`, {
    method: 'PUT',
    body: JSON.stringify({ roles }),
  });
}

export type InventoryProduct = 'market' | 'restaurant';

export type InventoryLine = {
  id: string;
  name: string;
  barcode: string;
  group: string;
  unit: string;
  salePrice: number;
  costPrice: number;
  warehouseId: string;
  warehouseName: string;
  qty: number;
  minQty: number;
  deviceId?: string;
  deviceName?: string;
};

export type InventoryWarehouse = { id: string; name: string; kind: string; active: boolean; deviceId?: string; deviceName?: string };
export type InventoryMenuItem = { id: string; name: string; categoryId: string; salePrice: number; sku: string; station: string; active: boolean; deviceId?: string; deviceName?: string };
export type InventoryMenuCategory = { id: string; name: string; active: boolean; deviceId?: string; deviceName?: string };

export type InventoryCommandStatus = {
  id: string; kind: string; status: 'pending' | 'applied' | 'rejected';
  error_reason: string | null; created_at: string; settled_at: string | null;
  target_device_id: string | null;
  body: Record<string, unknown>;
};

export function inventoryCommands(product: InventoryProduct, area = 'anbar') {
  return request<{ commands: InventoryCommandStatus[] }>(
    `/owner/inventory/commands?product=${product}&area=${encodeURIComponent(area)}`,
  );
}

export type TillBooks = {
  sales?: Array<{ id: string; no: string; total: number; at: number; refunded: boolean }>;
  orders?: Array<{ id: string; label: string; at: number; lines: number }>;
  points?: Array<{ id: string; name: string; status: string }>;
  products?: Array<{ id: string; name: string; qty: number; price: number }>;
  customers?: Array<{ id: string; name: string; debtMinor?: number }>;
  suppliers?: Array<{ id: string; name: string; status?: string; lines?: number; dueMinor?: number }>;
  purchases?: Array<{ id: string; number: string; supplierName: string; warehouseId: string; status: string; totalMinor: number; dueMinor?: number; createdAt: number }>;
  cashMovements?: Array<{ id: string; kind: string; amountMinor: number; reason: string; createdAt: number }>;
  payments?: Array<{ id: string; partyType: 'customer' | 'supplier'; partyId: string; partyName: string; amountMinor: number; note: string; createdAt: number }>;
  daily?: { sales: number; cash: number; card: number; count: number; profit: number };
  turnover?: Array<{ name: string; qty: number; total: number }>;
};

export type TillBookDevice = { deviceId: string; deviceName: string; updatedAt: string | null; books: TillBooks | null };

export function tillBooks(area: string) {
  return request<{
    market: { updatedAt: string | null; books: TillBooks | null; devices: TillBookDevice[] };
    restaurant: { updatedAt: string | null; books: TillBooks | null; devices: TillBookDevice[] };
  }>(`/owner/books?area=${encodeURIComponent(area)}`);
}

export function customerAccess() {
  return request<{ portal: string[] | null }>('/customer/access');
}

export function inventoryAccess() {
  return request<{ products: InventoryProduct[]; catalogProducts: InventoryProduct[]; cost: Record<InventoryProduct, boolean> }>(
    '/owner/inventory/access',
  );
}

export function inventorySnapshot(product: InventoryProduct, area = 'anbar') {
  return request<{
    product: InventoryProduct;
    showCost: boolean;
    updatedAt: string | null;
    snapshot: { warehouses?: InventoryWarehouse[]; lines?: InventoryLine[]; menu?: InventoryMenuItem[]; categories?: InventoryMenuCategory[] };
    problems: string[];
  }>(`/owner/inventory?product=${product}&area=${encodeURIComponent(area)}`);
}

export function inventoryCommand(product: InventoryProduct, kind: string, body: Record<string, unknown>) {
  return request<{ ok: boolean; id: string | null }>('/owner/inventory/commands', {
    method: 'POST',
    body: JSON.stringify({ product, kind, body }),
  });
}


export function posPortfolio(){return request<{devices:Array<{deviceId:string;branchId:string|null;hostname:string|null;product:OwnerProduct}>}>('/customer/pos-portfolio');}

export type WarehouseBranch={deviceId:string;branchId:string|null;name:string;terminalName:string;product:OwnerProduct;nativeProduct:'market'|'restaurant';online:boolean;supported:boolean;version:string;lastSeenAt:string|null;updatedAt:string|null;cached?:boolean;cachedAt?:string|null};
export type WarehouseBranches={serverTime:number;onlineTimeoutMs:number;branches:WarehouseBranch[];readOnly:boolean;areas:string[]|null};
export type WarehouseCall={method:string;payload?:Record<string,unknown>;idempotencyKey?:string};
export type WarehouseResult={success:boolean;data:any;error?:{code?:string;message:string}|null};
export function warehouseBranches(){const now=new Date(),y=now.getFullYear(),m=now.getMonth(),d=now.getDate(),profile={dayFrom:new Date(y,m,d).getTime(),dayTo:new Date(y,m,d+1).getTime(),month:y+'-'+String(m+1).padStart(2,'0'),monthFrom:new Date(y,m,1).getTime(),monthTo:new Date(y,m+1,1).getTime()};return request<WarehouseBranches>('/customer/warehouse/branches?'+new URLSearchParams(Object.entries(profile).map(([key,value])=>[key,String(value)])));}
export function warehouseBatch(deviceId:string,requestId:string,calls:WarehouseCall[],defer=false,fresh=false){return request<{results:WarehouseResult[];deviceId:string;requestId:string;queued?:boolean;status?:string;cached?:boolean;cachedAt?:string}>('/customer/warehouse/rpc',{method:'POST',body:JSON.stringify({deviceId,requestId,calls,defer,fresh})});}

export type InsightSnapshot={updatedAt:string;salesMinor:number;count:number|null;cashMinor:number|null;cardMinor:number|null;openRegisters?:number;openTables:number|null;topProducts:Array<{name:string;quantity:number;revenueMinor:number}>};
export type InsightBranch=WarehouseBranch&{snapshot:InsightSnapshot|null};
export type PortalInsights={product:OwnerProduct;serverTime:number;branches:InsightBranch[]};
export function customerInsights(product:OwnerProduct){return request<PortalInsights>('/customer/insights?product='+encodeURIComponent(product));}
export function customerLiveInsights(deviceId:string,product:OwnerProduct){return request<{results:WarehouseResult[]}>('/customer/insights/live',{method:'POST',body:JSON.stringify({deviceId,product})});}

export type WarehousePending={requestId:string;deviceId:string;status:'queued'|'processing'|'applied'|'failed'|'uncertain'|'conflict'|'cancelled';error:string|null;createdAt:string;updatedAt:string;label:string;methods:string[];adjustments:Array<{ingredientId:string;warehouseId:string;qtyDeltaMilli:number}>};
export function warehousePending(){return request<{operations:WarehousePending[]}>('/customer/warehouse/pending');}
export function cancelWarehousePending(id:string){return request<{ok:true}>('/customer/warehouse/pending/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:'{}'});}

export type WarehouseStockRow=InventoryLine&{branchId:string|null;sku:string;qtyMilli:number;salePriceMinor:number|null;costMinor:number|null;updatedAt:string};
export type WarehouseStock={rows:WarehouseStockRow[];warehouses:Array<{deviceId:string;branchId:string|null;id:string;name:string;updatedAt?:string|null}>;errors:Array<{deviceId:string;warehouseId?:string;message:string;denied?:boolean}>};
export function warehouseStock(product:OwnerProduct,device='all'){return request<WarehouseStock>('/customer/warehouse/stock?'+new URLSearchParams({product,device}));}
export type WarehouseDocument={id:string;nativeId:string;deviceId:string;branchName:string;source:string;createdAt:string;updatedAt:string;data:any};
export function warehouseDocuments(product:OwnerProduct,device='all',source='',cursor='',after=''){return request<{documents:WarehouseDocument[];errors:any[];hasMore:boolean;nextCursor:{at:string;after:string}|null}>('/customer/warehouse/documents?'+new URLSearchParams({product,device,source,cursor,after,limit:'500'}));}
export function warehouseReceive(body:{deviceId:string;requestId:string;supplierId:string;warehouseId:string;note:string;reference:string;lines:Array<{ingredientId:string;qtyMilli:number;unitCostMinor:number}>}){return request<{requestId:string;queued:boolean;status:string;result?:any}>('/customer/warehouse/receipts',{method:'POST',body:JSON.stringify(body)});}


// Platform billing is independent of the till's cash accounts.
export function billingRequest<T>(path:string,init:RequestInit={}){return request<T>('/customer/billing'+path,init);}
