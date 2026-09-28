/**
 * Stands in for Electron main in the possistem.az live demo of Aptek POS.
 *
 * The till's own preload (inlined below at build time) talks to a fake
 * ipcRenderer. Core calls go to the real market core compiled to WebAssembly,
 * through the same authorizeCorePayload main uses, so roles and manager
 * approvals are decided exactly as on a till. Staff sign-in, licence and
 * tenant state live here in memory; desktop-only features answer "not in demo".
 */
import createCore from './aptek-pos-core.mjs';
import { demoCatalog, demoShelves } from './seed.js';

// electron/core-payload.cjs, inlined at build time
const { authorizeCorePayload } = (function () {
  const module = { exports: {} };
  /*CORE_PAYLOAD*/
  return module.exports;
})();

const DEMO_PINS = { 'u-manager': '1234', 'u-head': '4444', 'u-cashier': '2222', 'u-warehouse': '3333' };
let staff = [
  { id: 'u-manager', name: 'Aptek POS Müdir', role: 'manager', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'] },
  { id: 'u-head', name: 'Aptek POS Baş kassir', role: 'head_cashier', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-sales'] },
  { id: 'u-cashier', name: 'Aptek POS Kassir', role: 'cashier', active: true, registerIds: ['reg-2'], warehouseIds: ['wh-sales'] },
  { id: 'u-warehouse', name: 'Aptek POS Anbar', role: 'warehouse', active: true, registerIds: [], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'] },
].map((row) => ({ ...row, pin: DEMO_PINS[row.id] }));

const publicStaff = ({ pin, ...profile }) => ({ ...profile, mustChangePin: false });
const now = Date.now();
const ACTIVATION = {
  mode: 'active', customerName: 'Demo Aptek', customerId: 'demo', deviceId: 'demo', serverDeviceId: 'demo',
  createdAt: now, validUntil: now + 365 * 864e5, controlUrl: 'https://possistem.az/pos/api',
};
const TENANT = {
  authenticated: true, email: 'demo@possistem.az', customerId: 'demo', customerName: 'Demo Aptek',
  expiresAt: now + 365 * 864e5, paymentUrl: null, licenses: [],
};
const NOT_IN_DEMO = 'Demo versiyada bu funksiya işləmir';

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

let core = null;
let requestNo = 0;
const sessions = new Map();
let currentToken = '';

// The demo database starts empty on every visit, so the till's "catalogue
// already imported" flags from an earlier visit must not survive it.
try {
  localStorage.removeItem('possistem.aptek.pos.core-migrated');
  localStorage.removeItem('possistem.aptek.pos.catalog-sync');
} catch {
  /* storage blocked: nothing was remembered either */
}

const ready = (async () => {
  const module = await createCore({ print: () => {}, printErr: () => {} });
  module.FS.mkdirTree('/data');
  const error = module.ccall('market_boot', 'string', ['string'], ['/data/market.db']);
  if (error) throw new Error(error);
  core = module;
  emit('market:coreStatus', { state: 'ready', dbPath: 'demo' });
})();
ready.catch((err) => console.error('[demo] market core failed to start', err));

function coreInvoke(method, payload) {
  const frame = { requestId: `demo-${++requestNo}`, method, protocolVersion: 1, timestamp: Date.now(), payload: payload ?? {} };
  const out = callWithString(core, 'market_call', JSON.stringify(frame));
  let response = null;
  for (const line of out.split('\n')) {
    if (!line) continue;
    const doc = JSON.parse(line);
    if (doc.type === 'event') emit('market:coreEvent', doc);
    else response = doc;
  }
  return response ? { success: response.success, data: response.data, error: response.error } : { success: false, data: null, error: { code: 'E_INTERNAL', message: 'Core did not answer', retryable: false } };
}

function requireSession(token, roles) {
  const userId = sessions.get(String(token || ''));
  if (!userId) throw new Error('Sessiya bitib');
  const user = staff.find((row) => row.id === userId && row.active);
  if (!user) throw new Error('İstifadəçi aktiv deyil');
  if (roles && !roles.includes(user.role)) throw new Error('Buna icazəniz yoxdur');
  return user;
}

function verifyManagerPin(pin) {
  const user = staff.find((row) => row.active && ['manager', 'head_cashier'].includes(row.role) && row.pin === String(pin));
  return user ? { ok: true, approverId: user.id } : { ok: false };
}

const PIN_TAKEN = 'Bu PIN artıq başqa işçidə var - başqa PIN seçin';
const pinTaken = (pin, exceptId) => staff.some((row) => row.id !== exceptId && row.active && row.pin === pin);

function assertAcceptablePin(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN 4-8 rəqəm olmalıdır');
}

async function requireCorePermission(token, permission) {
  const user = requireSession(token);
  const result = coreInvoke('auth.checkPermission', { actorId: user.id, role: user.role, permission });
  if (!result?.success || !result?.data?.allowed) throw new Error('Buna icazəniz yoxdur');
  return user;
}

const handlers = {
  'market:staff:list': () => staff.map(publicStaff),
  'market:auth:login': (input) => {
    // No userId: the PIN alone names the person, exactly as main.cjs does.
    const pin = String(input?.pin || '');
    const user = input?.userId
      ? staff.find((row) => row.id === String(input.userId) && row.active && row.pin === pin)
      : staff.find((row) => row.active && row.pin === pin);
    if (!user) throw new Error('Giriş kodu yanlışdır');
    const token = crypto.randomUUID();
    sessions.set(token, user.id);
    currentToken = token;
    return { ...publicStaff(user), sessionToken: token };
  },
  'market:auth:logout': (token) => {
    sessions.delete(String(token));
    if (currentToken === String(token)) currentToken = '';
    return true;
  },
  'market:auth:changePin': (input) => {
    const user = requireSession(input?.sessionToken);
    const pin = String(input?.newPin || '');
    assertAcceptablePin(pin);
    if (pinTaken(pin, user.id)) throw new Error(PIN_TAKEN);
    staff = staff.map((row) => (row.id === user.id ? { ...row, pin } : row));
    return publicStaff({ ...user, pin });
  },
  // The site's deep links (?signedIn=1) open the till already signed in as the manager.
  'market:auth:current': () => {
    if (new URLSearchParams(location.search).get('signedIn') !== '1' || currentToken) return null;
    return handlers['market:auth:login']({ userId: 'u-manager', pin: DEMO_PINS['u-manager'] });
  },
  'market:staff:save': (input) => {
    requireSession(input?.sessionToken, ['manager']);
    const profile = input?.profile || {};
    if (!profile.name || !['manager', 'head_cashier', 'cashier', 'warehouse'].includes(profile.role)) throw new Error('İşçi məlumatı düzgün deyil');
    const existing = staff.find((row) => row.id === profile.id);
    const pin = String(input?.pin || '');
    if (!existing || pin) assertAcceptablePin(pin);
    if (pin && pinTaken(pin, existing?.id)) throw new Error(PIN_TAKEN);
    const next = {
      id: existing?.id || `u-${Date.now()}`, name: String(profile.name).slice(0, 80), role: profile.role, active: profile.active !== false,
      registerIds: Array.isArray(profile.registerIds) ? profile.registerIds : [], warehouseIds: Array.isArray(profile.warehouseIds) ? profile.warehouseIds : [],
      pin: pin || existing.pin,
    };
    staff = existing ? staff.map((row) => (row.id === existing.id ? next : row)) : [...staff, next];
    return publicStaff(next);
  },
  'market:tenant:status': () => TENANT,
  'market:tenant:login': () => { throw new Error(NOT_IN_DEMO); },
  'market:tenant:logout': () => { throw new Error(NOT_IN_DEMO); },
  'market:activation:status': () => ACTIVATION,
  'market:activation:refresh': () => ACTIVATION,
  'market:activation:activate': () => ACTIVATION,
  'market:display:get': () => ({ prefs: { mode: 'fullscreen', width: 1280, height: 800, zoomFactor: 1 }, presets: [] }),
  'market:display:set': (input) => ({ mode: 'fullscreen', width: 1280, height: 800, zoomFactor: 1, ...(input ?? {}) }),
  'market:display:toggle': () => ({ mode: 'fullscreen' }),
  'market:image:pick': () => { throw new Error(NOT_IN_DEMO); },
  'market:update:status': () => ({ state: 'idle', message: 'Demo' }),
  'market:update:check': () => ({ state: 'idle', message: 'Demo' }),
  'market:update:install': () => { throw new Error(NOT_IN_DEMO); },
  'market:app:info': () => ({ version: '__APP_VERSION__', updateUrl: '', controlUrl: 'https://possistem.az/pos/api', packaged: true }),
  'market:backup:status': () => ({ configured: false, directory: '', lastBackupAt: 0, retentionDays: 30 }),
  'market:backup:list': () => [],
  'market:backup:configure': () => { throw new Error(NOT_IN_DEMO); },
  'market:backup:create': () => { throw new Error(NOT_IN_DEMO); },
  'market:backup:restore': () => { throw new Error(NOT_IN_DEMO); },
  'market:sync:status': () => ({ mode: 'offline', pending: 0, peerCount: 0, vpsConnected: false }),
  'market:sync:push': () => ({ connected: false, reason: 'Demo' }),
  'market:sync:bootstrap': () => { throw new Error(NOT_IN_DEMO); },
  'market:support:request': () => { throw new Error(NOT_IN_DEMO); },
  'market:support:thread': () => ({ ok: true, ticket: null, messages: [] }),
  'market:support:download': () => { throw new Error(NOT_IN_DEMO); },
  'market:coreStatus:get': () => ({ state: core ? 'ready' : 'starting', dbPath: 'demo' }),
  'market:coreRestart': () => ({ state: 'ready' }),
  'market:invoke': (input) => {
    const method = String(input?.method || '');
    if (!method) return { success: false, error: { code: 'E_VALIDATION', message: 'method required', retryable: false } };
    const payload = authorizeCorePayload(
      input?.payload,
      () => {
        try {
          return requireSession(input?.sessionToken || currentToken);
        } catch {
          return null;
        }
      },
      (pin) => verifyManagerPin(String(pin || '')),
      input?.managerPin,
    );
    const result = coreInvoke(method, payload);
    // A till asks its first operator to name it. The demo PC is "Demo kassa", so
    // a visitor lands on the sale screen straight after the catalogue loads.
    if (method === 'state.importLegacy' && result.success && !result.data?.settings?.deviceRegisterId && payload.actorId) {
      const user = staff.find((row) => row.id === payload.actorId);
      const bound = coreInvoke('cash.bindDeviceRegister', authorizeCorePayload({ name: 'Demo kassa', operatorId: user.id, updatedAt: Date.now() }, () => user));
      // A shop's first sign-in finds its stock: the demo pharmacy goes in as the
      // medicine form would create it: each medicine, then its lots.
      for (const shelf of demoShelves()) coreInvoke('shelf.save', authorizeCorePayload(shelf, () => user));
      for (const { product, lots } of demoCatalog()) {
        coreInvoke('product.create', authorizeCorePayload({ product }, () => user));
        for (const lot of lots) coreInvoke('lot.receive', authorizeCorePayload({ productId: product.id, supplier: product.supplier, ...lot }, () => user));
      }
      if (bound.success) return coreInvoke('state.get', authorizeCorePayload({}, () => user));
    }
    return result;
  },
  // Receipts and reports go to a printer the demo does not have: report them
  // printed so the sale flow completes as it does on a till.
  'market:printer:list': () => [],
  'market:printer:health': () => ({ provider: 'core', configured: false, target: '', online: false }),
  'market:printer:receipt': (input) => { requireSession(input?.sessionToken); return { ok: true, bytes: 0 }; },
  'market:printer:report': (input) => { requireSession(input?.sessionToken); return { ok: true, bytes: 0 }; },
  'market:printer:test': () => { throw new Error(NOT_IN_DEMO); },
  'market:printer:detect': () => { throw new Error(NOT_IN_DEMO); },
  'market:printer:configure': () => { throw new Error(NOT_IN_DEMO); },
  'market:printer:setTarget': () => { throw new Error(NOT_IN_DEMO); },
  'market:printer:label': async (input) => { await requireCorePermission(input?.sessionToken, 'PRINT_LABEL'); return { ok: true, bytes: 0 }; },
  'market:drawer:open': (input) => {
    const user = requireSession(input?.sessionToken);
    const payload = authorizeCorePayload({ reason: String(input?.reason || 'manual').slice(0, 160) }, () => user, verifyManagerPin, input?.managerPin);
    const result = coreInvoke('drawer.openLogged', payload);
    if (!result || result.success !== true) throw new Error(result?.error?.message || 'Buna icazəniz yoxdur');
    return { ok: true };
  },
  'market:terminal:pay': (input) => {
    requireSession(input?.sessionToken);
    const amountMinor = Number(input?.amountMinor) || 0;
    const reference = String(input?.reference || '').slice(0, 64);
    return reference
      ? { status: 'approved', amountMinor, reference, authCode: reference.slice(0, 8), provider: 'manual' }
      : { status: 'pending_manual', amountMinor, provider: 'manual' };
  },
  'market:fiscal:processPending': () => ({ success: false, error: { code: 'FISCAL_NOT_CONFIGURED', message: 'Fiskal provayder qurulmayıb — çeklər növbədə qalır', retryable: false } }),
};

const ipcRenderer = {
  async invoke(channel, arg) {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Error invoking remote method '${channel}': Error: No handler registered`);
    await ready;
    try {
      return await handler(arg);
    } catch (err) {
      throw new Error(`Error invoking remote method '${channel}': Error: ${err?.message ?? err}`);
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
