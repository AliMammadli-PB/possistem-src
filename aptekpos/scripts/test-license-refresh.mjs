#!/usr/bin/env node
/**
 * A renewal on the website unlocks the market till; nothing else may move its
 * end date. Runs the real verifyOnlineLicense() and applyLicenseRefresh() from
 * electron/main.cjs against a server-shaped envelope signed with a fresh key.
 */
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const main = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../electron/main.cjs'), 'utf8');
const from = main.indexOf('function verifyOnlineLicense(');
const to = main.indexOf('async function redeemMarketActivation(');
assert.ok(from > 0 && to > from, 'licence functions not found in main.cjs');

let saved = 0;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
const keyId = `ed25519-${createHash('sha256').update(Buffer.from(publicKeyHex, 'hex')).digest('hex').slice(0, 16)}`;

const load = new Function(
  'createHash', 'createPublicKey', 'verifySignature', 'SPKI_PREFIX', 'TRUSTED_LICENSE_KEY_IDS', 'CONTROL_URL', 'saveSecureState',
  `${main.slice(from, to)}; return applyLicenseRefresh;`,
);
const bind = (trusted) => load(
  createHash, createPublicKey, verify, Buffer.from('302a300506032b6570032100', 'hex'), new Set(trusted), 'https://possistem.az/pos/api', () => { saved += 1; },
);
// The build trusts the key under test, as a release build trusts production's.
const applyLicenseRefresh = bind([keyId]);
// A build that does not list the key must refuse it - even on first use.
const applyUntrusted = bind(['ed25519-0000000000000000']);

// Same shape as licenseEnvelope() on the server.
function envelope(validUntil, overrides = {}) {
  const payload = {
    licenseId: 'lic-1', customerId: 'c-1', plan: '1 ay', seats: 2, features: {},
    deviceId: 'srv-dev-1', deviceFingerprint: 'hwid-1', devicePublicKey: 'aa'.repeat(32),
    validUntil, status: 'active', signedAt: new Date().toISOString(), ...overrides,
  };
  return {
    signingKey: { algorithm: 'Ed25519', keyId, publicKeyHex },
    device: { id: 'srv-dev-1' },
    license: { id: 'lic-1', validUntil, status: 'active' },
    signedLicense: { payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('hex'), keyId },
  };
}

function till(mode, validUntil) {
  return {
    activation: {
      mode, validUntil, deviceId: 'hwid-1', serverDeviceId: 'srv-dev-1', customerId: 'c-1', createdAt: 1,
      customerName: 'Bravo', customer: { legalName: 'Bravo MMC', address: 'Bakı', phone: '050', taxId: '123' },
    },
    deviceProof: { publicKeyHex: 'aa'.repeat(32) },
    pinnedLicenseKey: { keyId, publicKeyHex },
  };
}

const DAY = 24 * 3600_000;
const later = new Date(Date.now() + 30 * DAY).toISOString();

// An expired till takes a renewal and keeps its customer details.
let state = till('expired', Date.now() - DAY);
assert.equal(applyLicenseRefresh(state, envelope(later)), true);
assert.equal(state.activation.mode, 'active');
assert.equal(state.activation.validUntil, Date.parse(later));
assert.equal(state.activation.customer.legalName, 'Bravo MMC');
assert.equal(state.activation.customer.taxId, '123');
assert.equal(saved, 1);

// The same date again changes nothing and writes nothing.
assert.equal(applyLicenseRefresh(state, envelope(later)), false);
assert.equal(saved, 1);

// A date moved by anyone but the server fails the signature.
state = till('expired', Date.now() - DAY);
const forged = envelope(later);
forged.signedLicense.payload.validUntil = new Date(Date.now() + 3650 * DAY).toISOString();
forged.license.validUntil = forged.signedLicense.payload.validUntil;
assert.throws(() => applyLicenseRefresh(state, forged), /imza/i);
assert.equal(state.activation.mode, 'expired');

// Another till's licence is refused.
assert.throws(() => applyLicenseRefresh(till('expired', 0), envelope(later, { deviceFingerprint: 'hwid-2' })));

// No signed licence (the server withholds it for an ended or revoked one): nothing happens.
assert.equal(applyLicenseRefresh(till('expired', 0), null), false);
assert.equal(applyLicenseRefresh(till('expired', 0), { license: { validUntil: later } }), false);

// A licence signed by a key this build does not trust is refused outright.
assert.throws(() => applyUntrusted(till('expired', 0), envelope(later)), /gözlənilən/);

console.log('market licence refresh: ok');
