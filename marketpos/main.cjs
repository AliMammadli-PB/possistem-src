const { authorizeCorePayload } = require('./core-payload.cjs');
const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, safeStorage, screen, session } = require('electron');
const { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, pbkdf2Sync, randomBytes, sign: signPayload, timingSafeEqual, verify: verifySignature } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } = require('node:fs');
const { hostname } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'market-pos://app/';
const UPDATE_URL = process.env.MARKET_POS_UPDATE_URL || 'https://possistem.az/marketpos/updates/';
const DEFAULT_CONTROL_API = 'https://possistem.az/pos/api';
const MARKET_INSTALLATION_ID = 'market-pos';
const MARKET_TENANT_BIND_ID = 'market-tenant-bind';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function isBlockedControlHost(hostnameValue) {
  const host = String(hostnameValue || '').toLowerCase();
  return host === '217.179.126.94'
    || host === 'offlinegame.az' || host.endsWith('.offlinegame.az')
    || host === 'cyberplus.az' || host.endsWith('.cyberplus.az');
}

function resolveControlApiBase() {
  const raw = String(process.env.MARKET_POS_CONTROL_URL || '').trim();
  if (!raw) return DEFAULT_CONTROL_API;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (isBlockedControlHost(url.hostname)) return DEFAULT_CONTROL_API;
    const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    return /\/pos\/api$/i.test(normalized) ? normalized : `${normalized}/pos/api`;
  } catch {
    return DEFAULT_CONTROL_API;
  }
}

const CONTROL_URL = resolveControlApiBase();
function controlApi(pathname) {
  const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${CONTROL_URL}${suffix}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function machineSeed() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
      const match = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
      if (match?.[1]) return sha256Hex(match[1]).slice(0, 32);
    }
  } catch { /* fall through */ }
  return sha256Hex(`${hostname()}|${app.getPath('userData')}`).slice(0, 32);
}

/** Stable HWID for MarketPos — different salt from restaurant POS on the same PC. */
function deviceFingerprint(installationId = MARKET_INSTALLATION_ID) {
  return sha256Hex([installationId || MARKET_INSTALLATION_ID, process.platform, process.arch, machineSeed()].join('|'));
}

