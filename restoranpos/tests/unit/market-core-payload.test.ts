import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { authorizeCorePayload } = require('../../../marketpos/electron/core-payload.cjs');

/**
 * The market core answers "may this person refund?" by reading `role` out of
 * the request payload. The renderer used to supply that payload unchanged, so
 * anything running in the window could call
 * `invoke('return.partial', { role: 'manager' })` and the manager PIN dialog was
 * decoration.
 */
describe('market core payload authorization', () => {
  const manager = () => ({ id: 'u-1', role: 'manager' });
  const cashier = () => ({ id: 'u-2', role: 'cashier' });

  it('overwrites a role the renderer claimed for itself', () => {
    const out = authorizeCorePayload({ role: 'manager', amount: 500 }, cashier);

    expect(out.role).toBe('cashier');
    expect(out.actorId).toBe('u-2');
    // Everything that is not an identity claim survives untouched.
    expect(out.amount).toBe(500);
  });

  it('strips identity entirely when nobody is signed in', () => {
    const out = authorizeCorePayload({ role: 'manager', actorId: 'u-9', approverId: 'x' }, () => null);

    // Fail closed: the core reads a missing role as "no permission".
    expect(out.role).toBeUndefined();
    expect(out.actorId).toBeUndefined();
    expect(out.approverId).toBeUndefined();
  });

  it('never lets the renderer assert a manager approval', () => {
    // `approverId` is what the core accepts as proof a manager said yes.
    const out = authorizeCorePayload({ approverId: 'u-manager' }, cashier);

    expect(out.approverId).toBeUndefined();
  });

  it('grants an approval only when the manager PIN actually matches', () => {
    const verify = (pin: string) =>
      pin === '9182' ? { ok: true, approverId: 'u-boss' } : { ok: false };

    const good = authorizeCorePayload({}, cashier, verify, '9182');
    expect(good.approverId).toBe('u-boss');

    const bad = authorizeCorePayload({}, cashier, verify, '0000');
    expect(bad.approverId).toBeUndefined();
  });

  it('ignores a payload that is not an object', () => {
    for (const junk of [null, undefined, 'role=manager', 42, ['role']]) {
      const out = authorizeCorePayload(junk, manager);
      expect(out.role).toBe('manager');
      expect(out.actorId).toBe('u-1');
    }
  });
});
