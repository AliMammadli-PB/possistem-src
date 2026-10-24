import { pbkdf2, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { signLicensePayload } from '@milioner/security';
import { loadOrCreateSigningKeys } from '../lib/keys.js';
import { writeAudit } from '../lib/audit.js';
import { z } from 'zod';
import { clientIp, parseBody } from '../lib/validate.js';
import { requireCustomer } from '../plugins/customer-auth.js';
import { requireSuperadmin } from '../plugins/auth.js';
import {
  catalogueFor,
  normaliseMarketRole,
  allKeysFor,
  clampToEntitlements,
  alwaysOnFor,
  isPosProductKey,
  type PosProduct,
} from './pos-permissions.js';

/**
 * Staff roles and permissions, set on the website and applied on the till.
 *
 * Two layers, deliberately separate:
 *
 *   entitlements - what POSSISTEM granted this customer for this product.
 *                  Ours. Written from the admin panel only.
 *   role policy  - which of those rights the customer's own manager hands to
 *                  which staff role. Theirs, edited in their own portal.
 *
 * The till only ever receives the intersection, so a right that was never sold
 * cannot be granted by editing roles, and withdrawing an entitlement takes
 * effect on the next pull without anyone touching the policy.
 *
 * Product matters: the two cores check different vocabularies, so every read
 * and write is scoped to one, and the device pull resolves the product from
 * the licence behind the device rather than trusting the caller.
 */

const PermissionKey = z.string().min(3).max(64).regex(/^[A-Za-z][A-Za-z_.]*$/);

const RoleUserSchema = z.object({
  userId: z.string().trim().min(1).max(80),
  name: z.string().max(80).optional(),
  allow: z.array(PermissionKey).max(200).default([]),
  deny: z.array(PermissionKey).max(200).default([]),
});
const RolePolicySchema = z.object({
  roles: z
    .array(z.object({ name: z.string().trim().min(1).max(64), permissions: z.array(PermissionKey).max(200), operationPolicyVersion: z.literal(1).optional() }))
    .max(40),
  // Per worker: allow / deny on top of their role (the till's employee overrides).
  users: z.array(RoleUserSchema).max(200).optional(),
});
export type RoleUser = z.infer<typeof RoleUserSchema>;

const EntitlementSchema = z.object({
  unrestricted: z.boolean(),
  allowed: z.array(PermissionKey).max(400),
});

type RolePolicyRole = { name: string; permissions: string[]; operationPolicyVersion?: 1 };

export type StoredRolePolicy = {
  product: PosProduct;
  roles: RolePolicyRole[];
  users: RoleUser[];
  version: number;
  updatedAt: string | null;
  updatedByKind: 'customer' | 'admin' | null;
};

export type StoredEntitlements = { unrestricted: boolean; allowed: string[]; updatedAt: string | null };

/** A query string or body field naming the product; restaurant when absent. */
function productOf(value: unknown): PosProduct {
  return isPosProductKey(value) ? value : 'restaurant';
}

/**
 * The products this customer actually holds a licence for.
 *
 * Without it both editors would have to show a Market tab to a restaurant-only
 * shop and hope nobody clicked it. A policy saved under a product they do not
 * own is harmless - nothing pulls it - but it is a question the screen should
 * not be asking.
 */
async function licensedProducts(app: FastifyInstance, customerId: string): Promise<PosProduct[]> {
  // `licenses` has no product column - it is derived, and has been since before
  // the market plan existed: an explicit features.product wins, then the legacy
  // `plan = 'market'`, and everything else is a restaurant. Selecting a column
  // called `product` here was a 500 on every load of this screen.
  const rows = (await app.db.execute(sql`
    SELECT DISTINCT
      CASE
        WHEN nullif(features ->> 'product', '') IS NOT NULL THEN features ->> 'product'
        WHEN plan = 'market' THEN 'market'
        ELSE 'restaurant'
      END AS product
    FROM licenses
    WHERE customer_id = ${customerId}::uuid AND status = 'active'
  `)) as Array<Record<string, unknown>>;

  const held = rows
    .map((row) => row.product)
    .filter((product): product is PosProduct => isPosProductKey(product));
  // A customer mid-onboarding has no active licence yet; the screen still has
  // to show them something, and restaurant is what the rest of this defaults to.
  return held.length > 0 ? held : ['restaurant'];
}

export async function readRolePolicy(
  app: FastifyInstance,
  customerId: string,
  product: PosProduct,
): Promise<StoredRolePolicy> {
  const rows = (await app.db.execute(sql`
    SELECT roles, users, version, updated_at, updated_by_kind
    FROM pos_role_policy
    WHERE customer_id = ${customerId}::uuid AND product = ${product}
  `)) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) return { product, roles: [], users: [], version: 0, updatedAt: null, updatedByKind: null };
  return {
    product,
    roles: ((row.roles as RolePolicyRole[]) ?? []).map(role => product === 'market' ? normaliseMarketRole(role) : role),
    users: (row.users as RoleUser[]) ?? [],
    version: Number(row.version ?? 0),
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
    updatedByKind: (row.updated_by_kind as StoredRolePolicy['updatedByKind']) ?? null,
  };
}

