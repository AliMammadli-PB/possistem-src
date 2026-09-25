const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, safeStorage, screen, session, shell } = require('electron');
const { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scryptSync, sign: signPayload, verify: verifySignature } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } = require('node:fs');
const { hostname } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ORIGIN = 'market-pos://app/';
const UPDATE_URL = process.env.MARKET_POS_UPDATE_URL || 'https://possistem.az/marketpos/updates/';
const DEFAULT_CONTROL_API = 'https://possistem.az/pos/api';
const MARKET_INSTALLATION_ID = 'market-pos';
/** Must match Restaurant POS owner bind salt (`Zt("tenant-bind")`). */
const RESTAURANT_TENANT_BIND_ID = 'tenant-bind';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/**
 * Licence signing keys this build trusts. A response signed by any other key is
 * rejected, including on first activation. Rotation: ship a build that lists the
 * new key id first, then switch the control plane. MARKET_POS_EXPECTED_KEY_ID
 * (comma-separated) replaces the list for a private/staging control plane.
 */
const TRUSTED_LICENSE_KEY_IDS = new Set(
  String(process.env.MARKET_POS_EXPECTED_KEY_ID || 'ed25519-42cd45bfa4ca3125')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

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
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/**
 * Machine seed for device activation (Market-isolated userData after setPath).
 * Must not be used for owner/tenant bind — that has to match Restaurant POS.
 */
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

/**
 * Same algorithm as Restaurant POS `ps()` / `Zt("tenant-bind")`.
 * Linux fallback uses productName "possistem" userData so Market + Restaurant
 * on one PC share one owner HWID (control API binds a single bound_hwid per email).
 */
function restaurantCompatibleMachineSeed() {
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
  const restaurantUserData = path.join(app.getPath('appData'), 'possistem');
  return sha256Hex(`${hostname()}|${restaurantUserData}`).slice(0, 32);
}

/** Device license fingerprint — Market-specific (separate from restaurant device rows). */
function deviceFingerprint(installationId = MARKET_INSTALLATION_ID) {
  return sha256Hex([installationId || MARKET_INSTALLATION_ID, process.platform, process.arch, machineSeed()].join('|'));
}

/** Owner account bind — MUST match restaurant POS on the same machine. */
function tenantBindFingerprint() {
  return sha256Hex([RESTAURANT_TENANT_BIND_ID, process.platform, process.arch, restaurantCompatibleMachineSeed()].join('|'));
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
  const automationData = process.env.MARKET_POS_AUTOMATION_PORT
    ? process.env.MARKET_POS_AUTOMATION_USER_DATA
    : null;
  const isolated = automationData
    ? path.resolve(automationData)
    : path.join(app.getPath('appData'), 'POSSISTEM', 'MarketPOS');
  mkdirSync(isolated, { recursive: true });
  app.setPath('userData', isolated);
}

const { CoreSupervisor } = require('./core-supervisor.cjs');
const { MarketSyncService } = require('./sync-service.cjs');
const { cacheCatalogImages, rewriteSyncEvents } = require('./catalog-images.cjs');
const { authorizeCorePayload } = require('./core-payload.cjs');
const { buildXzReportEscPos } = require('./hardware/printer');
const coreSupervisor = new CoreSupervisor();
let syncService = null;
let printerProvider = null;

const {
  DEFAULT_STAFF,
  pinIsShippedDefault,
  newPinCredential,
  assertAcceptablePin,
  publicStaff,
  createAttemptLimiter,
  verifyManagerPin: verifyManagerPinAgainst,
  createSessionStore,
  resolveSessionUser,
  pinMatches,
} = require('./staff-auth.cjs');
const { registerHardwareIpc } = require('./hardware-ipc.cjs');
const { createEncryptionKey } = require('./lan-crypto.cjs');
const LEGACY_STAFF_NAMES = { 'Aysel Məmmədova': 'MarketPos Müdir', 'Murad Əliyev': 'MarketPos Baş kassir', 'Nigar Kərimova': 'MarketPos Kassir', 'Elvin Qasımov': 'MarketPos Anbar' };

let mainWindow = null;
let updateStatus = { state: 'idle' };
let autoUpdater = null;
const authSessions = createSessionStore();
const loginLimiter = createAttemptLimiter();
const approvalLimiter = createAttemptLimiter();

function userDataFile(name) { return path.join(app.getPath('userData'), name); }
function ensureUserData() { mkdirSync(app.getPath('userData'), { recursive: true }); }

function createDeviceProof() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return {
    publicKeyHex: Buffer.from(publicDer).subarray(-32).toString('hex'),
    privateKeyPkcs8: Buffer.from(privateDer).toString('base64'),
    // X25519 key for sealing LAN replication (see lan-crypto.cjs).
    ...createEncryptionKey(),
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
    staffSession: null,
    pinnedLicenseKey: null,
    backup: { directory: '', password: '', lastBackupAt: 0, retentionDays: 30 },
  };
}

