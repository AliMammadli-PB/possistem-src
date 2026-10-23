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
// Əməliyyatlar (1.5.0): the restaurant warehouse core, run beside the till's own.
const { OpsEngine, ok: opsOk, fail: opsFail } = require('./ops-engine.cjs');
const opsEngine = new OpsEngine({ market: coreSupervisor, searchDirs: [path.resolve(__dirname, '..', '..', 'restoranpos', 'native', 'build')] });
function startOps(customerId) {
  return opsEngine.start(customerId).catch((err) => console.error('[ops-core] failed to start:', err instanceof Error ? err.message : err));
}
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
  findStaffByPin,
  pinTaken,
  mergeStaff,
} = require('./staff-auth.cjs');
const { SUPER_ADMIN, verifySuperAdmin, startsSuperAdmin, isSuperAdminPin } = require('./superadmin.cjs');
/** The account's staff plus POSSISTEM's super admin once its PIN reached this till. */
const staffWithAdmin = (state) => (state.superAdmin ? [...state.staff, SUPER_ADMIN] : state.staff);
/** A staff PIN may not start like the super admin PIN (the pad would wait for 10 digits). */
function assertNotAdminPrefix(pin) {
  if (startsSuperAdmin(loadSecureState().superAdmin, String(pin).slice(0, 4))) throw new Error('Bu PIN istifadə edilə bilməz — başqa PIN seçin');
}
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
    // 1.5.33: the shipped demo accounts (published PINs) are gone.
    const real = parsed.staff.filter((user) => !pinIsShippedDefault(user));
    if (real.length !== parsed.staff.length) { parsed.staff = real; dirty = true; }
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
  if (/^\d{10}$/.test(String(pin || ''))) {
    approvalLimiter.assertOpen('manager-approval');
    if(isSuperAdminPin(loadSecureState().superAdmin,String(pin))){approvalLimiter.succeed('manager-approval');return {ok:true,approverId:SUPER_ADMIN.id,role:SUPER_ADMIN.role};}
    approvalLimiter.fail('manager-approval');return {ok:false};
  }
  // The core checks the approver's own rights (approverRole); see core-payload.cjs.
  return verifyManagerPinAgainst(loadSecureState().staff, String(pin || ''), approvalLimiter, 'manager-approval', { anyRole: true });
}

async function operationApproval(input, actor, method) {
  try {
    const state=loadSecureState();
    return await require('./operation-approval.cjs').approveOperation({
      pin:String(input?.managerPin || input?.superAdminPin || ''),
      staff:state.staff,superAdmin:state.superAdmin,superIdentity:SUPER_ADMIN,
      verifySuperPin:isSuperAdminPin,limiter:approvalLimiter,superOnly:method==='permissions.save',
      record:approver=>coreSupervisor.invoke('auth.recordApproval', {actorId:actor.id,role:actor.role,permission:'MANAGER:'+method,approverId:approver.id})
    });
  } catch(error) {return opsFail(error.code || 'E_APPROVAL',error.message || 'Təsdiq alınmadı');}
}

/** The operator signed in at this till, or '' when nobody is. */
let currentSessionToken = '';

/**
 * The staff row behind a session token. Refuses an account still on a published
 * PIN (E_PIN_CHANGE_REQUIRED) unless `allowDefaultPin` - only the PIN-change
 * flow passes that.
 */
function requireSession(token, roles, options = {}) {
  return resolveSessionUser(authSessions, staffWithAdmin(loadSecureState()), token, { roles, ...options });
}

/**
 * Every permission key a user holds: role grants plus the super admin's
 * per-worker overrides (core); POSSISTEM's own user holds all of them.
 */
async function rightsOf(user) {
  const catalogue = await coreSupervisor.invoke('auth.permissionCatalogue', {});
  const keys = require('./operation-access.cjs').catalogueKeys(catalogue);
  if (user.superAdmin) return [...keys, 'SUPER_ADMIN'];
  const checked = await Promise.all(keys.map(async (permission) => {
    const res = await coreSupervisor.invoke('auth.checkPermission', { actorId: user.id, role: user.role, permission });
    return res?.success && res.data?.allowed ? permission : '';
  }));
  return checked.filter(Boolean);
}

async function requireCorePermission(token, permission) {
  const user = requireSession(token);
  if (user.superAdmin) return user;
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
async function syncRolePolicy(state, { force = false } = {}) {
  // The renderer pushes a heartbeat far more often than a policy changes.
  // Same pace as the heartbeat (30 s), so a role revoked on the website stops
  // working on the till in about half a minute rather than two.
  if (Date.now() - lastRolePullAt < (force ? 5000 : 30000)) return;
  if (state.activation?.mode !== 'active' || !state.activation.serverDeviceId) return;
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
    // POSSISTEM's PIN: kept only when signed with this till's licence key; an
    // explicit null (PIN removed on the website) clears it.
    if (policy && 'superAdmin' in policy) {
      const fresh = loadSecureState();
      const record = policy.superAdmin ? verifySuperAdmin(policy.superAdmin, { publicKeyHex: fresh.pinnedLicenseKey?.publicKeyHex, customerId: fresh.activation.customerId, deviceId: fresh.activation.serverDeviceId }) : null;
      if ((record || policy.superAdmin === null) && JSON.stringify(record) !== JSON.stringify(fresh.superAdmin ?? null)) {
        fresh.superAdmin = record;
        saveSecureState(fresh);
      }
    }
    const users = Array.isArray(policy?.users) ? policy.users : null;
    if (!policy?.version || !Array.isArray(policy.roles) || (policy.roles.length === 0 && !users?.length)) return;
    await coreSupervisor.invoke(
      'roles.applyPolicy',
      // users: the super admin's allow / deny for single workers (employee overrides).
      { policySource: 'control-plane', version: policy.version, roles: policy.roles, ...(users ? { users } : {}), ...(Array.isArray(policy.managedKeys) ? { managedKeys: policy.managedKeys } : {}) },
      15000,
    );
  } catch {
    // Offline, or the core is restarting: the next heartbeat tries again.
  }
}

let purgingDemo = false, demoPurgeTriedAt = 0;
/**
 * 1.5.33: older versions' demo catalogue (p-wolt-*) reached some accounts from a
 * browser cache. Once per account on every PC (the warehouse PC also takes its
 * goods out of Mallar - ops-engine purgeDemoCatalog).
 */
async function purgeDemoProducts(customerId) {
  if (purgingDemo || !customerId) return;
  // At most hourly: a product the core refuses must not rescan the catalogue every heartbeat.
  purgingDemo = true; demoPurgeTriedAt = Date.now();
  try {
    const list = await coreSupervisor.invoke('product.list', { activeOnly: true }, 60000);
    if (!list?.success || !Array.isArray(list.data)) return;
    for (const p of list.data.filter((row) => String(row.id).startsWith('p-wolt-'))) {
      const res = await coreSupervisor.invoke('product.delete', { id: p.id, actorId: 'system' }, 15000);
      if (!res?.success) return;
    }
    const state = loadSecureState();
    state.demoPurgedFor = customerId;
    saveSecureState(state);
  } catch (error) {
    console.error('[demo-purge]', error?.message || error);
  } finally {
    purgingDemo = false;
  }
}

