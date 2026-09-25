/**
 * A renewal on the website must unlock the till, and nothing else may move
 * its end date. Runs the real us() and _psApplyLicenseRefresh() from index.js
 * against a stub core.
 */
import { describe, expect, it } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const main = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');

function slice(from: string, to: string) {
  const i = main.indexOf(from);
  const j = main.indexOf(to, i);
  expect(i).toBeGreaterThan(-1);
  expect(j).toBeGreaterThan(i);
  return main.slice(i, j);
}

const src = slice('function us(', 'const be=') + slice('async function _psApplyLicenseRefresh(', 'async function _psSyncRolePolicy(');

// A throwaway signing key stands in for the control plane's; the build under
// test is told to trust it exactly as a release trusts production's.
const signer = nodeCrypto.generateKeyPairSync('ed25519');
const signerHex = Buffer.from(signer.publicKey.export({ type: 'spki', format: 'der' })).subarray(-32).toString('hex');

function harness() {
  const imported: unknown[] = [];
  const N = async (method: string, body: { licenseFileContents: string }) => {
    expect(method).toBe('license.importOffline');
    imported.push(JSON.parse(body.licenseFileContents));
    return { success: true };
  };
  const D = { info() {}, warn() {} };
  const ye = async () => 'install-1';
  process.env.POS_TRUSTED_LICENSE_KEYS = `k1:${signerHex}`;
  const c = { app: { isPackaged: false } };
  const apply = new Function('N', 'D', 'ye', 'W', 'c', `${src}; return _psApplyLicenseRefresh;`)(N, D, ye, nodeCrypto, c);
  delete process.env.POS_TRUSTED_LICENSE_KEYS;
  return { apply, imported };
}

function refresh(validUntil: string, extra: Record<string, unknown> = {}, signWith = signer.privateKey) {
  const payload = { licenseId: 'lic-1', deviceId: 'dev-1', deviceFingerprint: 'fp', validUntil, status: 'active', seats: 2, ...extra };
  return {
    device: { id: 'dev-1' },
    license: { id: 'lic-1', plan: '1 ay', seats: 2, customerId: 'c-1', customerEmail: 'a@b.az', features: {} },
    signedLicense: {
      payload,
      signature: nodeCrypto.sign(null, Buffer.from(JSON.stringify(payload)), signWith).toString('hex'),
      keyId: 'k1',
      signedAt: '2026-09-24T00:00:00.000Z',
    },
  };
}

describe('licence refresh on heartbeat', () => {
  it('imports a later end date signed by the server', async () => {
    const { apply, imported } = harness();
    await apply({ status: 'expired', expiresAt: Date.parse('2026-09-01T00:00:00Z') }, refresh('2026-10-24T00:00:00.000Z'), 'fp');
    expect(imported).toHaveLength(1);
    const lic = imported[0] as { payload: { expiresAt: number; installationId: string }; signature: string };
    expect(lic.payload.expiresAt).toBe(Date.parse('2026-10-24T00:00:00Z'));
    expect(lic.payload.installationId).toBe('install-1');
    expect(lic.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('refuses a renewal that the trusted key did not sign', async () => {
    const { apply, imported } = harness();
    const forged = refresh('2036-10-24T00:00:00.000Z', {}, nodeCrypto.generateKeyPairSync('ed25519').privateKey);
    await apply({ status: 'expired', expiresAt: 1 }, forged, 'fp');
    const edited = refresh('2026-10-24T00:00:00.000Z');
    edited.signedLicense.payload.validUntil = '2036-10-24T00:00:00.000Z';
    await apply({ status: 'expired', expiresAt: 1 }, edited, 'fp');
    expect(imported).toHaveLength(0);
  });

  it("refuses another device's licence", async () => {
    const { apply, imported } = harness();
    await apply({ status: 'expired', expiresAt: 1 }, refresh('2026-10-24T00:00:00.000Z', { deviceFingerprint: 'other-pc' }), 'fp');
    expect(imported).toHaveLength(0);
  });

  it('never re-imports the same date or shortens the licence', async () => {
    const { apply, imported } = harness();
    const now = { status: 'active', expiresAt: Date.parse('2026-10-24T00:00:00Z') };
    await apply(now, refresh('2026-10-24T00:00:00.000Z'), 'fp');
    await apply(now, refresh('2026-10-01T00:00:00.000Z'), 'fp');
    expect(imported).toHaveLength(0);
  });

  it('ignores a heartbeat without a signed licence (expired or revoked on the server)', async () => {
    const { apply, imported } = harness();
    await apply({ status: 'expired', expiresAt: 1 }, null, 'fp');
    expect(imported).toHaveLength(0);
  });

  it('keeps asking the server after the licence ended', () => {
    expect(main).toContain('if(!ln(t.status)&&t.status!=="expired"||t.status==="legacy_grace")return N("license.heartbeat");');
  });

  it('lets the lock screen ask the server', () => {
    expect(bundle).toContain('await window.pos.license.heartbeat();');
    expect(bundle).toContain('"Serverdən yoxla"');
  });
});