protocol.registerSchemesAsPrivileged([{ scheme: 'market-pos', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

// Test-only CDP bridge. It is completely absent in normal launches.
if (/^\d{4,5}$/.test(process.env.MARKET_POS_AUTOMATION_PORT || '')) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', process.env.MARKET_POS_AUTOMATION_PORT);
}

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.cyberplus.market.pos');
app.setName('MarketPos');
// Isolate Market POS data from Restaurant POS (%APPDATA%/POSSISTEM/MarketPOS).
{
  const isolated = path.join(app.getPath('appData'), 'POSSISTEM', 'MarketPOS');
  mkdirSync(isolated, { recursive: true });
  app.setPath('userData', isolated);
}

const { CoreSupervisor } = require('./core-supervisor.cjs');
const coreSupervisor = new CoreSupervisor();

const DEFAULT_STAFF = [
  { id: 'u-manager', name: 'MarketPos Müdir', role: 'manager', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'], salt: '687f8fbf095f402c0f82586d918206a0', pinHash: '1f5488722c7051e86a233f77e18f5a03bc60264c78d6cf18fc47236ab8f44981' },
  { id: 'u-head', name: 'MarketPos Baş kassir', role: 'head_cashier', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-sales'], salt: 'b1d14ca3484fbedd1d01f981f54f4c74', pinHash: '6c166257c084772d8bd291a4826991f1353e9da2b6bc5082f211a4f0047ca3d8' },
  { id: 'u-cashier', name: 'MarketPos Kassir', role: 'cashier', active: true, registerIds: ['reg-2'], warehouseIds: ['wh-sales'], salt: 'fe5892f2cb48f1621663fedd138bc8ab', pinHash: '961af08c2dfe98fd30598492d03ae37f22aab332fa7481eca91cbf83adfee452' },
  { id: 'u-warehouse', name: 'MarketPos Anbar', role: 'warehouse', active: true, registerIds: [], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'], salt: '42e27db11f3ca2ef0c5a8bad872201b7', pinHash: '72dc9539944ef364c217a072f5daac8611aaec82942f9dc6ba933dbf990a5ff2' },
];
const LEGACY_STAFF_NAMES = { 'Aysel Məmmədova': 'MarketPos Müdir', 'Murad Əliyev': 'MarketPos Baş kassir', 'Nigar Kərimova': 'MarketPos Kassir', 'Elvin Qasımov': 'MarketPos Anbar' };

let mainWindow = null;
let updateStatus = { state: 'idle' };
let autoUpdater = null;
const authSessions = new Map();
const failedLogins = new Map();

function userDataFile(name) { return path.join(app.getPath('userData'), name); }
function ensureUserData() { mkdirSync(app.getPath('userData'), { recursive: true }); }
function publicStaff(user) { const { salt, pinHash, ...profile } = user; return profile; }

function createDeviceProof() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return {
    publicKeyHex: Buffer.from(publicDer).subarray(-32).toString('hex'),
    privateKeyPkcs8: Buffer.from(privateDer).toString('base64'),
  };
}

function defaultSecureState() {
  const createdAt = Date.now();
  return {
    version: 2,
    staff: DEFAULT_STAFF,
    tenant: null,
    activation: {
      mode: 'unlicensed',
      customerName: 'MarketPos',
      deviceId: deviceFingerprint(MARKET_INSTALLATION_ID),
      createdAt,
      validUntil: 0,
      controlUrl: CONTROL_URL,
    },
    deviceProof: createDeviceProof(),
    pinnedLicenseKey: null,
  };
}

function publicTenant(tenant) {
  if (!tenant?.token) return { authenticated: false };
  return {
    authenticated: true,
    email: tenant.email,
    customerId: tenant.customerId,
    customerName: tenant.customerName,
    expiresAt: tenant.expiresAt,
    paymentUrl: tenant.paymentUrl || null,
    licenses: Array.isArray(tenant.licenses) ? tenant.licenses : [],
  };
}

function licenseAllowsStaffLogin(activation) {
  return activation?.mode === 'active' && Number(activation.validUntil) > Date.now();
}

function normalizeActivation(state) {
  let dirty = false;
  if (!state.tenant) { state.tenant = null; dirty = true; }
  if (!state.activation.deviceId) {
    state.activation.deviceId = deviceFingerprint(MARKET_INSTALLATION_ID);
    dirty = true;
  }
  // Migrate unbound installs to stable Market HWID (do not break already-redeemed bindings).
  if (state.activation.mode !== 'active') {
    const nextFp = deviceFingerprint(MARKET_INSTALLATION_ID);
    if (state.activation.deviceId !== nextFp) {
      state.activation.deviceId = nextFp;
      dirty = true;
    }
  }
  if (state.activation.mode === 'trial' && !state.activation.serverDeviceId) {
    state.activation.mode = 'unlicensed';
    state.activation.validUntil = 0;
    dirty = true;
  }
  if (state.activation.validUntil > 0 && state.activation.validUntil <= Date.now() && state.activation.mode !== 'revoked' && state.activation.mode !== 'expired') {
    state.activation.mode = 'expired';
    dirty = true;
  }
  if (state.activation.controlUrl !== CONTROL_URL) {
    state.activation.controlUrl = CONTROL_URL;
    dirty = true;
  }
  return dirty;
}

function loadSecureState() {
  ensureUserData();
  const file = userDataFile('market-secure-state.json');
  if (!existsSync(file)) { const initial = defaultSecureState(); saveSecureState(initial); return initial; }
  try {
    const envelope = JSON.parse(readFileSync(file, 'utf8'));
    const json = envelope.encrypted && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(envelope.data, 'base64'))
      : Buffer.from(envelope.data, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.staff) || !parsed.activation) throw new Error('bad state');
    let dirty = false;
    if (!parsed.deviceProof?.publicKeyHex || !parsed.deviceProof?.privateKeyPkcs8) {
      parsed.deviceProof = createDeviceProof();
      dirty = true;
    }
    const renamed = parsed.staff.some((user) => LEGACY_STAFF_NAMES[user.name]);
    if (renamed) {
      parsed.staff = parsed.staff.map((user) => ({ ...user, name: LEGACY_STAFF_NAMES[user.name] || user.name }));
      if (parsed.activation.customerName === 'CyberPlus Supermarket' || parsed.activation.customerName === 'MarketPos Supermarket') {
        parsed.activation.customerName = 'MarketPos';
      }
      dirty = true;
    }
    dirty = normalizeActivation(parsed) || dirty;
    if (dirty) saveSecureState(parsed);
    return parsed;
  } catch {
    const recovered = defaultSecureState();
    saveSecureState(recovered);
    return recovered;
  }
}

function saveSecureState(state) {
  ensureUserData();
  const file = userDataFile('market-secure-state.json');
  const temp = `${file}.tmp`;
  const json = JSON.stringify(state);
  const encrypted = safeStorage.isEncryptionAvailable();
  const data = encrypted ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  writeFileSync(temp, JSON.stringify({ version: 1, encrypted, data: data.toString('base64') }), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, file);
}

function assertTrusted(event) {
  const url = event.senderFrame?.url || '';
  if (!url.startsWith(APP_ORIGIN)) throw new Error('Etibarsız tətbiq sorğusu');
}

/**
 * Matches a manager's PIN against the staff store.
 *
 * This is the only thing that may produce an `approverId`: the core treats that
 * field as proof a manager approved an action, and the renderer cannot set it.
 *
 * The demo PINs that used to be accepted here (2468 / 1357) worked on every
 * install we ever shipped, which made every manager override forgeable by
 * anyone who had seen the README. They now apply only to a till whose staff
 * store holds no manager PIN at all - a fresh install that nobody has set up
 * yet - so a configured venue cannot be opened with them.
 */
function verifyManagerPin(pin) {
  const state = loadSecureState();
  const managers = state.staff.filter(
    (row) => row.active && (row.role === 'manager' || row.role === 'head_cashier'),
  );

  for (const user of managers) {
    const actual = pbkdf2Sync(pin, user?.salt || '00000000000000000000000000000000', 120000, 32, 'sha256');
    const expected = Buffer.from(user.pinHash || '', 'hex');
    if (expected.length === actual.length && timingSafeEqual(actual, expected)) {
      return { ok: true, approverId: user.id, role: user.role, name: user.name };
    }
  }

  const provisioned = managers.some((row) => String(row.pinHash || '').length > 0);
  if (!provisioned) {
    if (pin === '2468') return { ok: true, approverId: 'u-manager', role: 'manager', name: 'MarketPos Müdir' };
    if (pin === '1357') return { ok: true, approverId: 'u-head', role: 'head_cashier', name: 'MarketPos Baş kassir' };
  }
  return { ok: false };
}

/** The operator signed in at this till, or '' when nobody is. */
let currentSessionToken = '';

function requireSession(token, roles) {
  const sessionInfo = authSessions.get(String(token || ''));
  if (!sessionInfo || sessionInfo.expiresAt < Date.now()) throw new Error('Sessiya bitib');
  const state = loadSecureState();
  const user = state.staff.find((row) => row.id === sessionInfo.userId && row.active);
  if (!user) throw new Error('İstifadəçi aktiv deyil');
  if (roles && !roles.includes(user.role)) throw new Error('Bu əməliyyat üçün icazə yoxdur');
  return user;
}

function loadDisplayPrefs() {
  try {
    const value = JSON.parse(readFileSync(userDataFile('market-display.json'), 'utf8'));
    return { mode: value.mode === 'fullscreen' ? 'fullscreen' : 'windowed', width: Math.min(3840, Math.max(800, Number(value.width) || 1500)), height: Math.min(2160, Math.max(600, Number(value.height) || 940)), zoomFactor: Math.min(1.25, Math.max(0.7, Number(value.zoomFactor) || 1)) };
  } catch { return { mode: 'windowed', width: 1500, height: 940, zoomFactor: 1 }; }
}

function applyDisplayPrefs(prefs) {
  if (!mainWindow || mainWindow.isDestroyed()) return prefs;
  mainWindow.webContents.setZoomFactor(prefs.zoomFactor);
  if (prefs.mode === 'fullscreen') {
    mainWindow.setFullScreen(true);
  } else {
    mainWindow.setFullScreen(false);
    const work = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
    const width = Math.min(prefs.width, work.width);
    const height = Math.min(prefs.height, work.height);
    mainWindow.setBounds({ x: work.x + Math.floor((work.width - width) / 2), y: work.y + Math.floor((work.height - height) / 2), width, height }, true);
  }
  return prefs;
}

function saveDisplayPrefs(input) {
  const prefs = { mode: input.mode === 'fullscreen' ? 'fullscreen' : 'windowed', width: Math.min(3840, Math.max(800, Number(input.width) || 1500)), height: Math.min(2160, Math.max(600, Number(input.height) || 940)), zoomFactor: Math.min(1.25, Math.max(0.7, Number(input.zoomFactor) || 1)) };
  ensureUserData();
  writeFileSync(userDataFile('market-display.json'), JSON.stringify(prefs, null, 2), 'utf8');
  return applyDisplayPrefs(prefs);
}

function toggleFullscreen() {
  const current = loadDisplayPrefs();
  return saveDisplayPrefs({ ...current, mode: mainWindow?.isFullScreen() ? 'windowed' : 'fullscreen' });
}

function setUpdateStatus(next) {
  updateStatus = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:update:changed', next);
  return next;
}

function updateErrorStatus(error) {
  const raw = error?.message || String(error || '');
  const message = /404|latest\.yml|cannot find/i.test(raw)
    ? 'Hazırda imzalı yeni versiya yayımlanmayıb'
    : /ENOTFOUND|ECONN|timeout|network/i.test(raw)
      ? 'Yeniləmə serverinə qoşulmaq mümkün olmadı'
      : 'Yeniləmə yoxlanarkən xəta baş verdi';
  return setUpdateStatus({ state: 'error', message });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/**
 * A signed call to the device routes that carry no snapshot.
 *
 * The heartbeat signs `{deviceId, appVersion, signedAt, nonce, snapshot}` and
 * the server verifies that shape; every other device route verifies the same
 * four fields without a snapshot. Signing the wrong one of the two is a 401
 * with nothing in the message to say why, so the two live side by side here.
 */
function signedMarketDeviceCall(state) {
  const signedAt = new Date().toISOString();
  const nonce = randomBytes(16).toString('hex');
  const canonical = stableStringify({
    deviceId: state.activation.serverDeviceId,
    appVersion: app.getVersion(),
    signedAt,
    nonce,
  });
  const privateKey = createPrivateKey({
    key: Buffer.from(state.deviceProof.privateKeyPkcs8, 'base64'),
    type: 'pkcs8',
    format: 'der',
  });
  return {
    deviceId: state.activation.serverDeviceId,
    deviceFingerprint: state.activation.deviceId,
    appVersion: app.getVersion(),
    signedAt,
    nonce,
    deviceSignature: signPayload(null, Buffer.from(canonical, 'utf8'), privateKey).toString('hex'),
  };
}

/**
 * Brings the staff role policy set on the website down to this till.
 *
 * What arrives is already narrowed to what POSSISTEM sold this customer, so a
 * permission the shop was never sold cannot appear here however their own
 * manager edits roles on the site.
 *
 * `policySource` is the core's proof this came from the server: core-payload
 * strips that field from anything the renderer sends, so a window script
 * cannot reach the same handler. Failure is silent by design - a shop with no
 * internet keeps the policy it already applied and keeps selling.
 */
let lastRolePullAt = 0;
async function syncRolePolicy(state) {
  // The renderer pushes a heartbeat far more often than a policy changes.
  if (Date.now() - lastRolePullAt < 120000) return;
  lastRolePullAt = Date.now();
  try {
    const response = await fetch(controlApi('/market-pos/roles'), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(signedMarketDeviceCall(state)),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const policy = await response.json();
    if (!policy?.version || !Array.isArray(policy.roles) || policy.roles.length === 0) return;
    await coreSupervisor.invoke(
      'roles.applyPolicy',
      { policySource: 'control-plane', version: policy.version, roles: policy.roles },
      15000,
    );
  } catch {
    // Offline, or the core is restarting: the next heartbeat tries again.
  }
}

function signedMarketHeartbeat(state, snapshot) {
  const signedAt = new Date().toISOString();
  const nonce = randomBytes(16).toString('hex');
  const canonical = stableStringify({
    deviceId: state.activation.serverDeviceId,
    appVersion: app.getVersion(),
    signedAt,
    nonce,
    snapshot,
  });
  const privateKey = createPrivateKey({
    key: Buffer.from(state.deviceProof.privateKeyPkcs8, 'base64'),
    type: 'pkcs8',
    format: 'der',
  });
  return {
    deviceId: state.activation.serverDeviceId,
    deviceFingerprint: state.activation.deviceId,
    appVersion: app.getVersion(),
    signedAt,
    nonce,
    deviceSignature: signPayload(null, Buffer.from(canonical, 'utf8'), privateKey).toString('hex'),
    snapshot,
  };
}

async function initAutoUpdater() {
  if (!app.isPackaged) { setUpdateStatus({ state: 'disabled', message: 'Yeniləmə yalnız Setup ilə qurulan versiyada işləyir' }); return; }
  try {
    const updaterModule = require('electron-updater');
    autoUpdater = updaterModule.autoUpdater || updaterModule.default?.autoUpdater;
    if (!autoUpdater) throw new Error('electron-updater tapılmadı');
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_URL });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => setUpdateStatus({ state: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'not_available' }));
    autoUpdater.on('download-progress', (p) => setUpdateStatus({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => setUpdateStatus({ state: 'downloaded', version: info.version }));
    autoUpdater.on('error', updateErrorStatus);
    setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), 8000);
    setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 30 * 60 * 1000);
  } catch (error) { updateErrorStatus(error); }
}

