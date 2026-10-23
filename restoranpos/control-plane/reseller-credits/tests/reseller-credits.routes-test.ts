/**
 * The partner and admin routes end to end, over HTTP (inject), against a real
 * Postgres with the production schema + 0032 (PGlite on 127.0.0.1:55432).
 */
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '@possistem/database';
import { signResellerToken } from '../plugins/reseller-auth.js';
import { resellerRoutes, salesRoutes } from './resellers.js';
import { resellerPortalRoutes } from './reseller-portal.js';
import { deviceRoutes } from './devices.js';

const client = postgres('postgres://postgres@127.0.0.1:55432/postgres', { max: 1 });
let app: FastifyInstance;
let adminId: string;

before(async () => {
  app = Fastify();
  app.decorate('db', drizzle(client, { schema }) as never);
  const [admin] = (await client`
    INSERT INTO users (email, password_hash, role) VALUES (${`admin-${Date.now()}@x.az`}, 'x', 'superadmin') RETURNING id
  `) as unknown as Array<{ id: string }>;
  adminId = admin!.id;
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-test-admin']) (req as unknown as { user: unknown }).user = { id: adminId, role: 'superadmin', email: 'a@x.az' };
  });
  await app.register(resellerRoutes);
  await app.register(salesRoutes);
  await app.register(resellerPortalRoutes);
  await app.register(deviceRoutes);
  await app.ready();
});
after(async () => {
  await app.close();
  await client.end();
});

const admin = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) =>
  app.inject({ method, url, headers: { 'x-test-admin': '1' }, ...(body !== undefined ? { payload: body as object } : {}) });
const partner = (token: string, method: 'GET' | 'POST', url: string, body?: unknown) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body !== undefined ? { payload: body as object } : {}) });

it('runs a partner from first credit to renewal, refund and sign-out', async () => {
  const slug = `bayi-${Date.now()}`;
  const created = await admin('POST', '/resellers', { name: 'Bayi', slug, email: `${slug}@x.az`, password: 'password1', keyQuota: 3 });
  assert.equal(created.statusCode, 201, created.body);
  const reseller = created.json() as { id: string };
  const token = signResellerToken({ resellerId: reseller.id, slug, email: `${slug}@x.az` }).token;

  const me = (await partner(token, 'GET', '/reseller/me')).json();
  assert.deepEqual([me.quota, me.remaining, me.trialLimit, me.trialsUsed, me.maxDevices], [3, 3, 5, 0, 3]);

  // Too many devices, then more months than the balance.
  const base = { name: 'Market 1', email: `m-${Date.now()}@x.az`, password: 'password1', address: 'Bakı', product: 'market' };
  assert.equal((await partner(token, 'POST', '/reseller/customers', { ...base, term: 1, maxDevices: 4 })).statusCode, 400);
  const tooLong = await partner(token, 'POST', '/reseller/customers', { ...base, term: 6, maxDevices: 1 });
  assert.equal(tooLong.statusCode, 403);
  assert.equal(tooLong.json().code, 'QUOTA_EXHAUSTED');
  // Old clients that still send days are refused rather than given a free unit.
  assert.equal((await partner(token, 'POST', '/reseller/customers', { ...base, days: 3650, maxDevices: 1 })).statusCode, 400);

  const sold = await partner(token, 'POST', '/reseller/customers', { ...base, term: 1, maxDevices: 2 });
  assert.equal(sold.statusCode, 201, sold.body);
  assert.equal(sold.json().quota.remaining, 2);

  const list = (await partner(token, 'GET', '/reseller/customers')).json() as Array<{ customerId: string; licenseId: string; product: string; status: string; termMonths: number; plan: string }>;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0]!.product, list[0]!.status, list[0]!.termMonths, list[0]!.plan], ['market', 'active', 1, '1 ay']);

  const renewed = await partner(token, 'POST', `/reseller/licenses/${list[0]!.licenseId}/renew`, { term: 1 });
  assert.equal(renewed.statusCode, 200, renewed.body);
  assert.equal(renewed.json().quota.remaining, 1);
  assert.equal((await partner(token, 'POST', `/reseller/licenses/${list[0]!.licenseId}/renew`, { term: 3 })).statusCode, 403);

  const ledger = (await partner(token, 'GET', '/reseller/ledger')).json() as Array<{ reason: string; delta: number }>;
  assert.deepEqual(ledger.map((g) => `${g.reason}${g.delta}`).sort(), ['grant3', 'renew-1', 'sale-1']);

  // A lapsed licence reads as expired even though the row still says active.
  await client`UPDATE licenses SET valid_until = now() - interval '1 day' WHERE id = ${list[0]!.licenseId}`;
  const lapsed = (await partner(token, 'GET', '/reseller/customers')).json() as Array<{ status: string }>;
  assert.equal(lapsed[0]!.status, 'expired');
  const sales = (await admin('GET', '/sales')).json() as Array<{ licenseId: string; status: string }>;
  assert.equal(sales.find((s) => s.licenseId === list[0]!.licenseId)!.status, 'expired');

  // Admin: renew free, sell credits, settings, ledger.
  const adminRenew = await admin('POST', `/licenses/${list[0]!.licenseId}/renew`, { days: 30 });
  assert.equal(adminRenew.statusCode, 200, adminRenew.body);
  assert.equal((await admin('POST', `/resellers/${reseller.id}/credits`, { months: 12, amountMinor: 30000, note: 'Nağd' })).statusCode, 200);
  assert.equal((await admin('PATCH', `/resellers/${reseller.id}`, { trialLimit: 1, maxDevices: 5 })).statusCode, 200);
  const row = ((await admin('GET', '/resellers')).json() as Array<{ id: string; quota: number; trialLimit: number; maxDevices: number }>).find((r) => r.id === reseller.id)!;
  assert.deepEqual([row.quota, row.trialLimit, row.maxDevices], [15, 1, 5]);
  const adminLedger = (await admin('GET', `/resellers/${reseller.id}/ledger`)).json() as Array<{ reason: string; amountMinor: number | null }>;
  assert.equal(adminLedger.find((g) => g.reason === 'grant' && g.amountMinor === 30000) !== undefined, true);

  // Trial limit now 1.
  const trial = { ...base, product: 'restaurant', term: 'trial7', maxDevices: 1 };
  assert.equal((await partner(token, 'POST', '/reseller/customers', { ...trial, email: `t1-${Date.now()}@x.az` })).statusCode, 201);
  const second = await partner(token, 'POST', '/reseller/customers', { ...trial, email: `t2-${Date.now()}@x.az` });
  assert.equal(second.statusCode, 403);
  assert.equal(second.json().code, 'TRIAL_LIMIT');

  // Deleting a never-activated customer gives back what was spent on it.
  const del = await admin('DELETE', `/customers/${list[0]!.customerId}`);
  assert.equal(del.statusCode, 200, del.body);
  assert.equal(del.json().refundedCredits, 2);

  // Resetting the password ends existing sessions.
  assert.equal((await admin('PATCH', `/resellers/${reseller.id}`, { password: 'newpassword1' })).statusCode, 200);
  assert.equal((await partner(token, 'GET', '/reseller/me')).statusCode, 401);
});

