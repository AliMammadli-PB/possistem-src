/**
 * Stands in for Electron main when the till's own screens run inside the
 * possistem.az customer portal (Restoran idarəetməsi, 1.8.0).
 *
 * The till's preload (inlined below at build time) talks to a fake
 * ipcRenderer. Core calls are batched and sent to /pos/api/customer/pos/rpc;
 * the API hands them to the restaurant's till as one signed command and the
 * till answers as its administrator. What is added, changed or deleted here
 * happens on the till. Only the Əməliyyatlar screens are reachable.
 */
const API = '/pos/api';
const params = new URLSearchParams(location.search);
const DEVICE = params.get('device') || '';

/** The same list the API and the till enforce; anything else is answered here. */
const REMOTE = new Set(__REMOTE_METHODS__);

const listeners = new Map();
const emit = (channel, payload) => {
  for (const cb of listeners.get(channel) ?? []) {
    try { cb({}, payload); } catch (err) { console.error(err); }
  }
};
const ok = (data) => ({ success: true, data, error: null });
const fail = (code, message) => ({ success: false, data: null, error: { code, message, retryable: false } });

// ---------------------------------------------------------- portal session
let csrf = '';
async function portalSession() {
  const res = await fetch(`${API}/customer-auth/me`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.authenticated === false) throw new Error('Sayta yenidən daxil olun');
  csrf = body.csrfToken || '';
  return body;
}