export async function readEntitlements(
  app: FastifyInstance,
  customerId: string,
  product: PosProduct,
): Promise<StoredEntitlements> {
  const rows = (await app.db.execute(sql`
    SELECT allowed, unrestricted, updated_at
    FROM pos_entitlements
    WHERE customer_id = ${customerId}::uuid AND product = ${product}
  `)) as Array<Record<string, unknown>>;

  const row = rows[0];
  // No row means nobody has restricted this customer - not that they may do
  // nothing. Selling a tier is an act; silence keeps what they already had.
  if (!row) return { unrestricted: true, allowed: allKeysFor(product), updatedAt: null };
  const always = alwaysOnFor(product);
  const allowed = [...new Set([...((row.allowed as string[]) ?? []), ...always])];
  return {
    unrestricted: Boolean(row.unrestricted),
    allowed,
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
  };
}

/** What the till gets: the manager's policy narrowed to what was sold. */
export async function effectiveRolePolicy(
  app: FastifyInstance,
  customerId: string,
  product: PosProduct,
): Promise<StoredRolePolicy & { entitlementsApplied: boolean; features: { inventory: boolean; settings: boolean } }> {
  const [policy, ent, featureRows] = await Promise.all([
    readRolePolicy(app, customerId, product),
    readEntitlements(app, customerId, product),
    app.db.execute(sql`
      SELECT features FROM licenses
      WHERE customer_id = ${customerId}::uuid AND status = 'active'
        AND (CASE WHEN nullif(features ->> 'product', '') IS NOT NULL THEN features ->> 'product'
                  WHEN plan = 'market' THEN 'market' ELSE 'restaurant' END) = ${product}
      ORDER BY updated_at DESC
      LIMIT 1
    `) as Promise<Array<{ features: Record<string, unknown> | null }>>,
  ]);
  const feat = featureRows?.[0]?.features && typeof featureRows[0].features === 'object'
    ? featureRows[0].features
    : {};
  const known = allKeysFor(product);
  let roles = policy.roles;
  if (product === 'market') {
    // The manager (Müdür) starts with every right; a stored manager role holding
    // none of the market keys (the old editor saved it empty because the till
    // forced it to all) still means that default, not "nothing".
    const manager = roles.find((r) => r.name === 'manager');
    if (!manager) {
      roles = [...roles.filter((r) => r.name !== 'manager'), { name: 'manager', permissions: known }];
    }
  }
  // A worker cannot be allowed what the customer was not sold; a deny always stands.
  const users = policy.users
    .filter((u) => u.userId !== SUPERADMIN_USER_ID)
    .map((u) => ({
      ...u,
      allow: clampToEntitlements(product, [{ name: u.userId, permissions: u.allow }], ent.unrestricted ? null : ent.allowed)[0]?.permissions ?? [],
      deny: u.deny.filter((k) => known.includes(k)),
    }));
  // The POSSISTEM super admin PIN signs in as this user: never narrowed by role edits or the package.
  if (product === 'market') users.push({ userId: SUPERADMIN_USER_ID, name: 'POSSISTEM', allow: known, deny: [] });
  return {
    ...policy,
    roles: clampToEntitlements(product, roles, ent.unrestricted ? null : ent.allowed),
    users,
    entitlementsApplied: !ent.unrestricted,
    features: {
      inventory: feat.inventory !== false,
      settings: feat.settings !== false,
    },
  };
}

