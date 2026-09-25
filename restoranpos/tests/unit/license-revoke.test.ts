/**
 * A licence deleted or revoked on the website must lock the till. Runs the real
 * _psRevokeLicense() from index.js against a stub core, and checks the heartbeat
 * reacts to the server's LICENSE_REVOKED code only.
 */
import { describe, expect, it, vi } from 'vitest';
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

const src = slice('async function _psRevokeLicense(', 'async function _psSyncRolePolicy(');

function harness() {
  const stored: Array<{ payload: Record<string, unknown>; signature: string }> = [];
  const N = vi.fn(async (method: string, body: { payload: Record<string, unknown>; signature: string }) => {
    expect(method).toBe('license.activate');
    stored.push(body);
    return { success: true };
  });
  const D = { warn: vi.fn(), info: vi.fn() };
  const bs = vi.fn();
  const Le = vi.fn();
  const reload = vi.fn();
  const c = { BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { reload } }] } };
  const revoke = new Function('N', 'D', 'bs', 'Le', 'c', `${src}; return _psRevokeLicense;`)(N, D, bs, Le, c);
  return { revoke, stored, bs, Le, reload, N };
}

const active = {
  status: 'active', licenseId: 'lic-1', customerId: 'cust-1', deviceId: 'dev-1', installationId: 'inst-1',
  channel: 'stable', startsAt: 1, expiresAt: Date.now() + 86_400_000, offlineGraceDays: 7,
};

describe('restaurant licence revocation', () => {
  it('stores the licence as revoked, signs out, stops sync and reloads', async () => {
    const h = harness();
    await h.revoke(active, 'Lisenziya ləğv edilib');
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0]!.payload).toMatchObject({ status: 'revoked', licenseId: 'lic-1', customerId: 'cust-1', deviceId: 'dev-1', offlineGraceDays: 0 });
    expect(h.stored[0]!.payload.features).toEqual({});
    expect(h.bs).toHaveBeenCalledTimes(1);
    expect(h.Le).toHaveBeenCalledTimes(1);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('leaves legacy grace, e2e and already-revoked tills alone', async () => {
    for (const t of [{ ...active, licenseId: 'legacy-local' }, { ...active, licenseId: 'e2e-local' }, { ...active, status: 'revoked' }]) {
      const h = harness();
      await h.revoke(t, 'x');
      expect(h.N).not.toHaveBeenCalled();
      expect(h.reload).not.toHaveBeenCalled();
    }
  });

  it('is triggered only by the explicit LICENSE_REVOKED code', () => {
    expect(main).toContain('if(!g.ok&&g.code==="LICENSE_REVOKED"){await _psRevokeLicense(t,g.error)');
    // The control API client carries the server's error code through.
    expect(main).toContain('{ok:!1,status:o.status,error:h,code:g&&typeof g.code=="string"?g.code:void 0}');
  });
});