function publicTenant(tenant) {
  if (!tenant?.token) return { authenticated: false };
  // A stored session signs the owner back in across restarts (the staff PIN gate
  // still stands), but an EXPIRED one must ask for the account again rather than
  // reporting a login that the control plane would reject.
  if (Number(tenant.expiresAt) > 0 && Number(tenant.expiresAt) <= Date.now()) {
    return { authenticated: false };
  }
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
  if (!state.backup) { state.backup = { directory: '', password: '', lastBackupAt: 0, retentionDays: 30 }; dirty = true; }
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

/**
 * The secure state holds the device's private key, the tenant token and staff
 * PIN hashes. A packaged Windows build (DPAPI is always there) never writes it
 * in the clear; MARKET_POS_REQUIRE_SECURE_STORAGE=1 enforces that elsewhere.
 */
function secureStorageRequired() {
  return (app.isPackaged && process.platform === 'win32') || process.env.MARKET_POS_REQUIRE_SECURE_STORAGE === '1';
}

function loadSecureState() {
  ensureUserData();
  const file = userDataFile('market-secure-state.json');
  if (!existsSync(file)) { const initial = defaultSecureState(); saveSecureState(initial); return initial; }
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    envelope = null;
  }
  // Encrypted state that cannot be decrypted right now is not damaged: resetting
  // it would throw away the activation and every staff PIN.
  if (envelope?.encrypted && !safeStorage.isEncryptionAvailable()) {
    throw new Error('Təhlükəsiz yaddaş (OS keyring) əlçatan deyil — məlumatlar oxunmadı');
  }
  try {
    if (!envelope) throw new Error('unreadable');
    const json = envelope.encrypted
      ? safeStorage.decryptString(Buffer.from(envelope.data, 'base64'))
      : Buffer.from(envelope.data, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.staff) || !parsed.activation) throw new Error('bad state');
    let dirty = false;
    if (!parsed.deviceProof?.publicKeyHex || !parsed.deviceProof?.privateKeyPkcs8) {
      parsed.deviceProof = createDeviceProof();
      dirty = true;
    } else if (!parsed.deviceProof.encPublicKeyHex || !parsed.deviceProof.encPrivateKeyPkcs8) {
      // Tills activated before LAN encryption keep their signing key (the licence
      // is bound to it) and only gain the encryption key.
      parsed.deviceProof = { ...parsed.deviceProof, ...createEncryptionKey() };
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
    // Damaged beyond reading: keep the file for support, then start clean.
    try { renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* keep going */ }
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
  if (!encrypted && secureStorageRequired()) {
    throw new Error('Təhlükəsiz yaddaş (OS keyring) əlçatan deyil — məlumat açıq mətnlə yazılmadı');
  }
  const data = encrypted ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  writeFileSync(temp, JSON.stringify({ version: 1, encrypted, data: data.toString('base64') }), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, file);
}

function backupFileName(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `MarketPos-${stamp}.mposbak`;
}

function encryptDatabase(bytes, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const header = Buffer.from(JSON.stringify({ version: 1, cipher: 'aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }) + '\n', 'utf8');
  return Buffer.concat([Buffer.from('MPOSBACKUP1\n', 'ascii'), header, encrypted]);
}

function decryptDatabase(bytes, password) {
  const magic = Buffer.from('MPOSBACKUP1\n', 'ascii');
  if (!bytes.subarray(0, magic.length).equals(magic)) throw new Error('Backup formatı tanınmadı');
  const headerEnd = bytes.indexOf(10, magic.length);
  if (headerEnd < 0) throw new Error('Backup başlığı zədəlidir');
  const header = JSON.parse(bytes.subarray(magic.length, headerEnd).toString('utf8'));
  const key = scryptSync(password, Buffer.from(header.salt, 'base64'), 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(header.tag, 'base64'));
  return Buffer.concat([decipher.update(bytes.subarray(headerEnd + 1)), decipher.final()]);
}

async function createEncryptedBackup(reason = 'manual') {
  const state = loadSecureState();
  if (!state.backup?.directory || !state.backup?.password) throw new Error('Backup qovluğu və parolu əvvəlcə qurulmalıdır');
  if (!existsSync(state.backup.directory)) throw new Error('Backup diski və ya qovluğu qoşulu deyil');
  const customerId = state.activation?.customerId || '_default';
  await coreSupervisor.stop();
  try {
    const dbPath = coreSupervisor.dbPath;
    if (!dbPath || !existsSync(dbPath)) throw new Error('Market database tapılmadı');
    const output = path.join(state.backup.directory, backupFileName());
    const encrypted = encryptDatabase(readFileSync(dbPath), state.backup.password);
    writeFileSync(`${output}.tmp`, encrypted, { mode: 0o600 });
    renameSync(`${output}.tmp`, output);
    state.backup.lastBackupAt = Date.now();
    saveSecureState(state);
    const keepAfter = Date.now() - Math.max(1, Number(state.backup.retentionDays || 30)) * 86400000;
    for (const name of readdirSync(state.backup.directory).filter((name) => /^MarketPos-.*\.mposbak$/.test(name))) {
      const candidate = path.join(state.backup.directory, name);
      if (statSync(candidate).mtimeMs < keepAfter) unlinkSync(candidate);
    }
    return { file: output, sizeBytes: encrypted.length, createdAt: state.backup.lastBackupAt, reason };
  } finally {
    await coreSupervisor.start(customerId);
  }
}

function assertTrusted(event) {
  const url = event.senderFrame?.url || '';
  if (!url.startsWith(APP_ORIGIN)) throw new Error('Etibarsız tətbiq sorğusu');
}

/**
 * A manager's PIN checked against the staff store - the only thing that may
 * produce an `approverId`. Throttled, and never satisfied by a published PIN.
 */
function verifyManagerPin(pin) {
  return verifyManagerPinAgainst(loadSecureState().staff, String(pin || ''), approvalLimiter);
}

/** The operator signed in at this till, or '' when nobody is. */
let currentSessionToken = '';

/**
 * The staff row behind a session token. Refuses an account still on a published
 * PIN (E_PIN_CHANGE_REQUIRED) unless `allowDefaultPin` - only the PIN-change
 * flow passes that.
 */
function requireSession(token, roles, options = {}) {
  return resolveSessionUser(authSessions, loadSecureState().staff, token, { roles, ...options });
}

async function requireCorePermission(token, permission) {
  const user = requireSession(token);
  const result = await coreSupervisor.invoke('auth.checkPermission', {
    actorId: user.id,
    role: user.role,
    permission,
  });
  if (!result?.success || !result?.data?.allowed) {
    throw new Error('Buna icazəniz yoxdur');
  }
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
  // Same pace as the heartbeat (30 s), so a role revoked on the website stops
  // working on the till in about half a minute rather than two.
  if (Date.now() - lastRolePullAt < 30000) return;
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

/**
 * Device proof for calls that carry no snapshot (support).
 *
 * Must match verifyMarketDeviceProof on the server exactly: the heartbeat
 * canonical form includes `snapshot`, so signing a support request with it would
 * never verify.
 */
function signedMarketDeviceAuth(state) {
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
 * What the office needs to know before answering a support request.
 *
 * Collected in main because only main can see the licence, the core process and
 * the sync queue. Deliberately small and non-sensitive: no PINs, no tokens, no
 * customer data — just the state of the machine.
 */
function collectSupportDiagnostics() {
  const state = loadSecureState();
  const activation = state.activation || {};
  const sync = syncService?.status || {};
  const diagnostics = {
    app: `MarketPos ${app.getVersion()}`,
    platform: `${process.platform} ${process.arch}`,
    hostname: hostname(),
    license: activation.mode || 'unknown',
    licenseValidUntil: activation.validUntil
      ? new Date(Number(activation.validUntil)).toISOString().slice(0, 10)
      : null,
    customer: activation.customerName || null,
    deviceId: activation.serverDeviceId || null,
    hwid: typeof activation.deviceId === 'string' ? activation.deviceId.slice(0, 12) : null,
    core: coreSupervisor.state,
    coreDb: coreSupervisor.dbPath || null,
    sync: sync.mode || 'offline',
    syncPending: Number(sync.pending || 0),
    syncPeers: Number(sync.peerCount || 0),
    printer: printerProvider ? 'configured' : 'not_configured',
    // A still-default staff PIN is worth flagging: it also blocks manager
    // actions, which is a very common "nothing works" report.
    defaultPinInUse: (state.staff || []).some((row) => pinIsShippedDefault(row)),
  };
  const lastError = readLastCoreError();
  if (lastError) diagnostics.lastCoreError = lastError;
  return diagnostics;
}

/** Tail of the newest core log, so a crash loop is visible from the office. */
function readLastCoreError() {
  try {
    const logDir = coreSupervisor.logDir;
    if (!logDir || !existsSync(logDir)) return null;
    const newest = readdirSync(logDir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => ({ name, at: statSync(path.join(logDir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)[0];
    if (!newest) return null;
    const lines = readFileSync(path.join(logDir, newest.name), 'utf8')
      .split(/\r?\n/)
      .filter((line) => /error|fatal|crash/i.test(line));
    if (lines.length === 0) return null;
    // Last few only: the point is a hint, not a log dump in a jsonb column.
    return lines.slice(-3).join(' | ').slice(0, 600);
  } catch {
    return null;
  }
}

/**
 * Downloads a file support attached to this till's ticket, then hands it to the
 * OS to open.
 *
 * Saved under userData/support so it never lands in a shared temp directory, and
 * opened through shell.openPath — the OS shows its own prompt for an executable.
 * The app never runs it directly and never elevates.
 */
async function downloadSupportAttachment(attachmentId, fileName) {
  const state = loadSecureState();
  if (!state.activation?.serverDeviceId) throw new Error('Cihaz aktivləşdirilməyib');
  const response = await fetch(controlApi('/market-pos/support/attachment'), {
    method: 'POST',
    headers: { accept: 'application/octet-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ ...signedMarketDeviceAuth(state), attachmentId }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    let reason = 'Fayl yüklənmədi';
    try {
      const problem = await response.json();
      if (problem?.error) reason = problem.error;
    } catch { /* binary or empty body */ }
    throw new Error(reason);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = userDataFile('support');
  mkdirSync(dir, { recursive: true });
  // basename only: the name comes from the server and must not walk the path.
  const safeName = path.basename(String(fileName || 'file')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const target = path.join(dir, `${attachmentId}-${safeName || 'file'}`);
  writeFileSync(target, bytes, { mode: 0o600 });
  return target;
}

/**
 * Turns a control-plane failure into something a cashier can act on.
 *
 * The raw strings are English server text ("Not Found", "Device not
 * recognized") and meaningless at a till, so each status gets the sentence that
 * says what to do next.
 */
function explainSupportStatus(status, fallback) {
  if (status === 404) return 'Dəstək xidməti bu serverdə hələ aktiv deyil. possistem.az ilə əlaqə saxlayın.';
  if (status === 401 || status === 403) {
    return 'Bu kassa serverdə tanınmır. Parametrlər → Aktivasiya bölməsindən cihazı aktivləşdirin.';
  }
  if (status >= 500) return 'Dəstək serverində problem var. Bir azdan yenidən cəhd edin.';
  return fallback || 'Dəstək serverinə qoşulmaq olmadı';
}

async function callMarketSupport(pathname, extra = {}) {
  const state = loadSecureState();
  if (!state.activation?.serverDeviceId) {
    throw new Error('Cihaz aktivləşdirilməyib — dəstək üçün əvvəlcə aktivləşdirin.');
  }
  let response;
  try {
    response = await fetch(controlApi(pathname), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ ...signedMarketDeviceAuth(state), ...extra }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/abort|timeout/i.test(raw)) throw new Error('Dəstək serveri cavab vermir. İnternet bağlantısını yoxlayın.');
    throw new Error('İnternet bağlantısı yoxdur.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(explainSupportStatus(response.status, payload.error));
    error.status = response.status;
    throw error;
  }
  return payload;
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
  if (!TRUSTED_LICENSE_KEY_IDS.has(keyId)) throw new Error('Lisenziya imza açarı gözlənilən açarla uyğun deyil');
  if (state.pinnedLicenseKey && state.pinnedLicenseKey.keyId !== keyId) throw new Error('Lisenziya imza açarı gözlənilmədən dəyişib');
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(key.publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
  const valid = verifySignature(null, Buffer.from(JSON.stringify(envelope.payload)), publicKey, Buffer.from(envelope.signature, 'hex'));
  if (!valid) throw new Error('Aktivasiya imzası yoxlamadan keçmədi');
  if (envelope.payload.deviceFingerprint !== state.activation.deviceId || envelope.payload.status !== 'active') throw new Error('Lisenziya bu cihaz üçün aktiv deyil');
  if (envelope.payload.devicePublicKey && envelope.payload.devicePublicKey !== state.deviceProof.publicKeyHex) throw new Error('Lisenziya cihaz imza açarı ilə uyğun deyil');
  if (state.tenant?.customerId && String(envelope.payload.customerId || '') !== String(state.tenant.customerId)) {
    throw new Error('Aktivasiya açarı bu müştəri hesabına aid deyil');
  }
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
    licenseProof: { signedLicense: envelope, signingKey: key },
  };
  saveSecureState(state);
  return state.activation;
}

/**
 * A renewal made on the website, carried by the heartbeat. Checked exactly like
 * an activation; only a later end date is taken, so the till never shortens
 * itself or rewrites its state on every heartbeat.
 */
function applyLicenseRefresh(state, refresh) {
  const next = Date.parse(String(refresh?.license?.validUntil || ''));
  if (!refresh?.signedLicense || !Number.isFinite(next)) return false;
  if (state.activation.mode === 'active' && next <= state.activation.validUntil) return false;
  const customer = state.activation.customer || {};
  verifyOnlineLicense({
    ...refresh,
    restaurant: { name: customer.legalName || state.activation.customerName, address: customer.address, phone: customer.phone, taxId: customer.taxId },
  }, state);
  return true;
}

async function redeemMarketActivation(state, activationKey) {
  const key = String(activationKey || '').trim();
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
      product: 'market',
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.error || `Aktivasiya serveri xətası (${response.status})`);
  }
  return verifyOnlineLicense(await response.json(), state);
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
    loginLimiter.assertOpen(userId);
    const user = state.staff.find((row) => row.id === userId && row.active);
    if (!user || !pinMatches(user, pin)) {
      loginLimiter.fail(userId);
      throw new Error('Giriş kodu yanlışdır');
    }
    loginLimiter.succeed(userId);
    const issued = authSessions.issue(userId);
    // Remembered so core calls can be attributed without every renderer call
    // site having to carry the token: one till, one signed-in operator.
    currentSessionToken = issued.token;
    // Persisted so a restart does not ask for the PIN again - within the
    // session's absolute cap, which counts from this sign-in.
    state.staffSession = issued;
    saveSecureState(state);
    // An account still on a published PIN gets a session that can do exactly one
    // thing: market:auth:changePin (the renderer shows that screen first).
    return { ...publicStaff(user), sessionToken: issued.token };
  });
  ipcMain.handle('market:auth:logout', (event, token) => {
    assertTrusted(event);
    authSessions.revoke(String(token));
    if (currentSessionToken === String(token)) currentSessionToken = '';
    // Explicit logout is the one thing that ends the persisted session.
    const state = loadSecureState();
    if (state.staffSession) {
      state.staffSession = null;
      saveSecureState(state);
    }
    return true;
  });

  /**
   * Sets the signed-in operator's own PIN. The one call an account on a
   * published PIN may make; a published PIN is never accepted as the new one.
   */
  ipcMain.handle('market:auth:changePin', (event, input) => {
    assertTrusted(event);
    const user = requireSession(input?.sessionToken, undefined, { allowDefaultPin: true });
    const pin = String(input?.newPin || '');
    assertAcceptablePin(pin);
    const state = loadSecureState();
    const credential = newPinCredential(pin);
    state.staff = state.staff.map((row) => (row.id === user.id ? { ...row, ...credential } : row));
    saveSecureState(state);
    return publicStaff({ ...user, ...credential });
  });

  /**
   * Restores the signed-in cashier after a restart, or null if nobody is.
   *
   * The renderer calls this before showing the PIN pad: the session lives in the
   * encrypted secure state, so it survives an app close, a crash and a reboot -
   * but not its absolute cap.
   */
  ipcMain.handle('market:auth:current', (event) => {
    assertTrusted(event);
    const state = loadSecureState();
    const stored = state.staffSession;
    if (!stored?.token || !stored.userId) return null;
    // The licence gate still applies — a revoked or expired licence must not be
    // bypassable just by having been logged in before.
    if (!licenseAllowsStaffLogin(state.activation)) return null;
    const user = state.staff.find((row) => row.id === stored.userId && row.active);
    const token = user ? authSessions.restore(stored) : null;
    if (!token) {
      state.staffSession = null;
      saveSecureState(state);
      return null;
    }
    currentSessionToken = token;
    return { ...publicStaff(user), sessionToken: token };
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
    const hwid = tenantBindFingerprint();
    const response = await fetch(controlApi('/tenant/login'), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, client: 'pos', hwid, product: 'market' }),
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
      customerName: String(customer.name || 'Market POS'),
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
    authSessions.clear();
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
    if (!existing || pin) assertAcceptablePin(pin);
    const { salt, pinHash } = pin ? newPinCredential(pin) : existing;
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
    }
    // An ended licence still asks: the partner may have renewed it on the website.
    if (!['active', 'expired', 'revoked'].includes(state.activation.mode) || !state.activation.serverDeviceId) return state.activation;
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
      if (response.status === 401 || response.status === 404) {
        state.activation.mode = 'revoked';
        saveSecureState(state);
        return state.activation;
      }
      if (response.status === 403) {
        // The licence, not the device: an unpaid one can come back after renewal.
        const refused = await response.json().catch(() => ({}));
        state.activation.mode = refused?.code === 'LICENSE_REVOKED' ? 'revoked' : 'expired';
        saveSecureState(state);
        return state.activation;
      }
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload?.licenseRefresh) {
          try { applyLicenseRefresh(state, payload.licenseRefresh); } catch (error) { console.warn('[market] license refresh rejected', error?.message || error); }
        }
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
    const activation = await redeemMarketActivation(state, input?.activationKey);
    if (syncService) await syncService.stop().catch(() => undefined);
    await coreSupervisor.stop();
    await coreSupervisor.start(activation.customerId || '_default');
    syncService = createSyncService();
    await syncService.start().catch((error) => console.error('[market-sync]', error.message || error));
    return activation;
  });
  ipcMain.handle('market:update:status', (event) => { assertTrusted(event); return updateStatus; });
  ipcMain.handle('market:update:check', async (event, token) => { assertTrusted(event); requireSession(token, ['manager']); if (!autoUpdater) return setUpdateStatus({ state: 'disabled', message: 'Yeniləmə yalnız Setup versiyasında işləyir' }); try { await autoUpdater.checkForUpdates(); return updateStatus; } catch (error) { return updateErrorStatus(error); } });
  ipcMain.handle('market:update:install', (event, token) => { assertTrusted(event); requireSession(token, ['manager']); if (!autoUpdater || updateStatus.state !== 'downloaded') throw new Error('Hazır yeniləmə yoxdur'); autoUpdater.quitAndInstall(true, true); return true; });
  ipcMain.handle('market:app:info', (event) => { assertTrusted(event); return { version: app.getVersion(), updateUrl: UPDATE_URL, controlUrl: CONTROL_URL, packaged: app.isPackaged }; });
  ipcMain.handle('market:backup:status', (event) => {
    assertTrusted(event); const backup = loadSecureState().backup;
    return { configured: Boolean(backup?.directory && backup?.password), directory: backup?.directory || '', lastBackupAt: backup?.lastBackupAt || 0, retentionDays: backup?.retentionDays || 30 };
  });
  ipcMain.handle('market:backup:configure', async (event, input) => {
    assertTrusted(event); await requireCorePermission(input?.sessionToken, 'BACKUP_MANAGE');
    let directory = String(input?.directory || '');
    if (!directory) {
      const selected = await dialog.showOpenDialog(mainWindow, { title: 'Market POS backup qovluğu', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      directory = selected.filePaths[0];
    }
    const password = String(input?.password || '');
    if (password.length < 8) throw new Error('Backup parolu minimum 8 simvol olmalıdır');
    const state = loadSecureState(); state.backup = { ...state.backup, directory, password, retentionDays: 30 }; saveSecureState(state);
    return { configured: true, directory, lastBackupAt: state.backup.lastBackupAt || 0, retentionDays: 30 };
  });
  ipcMain.handle('market:backup:create', async (event, input) => { assertTrusted(event); const reason = input?.reason || 'manual'; await requireCorePermission(input?.sessionToken, reason === 'z-close' ? 'CLOSE_SHIFT' : 'BACKUP_MANAGE'); return createEncryptedBackup(reason); });
  ipcMain.handle('market:backup:list', (event) => {
    assertTrusted(event); const backup = loadSecureState().backup;
    if (!backup?.directory || !existsSync(backup.directory)) return [];
    return readdirSync(backup.directory).filter((name) => /^MarketPos-.*\.mposbak$/.test(name)).map((name) => { const fullPath = path.join(backup.directory, name); const stat = statSync(fullPath); return { name, path: fullPath, sizeBytes: stat.size, createdAt: stat.mtimeMs }; }).sort((a, b) => b.createdAt - a.createdAt);
  });
  ipcMain.handle('market:backup:restore', async (event, input) => {
    assertTrusted(event); await requireCorePermission(input?.sessionToken, 'BACKUP_MANAGE');
    let file = String(input?.file || '');
    if (!file) { const selected = await dialog.showOpenDialog(mainWindow, { title: 'Market POS backup bərpası', properties: ['openFile'], filters: [{ name: 'Market POS Backup', extensions: ['mposbak'] }] }); if (selected.canceled || !selected.filePaths[0]) return null; file = selected.filePaths[0]; }
    const state = loadSecureState(); const password = String(input?.password || state.backup?.password || '');
    const restored = decryptDatabase(readFileSync(file), password); const customerId = state.activation?.customerId || '_default';
    if (restored.subarray(0, 16).toString('ascii') !== 'SQLite format 3\u0000') throw new Error('Backup SQLite bazası deyil');
    await coreSupervisor.stop();
    try { const dbPath = coreSupervisor.dbPath; const stamp = Date.now(); if (existsSync(dbPath)) renameSync(dbPath, `${dbPath}.before-restore-${stamp}`); for (const suffix of ['-wal', '-shm']) { if (existsSync(`${dbPath}${suffix}`)) renameSync(`${dbPath}${suffix}`, `${dbPath}${suffix}.before-restore-${stamp}`); } writeFileSync(`${dbPath}.tmp`, restored, { mode: 0o600 }); renameSync(`${dbPath}.tmp`, dbPath); }
    finally { await coreSupervisor.start(customerId); }
    return { restored: true, file };
  });
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
      if (response.ok && payload?.licenseRefresh) {
        try { applyLicenseRefresh(state, payload.licenseRefresh); } catch (error) { console.warn('[market] license refresh rejected', error?.message || error); }
      }
      if (response.ok && Number.isInteger(payload?.config?.loyaltyRateBps)) {
        await coreSupervisor.invoke('settings.setValue', {
          key: 'loyaltyRateBps',
          value: payload.config.loyaltyRateBps,
          actorId: 'system',
        }).catch(() => undefined);
      }
      // Two queues share this answer: the owner's X/Z report requests, which the
      // sync service runs and reports back, and portal stock/cash documents,
      // which the screen applies with the signed-in operator's rights.
      const allCommands = Array.isArray(payload?.commands) ? payload.commands : [];
      const ownerCommands = allCommands.filter((row) => row?.kind === 'x_report' || row?.kind === 'z_report');
      if (response.ok && ownerCommands.length && syncService) {
        await syncService.dispatchCommands(state, ownerCommands).catch(() => undefined);
      }
      return { connected: response.ok, status: response.status, config: payload?.config, inventory: payload.inventory !== false, access: Array.isArray(payload.access) ? payload.access : null, device: payload.device && typeof payload.device === 'object' ? { station: String(payload.device.station || 'all') } : null, commands: allCommands.filter((row) => !ownerCommands.includes(row)) };
    } catch (error) { return { connected: false, reason: error.message || String(error) }; }
  });
  ipcMain.handle('market:sync:status', (event) => { assertTrusted(event); return syncService?.status || { mode: 'offline', pending: 0, peerCount: 0, vpsConnected: false }; });
  ipcMain.handle('market:sync:bootstrap', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager']);
    if (!syncService) throw new Error('Sinxron xidməti hazır deyil');
    return syncService.bootstrap();
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
        // requireSession refuses an account still on a published PIN, so such a
        // session reaches the core with no role at all and is refused there.
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
  ipcMain.handle('market:support:request', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken);
    const message = String(input?.message || '').trim().slice(0, 4000);
    if (!message) throw new Error('Mesaj boşdur');
    return callMarketSupport('/market-pos/support/request', {
      message,
      diagnostics: collectSupportDiagnostics(),
    });
  });
  ipcMain.handle('market:support:download', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken);
    const id = String(input?.attachmentId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Fayl identifikatoru düzgün deyil');
    const savedTo = await downloadSupportAttachment(id, input?.fileName);
    // Only the OS opens it; a failure here still leaves the saved file.
    const openError = await shell.openPath(savedTo);
    return { savedTo, opened: !openError, error: openError || null };
  });
  ipcMain.handle('market:support:thread', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken);
    try {
      return await callMarketSupport('/market-pos/support/active', {});
    } catch (err) {
      // "No conversation yet" rather than an error banner flashing every 5 s.
      if (err?.status && err.status < 500) return { ok: true, ticket: null, messages: [] };
      throw err;
    }
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

  printerProvider = registerHardwareIpc({ ipcMain, app, coreSupervisor, assertTrusted, requireSession, requireCorePermission, verifyManagerPin });
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

function createSyncService() {
  const controlOrigin = (() => {
    try { return new URL(CONTROL_URL).origin; } catch { return 'https://possistem.az'; }
  })();
  const allowedHosts = new Set([
    (() => { try { return new URL(CONTROL_URL).hostname.toLowerCase(); } catch { return 'possistem.az'; } })(),
    'possistem.az',
    'www.possistem.az',
  ]);
  return new MarketSyncService({
    core: coreSupervisor,
    getState: loadSecureState,
    controlApi,
    appVersion: () => app.getVersion(),
    rewriteEvents: rewriteSyncEvents,
    hydrateImages: () => cacheCatalogImages({
      userData: app.getPath('userData'),
      core: coreSupervisor,
      controlOrigin,
      allowedHosts,
    }),
    onStatus: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:sync:changed', status);
    },
    onReport: async (report) => {
      // A remote X/Z must not be reported as done when the output only went to
      // the local stub file: the owner would see a success in the web panel and
      // no paper at the till.
      if (!printerProvider || printerProvider.physical === false) {
        throw new Error('Çap edilmədi — kassada printer təyin olunmayıb (Ayarlar → Printer)');
      }
      await printerProvider.printRaw(buildXzReportEscPos(report), {
        kind: String(report?.reportType || 'X').toLowerCase() === 'z' ? 'z-report' : 'x-report',
      });
    },
  });
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
  syncService = createSyncService();
  await syncService.start().catch((error) => console.error('[market-sync]', error.message || error));
  coreSupervisor.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:coreStatus', status);
  });
  coreSupervisor.on('event', (evt) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('market:coreEvent', evt);
  });
  createWindow();
  void initAutoUpdater();
  const backupTimer = setInterval(() => {
    const state = loadSecureState();
    if (state.backup?.directory && state.backup?.password && Date.now() - Number(state.backup.lastBackupAt || 0) >= 86400000) {
      void createEncryptedBackup('daily').catch((error) => console.error('[market-backup]', error.message || error));
    }
  }, 3600000);
  backupTimer.unref();
});

app.on('before-quit', (event) => {
  if (coreSupervisor.state === 'stopped') return;
  if (!coreSupervisor.child) return;
  event.preventDefault();
  void (syncService?.stop() ?? Promise.resolve()).finally(() => coreSupervisor.stop().finally(() => app.exit(0)));
});

app.on('window-all-closed', () => app.quit());
