/**
 * Stands in for Electron main in the possistem.az live demo.
 *
 * The till's own preload (inlined below at build time) talks to a fake
 * ipcRenderer; requests go to the real core compiled to WebAssembly, which
 * holds its database in memory. Only what Electron main does itself is
 * answered here: licence and tenant status, the session mirror, core status,
 * and the few desktop-only features the demo cannot offer.
 */
import createCore from './restaurant-pos-core.mjs';
import { seedDemo } from './seed.js';

/** Passes a string through the heap: ccall's 'string' goes on the 2 MB stack, and a catalogue import does not fit. */
function callWithString(module, fn, text) {
  const size = module.lengthBytesUTF8(text) + 1;
  const ptr = module._malloc(size);
  try {
    module.stringToUTF8(text, ptr, size);
    return module.UTF8ToString(module[`_${fn}`](ptr));
  } finally {
    module._free(ptr);
  }
}

const listeners = new Map();
const emit = (channel, payload) => {
  for (const cb of listeners.get(channel) ?? []) {
    try {
      cb({}, payload);
    } catch (err) {
      console.error(err);
    }
  }
};

const ok = (data) => ({ success: true, data, error: null });
const fail = (code, message) => ({ success: false, data: null, error: { code, message, retryable: false } });
const NOT_IN_DEMO = () => fail('E_DEMO', 'Demo versiyada bu funksiya işləmir');

const now = Date.now();
const LICENSE = {
  branchId: 'demo', channel: 'stable', controlUrl: 'https://possistem.az/pos/api', customerId: 'demo',
  deviceId: 'demo', expiresAt: now + 365 * 864e5,
  features: { backup: true, catalog: true, gifts: true, pos: true, reports: true },
  graceStartedAt: null, installationId: 'demo', keyId: 'demo', lastHeartbeatAt: now, lastValidatedAt: now,
  legacyGraceDays: 60, licenseId: 'demo', offlineGraceDays: 30, startsAt: now, status: 'active', updatedAt: now,
  upgradeFromLegacy: false,
};
const TENANT = {
  authenticated: true, email: 'demo@possistem.az', customerId: 'demo', customerName: 'Demo Restoran',
  expiresAt: now + 365 * 864e5, paymentUrl: null, licenses: [],
};

let coreStatus = { state: 'starting', seq: 1, attempt: 0, pid: 1, corePath: 'wasm', coreVersion: '', lastExitCode: null,
  lastError: null, sinceMs: 0, stage: { key: 'db.open', message: 'Connecting to local database…', progress: 20 }, busy: null };
let session = null;
let core = null;
let seq = 0;
let requestNo = 0;

function takeFrames(text) {
  let response = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const frame = JSON.parse(line);
    if (frame.type === 'event') emit('pos:coreEvent', { event: frame.event, payload: frame.payload, timestamp: frame.timestamp, seq: ++seq });
    else response = frame;
  }
  return response;
}

function coreCall(method, payload = {}, options = {}) {
  const frame = {
    requestId: `demo-${++requestNo}`,
    method,
    protocolVersion: 1,
    timestamp: Date.now(),
    payload: options.idempotencyKey ? { ...payload, idempotencyKey: options.idempotencyKey } : payload,
  };
  const res = takeFrames(callWithString(core, 'pos_call', JSON.stringify(frame)));
  if (!res) return fail('E_INTERNAL', 'Core did not answer');
  return { success: res.success, data: res.data, error: res.error };
}

const ready = (async () => {
  const module = await createCore({ print: () => {}, printErr: () => {} });
  module.FS.mkdirTree('/data');
  core = module;
  takeFrames(module.ccall('pos_boot', 'string', ['string'], ['/data/pos.db']));
  await seedDemo(async (method, payload) => coreCall(method, payload));
  // The site's deep links (?signedIn=1#/admin/...) open a screen already signed in.
  if (new URLSearchParams(location.search).get('signedIn') === '1') {
    const login = coreCall('auth.login', { userId: '', pin: '1234' });
    if (login.success) session = login.data.session;
  }
  coreStatus = { ...coreStatus, state: 'ready', seq: 2, coreVersion: '1.7.8', stage: { key: 'ready', message: 'System ready', progress: 100 } };
  emit('pos:coreStatus', coreStatus);
})();
ready.catch((err) => {
  console.error('[demo] core failed to start', err);
  coreStatus = { ...coreStatus, state: 'crash_loop', lastError: { message: String(err?.message ?? err) } };
  emit('pos:coreStatus', coreStatus);
});

function setSession(next) {
  session = next;
  emit('pos:session:changed', session);
}

async function invoke({ method, payload, options }) {
  await ready;
  const body = payload ?? {};
  switch (method) {
    case '__app.info':
      return ok({ version: '1.7.8', electron: '', chrome: '', node: '', platform: 'win32', isDev: false, dbPath: '', logDir: '', corePath: '' });
    case 'license.status':
    case 'license.heartbeat':
    case 'license.lookup':
    case 'license.activate':
    case 'license.importOffline':
      return ok(LICENSE);
    case 'license.exportOfflineRequest':
    case 'tenant.login':
    case 'tenant.logout':
    case 'tenant.openPaymentUrl':
    case 'support.request':
    case 'support.active':
    case 'support.send':
    case 'users.changePin':
    case 'files.saveText':
    case 'files.savePdf':
      return NOT_IN_DEMO();
    case 'tenant.status':
      return ok(TENANT);
    default:
      if (method.startsWith('whatsapp.')) return NOT_IN_DEMO();
  }
  const res = coreCall(method, body, options ?? {});
  if ((method === 'auth.login' || method === 'roles.applyPolicy') && res.success && res.data?.session) {
    setSession(res.data.session);
  } else if (method === 'auth.logout') {
    setSession(null);
  }
  return res;
}

const DISPLAY = { prefs: { mode: 'fullscreen', width: 1280, height: 800, zoomFactor: 1 }, presets: [], screen: { width: 1280, height: 800 } };

const ipcRenderer = {
  async invoke(channel, arg) {
    switch (channel) {
      case 'pos:invoke':
        return invoke(arg ?? {});
      case 'pos:coreStatus:get':
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
        return { state: 'not_configured', reason: 'Demo' };
      case 'pos:openExternal':
        if (typeof arg === 'string' && /^https:\/\/possistem\.az\//i.test(arg)) window.open(arg, '_blank', 'noopener');
        return ok(null);
      case 'pos:catalog:image:pick':
        return NOT_IN_DEMO();
      default:
        return ok(null);
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
  contextBridge: {
    exposeInMainWorld(name, api) {
      window[name] = api;
    },
  },
};

(function (require) {
/*PRELOAD*/
})(() => electron);
