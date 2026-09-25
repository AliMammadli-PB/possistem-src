/**
 * Market POS privileged paths: cash drawer, manager approval, factory PINs,
 * operator sessions, mock hardware, and the native-core supervisor bounds.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { openDrawerAuthorized } = require('../../../marketpos/electron/drawer-auth.cjs');
const auth = require('../../../marketpos/electron/staff-auth.cjs');
const { mockHardwareAllowed, resolveTerminalMode } = require('../../../marketpos/electron/hardware-policy.cjs');
const { CoreSupervisor, MAX_MESSAGE_BYTES, MAX_PENDING } = require('../../../marketpos/electron/core-supervisor.cjs');

type Payload = Record<string, unknown>;

/**
 * The market core's `requirePermission` (native/core/src/RetailOps.cpp), rule for
 * rule: no role → only actorId "system" passes; a role holding the permission
 * passes; otherwise any non-empty approverId passes (main alone may set it).
 */
function fakeCore(grants: Record<string, string[]>) {
  const calls: Payload[] = [];
  const invokeCore = vi.fn(async (method: string, payload: Payload) => {
    calls.push(payload);
    expect(method).toBe('drawer.openLogged');
    const role = String(payload.role ?? '');
    const allowed = role
      ? (grants[role] ?? []).includes('OPEN_DRAWER') || (typeof payload.approverId === 'string' && payload.approverId !== '')
      : payload.actorId === 'system';
    return allowed
      ? { success: true, data: { ok: true } }
      : { success: false, error: { code: 'MANAGER_APPROVAL_REQUIRED', message: 'Permission OPEN_DRAWER requires manager approval' } };
  });
  return { invokeCore, calls };
}

const GRANTS = { manager: ['OPEN_DRAWER'], head_cashier: ['OPEN_DRAWER'], cashier: [] };
const cashier = { id: 'u-cash', role: 'cashier' };
const manager = { id: 'u-boss', role: 'manager' };
const MANAGER_PIN = '8642';
const managerRow = { id: 'u-boss', name: 'Boss', role: 'manager', active: true, ...auth.newPinCredential(MANAGER_PIN) };

function deps(user: { id: string; role: string } | null, core = fakeCore(GRANTS)) {
  const openDrawer = vi.fn(async () => ({ ok: true }));
  const verifyManagerPin = (pin: string) => auth.verifyManagerPin([managerRow], pin);
  return { core, openDrawer, d: { resolveUser: () => user, verifyManagerPin, invokeCore: core.invokeCore, openDrawer } };
}

describe('market cash drawer authorization', () => {
  it('refuses a cashier, and the drawer stays shut', async () => {
    const { d, openDrawer } = deps(cashier);
    await expect(openDrawerAuthorized({ reason: 'sale' }, d)).rejects.toMatchObject({ code: 'MANAGER_APPROVAL_REQUIRED' });
    expect(openDrawer).not.toHaveBeenCalled();
  });

  it('ignores a forged approverId (and role) sent by the renderer', async () => {
    const { d, core, openDrawer } = deps(cashier);
    const forged = { reason: 'x', approverId: 'u-boss', role: 'manager', actorId: 'u-boss' };
    await expect(openDrawerAuthorized(forged, d)).rejects.toBeTruthy();
    expect(core.calls[0]).toMatchObject({ role: 'cashier', actorId: 'u-cash' });
    expect(core.calls[0]).not.toHaveProperty('approverId');
    expect(openDrawer).not.toHaveBeenCalled();
  });

  it('ignores a forged actorId "system"', async () => {
    const { d, core, openDrawer } = deps(cashier);
    await expect(openDrawerAuthorized({ actorId: 'system', role: '' }, d)).rejects.toBeTruthy();
    expect(core.calls[0]!.actorId).toBe('u-cash');
    expect(core.calls[0]!.role).toBe('cashier');
    expect(openDrawer).not.toHaveBeenCalled();
  });

  it('never drives the hardware when the core answers success:false', async () => {
    const failing = { invokeCore: vi.fn(async () => ({ success: false, error: { code: 'E_CORE_DOWN', message: 'down' } })), calls: [] };
    const { d, openDrawer } = deps(manager, failing as never);
    await expect(openDrawerAuthorized({ reason: 'x' }, d)).rejects.toMatchObject({ code: 'E_CORE_DOWN' });
    expect(openDrawer).not.toHaveBeenCalled();
  });

  it('refuses when nobody is signed in, without asking the core', async () => {
    const { d, core, openDrawer } = deps(null);
    await expect(openDrawerAuthorized({}, d)).rejects.toMatchObject({ code: 'E_UNAUTHENTICATED' });
    expect(core.invokeCore).not.toHaveBeenCalled();
    expect(openDrawer).not.toHaveBeenCalled();
  });

  it('opens for a manager, attributed to the session', async () => {
    const { d, core, openDrawer } = deps(manager);
    await openDrawerAuthorized({ reason: 'float' }, d);
    expect(core.calls[0]).toMatchObject({ role: 'manager', actorId: 'u-boss', reason: 'float' });
    expect(openDrawer).toHaveBeenCalledTimes(1);
  });

  it('opens for a cashier only with a real manager PIN, verified in main', async () => {
    const wrong = deps(cashier);
    await expect(openDrawerAuthorized({ managerPin: '0000' }, wrong.d)).rejects.toBeTruthy();
    expect(wrong.openDrawer).not.toHaveBeenCalled();

    const right = deps(cashier);
    await openDrawerAuthorized({ managerPin: MANAGER_PIN }, right.d);
    expect(right.core.calls[0]).toMatchObject({ role: 'cashier', actorId: 'u-cash', approverId: 'u-boss' });
    expect(right.openDrawer).toHaveBeenCalledTimes(1);
  });
});

