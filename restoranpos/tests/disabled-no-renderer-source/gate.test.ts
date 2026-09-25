import { describe, expect, it } from 'vitest';

import { fail, ok } from '../../shared/contracts/ipc';
import {
  gateDecision,
  isLicensedStatus,
  licenceSatisfied,
} from '../../apps/desktop/src/renderer/lib/gate';

/**
 * These pin the difference between "the core said no" and "the core said
 * nothing", which is the distinction the startup gates got wrong.
 *
 * The sidecar answers on one worker thread. A printer it cannot reach holds
 * `license.status` behind it until the request times out, and the gate read
 * that timeout as an unlicensed terminal — so a restaurant mid-service was sent
 * to the activation screen while its licence was perfectly valid.
 */
describe('gateDecision', () => {
  const licensed = () => true;

  it('waits rather than blocking when the core does not answer', () => {
    // Exactly what CoreSupervisor emits when a request outlives its budget.
    const timedOut = fail('E_TIMEOUT', 'POS nüvəsi vaxtında cavab vermədi', true);
    expect(gateDecision(timedOut, licensed)).toBe('retry');

    const unavailable = fail('E_CORE_UNAVAILABLE', 'Core supervisor not ready', true);
    expect(gateDecision(unavailable, licensed)).toBe('retry');
  });

  it('blocks only on an answer that is actually a refusal', () => {
    const refused = fail('E_LICENSE_REQUIRED', 'No licence on this terminal', false);
    expect(gateDecision(refused, licensed)).toBe('block');
  });

  it('passes when the core answers and the condition holds', () => {
    expect(gateDecision(ok({ status: 'active' }), licenceSatisfied)).toBe('pass');
  });

  it('blocks when the core answers and the condition does not hold', () => {
    expect(gateDecision(ok({ authenticated: false }), (d) => Boolean(d.authenticated))).toBe(
      'block',
    );
  });
});

describe('licenceSatisfied', () => {
  it('accepts every state that lets the till trade', () => {
    for (const status of ['active', 'grace', 'legacy_grace', 'offline_grace']) {
      expect(isLicensedStatus(status)).toBe(true);
      expect(licenceSatisfied({ status })).toBe(true);
    }
  });

  it('rejects an unknown or missing state', () => {
    expect(isLicensedStatus('expired')).toBe(false);
    expect(isLicensedStatus(undefined)).toBe(false);
  });

  it('rejects a licence whose expiry has passed', () => {
    expect(licenceSatisfied({ status: 'active', expiresAt: Date.now() - 1000 })).toBe(false);
    expect(licenceSatisfied({ status: 'active', expiresAt: Date.now() + 60_000 })).toBe(true);
  });

  it('treats a zero expiry as "no expiry", not "expired in 1970"', () => {
    expect(licenceSatisfied({ status: 'active', expiresAt: 0 })).toBe(true);
  });
});