// ------------------------------------------------------------ batched RPC
let queue = [];
let timer = null;
function flush() {
  timer = null;
  const batch = queue.splice(0, 16);
  if (queue.length) timer = setTimeout(flush, 0);
  if (!batch.length) return;
  void (async () => {
    try {
      const res = await fetch(`${API}/customer/pos/rpc`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          ...(DEVICE ? { deviceId: DEVICE } : {}),
          calls: batch.map((c) => ({ method: c.method, payload: c.payload, ...(c.key ? { idempotencyKey: c.key } : {}) })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 401) window.parent?.postMessage({ type: 'ps-portal-unauthorized' }, location.origin);
      if (!res.ok || !body || !Array.isArray(body.results)) {
        const message = (body && body.error) || `Kassa ilə əlaqə alınmadı (${res.status})`;
        for (const c of batch) c.resolve(fail(res.status === 504 ? 'E_TILL_OFFLINE' : 'E_PORTAL', message));
        if (res.status === 504) setBanner(message);
        return;
      }
      setBanner('');
      batch.forEach((c, i) => c.resolve(body.results[i] ?? fail('E_PORTAL', 'Cavab gəlmədi')));
    } catch {
      for (const c of batch) c.resolve(fail('E_NETWORK', 'İnternet bağlantısı yoxdur'));
    }
  })();
}
function rpc(method, payload, key) {
  return new Promise((resolve) => {
    queue.push({ method, payload: payload ?? {}, key, resolve });
    if (queue.length >= 16) { clearTimeout(timer); flush(); } else if (!timer) timer = setTimeout(flush, 25);
  });
}

// ------------------------------------------------------------- the shell
let session = null;
const now = Date.now();
const LICENSE = {
  branchId: 'portal', channel: 'stable', controlUrl: `${location.origin}${API}`, customerId: 'portal', deviceId: DEVICE || 'portal',
  expiresAt: now + 365 * 864e5, features: { backup: true, catalog: true, gifts: true, pos: true, reports: true },
  graceStartedAt: null, installationId: 'portal', keyId: 'portal', lastHeartbeatAt: now, lastValidatedAt: now,
  legacyGraceDays: 60, licenseId: 'portal', offlineGraceDays: 30, startsAt: now, status: 'active', updatedAt: now, upgradeFromLegacy: false,
};
let coreStatus = { state: 'starting', seq: 1, attempt: 0, pid: 1, corePath: 'portal', coreVersion: '', lastExitCode: null,
  lastError: null, sinceMs: 0, stage: { key: 'db.open', message: 'Kassaya qoşulur…', progress: 30 }, busy: null };

function setBanner(text) {
  const el = document.getElementById('ps-portal-banner');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

const ready = (async () => {
  try {
    await portalSession();
    const res = await rpc('__session', {});
    if (!res.success) throw new Error(res.error?.message || 'Kassa cavab vermədi');
    session = res.data;
    coreStatus = { ...coreStatus, state: 'ready', seq: 2, coreVersion: '__APP_VERSION__', stage: { key: 'ready', message: 'Hazırdır', progress: 100 } };
  } catch (err) {
    const message = String(err?.message ?? err);
    coreStatus = { ...coreStatus, state: 'crash_loop', lastError: { message } };
    setBanner(message);
  }
  emit('pos:coreStatus', coreStatus);
  emit('pos:session:changed', session);
})();

/** Only the Əməliyyatlar screens: everything else leads back to them. */
function guardRoute() {
  if (!location.hash.startsWith('#/operations')) {
    const tab = params.get('tab');
    location.replace(`${location.pathname}${location.search}#/operations${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`);
  }
}
guardRoute();
window.addEventListener('hashchange', guardRoute);
window.__psPortalMode = true;
document.documentElement.classList.add('ps-portal');
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    .ps-portal .ps-shell > .flex > aside { display: none !important; }
    #ps-portal-banner { position: fixed; z-index: 9999; left: 50%; top: 10px; transform: translateX(-50%); max-width: 90vw;
      padding: 8px 14px; border-radius: 10px; background: #fff4e0; color: #92400e; border: 1px solid #f5d29a; font: 600 13px system-ui; }`;
  document.head.appendChild(style);
  const banner = document.createElement('div');
  banner.id = 'ps-portal-banner';
  banner.hidden = true;
  document.body.appendChild(banner);
});

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'fayl';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function invoke({ method, payload, options }) {
  await ready;
  const body = payload ?? {};
  switch (method) {
    case '__app.info':
      return ok({ version: '__APP_VERSION__', electron: '', chrome: '', node: '', platform: 'web', isDev: false, dbPath: '', logDir: '', corePath: '' });
    case 'license.status':
    case 'license.heartbeat':
    case 'license.lookup':
      return ok(LICENSE);
    case 'tenant.status':
      return ok({ authenticated: true, email: '', customerId: 'portal', customerName: '', expiresAt: now + 365 * 864e5, paymentUrl: null, licenses: [] });
    case 'auth.login':
      return session ? ok({ session }) : fail('E_PORTAL', 'Kassa qoşulmayıb');
    case 'auth.logout':
      return ok(null);
    case 'files.saveText':
      download(body.filename, new Blob([body.text ?? ''], { type: 'text/plain;charset=utf-8' }));
      return ok({ path: body.filename });
    case 'files.savePdf': {
      const w = window.open('', '_blank');
      if (w) { w.document.write(body.html ?? ''); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
      return ok({ path: body.filename });
    }
    default:
      break;
  }
  if (!REMOTE.has(method)) return fail('E_PORTAL', 'Bu əməliyyat yalnız kassada edilir');
  return rpc(method, body, options?.idempotencyKey);
}

const DISPLAY = { prefs: { mode: 'fullscreen', width: 1280, height: 800, zoomFactor: 1 }, presets: [], screen: { width: 1280, height: 800 } };

const ipcRenderer = {
  async invoke(channel, arg) {
    switch (channel) {
      case 'pos:invoke':
        return invoke(arg ?? {});
      case 'pos:coreStatus:get':
        await ready;
        return coreStatus;
      case 'pos:session:get':
        await ready;
        return session;
      case 'pos:display:get':
        return ok(DISPLAY);
      case 'pos:display:set':
        return ok({ ...DISPLAY.prefs, ...(arg ?? {}) });
      case 'pos:update:status':
      case 'pos:update:check':
      case 'pos:update:install':
        return { state: 'not_configured', reason: 'Portal' };
      case 'pos:openExternal':
        if (typeof arg === 'string' && /^https:\/\/possistem\.az\//i.test(arg)) window.open(arg, '_blank', 'noopener');
        return ok(null);
      default:
        return fail('E_PORTAL', 'Bu əməliyyat yalnız kassada edilir');
    }
  },
  on(channel, listener) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(listener);
  },
  removeListener(channel, listener) {
    listeners.get(channel)?.delete(listener);
  },
};

const electron = {
  ipcRenderer,
  contextBridge: { exposeInMainWorld(name, api) { window[name] = api; } },
};

(function (require) {
/*PRELOAD*/
})(() => electron);