function verifyOnlineLicense(body, state) {
  const key = body.signingKey;
  const envelope = body.signedLicense;
  if (!key || key.algorithm !== 'Ed25519' || !envelope?.payload || !/^[0-9a-f]{128}$/i.test(envelope.signature || '') || !/^[0-9a-f]{64}$/i.test(key.publicKeyHex || '')) throw new Error('Aktivasiya cavabının imzası etibarsızdır');
  const keyId = `ed25519-${createHash('sha256').update(Buffer.from(key.publicKeyHex, 'hex')).digest('hex').slice(0, 16)}`;
  if (key.keyId !== keyId || envelope.keyId !== keyId) throw new Error('Aktivasiya açarının kimliyi uyğun deyil');
  if (state.pinnedLicenseKey && state.pinnedLicenseKey.keyId !== keyId) throw new Error('Lisenziya imza açarı gözlənilmədən dəyişib');
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(key.publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
  const valid = verifySignature(null, Buffer.from(JSON.stringify(envelope.payload)), publicKey, Buffer.from(envelope.signature, 'hex'));
  if (!valid) throw new Error('Aktivasiya imzası yoxlamadan keçmədi');
  if (envelope.payload.deviceFingerprint !== state.activation.deviceId || envelope.payload.status !== 'active') throw new Error('Lisenziya bu cihaz üçün aktiv deyil');
  if (!body.device?.id || body.device.id !== envelope.payload.deviceId) throw new Error('Aktivasiya cihaz kimliyi uyğun deyil');
  const expiresAt = Number(envelope.payload.expiresAt);
  const isoExpiry = Date.parse(String(envelope.payload.validUntil || ''));
  const validUntil = expiresAt > 0 ? expiresAt : Number.isFinite(isoExpiry) ? isoExpiry : Date.UTC(2099, 11, 31);
  if (validUntil <= Date.now()) throw new Error('Lisenziyanın vaxtı bitib');
  const features = envelope.payload.features && typeof envelope.payload.features === 'object' ? envelope.payload.features : {};
  const branding = features.branding && typeof features.branding === 'object' ? features.branding : null;
  const customerName = String(branding?.productName || body.restaurant?.name || 'Market').slice(0, 120);
  state.pinnedLicenseKey = { keyId, publicKeyHex: key.publicKeyHex };
  state.activation = {
    mode: 'active',
    customerName,
    deviceId: state.activation.deviceId,
    serverDeviceId: body.device.id,
    customerId: envelope.payload.customerId,
    createdAt: state.activation.createdAt,
    validUntil,
    controlUrl: CONTROL_URL,
    branding,
    inventory: features.inventory !== false,
    customer: {
      legalName: body.restaurant?.name || customerName,
      address: body.restaurant?.address || '',
      phone: body.restaurant?.phone || '',
      taxId: body.restaurant?.taxId || '',
    },
  };
  saveSecureState(state);
  return state.activation;
}

function registerIpc() {
  ipcMain.handle('market:staff:list', (event) => { assertTrusted(event); return loadSecureState().staff.map(publicStaff); });
  ipcMain.handle('market:auth:login', (event, input) => {
    assertTrusted(event);
    const state = loadSecureState();
    if (!state.tenant?.token) throw new Error('Əvvəlcə müştəri hesabına daxil olun');
    if (!licenseAllowsStaffLogin(state.activation)) throw new Error('Cihaz aktivləşdirilməyib');
    const userId = String(input?.userId || '');
    const pin = String(input?.pin || '');
    const attempt = failedLogins.get(userId) || { count: 0, lockedUntil: 0 };
    if (attempt.lockedUntil > Date.now()) throw new Error('Çox sayda səhv cəhd. 30 saniyə gözləyin.');
    const user = state.staff.find((row) => row.id === userId && row.active);
    const expected = user ? Buffer.from(user.pinHash, 'hex') : Buffer.alloc(32);
    const actual = pbkdf2Sync(pin, user?.salt || '00000000000000000000000000000000', 120000, 32, 'sha256');
    if (!user || !timingSafeEqual(actual, expected)) {
      const count = attempt.count + 1;
      failedLogins.set(userId, { count: count >= 5 ? 0 : count, lockedUntil: count >= 5 ? Date.now() + 30000 : 0 });
      throw new Error('Giriş kodu yanlışdır');
    }
    failedLogins.delete(userId);
    const sessionToken = randomBytes(32).toString('hex');
    authSessions.set(sessionToken, { userId, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    // Remembered so core calls can be attributed without every renderer call
    // site having to carry the token: one till, one signed-in operator.
    currentSessionToken = sessionToken;
    return { ...publicStaff(user), sessionToken };
  });
  ipcMain.handle('market:auth:logout', (event, token) => {
    assertTrusted(event);
    authSessions.delete(String(token));
    if (currentSessionToken === String(token)) currentSessionToken = '';
    return true;
  });
  ipcMain.handle('market:tenant:status', (event) => {
    assertTrusted(event);
    const state = loadSecureState();
    return publicTenant(state.tenant);
  });
  ipcMain.handle('market:tenant:login', async (event, input) => {
    assertTrusted(event);
    const email = String(input?.email || '').trim();
    const password = String(input?.password || '');
    if (!email || !password) throw new Error('Email və parol tələb olunur');
    const hwid = deviceFingerprint(MARKET_TENANT_BIND_ID);
    const response = await fetch(controlApi('/tenant/login'), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, client: 'pos', hwid }),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `Giriş uğursuz (${response.status})`);
    }
    const customer = payload.customer || {};
    const state = loadSecureState();
    state.tenant = {
      token: String(payload.token || ''),
      email: String(customer.email || email),
      customerId: String(customer.id || ''),
      customerName: String(customer.name || 'MarketPos'),
      expiresAt: Number(payload.expiresAt) || 0,
      paymentUrl: payload.paymentUrl || null,
      licenses: Array.isArray(payload.licenses) ? payload.licenses : [],
    };
    if (!state.tenant.token) throw new Error('Server token qaytarmadı');
    if (state.activation.mode === 'unlicensed' || state.activation.mode === 'trial') {
      state.activation.customerName = state.tenant.customerName;
    }
    saveSecureState(state);
    return publicTenant(state.tenant);
  });
  ipcMain.handle('market:tenant:logout', (event) => {
    assertTrusted(event);
    const state = loadSecureState();
    state.tenant = null;
    saveSecureState(state);
    for (const token of authSessions.keys()) authSessions.delete(token);
    currentSessionToken = '';
    return { ok: true };
  });
  ipcMain.handle('market:staff:save', (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager']);
    const state = loadSecureState();
    const profile = input?.profile || {};
    const roles = ['manager', 'head_cashier', 'cashier', 'warehouse'];
    if (!profile.name || !roles.includes(profile.role)) throw new Error('İşçi məlumatı düzgün deyil');
    const existing = state.staff.find((row) => row.id === profile.id);
    const pin = String(input?.pin || '');
    if (!existing && !/^\d{4,8}$/.test(pin)) throw new Error('PIN 4–8 rəqəm olmalıdır');
    const salt = pin ? randomBytes(16).toString('hex') : existing.salt;
    const pinHash = pin ? pbkdf2Sync(pin, salt, 120000, 32, 'sha256').toString('hex') : existing.pinHash;
    const next = { id: existing?.id || `u-${Date.now()}`, name: String(profile.name).slice(0, 80), role: profile.role, active: profile.active !== false, registerIds: Array.isArray(profile.registerIds) ? profile.registerIds.slice(0, 20) : [], warehouseIds: Array.isArray(profile.warehouseIds) ? profile.warehouseIds.slice(0, 20) : [], salt, pinHash };
    state.staff = existing ? state.staff.map((row) => row.id === existing.id ? next : row) : [...state.staff, next];
    saveSecureState(state);
    return publicStaff(next);
  });
  ipcMain.handle('market:display:get', (event) => { assertTrusted(event); return { prefs: loadDisplayPrefs(), presets: [{ id: 'fullscreen', label: 'Tam ekran', mode: 'fullscreen', width: 0, height: 0 }, { id: '1920x1080', label: '1920×1080', mode: 'windowed', width: 1920, height: 1080 }, { id: '1600x900', label: '1600×900', mode: 'windowed', width: 1600, height: 900 }, { id: '1366x768', label: '1366×768', mode: 'windowed', width: 1366, height: 768 }, { id: '1024x768', label: '1024×768', mode: 'windowed', width: 1024, height: 768 }] }; });
  ipcMain.handle('market:display:set', (event, input) => { assertTrusted(event); requireSession(input?.sessionToken, ['manager']); return saveDisplayPrefs(input); });
  ipcMain.handle('market:display:toggle', (event) => { assertTrusted(event); return toggleFullscreen(); });
  ipcMain.handle('market:image:pick', async (event, token) => {
    assertTrusted(event); requireSession(token, ['manager', 'warehouse']);
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Şəkillər', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    if (statSync(source).size > 12 * 1024 * 1024) throw new Error('Şəkil 12 MB-dan böyük ola bilməz');
    const image = nativeImage.createFromPath(source);
    if (image.isEmpty()) throw new Error('Şəkil oxunmadı');
    const resized = image.resize({ width: 720, height: 720, quality: 'best' });
    const mediaDir = path.join(app.getPath('userData'), 'catalog-media');
    mkdirSync(mediaDir, { recursive: true });
    const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`;
    writeFileSync(path.join(mediaDir, filename), resized.toJPEG(88), { mode: 0o600 });
    return `market-pos://media/${filename}`;
  });
  ipcMain.handle('market:activation:status', (event) => {
    assertTrusted(event);
    return loadSecureState().activation;
  });
  ipcMain.handle('market:activation:refresh', async (event) => {
    assertTrusted(event);
    const state = loadSecureState();
    if (state.activation.validUntil > 0 && state.activation.validUntil <= Date.now() && state.activation.mode !== 'revoked') {
      state.activation.mode = 'expired';
      saveSecureState(state);
      return state.activation;
    }
    if (state.activation.mode !== 'active' || !state.activation.serverDeviceId) return state.activation;
    try {
      const body = signedMarketHeartbeat(state, {
        storeName: state.activation.customerName || 'MarketPos',
        terminalName: 'license-check',
        dailySalesMinor: 0,
        transactionCount: 0,
        cashMinor: 0,
        cardMinor: 0,
        openRegisters: 0,
        criticalStock: 0,
        queue: 0,
        registers: [],
        lowStock: [],
        warehouses: [],
        updatedAt: Date.now(),
      });
      const response = await fetch(controlApi('/market-pos/heartbeat'), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        state.activation.mode = 'revoked';
        saveSecureState(state);
        return state.activation;
      }
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload?.active === false || payload?.status === 'revoked' || payload?.status === 'expired') {
          state.activation.mode = payload.status === 'expired' ? 'expired' : 'revoked';
          saveSecureState(state);
        }
      }
    } catch {
      // Offline: keep local license state
    }
    return state.activation;
  });
  ipcMain.handle('market:activation:activate', async (event, input) => {
    assertTrusted(event);
    const state = loadSecureState();
    if (!state.tenant?.token) throw new Error('Əvvəlcə müştəri hesabına daxil olun');
    const localMode = state.activation.validUntil > 0 && state.activation.validUntil <= Date.now()
      ? 'expired'
      : state.activation.mode;
    // Bootstrap redeem allowed without staff session when not already active; Settings re-activate needs manager.
    if (localMode === 'active') requireSession(input?.sessionToken, ['manager']);
    const key = String(input?.activationKey || '').trim();
    if (key.length < 12 || key.length > 160) throw new Error('Aktivasiya açarı düzgün deyil');
    const response = await fetch(controlApi('/activation/redeem'), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        activationKey: key,
        deviceFingerprint: state.activation.deviceId,
        hostname: hostname(),
        appVersion: app.getVersion(),
        devicePublicKey: state.deviceProof.publicKeyHex,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(problem.error || `Aktivasiya serveri xətası (${response.status})`);
    }
    return verifyOnlineLicense(await response.json(), state);
  });
  ipcMain.handle('market:update:status', (event) => { assertTrusted(event); return updateStatus; });
  ipcMain.handle('market:update:check', async (event, token) => { assertTrusted(event); requireSession(token, ['manager']); if (!autoUpdater) return setUpdateStatus({ state: 'disabled', message: 'Yeniləmə yalnız Setup versiyasında işləyir' }); try { await autoUpdater.checkForUpdates(); return updateStatus; } catch (error) { return updateErrorStatus(error); } });
  ipcMain.handle('market:update:install', (event, token) => { assertTrusted(event); requireSession(token, ['manager']); if (!autoUpdater || updateStatus.state !== 'downloaded') throw new Error('Hazır yeniləmə yoxdur'); autoUpdater.quitAndInstall(true, true); return true; });
  ipcMain.handle('market:app:info', (event) => { assertTrusted(event); return { version: app.getVersion(), updateUrl: UPDATE_URL, controlUrl: CONTROL_URL, packaged: app.isPackaged }; });
  ipcMain.handle('market:sync:push', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    const state = loadSecureState();
    if (state.activation.mode !== 'active') return { connected: false, reason: 'trial' };
    if (!state.activation.serverDeviceId) return { connected: false, reason: 'reactivation_required' };
    try {
      const body = signedMarketHeartbeat(state, input.snapshot);
      if (input.books && typeof input.books === 'object') body.books = input.books;
      const response = await fetch(controlApi('/market-pos/heartbeat'), { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      // The heartbeat is the till's regular word with the server, so the role
      // policy rides along with it rather than needing a timer of its own.
      const payload = response.ok ? await response.json().catch(() => ({})) : {};
      if (response.ok) void syncRolePolicy(state);
      return { connected: response.ok, status: response.status, inventory: payload.inventory !== false, access: Array.isArray(payload.access) ? payload.access : null, commands: Array.isArray(payload.commands) ? payload.commands : [] };
    } catch (error) { return { connected: false, reason: error.message || String(error) }; }
  });

  ipcMain.handle('market:invoke', async (event, input) => {
    assertTrusted(event);
    const method = String(input?.method || '');
    if (!method) return { success: false, error: { code: 'E_VALIDATION', message: 'method required', retryable: false } };
    // The core decides permissions from `role` in the payload, so the renderer
    // must not be the one writing it - see core-payload.cjs.
    const payload = authorizeCorePayload(
      input?.payload,
      () => {
        try {
          return requireSession(input?.sessionToken || currentSessionToken);
        } catch {
          return null;
        }
      },
      // A manager PIN typed into the override dialog is verified here, never in
      // the renderer, and only a match produces an approverId.
      (pin) => verifyManagerPin(String(pin || '')),
      input?.managerPin,
    );
    return coreSupervisor.invoke(method, payload, Number(input?.timeoutMs) || 15000);
  });
  ipcMain.handle('market:coreStatus:get', (event) => {
    assertTrusted(event);
    return { state: coreSupervisor.state, dbPath: coreSupervisor.dbPath };
  });
  ipcMain.handle('market:coreRestart', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager']);
    await coreSupervisor.stop();
    const customerId = loadSecureState().activation?.customerId || '_default';
    await coreSupervisor.start(customerId);
    return { state: coreSupervisor.state };
  });

  const { CorePrinterProvider } = require('./hardware/printer');
  const { MockFiscalProvider } = require('./hardware/fiscal');
  const { ManualTerminalProvider, MockTerminalProvider } = require('./hardware/terminal');
  // Printing goes through the core, which owns the device. The file and mock
  // providers stay in hardware/printer.js for tests; wiring one here is what
  // made the till report a printed receipt that never left the machine.
  const printerSession = () => ({ role: 'manager', actorId: 'system' });
  const printerProvider = new CorePrinterProvider(
    (method, payload, timeoutMs) => coreSupervisor.invoke(method, payload, timeoutMs),
    printerSession,
  );
  const fiscalProvider = new MockFiscalProvider();
  let terminalProvider = new ManualTerminalProvider();

  ipcMain.handle('market:printer:list', (event) => { assertTrusted(event); return printerProvider.listPrinters(); });
  ipcMain.handle('market:printer:health', (event) => { assertTrusted(event); return printerProvider.health(); });
  // Detection sweeps the LAN and prints a page to each candidate, so it is
  // gated on a real manager session rather than the placeholder role used for
  // ordinary receipts - and given room to run, because a subnet sweep plus a
  // probe per candidate does not finish inside the default timeout.
  ipcMain.handle('market:printer:detect', async (event, input) => {
    assertTrusted(event);
    const user = requireSession(input?.sessionToken, ['manager']);
    return coreSupervisor.invoke(
      'printer.detect',
      { role: user.role, actorId: user.id, probe: input?.probe !== false },
      90000,
    );
  });
  ipcMain.handle('market:printer:setTarget', async (event, input) => {
    assertTrusted(event);
    const user = requireSession(input?.sessionToken, ['manager']);
    return coreSupervisor.invoke('printer.setTarget', {
      role: user.role,
      actorId: user.id,
      target: String(input?.target || ''),
    });
  });
  ipcMain.handle('market:printer:test', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager']);
    return printerProvider.printTest({ widthMm: input?.widthMm || 80 });
  });
  ipcMain.handle('market:printer:receipt', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    return printerProvider.printReceipt(input?.receipt || {}, { widthMm: input?.widthMm || 80, cut: input?.cut !== false });
  });
  ipcMain.handle('market:drawer:open', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    await coreSupervisor.invoke('drawer.openLogged', {
      actorId: input?.actorId || 'system',
      role: input?.role || 'manager',
      approverId: input?.approverId,
      reason: input?.reason || 'manual',
    });
    return printerProvider.openDrawer();
  });
  ipcMain.handle('market:auth:verifyManagerPin', (event, input) => {
    assertTrusted(event);
    return verifyManagerPin(String(input?.pin || ''));
  });
  ipcMain.handle('market:terminal:pay', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    const mode = String(input?.mode || 'manual');
    terminalProvider = mode === 'mock_integrated' ? new MockTerminalProvider() : new ManualTerminalProvider();
    const result = await terminalProvider.startPayment({
      amountMinor: Number(input?.amountMinor) || 0,
      reference: input?.reference || '',
    });
    if (result.status === 'declined') {
      const err = new Error('Terminal declined');
      err.code = 'TERMINAL_DECLINED';
      throw err;
    }
    return result;
  });
  ipcMain.handle('market:fiscal:processPending', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager']);
    const pending = await coreSupervisor.invoke('fiscal.listPending', {});
    if (!pending.success) return pending;
    const results = [];
    for (const job of pending.data || []) {
      try {
        const req = JSON.parse(job.request_json || '{}');
        const out = job.kind === 'refund'
          ? await fiscalProvider.registerRefund(req)
          : await fiscalProvider.registerSale(req);
        await coreSupervisor.invoke('fiscal.updateStatus', {
          id: job.id,
          status: out.status,
          fiscalReceiptId: out.fiscalReceiptId,
          qrData: out.qrData,
          response: out.response,
        });
        results.push({ id: job.id, status: out.status });
      } catch (error) {
        await coreSupervisor.invoke('fiscal.updateStatus', {
          id: job.id,
          status: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
        });
        results.push({ id: job.id, status: 'failed' });
      }
    }
    return { success: true, data: results };
  });
}

