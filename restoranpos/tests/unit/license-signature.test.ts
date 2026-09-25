/**
 * The restaurant till accepts only licences possistem signed. Runs the real
 * offline import (dn) and _psVerifyLicenseEnvelope() from index.js against a
 * stub core; a throwaway key stands in for the control plane's.
 */
import { describe, expect, it } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const main = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

function slice(from: string, to: string) {
  const i = main.indexOf(from);
  const j = main.indexOf(to, i);
  expect(i).toBeGreaterThan(-1);
  expect(j).toBeGreaterThan(i);
  return main.slice(i, j);
}

const helpers = slice('/* POS_LICENSE_SIGNATURE_v1 */', 'async function _psRevokeLicense(');
const dnSrc = slice('async function dn(', 'async function zs(');
const signer = nodeCrypto.generateKeyPairSync('ed25519');
const signerHex = Buffer.from(signer.publicKey.export({ type: 'spki', format: 'der' })).subarray(-32).toString('hex');

function load(isPackaged = false) {
  const stored: unknown[] = [];
  const N = async (method: string, body: { licenseFileContents: string }) => {
    expect(method).toBe('license.importOffline');
    stored.push(JSON.parse(body.licenseFileContents));
    return { success: true };
  };
  const d = (code: string, message: string) => ({ success: false, data: null, error: { code, message } });
  const Q = (e: unknown) => (e && typeof e === 'object' ? e : {});
  const ye = async () => 'install-1';
  const he = () => ({ fingerprint: 'fp-this-pc' });
  const Fe = () => undefined;
  const c = { app: { isPackaged } };
  process.env.POS_TRUSTED_LICENSE_KEYS = `ed25519-test:${signerHex}`;
  const mod = new Function('N', 'd', 'Q', 'ye', 'he', 'Fe', 'W', 'c',
    `${helpers}${dnSrc}; return { dn, verify: _psVerifyLicenseEnvelope, secureRequired: _psSecureRequired };`,
  )(N, d, Q, ye, he, Fe, nodeCrypto, c);
  delete process.env.POS_TRUSTED_LICENSE_KEYS;
  return { ...mod, stored };
}

function licenceFile(payload: Record<string, unknown>, key = signer.privateKey) {
  return JSON.stringify({
    payload,
    signature: nodeCrypto.sign(null, Buffer.from(JSON.stringify(payload)), key).toString('hex'),
    keyId: 'ed25519-test',
  });
}

const good = { licenseId: 'lic-1', status: 'active', deviceFingerprint: 'fp-this-pc', expiresAt: Date.now() + 86_400_000, signedAt: '2026-09-26T00:00:00.000Z' };

describe('restaurant licence signatures', () => {
  it('imports an offline licence signed by the trusted key', async () => {
    const { dn, stored } = load();
    const res = await dn(licenceFile(good));
    expect(res.success).toBe(true);
    expect(stored).toHaveLength(1);
  });

  it('refuses a hand-written, unsigned licence file', async () => {
    const { dn, stored } = load();
    const res = await dn(JSON.stringify({ payload: { status: 'active', expiresAt: 4102444800000 } }));
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('E_LICENSE_REQUIRED');
    expect(await dn(JSON.stringify({ status: 'active', expiresAt: 4102444800000 }))).toMatchObject({ success: false });
    expect(stored).toHaveLength(0);
  });

  it('refuses a signed licence whose payload was edited afterwards', async () => {
    const { dn, stored } = load();
    const file = JSON.parse(licenceFile(good));
    file.payload.expiresAt = 4102444800000;
    expect((await dn(JSON.stringify(file))).success).toBe(false);
    expect(stored).toHaveLength(0);
  });

  it('refuses a licence signed by any other key', async () => {
    const { dn } = load();
    const rogue = nodeCrypto.generateKeyPairSync('ed25519').privateKey;
    expect((await dn(licenceFile(good, rogue))).success).toBe(false);
  });

  it("refuses another PC's licence", async () => {
    const { dn } = load();
    expect((await dn(licenceFile({ ...good, deviceFingerprint: 'fp-other-pc' }))).success).toBe(false);
  });

  it('trusts the production key by default', () => {
    expect(helpers).toContain('["ed25519-42cd45bfa4ca3125","1338db4cbec4934a387a1cc73c3589f3b0f58dac63be7fed0bf2a7e455e336c3"]');
  });

  it('keeps the e2e licence bypass out of packaged builds', () => {
    expect(main).toContain('process.env.POS_E2E_BYPASS_LICENSE==="1"&&!c.app.isPackaged&&(ue(');
    expect(main).toContain('if(process.env.POS_E2E_BYPASS_LICENSE==="1"&&!c.app.isPackaged){');
    expect(main.match(/POS_E2E_BYPASS_LICENSE/g)).toHaveLength(2);
  });

  it('requires OS secure storage for secrets in a packaged Windows build', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(load(true).secureRequired()).toBe(true);
      expect(load(false).secureRequired()).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
    expect(main).toContain('else if(_psSecureRequired())return;else r=Buffer.from(n,"utf8");');
    expect(main).toContain('(_psSecureRequired()&&_psThrowNoSecureStorage(),p.writeFileSync(e.privateEnc');
  });
});
