'use strict';

/**
 * POSSISTEM's own 10-digit PIN (1.5.33): set once on the website's admin panel,
 * it signs into every customer's till as a full manager. The till holds only
 * scrypt hashes, delivered with the role policy and signed with the licence key
 * it pinned at activation (as remote commands are), so a forged server cannot
 * plant one. The first 4 digits have their own hash: the PIN pad keeps going
 * to 10 digits instead of signing in a 4-digit staff PIN.
 */
const { createPublicKey, verify, scryptSync, timingSafeEqual } = require('node:crypto');

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const SUPER_ADMIN_ID = 'possistem-admin';
const SUPER_ADMIN = Object.freeze({ id: SUPER_ADMIN_ID, name: 'POSSISTEM', role: 'manager', active: true, superAdmin: true, registerIds: [], warehouseIds: [] });
const HEX = (n) => new RegExp(`^[0-9a-f]{${n}}$`, 'i');

/** The signed record from /market-pos/roles, or null when it is not for this till. */
function verifySuperAdmin(blob, { publicKeyHex, customerId, deviceId }) {
  try {
    const p = blob?.payload;
    if (!p || p.type !== 'possistem-superadmin' || !HEX(64).test(String(publicKeyHex || '')) || !HEX(128).test(String(blob.signature || ''))) return null;
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(JSON.stringify(p), 'utf8'), key, Buffer.from(blob.signature, 'hex'))) return null;
    if (String(p.customerId) !== String(customerId) || (p.deviceId && String(p.deviceId) !== String(deviceId))) return null;
    if (![p.salt, p.prefixSalt].every((v) => HEX(32).test(String(v))) || ![p.hash, p.prefixHash].every((v) => HEX(64).test(String(v)))) return null;
    return { salt: p.salt, hash: p.hash, prefixSalt: p.prefixSalt, prefixHash: p.prefixHash, N: Number(p.N) || 131072, prefixN: Number(p.prefixN) || 16384, updatedAt: Number(p.updatedAt) || 0 };
  } catch {
    return null;
  }
}

function scryptEquals(pin, saltHex, hashHex, N) {
  const want = Buffer.from(hashHex, 'hex');
  const got = scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return want.length === got.length && timingSafeEqual(got, want);
}

/** Do these 4 digits start the super admin PIN? */
function startsSuperAdmin(record, digits) {
  return Boolean(record) && /^\d{4}$/.test(String(digits)) && scryptEquals(digits, record.prefixSalt, record.prefixHash, record.prefixN);
}

function isSuperAdminPin(record, pin) {
  return Boolean(record) && /^\d{10}$/.test(String(pin)) && scryptEquals(pin, record.salt, record.hash, record.N);
}

module.exports = { SUPER_ADMIN, SUPER_ADMIN_ID, verifySuperAdmin, startsSuperAdmin, isSuperAdminPin };

// Self-check: node electron/superadmin.cjs
if (require.main === module) {
  const assert = require('node:assert/strict');
  const { generateKeyPairSync, sign, randomBytes } = require('node:crypto');
  const pin = '1369999999';
  const salt = randomBytes(16).toString('hex'), prefixSalt = randomBytes(16).toString('hex');
  const opts = (N) => ({ N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const payload = { type: 'possistem-superadmin', customerId: 'c1', deviceId: 'd1', issuedAt: Date.now(), kdf: 'scrypt', N: 131072, r: 8, p: 1, prefixN: 16384,
    salt, hash: scryptSync(pin, Buffer.from(salt, 'hex'), 32, opts(131072)).toString('hex'),
    prefixSalt, prefixHash: scryptSync(pin.slice(0, 4), Buffer.from(prefixSalt, 'hex'), 32, opts(16384)).toString('hex'), updatedAt: 1 };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const blob = { payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('hex') };
  const record = verifySuperAdmin(blob, { publicKeyHex, customerId: 'c1', deviceId: 'd1' });
  assert.ok(record);
  assert.equal(verifySuperAdmin(blob, { publicKeyHex, customerId: 'c2', deviceId: 'd1' }), null);
  assert.equal(verifySuperAdmin({ ...blob, payload: { ...payload, hash: payload.prefixHash } }, { publicKeyHex, customerId: 'c1', deviceId: 'd1' }), null);
  assert.ok(startsSuperAdmin(record, '1369'));
  assert.ok(!startsSuperAdmin(record, '1368'));
  assert.ok(isSuperAdminPin(record, pin));
  assert.ok(!isSuperAdminPin(record, '1369999998'));
  console.log('superadmin self-check OK');
}