export const SUPERADMIN_USER_ID = 'possistem-admin';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;
const PIN_KDF = { N: 131072, r: 8, p: 1, maxmem: 268435456 };
const PIN_PREFIX_KDF = { N: 16384, r: 8, p: 1 };

/**
 * The super admin PIN hashes, signed for one till with the licence key it
 * pinned at activation (the key signDeviceCommand uses). null until a PIN is set.
 */
export async function superAdminGrant(app: FastifyInstance, customerId: string, deviceId: string) {
  const rows = (await app.db.execute(sql`
    SELECT salt, hash, prefix_salt, prefix_hash, updated_at FROM superadmin_pin WHERE id = 1
  `)) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  const keys = loadOrCreateSigningKeys();
  const signed = signLicensePayload(keys.privateKey, {
    type: 'possistem-superadmin',
    customerId,
    deviceId,
    issuedAt: Date.now(),
    kdf: 'scrypt',
    N: PIN_KDF.N,
    r: PIN_KDF.r,
    p: PIN_KDF.p,
    prefixN: PIN_PREFIX_KDF.N,
    salt: String(row.salt),
    hash: String(row.hash),
    prefixSalt: String(row.prefix_salt),
    prefixHash: String(row.prefix_hash),
    updatedAt: new Date(row.updated_at as string).getTime(),
  });
  return { payload: signed.payload, signature: signed.signature };
}

const StaffSaveSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(80),
  role: z.enum(['manager', 'head_cashier', 'cashier', 'warehouse']),
  branchId: z.string().max(80).optional(),
  active: z.boolean().optional(),
  pin: z.string().regex(/^\d{4}$/).optional(),
});
class StaffSaveError extends Error {
  constructor(public code: number, message: string) { super(message); }
}
const WEAK_PINS = new Set(['0000', '1111', '1234', '4321']);
// The demo users of old tills; the till refuses their PINs (staff-auth.cjs PUBLISHED_STAFF).
const PUBLISHED_PIN_CREDENTIALS = [
  ['687f8fbf095f402c0f82586d918206a0', '1f5488722c7051e86a233f77e18f5a03bc60264c78d6cf18fc47236ab8f44981'],
  ['b1d14ca3484fbedd1d01f981f54f4c74', '6c166257c084772d8bd291a4826991f1353e9da2b6bc5082f211a4f0047ca3d8'],
  ['fe5892f2cb48f1621663fedd138bc8ab', '961af08c2dfe98fd30598492d03ae37f22aab332fa7481eca91cbf83adfee452'],
  ['42e27db11f3ca2ef0c5a8bad872201b7', '72dc9539944ef364c217a072f5daac8611aaec82942f9dc6ba933dbf990a5ff2'],
];
const pbkdf2Async = promisify(pbkdf2);

/** The till's PIN hash (electron/staff-auth.cjs): the hex salt string itself is the pbkdf2 salt. */
export async function tillPinHash(pin: string, salt: string): Promise<string> {
  return (await pbkdf2Async(String(pin), salt, 120000, 32, 'sha256')).toString('hex');
}

async function matchesPublishedPin(pin: string): Promise<boolean> {
  const hits = await Promise.all(PUBLISHED_PIN_CREDENTIALS.map(async ([salt, hash]) => (await tillPinHash(pin, salt!)) === hash));
  return hits.includes(true);
}

/** True when `pin` is the first 4 digits of the POSSISTEM super admin PIN (it would open that account on the till). */
async function isSuperadminPrefix(app: FastifyInstance, pin: string): Promise<boolean> {
  const rows = (await app.db.execute(sql`SELECT prefix_salt, prefix_hash FROM superadmin_pin WHERE id = 1`)) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return false;
  return (await scryptAsync(pin, Buffer.from(String(row.prefix_salt), 'hex'), 32, PIN_PREFIX_KDF)).toString('hex') === row.prefix_hash;
}

