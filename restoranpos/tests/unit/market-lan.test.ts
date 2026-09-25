/**
 * LAN replication confidentiality: two real MarketSyncService instances talk
 * over localhost HTTP with real keys and signed licence proofs; only the cores
 * are stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';

const require = createRequire(import.meta.url);
const lanCrypto = require('../../../marketpos/electron/lan-crypto.cjs');
const { MarketSyncService } = require('../../../marketpos/electron/sync-service.cjs');

const rawHex = (key: { export: (o: object) => Buffer }) => Buffer.from(key.export({ type: 'spki', format: 'der' })).subarray(-32).toString('hex');

const licenceKey = generateKeyPairSync('ed25519');
const signingKey = { algorithm: 'Ed25519', keyId: 'ed25519-test', publicKeyHex: rawHex(licenceKey.publicKey as never) };

function till(deviceId: string, withEncryption = true) {
  const device = generateKeyPairSync('ed25519');
  const deviceProof = {
    publicKeyHex: rawHex(device.publicKey as never),
    privateKeyPkcs8: Buffer.from(device.privateKey.export({ type: 'pkcs8', format: 'der' })).toString('base64'),
    ...(withEncryption ? lanCrypto.createEncryptionKey() : {}),
  };
  const payload = { status: 'active', customerId: 'cust-1', deviceId, devicePublicKey: deviceProof.publicKeyHex, expiresAt: Date.now() + 86_400_000 };
  const licenseProof = { signedLicense: { payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), licenceKey.privateKey).toString('hex') }, signingKey };
  return {
    activation: { mode: 'active', customerId: 'cust-1', serverDeviceId: deviceId, licenseProof },
    deviceProof,
    pinnedLicenseKey: { keyId: signingKey.keyId, publicKeyHex: signingKey.publicKeyHex },
  };
}

function service(state: ReturnType<typeof till>, outgoing: unknown[]) {
  const applied: unknown[] = [];
  const core = {
    invoke: vi.fn(async (method: string, payload: { events?: unknown[] }) => {
      if (method === 'sync.apply') applied.push(...(payload.events ?? []));
      if (method === 'sync.export') return { success: true, data: { vector: { v: outgoing.length }, events: outgoing } };
      return { success: true, data: {} };
    }),
  };
  const svc = new MarketSyncService({ core, getState: () => state, controlApi: (p: string) => p, appVersion: 'test' });
  return { svc, applied };
}

const started: Array<{ stop: () => Promise<void> }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (started.length) await started.pop()!.stop();
});

describe('LAN crypto envelope', () => {
  it('round-trips and rejects tampering or the wrong key', () => {
    const b = lanCrypto.createEncryptionKey();
    const other = lanCrypto.createEncryptionKey();
    const { envelope, responseKey } = lanCrypto.sealRequest({ sale: 'secret-sale' }, b.encPublicKeyHex);
    expect(JSON.stringify(envelope)).not.toContain('secret-sale');
    const opened = lanCrypto.openRequest(envelope, b.encPrivateKeyPkcs8, b.encPublicKeyHex);
    expect(opened.value).toEqual({ sale: 'secret-sale' });
    expect(opened.responseKey.equals(responseKey)).toBe(true);
    expect(() => lanCrypto.openRequest(envelope, other.encPrivateKeyPkcs8, other.encPublicKeyHex)).toThrow();
    const tampered = { ...envelope, ct: Buffer.from('x'.repeat(40)).toString('base64') };
    expect(() => lanCrypto.openRequest(tampered, b.encPrivateKeyPkcs8, b.encPublicKeyHex)).toThrow();
  });
});

describe('LAN replication over HTTP', () => {
  async function pair(serverEncrypted: boolean) {
    const stateA = till('dev-a');
    const stateB = till('dev-b', serverEncrypted);
    const a = service(stateA, [{ id: 'secret-sale-from-a' }]);
    const b = service(stateB, [{ id: 'secret-stock-from-b' }]);
    await b.svc.startHttp();
    started.push({ stop: () => b.svc.stop() });
    const peer = { host: '127.0.0.1', port: b.svc.httpPort, encKey: serverEncrypted ? stateB.deviceProof.encPublicKeyHex : null, vector: {} };
    return { a, b, stateA, peer };
  }

  it('seals both directions between current tills', async () => {
    const { a, b, stateA, peer } = await pair(true);
    const wire: string[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      wire.push(`${String(url)} ${String(init?.body)}`);
      const res = await realFetch(url, init);
      const text = await res.text();
      wire.push(text);
      return new Response(text, { status: res.status, headers: res.headers });
    });
    await a.svc.exchangePeer(peer, stateA);
    expect(b.applied).toEqual([{ id: 'secret-sale-from-a' }]);
    expect(a.applied).toEqual([{ id: 'secret-stock-from-b' }]);
    expect(wire[0]).toContain('/v2/exchange');
    for (const frame of wire) {
      expect(frame).not.toContain('secret-sale-from-a');
      expect(frame).not.toContain('secret-stock-from-b');
      expect(frame).not.toContain('cust-1');
    }
  });

  it('still replicates with a till that predates LAN encryption', async () => {
    const { a, b, stateA, peer } = await pair(false);
    await a.svc.exchangePeer(peer, stateA);
    expect(b.applied).toEqual([{ id: 'secret-sale-from-a' }]);
    expect(a.applied).toEqual([{ id: 'secret-stock-from-b' }]);
  });

  it('refuses a sealed request whose ciphertext was altered', async () => {
    const { b, stateA, peer } = await pair(true);
    const { envelope } = lanCrypto.sealRequest({ customerId: 'cust-1' }, peer.encKey);
    envelope.ct = Buffer.from('tampered-ciphertext').toString('base64');
    const res = await fetch(`http://127.0.0.1:${peer.port}/v2/exchange`, { method: 'POST', body: JSON.stringify(envelope) });
    expect(res.status).toBe(400);
    expect(b.applied).toEqual([]);
    expect(stateA).toBeTruthy();
  });
});