it('keeps the credits of a customer whose till was activated', async () => {
  const slug = `bayi2-${Date.now()}`;
  const reseller = (await admin('POST', '/resellers', { name: 'B2', slug, email: `${slug}@x.az`, password: 'password1', keyQuota: 1 })).json() as { id: string };
  const token = signResellerToken({ resellerId: reseller.id, slug, email: `${slug}@x.az` }).token;
  const sold = await partner(token, 'POST', '/reseller/customers', { name: 'R', email: `r-${Date.now()}@x.az`, password: 'password1', address: 'Bakı', term: 1, maxDevices: 1 });
  assert.equal(sold.statusCode, 201, sold.body);
  const customerId = sold.json().customer.id as string;
  await client`UPDATE activation_keys SET redeem_count = 1 WHERE license_id IN (SELECT id FROM licenses WHERE customer_id = ${customerId})`;
  const del = await admin('DELETE', `/customers/${customerId}`);
  assert.equal(del.statusCode, 200, del.body);
  assert.equal(del.json().refundedCredits, 0);
});

it('hands a till its renewed licence on the heartbeat, and nothing once it has ended', async () => {
  const slug = `bayi3-${Date.now()}`;
  const reseller = (await admin('POST', '/resellers', { name: 'B3', slug, email: `${slug}@x.az`, password: 'password1', keyQuota: 2 })).json() as { id: string };
  const token = signResellerToken({ resellerId: reseller.id, slug, email: `${slug}@x.az` }).token;
  const sold = await partner(token, 'POST', '/reseller/customers', { name: 'R', email: `h-${Date.now()}@x.az`, password: 'password1', address: 'Bakı', term: 1, maxDevices: 1 });
  const customerId = sold.json().customer.id as string;
  const [lic] = (await client`SELECT id FROM licenses WHERE customer_id = ${customerId}`) as unknown as Array<{ id: string }>;
  const [device] = (await client`
    INSERT INTO devices (license_id, device_fingerprint, hostname, status)
    VALUES (${lic!.id}, 'fingerprint-123456', 'kassa', 'active') RETURNING id
  `) as unknown as Array<{ id: string }>;

  const beat = async () => (await app.inject({ method: 'POST', url: `/devices/${device!.id}/heartbeat`, payload: { deviceFingerprint: 'fingerprint-123456' } })).json();
  const first = await beat();
  assert.equal(first.ok, true);
  assert.equal(first.licenseRefresh.device.id, device!.id);
  assert.equal(first.licenseRefresh.signedLicense.payload.deviceFingerprint, 'fingerprint-123456');
  assert.match(first.licenseRefresh.signedLicense.signature, /^[0-9a-f]{128}$/);

  await client`UPDATE licenses SET valid_until = now() - interval '1 day' WHERE id = ${lic!.id}`;
  assert.equal((await beat()).licenseRefresh, null);

  await partner(token, 'POST', `/reseller/licenses/${lic!.id}/renew`, { term: 1 });
  const renewed = await beat();
  assert.ok(Date.parse(renewed.licenseRefresh.license.validUntil) > Date.now() + 27 * 86_400_000);
});