async function customerBranches(app: FastifyInstance, customerId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = (await app.db.execute(sql`
    SELECT id, name FROM branches WHERE customer_id = ${customerId}::uuid AND active ORDER BY name
  `)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

function staffOut(r: Record<string, unknown>, branchNames: Map<string, string>) {
  const branchId = String(r.branch_id ?? '');
  return {
    id: String(r.staff_id), name: String(r.name || r.staff_id), role: String(r.role), active: r.active !== false,
    objectId: String(r.object_id ?? ''), branchId, branchName: branchId ? branchNames.get(branchId) ?? '' : '',
    updatedAt: Number(r.updated_at ?? 0),
  };
}

const SuperadminPinSchema = z.object({
  pin: z.string().regex(/^\d{10}$/),
  confirm: z.string().regex(/^\d{10}$/),
});

export async function writeRolePolicy(
  app: FastifyInstance,
  customerId: string,
  product: PosProduct,
  policy: z.infer<typeof RolePolicySchema>,
  kind: 'customer' | 'admin',
  actorId: string | null,
  expectedVersion?: number,
): Promise<StoredRolePolicy> {
  const rows = (await app.db.execute(sql`
    INSERT INTO pos_role_policy (customer_id, product, roles, users, version, updated_at, updated_by_kind, updated_by)
    VALUES (${customerId}::uuid, ${product}, ${JSON.stringify(policy.roles)}::jsonb, ${JSON.stringify(policy.users ?? [])}::jsonb, 1, now(), ${kind}, ${actorId}::uuid)
    ON CONFLICT (customer_id, product) DO UPDATE SET
      roles = EXCLUDED.roles,
      -- A save without users (the customer's portal) keeps the admin's per-worker rows.
      users = CASE WHEN ${policy.users === undefined} THEN pos_role_policy.users ELSE EXCLUDED.users END,
      version = pos_role_policy.version + 1,
      updated_at = now(),
      updated_by_kind = EXCLUDED.updated_by_kind,
      updated_by = EXCLUDED.updated_by
    WHERE ${expectedVersion === undefined} OR pos_role_policy.version = ${expectedVersion ?? 0}
    RETURNING roles, users, version, updated_at, updated_by_kind
  `)) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) throw Object.assign(new Error('İcazələr başqa yerdə dəyişdirilib. Siyahını yeniləyin.'), {statusCode:409});
  return {
    product,
    roles: ((row.roles as RolePolicyRole[]) ?? []).map(role => product === 'market' ? normaliseMarketRole(role) : role),
    users: (row.users as RoleUser[]) ?? [],
    version: Number(row.version ?? 0),
    updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
    updatedByKind: (row.updated_by_kind as StoredRolePolicy['updatedByKind']) ?? null,
  };
}

/** The customer's own portal: their staff, inside what they were sold. */
export async function posRoleCustomerRoutes(app: FastifyInstance) {
  app.get('/customer/pos/roles', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const product = productOf((req.query as { product?: string }).product);
    const [policy, entitlements, products] = await Promise.all([
      readRolePolicy(app, identity.id, product),
      readEntitlements(app, identity.id, product),
      licensedProducts(app, identity.id),
    ]);
    // The catalogue travels with the policy so the editor shows this product's
    // own keys, and the entitlement so it can show - not hide - what was not
    // sold: a greyed row is an upsell, a missing row is a mystery.
    return { ...policy, entitlements, products, catalogue: catalogueFor(product) };
  });

  app.put('/customer/pos/roles', {
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const product = productOf((req.query as { product?: string }).product);
    // Market: rights are POSSISTEM's to set (the admin panel), not the shop's.
    if (product === 'market') return reply.code(403).send({ error: 'Market POS səlahiyyətlərini possistem təyin edir' });
    const body = parseBody(RolePolicySchema, req.body, reply);
    if (!body) return;
    delete (body as { users?: unknown }).users;

    // Stored as sent, clamped on the way out. Keeping the customer's intent
    // means a right restored later comes back without them re-editing.
    return writeRolePolicy(app, identity.id, product, body, 'customer', identity.id);
  });
}

