'use strict';

/**
 * Staff credentials, manager approval and operator sessions.
 *
 * Kept free of Electron so the rules below can be unit-tested directly.
 *
 * The shipped staff rows carry a fixed salt+hash, so their PINs are published
 * with the source and identical on every install. Such an account may sign in,
 * but only to set its own PIN: every session check refuses it until then, and
 * it can never approve anything as a manager.
 */
const { pbkdf2Sync, randomBytes, timingSafeEqual } = require('node:crypto');

const PIN_ITERATIONS = 120000;
const PIN_PATTERN = /^\d{4,8}$/;
const ZERO_SALT = '00000000000000000000000000000000';

const DEFAULT_STAFF = [
  { id: 'u-manager', name: 'MarketPos Müdir', role: 'manager', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'], salt: '687f8fbf095f402c0f82586d918206a0', pinHash: '1f5488722c7051e86a233f77e18f5a03bc60264c78d6cf18fc47236ab8f44981' },
  { id: 'u-head', name: 'MarketPos Baş kassir', role: 'head_cashier', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-sales'], salt: 'b1d14ca3484fbedd1d01f981f54f4c74', pinHash: '6c166257c084772d8bd291a4826991f1353e9da2b6bc5082f211a4f0047ca3d8' },
  { id: 'u-cashier', name: 'MarketPos Kassir', role: 'cashier', active: true, registerIds: ['reg-2'], warehouseIds: ['wh-sales'], salt: 'fe5892f2cb48f1621663fedd138bc8ab', pinHash: '961af08c2dfe98fd30598492d03ae37f22aab332fa7481eca91cbf83adfee452' },
  { id: 'u-warehouse', name: 'MarketPos Anbar', role: 'warehouse', active: true, registerIds: [], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'], salt: '42e27db11f3ca2ef0c5a8bad872201b7', pinHash: '72dc9539944ef364c217a072f5daac8611aaec82942f9dc6ba933dbf990a5ff2' },
];
const DEFAULT_PIN_FINGERPRINTS = new Set(DEFAULT_STAFF.map((u) => `${u.salt}:${u.pinHash}`));
const APPROVER_ROLES = new Set(['manager', 'head_cashier']);

/** Idle window of an operator session. */
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
/** Hard cap from sign-in: a restart or reboot never extends a session past it. */
const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;

function hashPin(pin, salt) {
  return pbkdf2Sync(String(pin), salt || ZERO_SALT, PIN_ITERATIONS, 32, 'sha256').toString('hex');
}

function pinMatches(user, pin) {
  const expected = Buffer.from(String(user?.pinHash || ''), 'hex');
  const actual = pbkdf2Sync(String(pin), user?.salt || ZERO_SALT, PIN_ITERATIONS, 32, 'sha256');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

/** True while the account still holds the PIN that ships with the source. */
function pinIsShippedDefault(user) {
  return Boolean(user) && DEFAULT_PIN_FINGERPRINTS.has(`${user.salt}:${user.pinHash}`);
}

/** True when `pin` is one of the published default PINs, whatever account it is set on. */
function isShippedDefaultPin(pin) {
  return DEFAULT_STAFF.some((u) => pinMatches(u, pin));
}

function newPinCredential(pin) {
  const salt = randomBytes(16).toString('hex');
  return { salt, pinHash: hashPin(pin, salt) };
}

/** Throws with a user-facing message when `pin` may not be set. */
function assertAcceptablePin(pin) {
  if (!PIN_PATTERN.test(String(pin))) throw new Error('PIN 4–8 rəqəm olmalıdır');
  if (isShippedDefaultPin(pin)) throw new Error('Bu PIN hamıya məlumdur — başqa PIN seçin');
}

function publicStaff(user) {
  const { salt, pinHash, ...profile } = user;
  return { ...profile, mustChangePin: pinIsShippedDefault(user) };
}

/**
 * Sign-in by PIN alone, as on the restaurant till: the PIN names the person.
 * Returns the one active account holding it, or null (none, or - which
 * staff saving forbids - more than one).
 */
function findStaffByPin(staff, pin) {
  const matches = (Array.isArray(staff) ? staff : []).filter((row) => row.active && pinMatches(row, pin));
  return matches.length === 1 ? matches[0] : null;
}

/** True when another active account already signs in with this PIN. */
function pinTaken(staff, pin, exceptId) {
  return (Array.isArray(staff) ? staff : []).some((row) => row.id !== exceptId && row.active && pinMatches(row, pin));
}

/**
 * Failed-attempt throttle: `max` misses lock the key, each further lock doubles
 * (capped), and a success clears it.
 */
function createAttemptLimiter({ max = 5, lockMs = 30000, maxLockMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const state = new Map();
  return {
    assertOpen(key) {
      const entry = state.get(key);
      if (entry && entry.lockedUntil > now()) {
        const seconds = Math.ceil((entry.lockedUntil - now()) / 1000);
        const err = new Error(`Çox sayda səhv cəhd. ${seconds} saniyə gözləyin.`);
        err.code = 'E_RATE_LIMITED';
        throw err;
      }
    },
    fail(key) {
      const entry = state.get(key) || { count: 0, lockedUntil: 0, locks: 0 };
      entry.count += 1;
      if (entry.count >= max) {
        entry.locks += 1;
        entry.lockedUntil = now() + Math.min(maxLockMs, lockMs * 2 ** (entry.locks - 1));
        entry.count = 0;
      }
      state.set(key, entry);
    },
    succeed(key) {
      state.delete(key);
    },
  };
}

/**
 * The only producer of an `approverId`. Accounts still on a published PIN never
 * approve, and there is no fallback PIN of any kind.
 */
function verifyManagerPin(staff, pin, limiter, key = 'manager-approval') {
  if (limiter) limiter.assertOpen(key);
  const candidates = (Array.isArray(staff) ? staff : []).filter(
    (row) => row.active && APPROVER_ROLES.has(row.role) && !pinIsShippedDefault(row),
  );
  for (const user of candidates) {
    if (pinMatches(user, pin)) {
      if (limiter) limiter.succeed(key);
      return { ok: true, approverId: user.id, role: user.role, name: user.name };
    }
  }
  if (limiter) limiter.fail(key);
  return { ok: false };
}

/**
 * In-memory operator sessions with an idle window and an absolute cap measured
 * from sign-in (`issuedAt`), which survives restarts through the stored record.
 */
function createSessionStore({ now = Date.now, idleMs = SESSION_IDLE_MS, absoluteMs = SESSION_ABSOLUTE_MS } = {}) {
  const sessions = new Map();
  const expiryFor = (issuedAt) => Math.min(now() + idleMs, issuedAt + absoluteMs);
  return {
    issue(userId) {
      const token = randomBytes(32).toString('hex');
      const issuedAt = now();
      sessions.set(token, { userId, issuedAt, expiresAt: expiryFor(issuedAt) });
      return { token, userId, issuedAt };
    },
    /** Re-arms a persisted session; null when it is past its absolute cap. */
    restore(stored) {
      if (!stored?.token || !stored.userId) return null;
      const issuedAt = Number(stored.issuedAt) || 0;
      if (!issuedAt || issuedAt + absoluteMs <= now()) return null;
      sessions.set(stored.token, { userId: stored.userId, issuedAt, expiresAt: expiryFor(issuedAt) });
      return stored.token;
    },
    get(token) {
      const entry = sessions.get(String(token || ''));
      if (!entry) return null;
      if (entry.expiresAt < now()) {
        sessions.delete(String(token));
        return null;
      }
      entry.expiresAt = expiryFor(entry.issuedAt);
      return entry;
    },
    revoke(token) {
      sessions.delete(String(token || ''));
    },
    clear() {
      sessions.clear();
    },
  };
}

/**
 * Resolves a token to an active staff row. An account still on a published PIN
 * is refused (`E_PIN_CHANGE_REQUIRED`) unless the caller is the PIN-change flow.
 */
function resolveSessionUser(sessions, staff, token, { roles, allowDefaultPin = false } = {}) {
  const entry = sessions.get(token);
  if (!entry) throw new Error('Sessiya bitib');
  const user = (Array.isArray(staff) ? staff : []).find((row) => row.id === entry.userId && row.active);
  if (!user) throw new Error('İstifadəçi aktiv deyil');
  if (!allowDefaultPin && pinIsShippedDefault(user)) {
    const err = new Error('Əvvəlcə öz PIN kodunuzu təyin edin');
    err.code = 'E_PIN_CHANGE_REQUIRED';
    throw err;
  }
  if (roles && !roles.includes(user.role)) throw new Error('Buna icazəniz yoxdur');
  return user;
}

module.exports = {
  DEFAULT_STAFF,
  PIN_PATTERN,
  SESSION_IDLE_MS,
  SESSION_ABSOLUTE_MS,
  hashPin,
  pinMatches,
  findStaffByPin,
  pinTaken,
  pinIsShippedDefault,
  isShippedDefaultPin,
  newPinCredential,
  assertAcceptablePin,
  publicStaff,
  createAttemptLimiter,
  verifyManagerPin,
  createSessionStore,
  resolveSessionUser,
};
