/**
 * A renewal on the website must unlock the till, and nothing else may move
 * its end date. Runs the real us() and _psApplyLicenseRefresh() from index.js
 * against a stub core.
 */
import { describe, expect, it } from 'vitest';
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

function harness() {
  const imported: unknown[] = [];
  const N = async (method: string, body: { licenseFileContents: string }) => {
    expect(method).toBe('license.importOffline');
    imported.push(JSON.parse(body.licenseFileContents));
    return { success: true };
  };
  const D = { info() {}, warn() {} };
  const ye = async () => 'install-1';
  const apply = new Function('N', 'D', 'ye', `${src}; return _psApplyLicenseRefresh;`)(N, D, ye);
  return { apply, imported };
}

const refresh = (validUntil: string) => ({
  device: { id: 'dev-1' },
  license: { id: 'lic-1', plan: '1 ay', seats: 2, customerId: 'c-1', customerEmail: 'a@b.az', features: {} },
  signedLicense: {
    payload: { licenseId: 'lic-1', deviceId: 'dev-1', validUntil, status: 'active', seats: 2 },
    signature: 'sig',
    keyId: 'k1',
    signedAt: '2026-09-24T00:00:00.000Z',
  },
});

describe('licence refresh on heartbeat', () => {
  it('imports a later end date signed by the server', async () => {
    const { apply, imported } = harness();
    await apply({ status: 'expired', expiresAt: Date.parse('2026-09-01T00:00:00Z') }, refresh('2026-10-24T00:00:00.000Z'), 'fp');
    expect(imported).toHaveLength(1);
    const lic = imported[0] as { payload: { expiresAt: number; installationId: string }; signature: string };
    expect(lic.payload.expiresAt).toBe(Date.parse('2026-10-24T00:00:00Z'));
    expect(lic.payload.installationId).toBe('install-1');
    expect(lic.signature).toBe('sig');
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