/** POSSISTEM admin panel: pick a customer, set what they were sold, and their roles. */
export async function posRoleAdminRoutes(app: FastifyInstance) {
  app.get('/customers/:id/pos/roles', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const product = productOf((req.query as { product?: string }).product);
    const [policy, entitlements, products] = await Promise.all([
      readRolePolicy(app, id, product),
      readEntitlements(app, id, product),
      licensedProducts(app, id),
    ]);
    return { ...policy, entitlements, products, catalogue: catalogueFor(product) };
  });

  app.put('/customers/:id/pos/roles', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const product = productOf((req.query as { product?: string }).product);
    const body = parseBody(RolePolicySchema, req.body, reply);
    if (!body) return;
    const actor = (req as { user?: { id?: string } }).user?.id ?? null;
    return writeRolePolicy(app, id, product, body, 'admin', actor);
  });

  /** The customer's Market workers (no PIN hashes), grouped by filial in the admin panel. */
  app.get('/customers/:id/pos/staff', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return reply.code(400).send({ error: 'Invalid customer id' });
    const [rows, branches] = await Promise.all([
      app.db.execute(sql`
        SELECT staff_id, name, role, active, object_id, branch_id, updated_at
        FROM market_staff
        WHERE customer_id = ${id}::uuid AND NOT deleted
        ORDER BY active DESC, name
      `) as Promise<Array<Record<string, unknown>>>,
      customerBranches(app, id),
    ]);
    const names = new Map(branches.map((b) => [b.id, b.name]));
    const staff = rows.map((r) => staffOut(r, names));
    const counts: Record<string, number> = {};
    // branchCounts[branchId ('' = every filial)][role] = n
    const branchCounts: Record<string, Record<string, number>> = {};
    for (const person of staff) {
      counts[person.role] = (counts[person.role] ?? 0) + 1;
      const at = (branchCounts[person.branchId] ??= {});
      at[person.role] = (at[person.role] ?? 0) + 1;
    }
    return { staff, counts, branches, branchCounts };
  });

  /** Create or edit one worker. The PIN is hashed the till's way and never stored, echoed or logged. */
  app.post('/customers/:id/pos/staff', {
    config: { rateLimit: { max: 60, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id: customerId } = req.params as { id: string };
    if (!z.string().uuid().safeParse(customerId).success) return reply.code(400).send({ error: 'Invalid customer id' });
    const parsed = StaffSaveSchema.safeParse(req.body ?? {});
    // Not parseBody: its error echoes the input, and the input holds the PIN.
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? '');
      return reply.code(400).send({ error: field === 'pin' ? 'PIN düz 4 rəqəm olmalıdır' : `Yanlış sahə: ${field || 'body'}` });
    }
    const body = parsed.data;
    const [customer] = (await app.db.execute(sql`SELECT 1 FROM customers WHERE id = ${customerId}::uuid`)) as unknown[];
    if (!customer) return reply.code(404).send({ error: 'Müştəri tapılmadı' });
    if (body.pin && (WEAK_PINS.has(body.pin) || (await isSuperadminPrefix(app, body.pin)) || (await matchesPublishedPin(body.pin)))) {
      return reply.code(400).send({ error: 'Bu PIN istifadə edilə bilməz' });
    }
    const branches = await customerBranches(app, customerId);
    const names = new Map(branches.map((b) => [b.id, b.name]));
    const actor = (req as { user?: { id?: string } }).user?.id ?? null;

    let result;
    try { result = await app.db.transaction(async (tx) => {
      // One writer per customer at a time, so two saves cannot both take the same PIN.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'market_staff:' + customerId}))`);
      const rows = (await tx.execute(sql`
        SELECT staff_id, active, salt, pin_hash, branch_id, deleted, updated_at FROM market_staff WHERE customer_id = ${customerId}::uuid
      `)) as Array<Record<string, unknown>>;
      const existing = body.id ? rows.find((r) => r.staff_id === body.id) : undefined;
      if (body.id && !existing) throw new StaffSaveError(404, 'İşçi tapılmadı');
      if (!existing && !body.pin) throw new StaffSaveError(400, 'Yeni işçi üçün PIN lazımdır');
      const branchId = body.branchId ?? String(existing?.branch_id ?? '');
      // A filial that was closed later does not block editing a worker still assigned to it.
      if (branchId && !names.has(branchId) && branchId !== existing?.branch_id) throw new StaffSaveError(400, 'Filial tapılmadı');
      let credential: { salt: string; pinHash: string } | null = null;
      if (body.pin) {
        const others = rows.filter((r) => r.staff_id !== body.id && r.active !== false && r.deleted !== true && r.pin_hash);
        const taken = await Promise.all(others.map(async (r) => (await tillPinHash(body.pin!, String(r.salt))) === r.pin_hash));
        if (taken.includes(true)) throw new StaffSaveError(409, 'Bu PIN başqa işçidədir');
        const salt = randomBytes(16).toString('hex');
        credential = { salt, pinHash: await tillPinHash(body.pin, salt) };
      }
      const staffId = existing ? String(existing.staff_id) : `u-${randomUUID()}`;
      const active = body.active ?? (existing ? existing.active !== false : true);
      // Newer than any copy a till holds, even one whose clock ran ahead, so every till takes it.
      const updatedAt = Math.max(Date.now(), Number(existing?.updated_at ?? 0) + 1);
      const [saved] = (await tx.execute(sql`
        INSERT INTO market_staff (customer_id, staff_id, name, role, active, salt, pin_hash, branch_id, deleted, updated_at)
        VALUES (${customerId}::uuid, ${staffId}, ${body.name}, ${body.role}, ${active},
          ${credential?.salt ?? ''}, ${credential?.pinHash ?? ''}, ${branchId}, false, ${updatedAt})
        ON CONFLICT (customer_id, staff_id) DO UPDATE SET
          name = EXCLUDED.name, role = EXCLUDED.role, active = EXCLUDED.active, branch_id = EXCLUDED.branch_id,
          salt = CASE WHEN ${credential !== null} THEN EXCLUDED.salt ELSE market_staff.salt END,
          pin_hash = CASE WHEN ${credential !== null} THEN EXCLUDED.pin_hash ELSE market_staff.pin_hash END,
          deleted = false, updated_at = EXCLUDED.updated_at
        RETURNING staff_id, name, role, active, object_id, branch_id, updated_at
      `)) as Array<Record<string, unknown>>;
      return { created: !existing, pinChanged: credential !== null, row: saved! };
    }); } catch (err) {
      if (err instanceof StaffSaveError) return reply.code(err.code).send({ error: err.message });
      throw err;
    }
    const staff = staffOut(result.row, names);
    await writeAudit(app, {
      actorUserId: actor, action: 'market_staff.save', entityType: 'market_staff', entityId: staff.id, ip: clientIp(req),
      meta: { customerId, created: result.created, pinChanged: result.pinChanged, role: staff.role, branchId: staff.branchId, active: staff.active },
    });
    return { staff };
  });

  /** Whether the POSSISTEM super admin PIN is set. The PIN and its hashes never leave here. */
  app.get('/admin/superadmin-pin', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const rows = (await app.db.execute(sql`SELECT updated_at FROM superadmin_pin WHERE id = 1`)) as Array<Record<string, unknown>>;
    return { set: rows.length > 0, updatedAt: rows[0] ? new Date(rows[0].updated_at as string).toISOString() : null };
  });

  app.put('/admin/superadmin-pin', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const parsed = SuperadminPinSchema.safeParse(req.body ?? {});
    // Not parseBody: its error echoes the input, and the input is the PIN.
    if (!parsed.success) return reply.code(400).send({ error: 'PIN düz 10 rəqəm olmalıdır' });
    if (parsed.data.pin !== parsed.data.confirm) return reply.code(400).send({ error: 'PIN-lər eyni deyil' });
    const pin = parsed.data.pin;
    const salt = randomBytes(16).toString('hex');
    const prefixSalt = randomBytes(16).toString('hex');
    const hash = (await scryptAsync(pin, Buffer.from(salt, 'hex'), 32, PIN_KDF)).toString('hex');
    const prefixHash = (await scryptAsync(pin.slice(0, 4), Buffer.from(prefixSalt, 'hex'), 32, PIN_PREFIX_KDF)).toString('hex');
    const actor = (req as { user?: { id?: string } }).user?.id ?? null;
    const rows = (await app.db.execute(sql`
      INSERT INTO superadmin_pin (id, salt, hash, prefix_salt, prefix_hash, updated_at, updated_by)
      VALUES (1, ${salt}, ${hash}, ${prefixSalt}, ${prefixHash}, now(), ${actor}::uuid)
      ON CONFLICT (id) DO UPDATE SET
        salt = EXCLUDED.salt, hash = EXCLUDED.hash,
        prefix_salt = EXCLUDED.prefix_salt, prefix_hash = EXCLUDED.prefix_hash,
        updated_at = now(), updated_by = EXCLUDED.updated_by
      RETURNING updated_at
    `)) as Array<Record<string, unknown>>;
    await writeAudit(app, { actorUserId: actor, action: 'superadmin_pin.set', entityType: 'superadmin_pin', entityId: '1', ip: clientIp(req) });
    return { set: true, updatedAt: new Date(rows[0]!.updated_at as string).toISOString() };
  });

  /** What this customer was sold. Ours to set, never the customer's. */
  app.put('/customers/:id/pos/entitlements', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const product = productOf((req.query as { product?: string }).product);
    const body = parseBody(EntitlementSchema, req.body, reply);
    if (!body) return;

    // Keys this product has never heard of are dropped rather than stored: an
    // entitlement list is checked against the till's own vocabulary, and a
    // typo that silently grants nothing is worse than a shorter list.
    const known = new Set(allKeysFor(product));
    const allowed = [...new Set([
      ...body.allowed.filter((k) => known.has(k)),
      ...alwaysOnFor(product),
    ])];
    const actor = (req as { user?: { id?: string } }).user?.id ?? null;

    await app.db.execute(sql`
      INSERT INTO pos_entitlements (customer_id, product, allowed, unrestricted, updated_at, updated_by)
      VALUES (${id}::uuid, ${product}, ${JSON.stringify(allowed)}::jsonb, ${body.unrestricted}, now(), ${actor}::uuid)
      ON CONFLICT (customer_id, product) DO UPDATE SET
        allowed = EXCLUDED.allowed,
        unrestricted = EXCLUDED.unrestricted,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by
    `);

    // The till re-applies only on a new version; without this bump a changed
    // package reached it only after the next unrelated role edit.
    await app.db.execute(sql`
      INSERT INTO pos_role_policy (customer_id, product, roles, version, updated_at, updated_by_kind, updated_by)
      VALUES (${id}::uuid, ${product}, '[]'::jsonb, 1, now(), 'admin', ${actor}::uuid)
      ON CONFLICT (customer_id, product) DO UPDATE SET
        version = pos_role_policy.version + 1,
        updated_at = now()
    `);

    const entitlements = await readEntitlements(app, id, product);
    return { product, entitlements, dropped: body.allowed.length - allowed.length };
  });
}

/** The device must authenticate separately; its proof alone cannot grant a role. */
export async function verifySuperadminCredential(app: FastifyInstance, pin: string): Promise<boolean> {
  if (!/^\d{10}$/.test(pin)) return false;
  const rows = await app.db.execute(sql`SELECT salt, hash FROM superadmin_pin WHERE id = 1`) as Array<Record<string, unknown>>;
  const row = rows[0]; if (!row) return false;
  const actual = await scryptAsync(pin, Buffer.from(String(row.salt), 'hex'), 32, PIN_KDF);
  const expected = Buffer.from(String(row.hash), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
