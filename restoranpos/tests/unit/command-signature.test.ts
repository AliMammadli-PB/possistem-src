/**
 * Remote commands run only when the control plane signed them for this till.
 * Market: electron/command-auth.cjs. Restaurant: _psVerifyCommand() in index.js.
 * Envelopes are built exactly like the control plane's signDeviceCommand().
 */
import { describe, expect, it } from 'vitest';
import * as nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { verifySignedCommand } = require('../../../marketpos/electron/command-auth.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const main = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

const signer = nodeCrypto.generateKeyPairSync('ed25519');
const signerHex = Buffer.from(signer.publicKey.export({ type: 'spki', format: 'der' })).subarray(-32).toString('hex');

function signed(fields: Record<string, unknown>, key = signer.privateKey, now = Date.now()) {
  const payload = { type: 'pos-command', ...fields, issuedAt: now, expiresAt: now + 15 * 60_000, signedAt: new Date(now).toISOString() };
  return { payload, signature: nodeCrypto.sign(null, Buffer.from(JSON.stringify(payload)), key).toString('hex'), signedAt: payload.signedAt, keyId: 'ed25519-test' };
}

describe('market remote commands', () => {
  const ctx = () => ({ publicKeyHex: signerHex, deviceId: 'dev-1', customerId: 'cust-1', seen: new Set<string>() });
  const cmd = (over: Record<string, unknown> = {}, key = signer.privateKey) => {
    const fields = { id: 'cmd-1', kind: 'z_report', payload: { actualCashMinor: 1200 }, customerId: 'cust-1', deviceId: 'dev-1', ...over };
    return { id: 'cmd-1', kind: 'x_report', payload: { actualCashMinor: 999999 }, signed: signed(fields, key) };
  };

  it('runs the signed copy, not the unsigned outer fields', () => {
    const out = verifySignedCommand(cmd(), ctx());
    expect(out).toEqual({ ok: true, command: { id: 'cmd-1', kind: 'z_report', payload: { actualCashMinor: 1200 } } });
  });

  it('refuses unsigned, foreign-key, other-till, expired and replayed commands', () => {
    expect(verifySignedCommand({ id: 'cmd-1', kind: 'z_report' }, ctx()).ok).toBe(false);
    expect(verifySignedCommand(cmd({}, nodeCrypto.generateKeyPairSync('ed25519').privateKey), ctx()).ok).toBe(false);
    expect(verifySignedCommand(cmd({ deviceId: 'dev-2' }), ctx()).ok).toBe(false);
    expect(verifySignedCommand(cmd({ customerId: 'cust-2' }), ctx()).ok).toBe(false);
    const late = cmd();
    expect(verifySignedCommand(late, { ...ctx(), now: Date.now() + 16 * 60_000 }).ok).toBe(false);
    const c = ctx();
    expect(verifySignedCommand(cmd(), c).ok).toBe(true);
    expect(verifySignedCommand(cmd(), c)).toMatchObject({ ok: false, reason: 'replayed' });
    const edited = cmd();
    (edited.signed.payload as Record<string, unknown>).kind = 'z_report_forged';
    expect(verifySignedCommand(edited, ctx()).ok).toBe(false);
  });
});

describe('restaurant remote commands', () => {
  function slice(from: string, to: string) {
    const i = main.indexOf(from);
    const j = main.indexOf(to, i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    return main.slice(i, j);
  }
  const helpers = slice('/* POS_LICENSE_SIGNATURE_v1 */', 'async function _psRevokeLicense(');

  function load() {
    process.env.POS_TRUSTED_LICENSE_KEYS = `ed25519-test:${signerHex}`;
    const fn = new Function('W', 'c', `${helpers}; return _psVerifyCommand;`)(nodeCrypto, { app: { isPackaged: false } });
    delete process.env.POS_TRUSTED_LICENSE_KEYS;
    return fn;
  }
  const till = { deviceId: 'dev-1', customerId: 'cust-1' };
  const cmd = (over: Record<string, unknown> = {}, key = signer.privateKey) => ({
    id: 'c1', command: 'report.x', args: {},
    signed: signed({ id: 'c1', command: 'report.z', args: { a: 1 }, customerId: 'cust-1', deviceId: 'dev-1', ...over }, key),
  });

  it('runs the signed copy once', () => {
    const verify = load();
    expect(verify(cmd(), till)).toEqual({ id: 'c1', command: 'report.z', args: { a: 1 } });
    expect(verify(cmd(), till)).toBeNull();
  });

  it('refuses unsigned, foreign-key and other-till commands', () => {
    const verify = load();
    expect(verify({ id: 'c1', command: 'report.z', args: {} }, till)).toBeNull();
    expect(verify(cmd({}, nodeCrypto.generateKeyPairSync('ed25519').privateKey), till)).toBeNull();
    expect(verify(cmd({ deviceId: 'dev-2' }), till)).toBeNull();
    expect(verify(cmd({ customerId: 'cust-2' }), till)).toBeNull();
  });

  it('reports refused commands instead of running them', () => {
    expect(main).toContain('const ok=_psVerifyCommand(cmd,e);if(ok){u.push(ok);continue}');
    expect(main).toContain('errorCode:"E_COMMAND_SIGNATURE"');
    expect(main).not.toContain('const u=i.data?.commands??[];u.length>0&&await Ps(u,');
  });
});
