import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateActivationKeyPlaintext,
  hmacActivationKey,
  hashSessionToken,
  signLicensePayload,
  verifyLicensePayload,
  generateEd25519KeyPair,
} from '../src/index.js';

describe('@milioner/security', () => {
  it('generates long Base32 activation keys', () => {
    const key = generateActivationKeyPlaintext();
    const compact = key.replace(/-/g, '');
    assert.ok(compact.length >= 26);
    assert.match(compact, /^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it('HMACs activation keys deterministically', () => {
    const a = hmacActivationKey('pepper', 'ABC123');
    const b = hmacActivationKey('pepper', 'ABC123');
    const c = hmacActivationKey('pepper', 'OTHER');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(a.length, 64);
  });

  it('hashes session tokens', () => {
    const h = hashSessionToken('tok');
    assert.equal(h.length, 64);
    assert.equal(h, hashSessionToken('tok'));
  });

  it('signs and verifies license payloads', () => {
    const { privateKey, publicKey } = generateEd25519KeyPair();
    const payload = {
      licenseId: '00000000-0000-0000-0000-000000000001',
      plan: 'pro',
      seats: 2,
      features: { kds: true },
      deviceId: '00000000-0000-0000-0000-000000000002',
      deviceFingerprint: 'fp-test-12345678',
      validUntil: null,
    };
    const signed = signLicensePayload(privateKey, payload);
    assert.ok(signed.signature.length > 0);
    assert.equal(verifyLicensePayload(publicKey, signed.payload, signed.signature), true);
  });
});