function createWindow() {
  const prefs = loadDisplayPrefs();
  mainWindow = new BrowserWindow({
    width: prefs.width, height: prefs.height, minWidth: 800, minHeight: 560, show: false,
    fullscreen: prefs.mode === 'fullscreen', backgroundColor: '#071713', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'), title: 'MarketPos',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(APP_ORIGIN)) event.preventDefault(); });
  mainWindow.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'F11') { event.preventDefault(); toggleFullscreen(); } });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => { if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`); });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => console.error(`[renderer] load failed ${code}: ${description} (${url})`));
  if (process.env.MARKET_POS_DIAGNOSTIC === '1') mainWindow.webContents.once('did-finish-load', async () => { const state = await mainWindow.webContents.executeJavaScript(`({ rootChildren: document.getElementById('root')?.childElementCount ?? -1, visibleText: document.body.innerText.trim().slice(0, 160) })`); console.log(`[renderer] mounted rootChildren=${state.rootChildren} text=${JSON.stringify(state.visibleText)}`); });
  mainWindow.once('ready-to-show', () => { mainWindow.show(); applyDisplayPrefs(loadDisplayPrefs()); });
  void mainWindow.loadURL(`${APP_ORIGIN}index.html`);
}

app.on('second-instance', () => { if (!mainWindow) return; if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); });

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const distRoot = path.resolve(__dirname, '..', 'dist');
  const mediaRoot = path.resolve(app.getPath('userData'), 'catalog-media');
  await protocol.handle('market-pos', (request) => {
    const url = new URL(request.url);
    const root = url.hostname === 'media' ? mediaRoot : distRoot;
    let requested = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    // Absolute /assets/... from renderer resolves as market-pos://assets/... — map into dist/assets
    if (url.hostname === 'assets') requested = path.posix.join('assets', requested);
    const filePath = path.resolve(root, requested);
    if (!(filePath === root || filePath.startsWith(`${root}${path.sep}`))) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  registerIpc();
  const secure = loadSecureState();
  try {
    await coreSupervisor.start(secure.activation?.customerId || '_default');
  } catch (err) {
    console.error('[market-core] failed to start:', err instanceof Error ? err.message : err);
  }
  coreSupervisor.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:coreStatus', status);
  });
  coreSupervisor.on('event', (evt) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:coreEvent', evt);
  });
  createWindow();
  void initAutoUpdater();
});

app.on('before-quit', (event) => {
  if (coreSupervisor.state === 'stopped') return;
  if (!coreSupervisor.child) return;
  event.preventDefault();
  void coreSupervisor.stop().finally(() => app.exit(0));
});

app.on('window-all-closed', () => app.quit());
