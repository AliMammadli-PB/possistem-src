import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hmacActivationKey } from '@milioner/security';
import { ResellerCreateSchema } from '@milioner/contracts';
import {
  resolveResellerToken,
  revokeResellerToken,
  signResellerToken,
} from './plugins/reseller-auth.js';

describe('@milioner/api smoke', () => {
  it('wires workspace packages', () => {
    const digest = hmacActivationKey('pepper', 'TEST-KEY');
    assert.equal(digest.length, 64);
    const reseller = ResellerCreateSchema.parse({
      name: 'Demo Bayi',
      slug: 'demo-bayi',
      email: 'demo@example.com',
      password: 'secret12345',
      keyQuota: 5,
    });
    assert.equal(reseller.slug, 'demo-bayi');
  });

  it('parses tenant and activation contracts', async () => {
    const { TenantLoginRequestSchema, ActivationLookupSchema, SaleCreateSchema } =
      await import('@milioner/contracts');
    const login = TenantLoginRequestSchema.parse({
      email: 'demo@example.com',
      password: 'secret123',
    });
    assert.equal(login.email, 'demo@example.com');
    const sale = SaleCreateSchema.parse({
      name: 'Demo',
      email: 'demo@example.com',
      password: 'secret12345',
      address: 'Bakı, Nizami küç. 12',
      days: 90,
    });
    assert.equal(sale.days, 90);
    const lookup = ActivationLookupSchema.parse({
      activationKey: 'AAAA-BBBB-CCCC-DDDD',
    });
    assert.ok(lookup.activationKey.length >= 16);
  });
});

describe('reseller token', () => {
  const identity = { resellerId: 'r-1', slug: 'demo-bayi', email: 'demo@example.com' };

  it('round-trips a signed token', () => {
    const { token, expiresAt } = signResellerToken(identity);
    assert.ok(token.startsWith('r1.'));
    assert.ok(expiresAt > Date.now());
    assert.deepEqual(resolveResellerToken(token), identity);
  });

  it('rejects a tampered payload', () => {
    const { token } = signResellerToken(identity);
    const [prefix, body, sig] = token.split('.');
    const forged = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8'));
    forged.resellerId = 'r-2';
    const swapped = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');
    assert.equal(resolveResellerToken(`${prefix}.${swapped}.${sig}`), null);
  });

  it('rejects tenant tokens and garbage', () => {
    assert.equal(resolveResellerToken('t1.abc.def'), null);
    assert.equal(resolveResellerToken('not-a-token'), null);
    assert.equal(resolveResellerToken(undefined), null);
  });

  it('stops honouring a token after logout', () => {
    const { token } = signResellerToken(identity);
    assert.ok(resolveResellerToken(token));
    revokeResellerToken(token);
    assert.equal(resolveResellerToken(token), null);
  });
});