/**
 * Branches' warehouses for each other and for the website (1.5.41): the
 * warehouse PC sends its stock when it changed (or every 5 min), and every PC
 * keeps the other branches' last copies on disk - an offline branch still shows
 * what it had when it was last online.
 */
const branchStockFile = (customerId) => userDataFile(`branch-stock-${String(customerId).replace(/[^\w-]/g, '')}.json`);
const branchStockSync = new Map();
function readBranchStock(state) {
  try {
    const cached = JSON.parse(readFileSync(branchStockFile(state.activation.customerId), 'utf8'));
    return { at: Number(cached.at) || 0, branches: Array.isArray(cached.branches) ? cached.branches : [] };
  } catch { return { at: 0, branches: [] }; }
}
async function syncBranchStock(state, force = false, knownSnapshot) {
  const activation = state.activation;
  if (activation?.mode !== 'active' || !activation.serverDeviceId || !activation.customerId) return;
  const key = activation.customerId + ':' + activation.serverDeviceId + ':' + (activation.cloudBranchId || '');
  const record = branchStockSync.get(key) || { hash: '', sentAt: 0, pulledAt: 0, pending: null };
  branchStockSync.set(key, record);
  if (record.pending) return record.pending;
  if (Date.now() - record.pulledAt < (force ? 5000 : 15000)) return;
  record.pulledAt = Date.now();
  record.pending = (async () => {
    try {
      const snapshot = knownSnapshot === undefined ? await opsEngine.stockSnapshot().catch(() => null) : knownSnapshot;
      const hash = snapshot ? createHash('sha256').update(JSON.stringify([snapshot.objectId, snapshot.warehouses, snapshot.lines, snapshot.registers])).digest('hex') : '';
      const send = Boolean(snapshot) && (hash !== record.hash || Date.now() - record.sentAt > 60000);
      const response = await fetch(controlApi('/market-pos/branch-stock'), {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ ...signedMarketDeviceCall(state), ...(send ? { snapshot } : {}) }), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return;
      const data = await response.json();
      // A pending request cannot overwrite a different account's cache after a login or branch switch.
      const current = loadSecureState().activation;
      if (current?.customerId !== activation.customerId || current?.serverDeviceId !== activation.serverDeviceId || current?.cloudBranchId !== activation.cloudBranchId) return;
      if (send) Object.assign(record, { hash, sentAt: Date.now() });
      if (Array.isArray(data?.branches)) writeFileSync(branchStockFile(activation.customerId), JSON.stringify({ at: Date.now(), branches: data.branches }));
    } catch { /* Last confirmed copies remain available while disconnected. */ }
  })().finally(() => { record.pending = null; });
  return record.pending;
}

let lastStaffSyncAt = 0;
/**
 * The account's users on every PC: send ours (salted PIN hashes, never a PIN),
 * take back anyone changed later elsewhere. Shipped placeholder accounts
 * (published PINs) are not sent; a real account with the same id replaces them.
 */
