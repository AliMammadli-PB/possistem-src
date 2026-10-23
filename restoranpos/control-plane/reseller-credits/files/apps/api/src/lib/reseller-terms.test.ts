import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  addMonths,
  creditCost,
  effectiveStatus,
  renewedUntil,
  saleValidUntil,
  termLabel,
} from './reseller-terms.js';

const d = (iso: string) => new Date(iso);

it('charges one credit per month and nothing for a trial', () => {
  assert.equal(creditCost('trial7'), 0);
  assert.equal(creditCost(1), 1);
  assert.equal(creditCost(12), 12);
});

it('adds calendar months and clamps to the end of a shorter month', () => {
  assert.equal(addMonths(d('2026-01-31T10:00:00Z'), 1).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(addMonths(d('2028-01-31T10:00:00Z'), 1).toISOString(), '2028-02-29T10:00:00.000Z');
  assert.equal(addMonths(d('2026-11-15T00:00:00Z'), 3).toISOString(), '2027-02-15T00:00:00.000Z');
  assert.equal(addMonths(d('2026-09-24T00:00:00Z'), 12).toISOString(), '2027-09-24T00:00:00.000Z');
});

it('gives a trial seven days', () => {
  assert.equal(saleValidUntil('trial7', d('2026-09-24T12:00:00Z')).toISOString(), '2026-10-01T12:00:00.000Z');
});

it('renews a lapsed licence from today, not from the old end', () => {
  const now = d('2026-09-24T00:00:00Z');
  assert.equal(renewedUntil(d('2026-08-01T00:00:00Z'), 1, now).toISOString(), '2026-10-24T00:00:00.000Z');
});

it('renews a running licence from its end, so renewing early loses nothing', () => {
  const now = d('2026-09-24T00:00:00Z');
  assert.equal(renewedUntil(d('2026-10-10T00:00:00Z'), 3, now).toISOString(), '2027-01-10T00:00:00.000Z');
});

it('shows a licence past its end as expired even if the row still says active', () => {
  const now = d('2026-09-24T00:00:00Z');
  assert.equal(effectiveStatus('active', d('2026-09-01T00:00:00Z'), now), 'expired');
  assert.equal(effectiveStatus('active', d('2026-10-01T00:00:00Z'), now), 'active');
  assert.equal(effectiveStatus('revoked', d('2026-10-01T00:00:00Z'), now), 'revoked');
});

it('names the plan the way the partner chose it', () => {
  assert.equal(termLabel('trial7'), 'Sınaq 7 gün');
  assert.equal(termLabel(6), '6 ay');
});
