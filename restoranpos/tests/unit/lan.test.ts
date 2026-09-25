/**
 * One restaurant, several PCs - the main-process half.
 *
 * The LAN block patched into index.js is run here for real: a host listening
 * on 43180 in front of a fake core, and a terminal routing through it over
 * HTTP. What would rot: the terminal writing to its own database when the host
 * is away, a call from a PC without the customer's key being run, the waiter's
 * PIN not following their calls, or kitchen events never reaching the kitchen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const main = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const block = main.slice(main.indexOf('/* POS_LAN_v1 */\nvar _psLan'));
const KEY = 'k'.repeat(64);

type Result = { success: boolean; data: unknown; error: { code: string; message: string } | null };
const d = (code: string, message: string, retryable = false) => ({ success: false, data: null, error: { code, message, retryable } });

// The names the minified main binds, stubbed to what the block uses.
const calls: Array<{ method: string; actor: unknown }> = [];
const core = Object.assign(new EventEmitter(), {
  invoke: async (method: string, payload: Record<string, unknown>, opts: { actor?: { userId: string } }) => {
    calls.push({ method, actor: opts.actor });
    if (method === 'auth.login') return { success: true, data: { session: { userId: 'usr-waiter' } }, error: null };
    return { success: true, data: { method, payload, actor: opts.actor?.userId ?? null }, error: null };
  },
});
const scope = {
  require: createRequire(import.meta.url), m: path, W: crypto, Bt: os, p: fs,
  Wt: () => fs.mkdtempSync(path.join(os.tmpdir(), 'lan-')),
  c: { BrowserWindow: { getAllWindows: () => [] }, app: { whenReady: () => Promise.reject() } },
  v: { info() {}, warn() {} },
  d,
  Cn: {
    'tables.list': { auth: true, timeout: 3000, idempotent: false },
    'auth.login': { auth: false, timeout: 3000, idempotent: false },
    'backup.restore': { auth: true, timeout: 3000, idempotent: true },
  },
};
const lan = new Function(...Object.keys(scope), `${block}; return { _psLanApply, _psLanRoute, _psLanOnEvent, _psLanAccess, _psLan };`)(
  ...Object.values(scope),
) as {
  _psLanApply: (device: unknown, persist?: boolean) => void;
  _psLanRoute: (method: string, payload: unknown, opts?: unknown) => Promise<Result> | null;
  _psLanOnEvent: (event: { event: string; payload: unknown }) => void;
  _psLanAccess: (list: string[] | null) => string[] | null;
  _psLan: { actor: string | null; host: boolean; hostAddress?: string };
};

async function rpc(body: string, key = KEY) {
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', key).update(`${ts}.${body}`).digest('hex');
  const res = await fetch('http://127.0.0.1:43180/rpc', { method: 'POST', headers: { 'x-ps-ts': ts, 'x-ps-sig': sig }, body });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  (globalThis as { __psCore?: unknown }).__psCore = core;
  lan._psLanApply({ station: 'all', lanHost: true, lanKey: KEY }, false);
  await new Promise((r) => setTimeout(r, 150));
});
afterAll(() => lan._psLanApply(null, false));

describe('the host', () => {
  it('refuses a call without the customer key', async () => {
    const res = await rpc(JSON.stringify({ method: 'tables.list', actor: { userId: 'x' } }), 'wrong'.repeat(13));
    expect(res.status).toBe(401);
  });

  it('runs a signed call as the terminal staff member', async () => {
    const res = await rpc(JSON.stringify({ method: 'tables.list', payload: {}, actor: { userId: 'usr-waiter' } }));
    expect(res.json.success).toBe(true);
    expect(res.json.data.actor).toBe('usr-waiter');
  });

  it('wants a PIN before anything that needs one', async () => {
    const res = await rpc(JSON.stringify({ method: 'tables.list', actor: { userId: '' } }));
    expect(res.json.error.code).toBe('E_UNAUTHORIZED');
  });

  it('never restores a backup for another PC', async () => {
    const res = await rpc(JSON.stringify({ method: 'backup.restore', actor: { userId: 'usr-admin' } }));
    expect(res.json.error.code).toBe('E_FORBIDDEN');
  });
});

describe('a terminal', () => {
  it('follows the PIN typed on it, and routes through the host', async () => {
    // One process plays both PCs: the host keeps listening, the route points at it.
    (lan._psLan as { hostAddress?: string }).hostAddress = '127.0.0.1:43180';
    const out = await lan._psLanRoute('auth.login', { pin: '1234' });
    expect(out?.success).toBe(true);
    expect(lan._psLan.actor).toBe('usr-waiter');
    const list = await lan._psLanRoute('tables.list', {});
    expect((list?.data as { actor: string }).actor).toBe('usr-waiter');
  });

  it('keeps its own heartbeat local', () => {
    expect(lan._psLanRoute('core.ping', {})).toBeNull();
  });

  it('refuses rather than writing locally when the host is gone', async () => {
    lan._psLanApply({ station: 'waiter', lanHost: false, lanKey: KEY, hostAddress: '127.0.0.1:1' }, false);
    const out = await lan._psLanRoute('tables.list', {});
    expect(out?.success).toBe(false);
    expect(out?.error?.code).toBe('E_CORE_DOWN');
    lan._psLanApply({ station: 'all', lanHost: true, lanKey: KEY }, false);
    await new Promise((r) => setTimeout(r, 150));
  });
});

describe('events', () => {
  it('reach a terminal waiting on the host', async () => {
    const ts = () => String(Date.now());
    const sign = (t: string) => crypto.createHmac('sha256', KEY).update(`${t}.`).digest('hex');
    let t = ts();
    const first = await (await fetch('http://127.0.0.1:43180/events?since=-1', { headers: { 'x-ps-ts': t, 'x-ps-sig': sign(t) } })).json();
    t = ts();
    const waiting = fetch(`http://127.0.0.1:43180/events?since=${first.seq}`, { headers: { 'x-ps-ts': t, 'x-ps-sig': sign(t) } }).then((r) => r.json());
    setTimeout(() => lan._psLanOnEvent({ event: 'kds.updated', payload: { id: 1 } }), 50);
    const got = await waiting;
    expect(got.events.map((e: { event: string }) => e.event)).toContain('kds.updated');
  });
});

describe('station', () => {
  it('narrows the website areas to the PC job', () => {
    lan._psLanApply({ station: 'kitchen', lanHost: true, lanKey: KEY }, false);
    expect(lan._psLanAccess(null)).toEqual(['kds', 'settings']);
    expect(lan._psLanAccess(['tables', 'settings'])).toEqual(['settings']);
    lan._psLanApply({ station: 'all', lanHost: true, lanKey: KEY }, false);
    expect(lan._psLanAccess(null)).toBeNull();
  });
});