async function syncStaff(state, { force = false } = {}) {
  if (!force && Date.now() - lastStaffSyncAt < 30000) return;
  if (state.activation?.mode !== 'active' || !state.activation.serverDeviceId) return;
  lastStaffSyncAt = Date.now();
  try {
    const mine = state.staff.filter((row) => !pinIsShippedDefault(row)).map((row) => ({
      id: String(row.id), name: String(row.name || '').slice(0, 80), role: row.role, active: row.active !== false,
      salt: row.salt, pinHash: row.pinHash, registerIds: row.registerIds || [], warehouseIds: row.warehouseIds || [],
      objectId: String(row.objectId || ''), branchId: String(row.branchId || ''), placesSet: Boolean(row.placesSet), deleted: false, updatedAt: Number(row.updatedAt) || 1,
      salaryMinor: Math.max(0, Math.round(Number(row.salaryMinor) || 0)), ...(row.employeeId ? { employeeId: String(row.employeeId) } : {}),
    }));
    const response = await fetch(controlApi('/market-pos/staff/sync'), {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ ...signedMarketDeviceCall(state), staff: mine }), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const remote = (await response.json())?.staff;
    if (!Array.isArray(remote)) return;
    const fresh = loadSecureState();
    const merged = mergeStaff(fresh.staff, remote);
    if (merged !== fresh.staff) { fresh.staff = merged; saveSecureState(fresh); }
  } catch {
    // Offline: the next heartbeat tries again; sign-in uses what this PC has.
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
  // 1.5.64: a file already fetched for this ticket is shown again without another download.
  const cachedName = path.basename(String(fileName || 'file')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'file';
  const cached = path.join(userDataFile('support'), `${attachmentId}-${cachedName}`);
  if (existsSync(cached)) return cached;
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

/**
 * The owner's email/password session activates this PC (no key per PC): the
 * control plane checks the account's free PC slots and answers exactly as
 * /activation/redeem does. The device key signs the request, so a PC that was
 * another account's till before can be moved here only by itself.
 */
async function tenantActivateMarket(state) {
  if (!state.tenant?.token) throw new Error('Əvvəlcə müştəri hesabına daxil olun');
  const signedAt = new Date().toISOString();
  const nonce = randomBytes(16).toString('hex');
  const body = {
    deviceFingerprint: state.activation.deviceId, hostname: hostname(), appVersion: app.getVersion(),
    devicePublicKey: state.deviceProof.publicKeyHex, product: 'market', signedAt, nonce,
  };
  const canonical = stableStringify({ purpose: 'tenant-activate', deviceFingerprint: body.deviceFingerprint, devicePublicKey: body.devicePublicKey, signedAt, nonce });
  const privateKey = createPrivateKey({ key: Buffer.from(state.deviceProof.privateKeyPkcs8, 'base64'), type: 'pkcs8', format: 'der' });
  body.deviceSignature = signPayload(null, Buffer.from(canonical, 'utf8'), privateKey).toString('hex');
  const response = await fetch(controlApi('/tenant/pos/activate'), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${state.tenant.token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.error || `Aktivasiya serveri xətası (${response.status})`);
  }
  return verifyOnlineLicense(await response.json(), state);
}

/**
 * Another account signed in on this PC: the users, sign-in and activation were
 * the previous account's (its PINs kept working, its objects were refused).
 * Start this account clean: activate with its key, its users come from the cloud.
 * Mutates state; the caller saves. Returns whether anything was reset.
 */
async function forgetPreviousAccount(state) {
  const previous = String(state.activation?.customerId || state.lastCustomerId || '');
  const current = String(state.tenant?.customerId || '');
  if (!previous || !current || previous === current) return false;
  state.staff = DEFAULT_STAFF;
  state.staffSession = null;
  state.pinnedLicenseKey = null;
  state.superAdmin = null;
  state.activation = { ...defaultSecureState().activation, deviceId: state.activation.deviceId, customerName: state.tenant.customerName };
  state.lastCustomerId = current;
  authSessions.clear();
  currentSessionToken = '';
  if (syncService) await syncService.stop().catch(() => undefined);
  await opsEngine.stop().catch(() => undefined);
  return true;
}

function registerIpc() {
  ipcMain.handle('market:staff:list', (event) => { assertTrusted(event); return loadSecureState().staff.map(publicStaff); });
  ipcMain.handle('market:auth:login', async (event, input) => {
    assertTrusted(event);
    const state = loadSecureState();
    if (!state.tenant?.token) throw new Error('Əvvəlcə müştəri hesabına daxil olun');
    if (!licenseAllowsStaffLogin(state.activation)) throw new Error('Cihaz aktivləşdirilməyib');
    if (state.activation.customerId && state.activation.customerId !== state.tenant.customerId) {
      throw new Error('Bu kassa başqa hesabın lisenziyası ilədir — bu hesabın aktivasiya açarını daxil edin');
    }
    const pin = String(input?.pin || '');
    // No userId: the PIN alone names the person, as on the restaurant till.
    // The till, not an account, is what gets guessed at, so it is what locks.
    const limiterKey = String(input?.userId || '') || 'pin-only';
    loginLimiter.assertOpen(limiterKey);
    const user = isSuperAdminPin(state.superAdmin, pin) ? SUPER_ADMIN : input?.userId
      ? state.staff.find((row) => row.id === String(input.userId) && row.active && pinMatches(row, pin))
      : findStaffByPin(state.staff, pin);
    if (!user) {
      loginLimiter.fail(limiterKey);
      throw new Error('Giriş kodu yanlışdır');
    }
    // A worker POSSISTEM put in one filial signs in only on that filial's PCs.
    if (!user.superAdmin && user.branchId && state.activation.cloudBranchId && user.branchId !== state.activation.cloudBranchId) {
      loginLimiter.fail(limiterKey);
      throw new Error('Bu işçi bu filiala aid deyil');
    }
    // A user bound to kassas on the users screen signs in only at those kassas.
    const here = opsEngine.cashCurrentRegisterId;
    // Unknown kassa (a new PC before its kassa is set up): staff wait, a manager may sign in to set it up.
    if (!user.superAdmin && user.placesSet && user.registerIds?.length && (here ? !user.registerIds.includes(here) : user.role !== 'manager')) {
      throw new Error('Bu istifadəçi bu kassaya bağlı deyil');
    }
    if (!user.superAdmin && user.objectId && !user.branchId) {
      const local=await opsEngine.branchContext().catch(()=>{throw Error('Anbar sistemi açılır — bir neçə saniyədən sonra yenidən daxil olun');});
      if(!local.objectId||local.objectId!==user.objectId)throw Error('Bu istifadəçi bu filialə bağlı deyil');
    }
    if(!user.superAdmin&&user.branchId&&!state.activation.cloudBranchId)throw Error('Filial bağlantısı yenilənməlidir');
    loginLimiter.succeed(limiterKey);
    const userId = user.id;
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
  // The PIN pad asks after 4 digits whether to wait for POSSISTEM's 10.
  // A PIN set on the website a moment ago: asked for once more before saying no.
  ipcMain.handle('market:auth:adminPrefix', async (event, digits) => {
    assertTrusted(event);
    const state = loadSecureState();
    if (!state.superAdmin) await syncRolePolicy(state, { force: true });
    return startsSuperAdmin(loadSecureState().superAdmin, String(digits || ''));
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
    assertNotAdminPrefix(pin);
    const state = loadSecureState();
    // Sign-in is by PIN alone, so two people may never share one.
    if (pinTaken(state.staff, pin, user.id)) throw new Error('Bu PIN artıq başqa işçidə var - başqa PIN seçin');
    const credential = newPinCredential(pin);
    const updatedAt = Date.now();
    state.staff = state.staff.map((row) => (row.id === user.id ? { ...row, ...credential, updatedAt } : row));
    saveSecureState(state);
    void syncStaff(state);
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
    const user = staffWithAdmin(state).find((row) => row.id === stored.userId && row.active);
    const token = user ? authSessions.restore(stored) : null;
    if (!token) {
      state.staffSession = null;
      saveSecureState(state);
      return null;
    }
    currentSessionToken = token;
    return { ...publicStaff(user), sessionToken: token };
  });
  // Technical support chat (1.5.49): the till talks to possistem support through the owner account's
  // tenant token — the same ticket the console and the support APK answer. Works before a staff PIN.
  const supportCall = async (pathname, init = {}) => {
    const state = loadSecureState();
    if (!state.tenant?.token) throw new Error('Dəstək çatı üçün əvvəlcə sahibkar hesabına daxil olun');
    const response = await fetch(controlApi(pathname), { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${state.tenant.token}` }, signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 401 ? 'Hesab sessiyası bitib. Sahibkar hesabına yenidən daxil olun.' : (data?.error || `Server xətası (${response.status})`));
    return data;
  };
  const supportId = (value) => { const id = String(value || ''); if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Sorğu tapılmadı'); return id; };
  ipcMain.handle('market:support:active', async (event) => { assertTrusted(event); return supportCall('/customer/support/active'); });
  ipcMain.handle('market:support:send', async (event, input) => {
    assertTrusted(event);
    const body = String(input?.body || '').trim().slice(0, 4000);
    if (!body) throw new Error('Mesaj boşdur');
    if (!input?.ticketId) return supportCall('/customer/support/request', { method: 'POST', body: JSON.stringify({ message: body }) });
    return supportCall(`/customer/support/tickets/${supportId(input.ticketId)}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
  });
  // 1.5.64: a file support sent in the chat (message meta.attachment). Works before a staff PIN,
  // like the chat itself; the download is signed with this device. Images up to 15 MB come back as
  // a data URL to show in the chat; `open` hands the saved file to the OS.
  ipcMain.handle('market:support:file', async (event, input) => {
    assertTrusted(event);
    const id = String(input?.attachmentId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Fayl identifikatoru düzgün deyil');
    const savedTo = await downloadSupportAttachment(id, input?.fileName);
    if (input?.open) {
      const openError = await shell.openPath(savedTo);
      return { savedTo, opened: !openError, error: openError || null };
    }
    const mime = String(input?.mimeType || '').toLowerCase();
    const image = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(savedTo);
    if (!image || statSync(savedTo).size > 15 * 1024 * 1024) return { savedTo, dataUrl: null };
    const type = /^image\//.test(mime) ? mime : `image/${(path.extname(savedTo).slice(1).toLowerCase().replace('jpg', 'jpeg')) || 'png'}`;
    return { savedTo, dataUrl: `data:${type};base64,${readFileSync(savedTo).toString('base64')}` };
  });
  ipcMain.handle('market:support:messages', async (event, input) => {
    assertTrusted(event);
    const after = input?.after && !Number.isNaN(Date.parse(input.after)) ? `?after=${encodeURIComponent(new Date(input.after).toISOString())}` : '';
    return supportCall(`/customer/support/tickets/${supportId(input?.ticketId)}/messages${after}`);
  });
  ipcMain.handle('market:tenant:status', async (event) => {
    assertTrusted(event);
    const state = loadSecureState();
    // Signed in to another account under 1.5.30 (no reset then): reset now.
    if (await forgetPreviousAccount(state)) saveSecureState(state);
    return publicTenant(state.tenant);
  });
  ipcMain.handle('market:tenant:login', async (event, input) => {
    assertTrusted(event);
    const email = String(input?.email || '').trim();
    const password = String(input?.password || '');
    if (!email || !password) throw new Error('Email və parol tələb olunur');
    const hwid = tenantBindFingerprint();
    const payload = await require('./tenant-auth.cjs').tenantLogin({endpoint:controlApi('/tenant/login'),email,password,hwid});
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
    const switched = await forgetPreviousAccount(state);
    state.lastCustomerId = state.tenant.customerId;
    if (state.activation.mode === 'unlicensed' || state.activation.mode === 'trial') {
      state.activation.customerName = state.tenant.customerName;
    }
    saveSecureState(state);
    return { ...publicTenant(state.tenant), ...(switched ? { switched: true } : {}) };
  });
  ipcMain.handle('market:tenant:logout', (event) => {
    assertTrusted(event);
    const state = loadSecureState();
    const token = state.tenant?.token;
    if (token) void fetch(controlApi('/tenant/logout'), { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
    state.tenant = null;
    state.staffSession = null;
    saveSecureState(state);
    authSessions.clear();
    currentSessionToken = '';
    return { ok: true };
  });
  /**
   * Users are created here; what they may do is not. Rights come from
   * POSSISTEM (the super admin's role policy and per-worker overrides, applied
   * by syncRolePolicy), so the shop's admin needs MANAGE_USERS and grants nothing.
   */
  ipcMain.handle('market:staff:save', async (event, input) => {
    assertTrusted(event);
    const actor = await requireCorePermission(input?.sessionToken, 'MANAGE_USERS');
    const state = loadSecureState();
    const profile = input?.profile || {};
    if(profile.active===false){const approval=await operationApproval(input,actor,'staff.deactivate');if(!approval.success)return approval;}
    const roles = ['manager', 'head_cashier', 'cashier', 'warehouse'];
    if (!String(profile.name || '').trim() || !roles.includes(profile.role)) throw new Error('İstifadəçi məlumatı düzgün deyil');
    const existing = state.staff.find((row) => row.id === profile.id);
    if (actor.role !== 'manager' && (profile.role === 'manager' || existing?.role === 'manager')) throw new Error('Müdir hesabını yalnız müdir dəyişə bilər');
    if (existing?.id === actor.id && (profile.role !== existing.role || profile.active === false)) throw new Error('Öz rolunuzu və ya aktivliyinizi dəyişə bilməzsiniz');
    const pin = String(input?.pin || '');
    if (!existing || pin) { assertAcceptablePin(pin); assertNotAdminPrefix(pin); }
    if (pin && pinTaken(state.staff, pin, existing?.id)) throw new Error('Bu PIN artıq başqa işçidə var - başqa PIN seçin');
    const { salt, pinHash } = pin ? newPinCredential(pin) : existing;
    const ids = (list) => (Array.isArray(list) ? [...new Set(list.map(String))].slice(0, 20) : []);
    await opsEngine.syncOwnerObject();
    const places=await require('./staff-places.cjs').staffPlaces({core:coreSupervisor,ops:opsEngine,network:()=>cloudBranches.list(),activation:state.activation,cache:opsEngine.settings().staffPlacesCache,links:opsEngine.settings().cloudObjectLinks||{},remote:(id,calls)=>cloudBranches.rpc(id,calls),allowedBranchId:actor.branchId||''});
    const object=require('./staff-places.cjs').validatePlaces(places,profile,actor);
    const next = {
      id: existing?.id || `u-${Date.now()}`, name: String(profile.name).trim().slice(0, 80), role: profile.role, active: profile.active !== false,
      registerIds: ids(profile.registerIds), warehouseIds: profile.warehouseIds ? ids(profile.warehouseIds) : existing?.warehouseIds || [],
      objectId: String(object?.id || '').slice(0,80),
      // Bind login access to the selected owner's cloud location; credentials never grant another owner.
      branchId: String(object?.branchId || (profile.objectId?existing?.branchId||'':'')),
      // Set by the users screen: from then on sign-in honours the kassa binding.
      placesSet: true, ...(existing?.employeeId?{employeeId:existing.employeeId}:{}), salt, pinHash, updatedAt: Date.now(),
    };
    const managers = (rows) => rows.filter((row) => row.role === 'manager' && row.active).length;
    const after = existing ? state.staff.map((row) => row.id === existing.id ? next : row) : [...state.staff, next];
    if (managers(state.staff) > 0 && managers(after) === 0) throw new Error('Ən azı bir aktiv müdir qalmalıdır');
    state.staff = after;
    saveSecureState(state);
    void syncStaff(state);
    return publicStaff(next);
  });
  /** What a user may do here (rights come from POSSISTEM); another user's needs MANAGE_USERS. */
  const readPermissions = async () => {
    const state=loadSecureState();
    const response=await fetch(controlApi('/market-pos/roles'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(signedMarketDeviceCall(state)),signal:AbortSignal.timeout(10000)});
    const data=await response.json();if(!response.ok)throw Error(data.error || 'İcazələr yüklənmədi');return data;
  };
  ipcMain.handle('market:permissions:get', async(event,input)=>{
    assertTrusted(event);const actor=requireSession(input?.sessionToken);if(!actor.superAdmin)throw Error('İcazələri yalnız superadmin dəyişə bilər');
    return readPermissions();
  });
  ipcMain.handle('market:permissions:save', async(event,input)=>{
    assertTrusted(event);const actor=requireSession(input?.sessionToken);if(!actor.superAdmin)throw Error('İcazələri yalnız superadmin dəyişə bilər');
    const approval=await operationApproval(input,actor,'permissions.save');if(!approval.success)return approval;
    const response=await fetch(controlApi('/market-pos/roles/edit'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...signedMarketDeviceCall(loadSecureState()),role:input.role,permissions:input.permissions,expectedVersion:input.expectedVersion,superAdminPin:input.superAdminPin}),signal:AbortSignal.timeout(20000)});
    const data=await response.json();if(!response.ok)throw Error(data.error || 'İcazələr saxlanmadı');
    lastRolePullAt=0;await syncRolePolicy(loadSecureState(),{force:true});return readPermissions();
  });
  ipcMain.handle('market:auth:rights', async (event, input) => {
    assertTrusted(event);
    const me = requireSession(input?.sessionToken);
    const userId = String(input?.userId || me.id);
    if (userId !== me.id) await requireCorePermission(input?.sessionToken, 'MANAGE_USERS');
    const user = staffWithAdmin(loadSecureState()).find((row) => row.id === userId);
    return user ? rightsOf(user) : [];
  });
  ipcMain.handle('market:staff:delete', async (event, input) => {
    assertTrusted(event);
    const actor = await requireCorePermission(input?.sessionToken, 'MANAGE_USERS');
    const state = loadSecureState();
    const target = state.staff.find((row) => row.id === String(input?.id || ''));
    if (!target) throw new Error('İstifadəçi tapılmadı');
    if (target.id === actor.id) throw new Error('Öz hesabınızı silə bilməzsiniz');
    if (target.role === 'manager' && actor.role !== 'manager') throw new Error('Müdir hesabını yalnız müdir silə bilər');
    if (target.role === 'manager' && state.staff.filter((row) => row.role === 'manager' && row.active && row.id !== target.id).length === 0) throw new Error('Ən azı bir aktiv müdir qalmalıdır');
    const approval = await operationApproval(input, actor, 'staff.delete'); if (!approval.success) return approval;
    target.active = false;
    target.updatedAt = Date.now();
    saveSecureState(state);
    void syncStaff(state);
    // Their open session ends with the row: every session check looks the user up.
    return { ok: true };
  });
  /** Objects (Filiallar) and kassas a user can be bound to; kassas from Market, objects from the warehouse. */
  ipcMain.handle('market:staff:places', async (event, input) => {
    assertTrusted(event);
    const actor=await requireCorePermission(input?.sessionToken, 'MANAGE_USERS');
    await opsEngine.syncOwnerObject();
    const result=await require('./staff-places.cjs').staffPlaces({core:coreSupervisor,ops:opsEngine,network:()=>cloudBranches.list(),activation:loadSecureState().activation,cache:opsEngine.settings().staffPlacesCache,links:opsEngine.settings().cloudObjectLinks||{},remote:(id,calls)=>cloudBranches.rpc(id,calls),allowedBranchId:actor.branchId||''});
    if(!result.offline)opsEngine.saveSettings({staffPlacesCache:{objects:result.cloudObjects}});
    return result;
  });
  ipcMain.handle('market:display:get', (event) => { assertTrusted(event); return { prefs: loadDisplayPrefs(), presets: [{ id: 'fullscreen', label: 'Tam ekran', mode: 'fullscreen', width: 0, height: 0 }, { id: '1920x1080', label: '1920×1080', mode: 'windowed', width: 1920, height: 1080 }, { id: '1600x900', label: '1600×900', mode: 'windowed', width: 1600, height: 900 }, { id: '1366x768', label: '1366×768', mode: 'windowed', width: 1366, height: 768 }, { id: '1024x768', label: '1024×768', mode: 'windowed', width: 1024, height: 768 }] }; });
  ipcMain.handle('market:display:set', (event, input) => { assertTrusted(event); requireSession(input?.sessionToken, ['manager']); return saveDisplayPrefs(input); });
  ipcMain.handle('market:display:toggle', (event) => { assertTrusted(event); return toggleFullscreen(); });
  // LAN label scale (1.5.51): Mallar → Tərəziyə çıxış; ops-engine resends goods on every change.
  const scaleCfg = () => opsEngine.settings().scaleLan || {};
  const scaleUser = (event, input) => { assertTrusted(event); requireSession(input?.sessionToken, ['manager', 'warehouse']); };
  ipcMain.handle('market:scale:get', (event, input) => { scaleUser(event, input); const c = scaleCfg(); return { ip: c.ip || '', prefix: c.prefix || '20', auto: c.auto !== false, last: c.last || '', labelNo: Number(c.labelNo) || 0 }; });
  ipcMain.handle('market:scale:set', (event, input) => {
    scaleUser(event, input);
    const ip = String(input?.ip || '').trim();
    if (ip && !require('node:net').isIPv4(ip)) throw new Error('Tərəzinin IP ünvanı düzgün deyil');
    const prefix = /^2\d$/.test(String(input?.prefix)) ? String(input.prefix) : '20';
    // 1.5.61: the scale's print format per PLU; a caller that does not send it keeps the saved one.
    const labelNo = input?.labelNo === undefined ? Number(scaleCfg().labelNo) || 0 : Number(input.labelNo);
    if (!Number.isInteger(labelNo) || labelNo < 0 || labelNo > 39) throw new Error('Etiket formatı 0–39 olmalıdır');
    opsEngine.saveSettings({ scaleLan: { ...scaleCfg(), ip, prefix, auto: input?.auto !== false, labelNo, sig: '' } });
    return true;
  });
  ipcMain.handle('market:scale:scan', async (event, input) => { scaleUser(event, input); return require('./scale-lan.cjs').scan(); });
  ipcMain.handle('market:scale:send', async (event, input) => { scaleUser(event, input); return opsEngine.scaleSync({ force: true }); });
  ipcMain.handle('market:scale:diagnose', async (event, input) => {
    scaleUser(event, input);
    const c = scaleCfg();
    const goods = await opsEngine.invoke('goods.list', {}, { timeoutMs: 60000 }).catch(() => null);
    const header = [`time ${new Date().toISOString()}`, `MarketPos ${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform} ${require('node:os').release()}`];
    const result = await require('./scale-lan.cjs').diagnose({ ip: c.ip, prefix: c.prefix || '20', goods: goods?.success ? goods.data?.goods ?? [] : [], header });
    const file = path.join(app.getPath('userData'), 'scale-diagnostics.txt');
    try { writeFileSync(file, result.log, 'utf8'); result.log += `\n\nsaved to ${file}`; } catch { /* log still shown */ }
    return result;
  });
  ipcMain.handle('market:scale:test', async (event, input) => {
    scaleUser(event, input);
    const lan = require('./scale-lan.cjs'), c = scaleCfg();
    if (!c.ip) throw new Error('Tərəzinin IP ünvanı yazılmayıb');
    const goods = await opsEngine.invoke('goods.list', {}, { timeoutMs: 60000 }).catch(() => null);
    const plu = lan.testPlu(goods?.success ? goods.data?.goods ?? [] : []);
    const res = await lan.sendLines(c.ip, [lan.pluLine({ plu, name: 'POSSISTEM AZN TEST', priceMinor: 800, labelNo: Number(c.labelNo) || 0 }, c.prefix)]);
    return { plu, reply: res.reply, accepted: res.accepted === 1 };
  });
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
    // No key typed: the owner's account activates this PC (within its PC slots).
    const activation = String(input?.activationKey || '').trim()
      ? await redeemMarketActivation(state, input.activationKey)
      : await tenantActivateMarket(state);
    // This account's users (PINs set on its other PCs) before anyone signs in.
    await syncStaff(loadSecureState(), { force: true });
    await syncRolePolicy(loadSecureState(), { force: true });
    if (syncService) await syncService.stop().catch(() => undefined);
    await coreSupervisor.stop();
    await coreSupervisor.start(activation.customerId || '_default');
    await opsEngine.stop();
    void startOps(activation.customerId || '_default');
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
      // The till's users, so the super admin can set each worker's rights.
      // Names and roles only - never PINs.
      // lines (every product x warehouse) is not read by the server and pushed big
      // shops past its 4 MB limit (413 on every heartbeat), so it stays home.
      const { lines: _lines, ...sent } = input.snapshot || {};
      if (state.demoPurgedFor !== state.activation.customerId && Date.now() - demoPurgeTriedAt > 3600000) void purgeDemoProducts(state.activation.customerId);
      const snapshot = { ...sent, staff: state.staff.slice(0, 200).map((row) => ({ id: String(row.id), name: String(row.name || '').slice(0, 80), role: String(row.role), active: row.active !== false })) };
      const body = signedMarketHeartbeat(state, snapshot);
      if (input.books && typeof input.books === 'object') body.books = input.books;
      const response = await fetch(controlApi('/market-pos/heartbeat'), { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      // The heartbeat is the till's regular word with the server, so the role
      // policy rides along with it rather than needing a timer of its own.
      const payload = response.ok ? await response.json().catch(() => ({})) : {};
      if (response.ok) { void syncRolePolicy(state); void syncStaff(state); }
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
    if(method.startsWith('sunmi.')||method==='fiscal.updateStatus')return opsFail('E_FORBIDDEN','Daxili fiskal əməliyyatdır');
    if (!method) return { success: false, error: { code: 'E_VALIDATION', message: 'method required', retryable: false } };
    if(method==='inventory.transfer')return {success:false,error:{code:'PERMISSION_DENIED',message:'Anbar → Yerdəyişmələr qaiməsindən istifadə edin',retryable:false}};
    // Rights are POSSISTEM's to set (roles.applyPolicy from the control plane);
    // the till's own screens may read them but not grant or revoke.
    if (method === 'auth.saveRole' || method === 'auth.deleteRole' || method === 'auth.setOverride') {
      return { success: false, error: { code: 'PERMISSION_DENIED', message: 'Səlahiyyətləri possistem təyin edir', retryable: false } };
    }
    // The core decides permissions from `role` in the payload, so the renderer
    // must not be the one writing it - see core-payload.cjs.
    if(['customer.bridge','customer.history','sale.correct'].includes(method))throw Error('Partnyor qaiməsindən istifadə edin');
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
      require('./operation-access.cjs').isDestructive(method, input?.payload) ? undefined : input?.managerPin,
    );
    if (require('./operation-access.cjs').isDestructive(method, input?.payload)) {
      let actor; try { actor = requireSession(input?.sessionToken || input?.payload?.sessionToken || currentSessionToken); } catch { return opsFail('E_FORBIDDEN', 'Giriş tələb olunur'); }
      const approval = await operationApproval(input, actor, method); if (!approval.success) return approval;
      payload.approverId = approval.approver.id; payload.approverRole = approval.approver.role;
    }
    if (/^(cart\.|sale\.(complete|hold|cancelHeld)$)/.test(method)) {
      if (!payload.role) return opsFail('E_FORBIDDEN','Giriş tələb olunur');
      payload.cartId = 'active-' + payload.actorId;
      payload.requireCartApproval = true;
    }
    if (payload?.role && opsEngine.isHost() && /^cash\.(xReport|zClose|openSession|closeSession|cashIn|cashOut|safeDrop)$/.test(method)) {
      try {
        await opsEngine.flushCatalog({ timeoutMs: 20000 });
        if (method === 'cash.openSession') payload.openingFloatMinor = await opsEngine.cashOpening(String(payload.registerId || ''));
      } catch (error) { return opsFail('E_SYNC', error?.message || String(error)); }
    }
    const result = await coreSupervisor.invoke(method, payload, Number(input?.timeoutMs) || 15000);
    // Never hold up a completed payment/receipt on the warehouse. Finance reads
    // join the same barrier before showing balances.
    if (result.success && /^(sale\.complete|return\.(create|partial)|cash\.(createRegister|bindDeviceRegister|openSession|closeSession|cashIn|cashOut|safeDrop|zClose)|treasury\.transfer)$/.test(method)) opsEngine.scheduleCatalog();
    return result;
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

  const cloudBranches = require('./cloud-branches.cjs').createCloudBranches({credentials:async()=>{
    const state=loadSecureState();if(!state.tenant?.token || state.tenant.customerId!==state.activation?.customerId)throw Error('Sahibkar hesabı aktiv kassaya uyğun deyil');
    return {token:state.tenant.token,deviceId:state.activation.serverDeviceId,baseUrl:CONTROL_URL};
  }});
  opsEngine.staffProfiles=()=>loadSecureState().staff;
  opsEngine.ownerObject=()=>{const a=loadSecureState().activation;return {branchId:a.cloudBranchId,name:a.cloudBranchName,deviceId:a.serverDeviceId};};
  opsEngine.transferTransport=async event=>{
    const result=await cloudBranches.rpc(event.deviceId,[{method:'business.call',payload:{action:'transfer.sync',event:event.payload},idempotencyKey:event.id}]);
    const first=result?.results?.[0];
    // A validation refusal from the recipient's core means nothing was booked there: the sender may recall.
    if(!first?.success)throw Object.assign(Error(first?.error?.message||'Filial qaiməni qəbul etmədi'),{rejected:first?.error?.code==='E_VALIDATION'});
    opsEngine.scheduleCatalog();return first.data;
  };
  // This branch's warehouse (live on the warehouse PC) and the other branches' last copies.
  ipcMain.handle('market:branches:stock', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager']);
    const state = loadSecureState();
    const own = await opsEngine.stockSnapshot().catch(() => null);
    const cached = readBranchStock(state);
    const pulling = syncBranchStock(state, true, own);
    // Cached warehouses open immediately; first visit waits at most two seconds for the cloud.
    if (!cached.branches.length) { let timer; await Promise.race([pulling, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); clearTimeout(timer); }
    const latest = readBranchStock(state);
    return { ...latest, own: own ? { deviceId: state.activation.serverDeviceId, branchId: state.activation.cloudBranchId || null, branchName: state.activation.cloudBranchName || '', online: true, ...own } : null };
  });
  // Edits to a branch's warehouse wait on the server until that branch is online
  // (1.5.42): the owner's account sends them, the branch's warehouse PC applies them.
  const ownerCall = async (pathname, init = {}) => {
    const state = loadSecureState();
    if (!state.tenant?.token) throw new Error('Əvvəlcə müştəri hesabına daxil olun');
    const response = await fetch(controlApi(pathname), { ...init, headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${state.tenant.token}` }, signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Server xətası (${response.status})`);
    return data;
  };
  ipcMain.handle('market:branches:queueEdits', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager']);
    const edits = Array.isArray(input?.edits) ? input.edits.slice(0, 200) : [];
    if (!edits.length) throw new Error('Düzəliş yoxdur');
    return ownerCall('/owner/market/branch-edits', { method: 'POST', body: JSON.stringify({ deviceId: String(input.deviceId), requestId: String(input.requestId), edits, ...(input.note ? { note: String(input.note).slice(0, 200) } : {}) }) });
  });
  ipcMain.handle('market:branches:edits', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager']);
    return ownerCall(`/owner/market/branch-edits?deviceId=${encodeURIComponent(String(input?.deviceId || ''))}`);
  });
  ipcMain.handle('market:branches:cancelEdit', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager']);
    return ownerCall(`/owner/market/branch-edits/${encodeURIComponent(String(input?.id || ''))}/cancel`, { method: 'POST', body: '{}' });
  });
  ipcMain.handle('market:branches:selection',async(event,input)=>{
    assertTrusted(event);const staff=requireSession(input?.sessionToken, ['manager', 'head_cashier', 'cashier', 'warehouse']);
    return require('./object-selection.cjs').selection({manager:Boolean(staff.superAdmin),list:()=>cloudBranches.list(),localContext:()=>{const a=loadSecureState().activation;return {id:a.cloudBranchId,name:a.cloudBranchName};}});
  });
  // Objects and which object a till belongs to: POSSISTEM's user only (1.5.33).
  const requireSuperAdmin=(token)=>{const user=requireSession(token,['manager']);if(!user.superAdmin)throw new Error('Filiallari yalnız POSSISTEM dəyişə bilər');return user;};
  ipcMain.handle('market:branches:manage',async(event,input)=>{assertTrusted(event);requireSuperAdmin(input?.sessionToken);return cloudBranches.manage(input.operation);});
  ipcMain.handle('market:branches:assign',async(event,input)=>{assertTrusted(event);requireSuperAdmin(input?.sessionToken);const result=await cloudBranches.assign(input.deviceId,input.name);const state=loadSecureState();if(input.deviceId===state.activation.serverDeviceId){state.activation.cloudBranchId=result.branchId;state.activation.cloudBranchName=result.name;state.activation.branchScopeKnown=true;saveSecureState(state);}return result;});
  ipcMain.handle('market:branches:list',async(event,input)=>{assertTrusted(event);requireSession(input?.sessionToken,['manager']);return cloudBranches.list();});
  ipcMain.handle('market:branches:rpc',async(event,input)=>{assertTrusted(event);const actor=requireSession(input?.sessionToken,['manager']);const rights=await rightsOf(actor);for(const call of Array.isArray(input.calls)?input.calls:[]){if(!actor.superAdmin&&!(await require('./operation-access.cjs').allowsOperation(call.method,call.payload||{},async key=>rights.includes(key))))throw Error('Bu filial əməliyyatına icazəniz yoxdur');}if(Array.isArray(input.calls)&&input.calls.some(call=>require('./operation-access.cjs').isDestructive(call.method,call.payload))){const approval=await operationApproval(input,actor,'branches.rpc');if(!approval.success)return approval;}return cloudBranches.rpc(input.deviceId,input.calls);});
  ipcMain.handle('market:branch:context', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager', 'head_cashier', 'cashier', 'warehouse']);
    const result=await opsEngine.branchContext();const cloudName=loadSecureState().activation.cloudBranchName;return {...result,branchName:cloudName||result.branchName};
  });

  // Əməliyyatlar screens (an iframe of the restaurant renderer) call through here.
  ipcMain.handle('market:ops:categories', (event) => { assertTrusted(event); return opsEngine.saleCategories(); });
  ipcMain.handle('market:ops:invoke', async (event, input) => {
    assertTrusted(event);
    let staff;
    try { staff = requireSession(input?.sessionToken); } catch (error) { return opsFail('E_FORBIDDEN', error instanceof Error ? error.message : String(error)); }
    const can = async (permission) => {
      if (staff.superAdmin) return true;
      const check = await coreSupervisor.invoke('auth.checkPermission', { actorId: staff.id, role: staff.role, permission });
      return Boolean(check?.success && check.data?.allowed);
    };
    // Əməliyyatlar is the manager's and the storekeeper's; anyone else POSSISTEM
    // gave a document right (Qaimələrə baxmaq / düzəliş / silmək) gets in too.
    const opsRole = (await Promise.all(require('./operation-access.cjs').SECTION_KEYS.map(can))).some(Boolean);
    const docsOnly = !opsRole && (await can('DOCS_VIEW') || await can('DOCS_CREATE') || await can('DOCS_EDIT') || await can('DOCS_DELETE') || await can('MANAGE_USERS') || await can('EDIT_STOCK') || await can('RECEIVE_PURCHASE') || await can('STOCK_ADJUSTMENT'));
    if (!opsRole && !docsOnly) return opsFail('E_FORBIDDEN', 'Əməliyyatlara icazəniz yoxdur');
    if (!(await require('./operation-access.cjs').allowsOperation(String(input?.method || ''), input?.payload || {}, can))) return opsFail('E_FORBIDDEN', 'Bu əməliyyat üçün icazəniz yoxdur');
    if(input?.method==='cashAccounts.list')await opsEngine.syncOwnerObject();
    if(staff.objectId&&staff.objectId===staff.branchId&&staff.branchId===loadSecureState().activation.cloudBranchId){
      const local=await opsEngine.branchContext();staff={...staff,objectId:local.objectId||staff.objectId};
    }
    const method = String(input?.method || '');
    if (method === '__session') {
      try { const result=await opsEngine.session(staff, await rightsOf(staff));if(result.success)Object.assign(result.data,{canBranchCatalog:staff.role==='manager'&&await can('CREATE_PRODUCT')&&await can('DOCS_CREATE'),canDocsCreate:await can('DOCS_CREATE'),canDocsEdit:await can('DOCS_EDIT'),canDocsDelete:await can('DOCS_DELETE'),canDocsView:await can('DOCS_VIEW')});return result; } catch (error) { return opsFail('E_CORE_DOWN', error instanceof Error ? error.message : String(error)); }
    }
    if (method === '__importBranchProduct') {
      try {
        const state = loadSecureState();
        const data = await require('./branch-catalog.cjs').importBranchProduct({ ops: opsEngine, snapshots: readBranchStock(state).branches, activation: state.activation, reference: input?.payload || {}, staff, can });
        return opsOk(data);
      } catch (error) { return opsFail('E_BRANCH_PRODUCT', error.message); }
    }
    if(method==='inventory.transfer')return opsFail('E_FORBIDDEN','Anbar → Yerdəyişmələr qaiməsindən istifadə edin');
    const businessAction=method==='business.call'?String(input?.payload?.action||''):'';
    if(['stock.snapshot','party.import','party.snapshot'].includes(businessAction))return opsFail('E_FORBIDDEN','Daxili anbar əməliyyatıdır');
    if(['transfer.sync','transfer.outbox','transfer.ack','transfer.failure'].includes(businessAction))return opsFail('E_FORBIDDEN','Daxili göndəriş əməliyyatıdır');
    if(businessAction==='transfer.targets'){
      if(!(await can('TRANSFER_STOCK')))return opsFail('E_FORBIDDEN','Anbarlararası göndəriş icazəniz yoxdur');
      try{return opsOk(await require('./transfer-places.cjs').transferPlaces({ops:opsEngine,network:()=>cloudBranches.list(),remote:(id,calls)=>cloudBranches.rpc(id,calls),activation:loadSecureState().activation,scope:{id:staff.id,role:staff.role,warehouseIds:staff.warehouseIds||[],objectId:staff.objectId||''},deviceId:String(input?.payload?.deviceId||''),sourceDeviceId:String(input?.payload?.sourceDeviceId||'')}));}
      catch(error){return opsFail('E_TRANSFER_NETWORK',error.message);}
    }
    if(['market.customer.history','market.sale.correct'].includes(businessAction)) {
      if (require('./operation-access.cjs').isDestructive(method, input?.payload)) { const approval = await operationApproval(input, staff, method); if (!approval.success) return approval; }
      try{return await require('./customer-history.cjs').customerAction({action:businessAction,payload:input.payload||{},staff,can,core:coreSupervisor,ops:opsEngine});}
      catch(error){return opsFail('E_CUSTOMER_DOCUMENT',error.message);}
    }
    if(businessAction.startsWith('transfer.')&&!['transfer.list','transfer.get'].includes(businessAction)&&!(await can('TRANSFER_STOCK')))return opsFail('E_FORBIDDEN','Yerdəyişmə icazəniz yoxdur');
    if (!opsEngine.allowed(method, require('./operation-access.cjs').operationRights(method, input?.payload || {}).length ? 'manager' : staff.role, docsOnly, input?.payload || {})) return opsFail('E_FORBIDDEN', 'Buna icazəniz yoxdur');
    // Qaimələr: everyone in here may look at all of them; changing or deleting
    // one needs the right (role grants + the super admin's per-worker overrides).
    const docNeed = require('./ops-engine.cjs').docPermission(method, input?.payload);
    if (docNeed) {
      if (!(await can(docNeed))) return opsFail('E_FORBIDDEN', docNeed === 'DOCS_DELETE' ? 'Qaimə silməyə icazəniz yoxdur' : docNeed === 'DOCS_EDIT' ? 'Qaimədə düzəliş etməyə icazəniz yoxdur' : 'Qaimələrə baxmağa icazəniz yoxdur');
    }
    if(staff.role!=='manager'&&(method==='customers.payDebt'||businessAction==='correct')) {
      const listing=await opsEngine.invoke('cashAccounts.list',{});
      if(!listing.success)return listing;
      const accountIds=[input.payload?.accountId].filter(Boolean);
      if(businessAction==='correct'&&input.payload?.type==='customer'){
        const old=await opsEngine.invoke('business.call',{action:'document.get',type:'customer',id:input.payload.id});
        if(!old.success)return old;
        if(old.data.document.accountId)accountIds.push(old.data.document.accountId);
      }
      for(const id of accountIds){const account=listing.data.accounts.find(a=>a.id===id);if(!account||staff.objectId&&account.objectId!==staff.objectId||staff.registerIds?.length&&(!account.terminalId?.startsWith('market-')||!staff.registerIds.includes(account.terminalId.slice(7))))return opsFail('E_FORBIDDEN','Bu kassada əməliyyat icazəniz yoxdur');}
    }
    if (require('./operation-access.cjs').isDestructive(method, input?.payload)) {
      const approval = await operationApproval(input, staff, method);
      if (!approval.success) return approval;
    }
    if(method==='customers.payDebt'){try{await opsEngine.flushCatalog({timeoutMs:20000});}catch(error){return opsFail('E_SYNC',error.message);}}
    // Read the committed ledger immediately; catalog reconciliation runs independently.
    // Opening a warehouse screen must not wait for thousands of product writes.
    const result = await opsEngine.invoke(method, {...(input?.payload ?? {}),_marketScope:{id:staff.id,name:staff.name,role:staff.role,objectId:staff.objectId||'',registerIds:staff.registerIds||[],warehouseIds:staff.warehouseIds||[]},...(businessAction==='transfer.save'?{fromDeviceId:loadSecureState().activation.serverDeviceId}: {})}, {
      terminal: { id: 'market-ops', name: staff.name },
      idempotencyKey: typeof input?.idempotencyKey === 'string' ? input.idempotencyKey : undefined,
      timeoutMs: Math.min(Math.max(Number(input?.timeoutMs) || 15000, 1000), 120000),
    });
    if(result.success&&(method==='customers.payDebt'||businessAction==='correct'&&input.payload?.type==='customer')){opsEngine.scheduleCatalog();try{await opsEngine.syncCustomers();await opsEngine.syncWarehouseLedger();}catch{return {...result,syncWarning:true}}}
    if(result.success&&businessAction.startsWith('transfer.')){opsEngine.scheduleCatalog();void opsEngine.flushTransfers().catch(()=>{});}
    if (result.success && (require('./ops-engine.cjs').isCatalogWrite(method) || /^cashAccounts\.(save|transfer|deactivate)$/.test(method))) {
      try { await opsEngine.flushCatalog({ timeoutMs: 5000 }); }
      catch (error) {
        // The warehouse write is committed. Never report it as failed and
        // invite a second stock adjustment; surface synchronization separately.
        console.error('[ops-sync]', error?.message || error);
        return { ...result, syncWarning: true };
      }
    }
    // Parametrlər → Printer is the warehouse system's screen; the Market receipt
    // must go to the printer chosen there, not wait for a second setting.
    if (method === 'print.setPrinter' && result.success && (input?.payload?.target || 'receipt') === 'receipt') {
      const name = String(input?.payload?.printerName || 'auto');
      printerProvider?.forgetTarget?.();
      await coreSupervisor.invoke('printer.setTarget', { role: 'manager', actorId: 'system', target: name === 'virtual' ? 'auto' : name }).catch(() => undefined);
    }
    if (method === 'cashAccounts.list' && result.success && opsEngine.cashCurrentRegisterId) {
      const current = `market-${opsEngine.cashCurrentRegisterId}`;
      return { ...result, data: { ...result.data, currentTerminalId: current,
        terminals: (result.data.terminals || []).map(t => ({ ...t, current: t.id === current })) } };
    }
    return result;
  });
  ipcMain.handle('market:ops:cashSummary', async (event, input) => {
    assertTrusted(event);
    const staff = requireSession(input?.sessionToken, ['manager', 'head_cashier', 'cashier']);
    const permission = await coreSupervisor.invoke('auth.checkPermission', { role: staff.role, actorId: staff.id, permission: 'VIEW_REPORTS' });
    if (!permission.success || !permission.data?.allowed) return opsFail('E_FORBIDDEN', 'Buna icazəniz yoxdur');
    try { return opsOk(await opsEngine.cashSummary()); }
    catch (error) { return opsFail('E_SYNC', error?.message || String(error)); }
  });
  ipcMain.handle('market:ops:status', (event) => { assertTrusted(event); return opsEngine.status(); });
  ipcMain.handle('market:ops:setHost', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager']);
    opsEngine.saveSettings({ host: Boolean(input?.host) });
    // The core keeps running either way: every till prints its receipts with it.
    await startOps(loadSecureState().activation?.customerId || '_default');
    return opsEngine.status();
  });
  ipcMain.handle('market:ops:sync', async (event, input) => {
    assertTrusted(event);
    requireSession(input?.sessionToken, ['manager', 'warehouse']);
    // "Yenidən göndər": receipts set aside after failed tries get another go.
    opsEngine.retryParked();
    try { await opsEngine.flushCatalog({ timeoutMs: 20000 }); return opsOk(opsEngine.status()); }
    catch (error) { return opsFail('E_SYNC', error?.message || String(error)); }
  });

  printerProvider = registerHardwareIpc({
    ipcMain, app, coreSupervisor, assertTrusted, requireSession, requireCorePermission, verifyManagerPin, opsEngine,
    currentSunmiActor: () => requireSession(currentSessionToken),
    staffName: (id) => loadSecureState().staff.find((row) => row.id === id)?.name || '',
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
    onBranchContext: ({branchId,branchName}) => {const state=loadSecureState();if(state.activation.cloudBranchId!==branchId||state.activation.cloudBranchName!==branchName||!state.activation.branchScopeKnown){state.activation.cloudBranchId=branchId;state.activation.cloudBranchName=branchName;state.activation.branchScopeKnown=true;saveSecureState(state);}},
    onCoreBatch: payload => opsEngine.remoteBatch(payload),
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

// On Windows a native dialog (confirm, file picker) can leave the page without
// keyboard focus: inputs stop taking clicks until restart. Hand focus back to
// the page whenever its window is focused again.
app.on('browser-window-created', (_event, win) => {
  win.on('focus', () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.focus();
  });
});

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
  void startOps(secure.activation?.customerId || '_default');
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
  // The account's users and POSSISTEM's PIN reach the till before anyone signs
  // in: a PC just updated or installed has nobody else to sign in with (1.5.34).
  const accountPull = () => {
    const state = loadSecureState();
    if (state.activation.mode !== 'active' || !state.activation.serverDeviceId) return;
    void syncRolePolicy(state);
    void syncStaff(state);
    void syncBranchStock(state);
  };
  setTimeout(accountPull, 3000);
  setInterval(accountPull, 30000).unref();
});

app.on('before-quit', (event) => {
  if (coreSupervisor.state === 'stopped') return;
  if (!coreSupervisor.child) return;
  event.preventDefault();
  void (syncService?.stop() ?? Promise.resolve()).finally(() => opsEngine.stop().catch(() => undefined).finally(() => coreSupervisor.stop().finally(() => app.exit(0))));
});

app.on('window-all-closed', () => app.quit());
