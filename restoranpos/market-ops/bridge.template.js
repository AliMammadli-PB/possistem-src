/**
 * Stands in for Electron main when the restaurant's Əməliyyatlar screens run
 * inside Market POS (1.5.0), as an iframe of the Market window.
 *
 * The restaurant preload (inlined below at build time) talks to a fake
 * ipcRenderer; core calls go to the parent window's marketOps.invoke, where
 * Market main checks the signed-in Market user and runs them on the warehouse
 * core. Only the Əməliyyatlar screens and the receipt settings (#/settings)
 * are reachable; Kalkulyasiya and Çatdırılma are hidden (window.__psMarketMode).
 */
window.__psMarketMode = true;
const host = window.parent && window.parent !== window ? window.parent : null;
const params = new URLSearchParams(location.search);

const listeners = new Map();
const emit = (channel, payload) => {
  for (const cb of listeners.get(channel) ?? []) {
    try { cb({}, payload); } catch (err) { console.error(err); }
  }
};
const ok = (data) => ({ success: true, data, error: null });
const fail = (code, message) => ({ success: false, data: null, error: { code, message, retryable: false } });

async function call(method, payload, options) {
  if (!host?.marketOps) return fail('E_MARKET', 'Əməliyyatlar yalnız MarketPos daxilində açılır');
  try {
    const res = await host.marketOps.invoke({
      sessionToken: host.__marketOpsToken || '',
      method, payload: payload ?? {},
      idempotencyKey: options?.idempotencyKey, timeoutMs: options?.timeoutMs,
    });
    return res && typeof res === 'object' ? res : fail('E_MARKET', 'Cavab gəlmədi');
  } catch (err) {
    return fail('E_MARKET', String(err?.message ?? err).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ''));
  }
}

let session = null;
const now = Date.now();
const LICENSE = {
  branchId: 'market', channel: 'stable', controlUrl: '', customerId: 'market', deviceId: 'market',
  expiresAt: now + 365 * 864e5, features: { backup: true, catalog: true, gifts: true, pos: true, reports: true },
  graceStartedAt: null, installationId: 'market', keyId: 'market', lastHeartbeatAt: now, lastValidatedAt: now,
  legacyGraceDays: 60, licenseId: 'market', offlineGraceDays: 30, startsAt: now, status: 'active', updatedAt: now, upgradeFromLegacy: false,
};
let coreStatus = { state: 'starting', seq: 1, attempt: 0, pid: 1, corePath: 'market', coreVersion: '', lastExitCode: null,
  lastError: null, sinceMs: 0, stage: { key: 'db.open', message: 'Anbar sistemi açılır…', progress: 30 }, busy: null };

const ready = (async () => {
  try {
    const res = await call('__session', {});
    if (!res.success) throw new Error(res.error?.message || 'Anbar sistemi cavab vermədi');
    session = res.data;
    coreStatus = { ...coreStatus, state: 'ready', seq: 2, coreVersion: '__APP_VERSION__', stage: { key: 'ready', message: 'Hazırdır', progress: 100 } };
  } catch (err) {
    coreStatus = { ...coreStatus, state: 'crash_loop', lastError: { message: String(err?.message ?? err) } };
  }
  emit('pos:coreStatus', coreStatus);
  emit('pos:session:changed', session);
})();

/** Only the Əməliyyatlar screens and the receipt settings: anything else leads back. */
function guardRoute() {
  if (!location.hash.startsWith('#/operations') && !location.hash.startsWith('#/settings')) {
    const tab = params.get('tab');
    location.replace(`${location.pathname}${location.search}#/operations${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`);
  }
}
guardRoute();
window.addEventListener('hashchange', guardRoute);
document.documentElement.classList.add('ps-market-ops');
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = '.ps-market-ops .ps-shell > .flex > aside { display: none !important; }';
  document.head.appendChild(style);
});

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'fayl';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function printHtml(html) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  frame.srcdoc = html;
  frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(() => frame.remove(), 60000); } };
  document.body.appendChild(frame);
}

async function invoke({ method, payload, options }) {
  await ready;
  const body = payload ?? {};
  switch (method) {
    case '__app.info':
      return ok({ version: '__APP_VERSION__', electron: '', chrome: '', node: '', platform: 'market', isDev: false, dbPath: '', logDir: '', corePath: '' });
    case 'license.status':
    case 'license.heartbeat':
    case 'license.lookup':
      return ok(LICENSE);
    case 'tenant.status':
      return ok({ authenticated: true, email: '', customerId: 'market', customerName: '', expiresAt: now + 365 * 864e5, paymentUrl: null, licenses: [] });
    case 'auth.login':
      return session ? ok({ session }) : fail('E_MARKET', 'Anbar sistemi hazır deyil');
    case 'auth.logout':
      return ok(null);
    case 'files.saveText':
      download(body.filename, new Blob(['﻿' + (body.text ?? '')], { type: 'text/plain;charset=utf-8' }));
      return ok({ path: body.filename });
    case 'files.saveBinary': {
      const bin = atob(String(body.base64 ?? ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      download(body.filename, new Blob([bytes]));
      return ok({ path: body.filename });
    }
    case 'files.savePdf':
      printHtml(String(body.html ?? ''));
      return ok({ path: body.filename });
    default:
      return call(method, body, options);
  }
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
        return { state: 'not_configured', reason: 'Market' };
      case 'pos:openExternal':
        return ok(null);
      default:
        return fail('E_MARKET', 'Bu əməliyyat MarketPos-da yoxdur');
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