describe('market staff credentials', () => {
  it('recognises the published factory PINs', () => {
    for (const pin of ['2468', '1357', '1111', '3690']) expect(auth.isShippedDefaultPin(pin)).toBe(true);
    expect(auth.isShippedDefaultPin('8642')).toBe(false);
  });

  it('never lets a factory-PIN manager approve, and has no fallback PIN', () => {
    expect(auth.verifyManagerPin(auth.DEFAULT_STAFF, '2468').ok).toBe(false);
    expect(auth.verifyManagerPin(auth.DEFAULT_STAFF, '1357').ok).toBe(false);
    expect(auth.verifyManagerPin([], '2468').ok).toBe(false);
    expect(auth.verifyManagerPin([managerRow], MANAGER_PIN)).toMatchObject({ ok: true, approverId: 'u-boss' });
  });

  it('refuses a factory PIN as a new PIN', () => {
    expect(() => auth.assertAcceptablePin('1111')).toThrow();
    expect(() => auth.assertAcceptablePin('12')).toThrow();
    expect(() => auth.assertAcceptablePin('5739')).not.toThrow();
  });

  it('locks manager approval after repeated misses', () => {
    let now = 1_000_000;
    const limiter = auth.createAttemptLimiter({ now: () => now });
    for (let i = 0; i < 5; i += 1) expect(auth.verifyManagerPin([managerRow], '0000', limiter).ok).toBe(false);
    expect(() => auth.verifyManagerPin([managerRow], MANAGER_PIN, limiter)).toThrow(/gözləyin/);
    now += 31_000;
    expect(auth.verifyManagerPin([managerRow], MANAGER_PIN, limiter).ok).toBe(true);
  });

  it('confines a factory-PIN session to the PIN change', () => {
    const sessions = auth.createSessionStore();
    const issued = sessions.issue('u-manager');
    expect(() => auth.resolveSessionUser(sessions, auth.DEFAULT_STAFF, issued.token, {})).toThrow(
      expect.objectContaining({ code: 'E_PIN_CHANGE_REQUIRED' }),
    );
    expect(auth.resolveSessionUser(sessions, auth.DEFAULT_STAFF, issued.token, { allowDefaultPin: true }).id).toBe('u-manager');
    expect(auth.publicStaff(auth.DEFAULT_STAFF[0]).mustChangePin).toBe(true);
  });

  it('caps a restored session at its absolute lifetime', () => {
    let now = 5_000_000;
    const sessions = auth.createSessionStore({ now: () => now });
    const issued = sessions.issue('u-boss');
    now += auth.SESSION_ABSOLUTE_MS - 60_000;
    expect(auth.createSessionStore({ now: () => now }).restore(issued)).toBe(issued.token);
    now += 120_000;
    expect(auth.createSessionStore({ now: () => now }).restore(issued)).toBeNull();
    expect(auth.createSessionStore({ now: () => now }).restore({ token: 'legacy', userId: 'u-boss' })).toBeNull();
  });
});

describe('market mock hardware', () => {
  it('is refused in a packaged build unless explicitly allowed', () => {
    expect(mockHardwareAllowed({ isPackaged: true, env: {} })).toBe(false);
    expect(mockHardwareAllowed({ isPackaged: true, env: { MARKET_POS_ALLOW_MOCK_HARDWARE: '1' } })).toBe(true);
    expect(mockHardwareAllowed({ isPackaged: false, env: {} })).toBe(true);
    expect(resolveTerminalMode('mock_integrated', false)).toBe('manual');
    expect(resolveTerminalMode('mock_integrated', true)).toBe('mock_integrated');
  });
});

describe('market core supervisor bounds', () => {
  function readySupervisor() {
    const sup = new CoreSupervisor();
    const kill = vi.fn();
    sup.child = { stdin: { writable: true, write: () => true, on: () => undefined }, kill };
    sup.state = 'ready';
    return { sup, kill };
  }

  it('refuses a request beyond the pending cap', async () => {
    const { sup } = readySupervisor();
    for (let i = 0; i < MAX_PENDING; i += 1) void sup.invoke('core.ping', {}, 60_000);
    const over = await sup.invoke('core.ping', {}, 60_000);
    expect(over.error.code).toBe('E_QUEUE_FULL');
    for (const [, p] of sup.pending) clearTimeout(p.timer);
  });

  it('refuses an oversized request frame', async () => {
    const { sup } = readySupervisor();
    const out = await sup.invoke('state.importLegacy', { blob: 'x'.repeat(MAX_MESSAGE_BYTES) });
    expect(out.error.code).toBe('E_PAYLOAD_TOO_LARGE');
  });

  it('kills a core that streams an unterminated frame past the limit', async () => {
    const { sup, kill } = readySupervisor();
    const waiting = sup.invoke('core.ping', {}, 60_000);
    sup.onStdout('x'.repeat(MAX_MESSAGE_BYTES + 1));
    expect((await waiting).error.code).toBe('E_PROTOCOL');
    expect(kill).toHaveBeenCalled();
    expect(sup.buffer).toBe('');
  });

  it('queues writes behind stdin backpressure', () => {
    const { sup } = readySupervisor();
    const written: string[] = [];
    let accept = false;
    sup.child.stdin.write = (frame: string) => { written.push(frame); return accept; };
    void sup.invoke('a', {}, 60_000);
    void sup.invoke('b', {}, 60_000);
    expect(written).toHaveLength(1);
    accept = true;
    sup.flushWrites();
    expect(written).toHaveLength(2);
    for (const [, p] of sup.pending) clearTimeout(p.timer);
  });
});
