import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { parseBody } from '../lib/validate.js';
import { requireCustomer } from '../plugins/customer-auth.js';
import { requireSuperadmin } from '../plugins/auth.js';
import {
  catalogueFor,
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

const RolePolicySchema = z.object({
  roles: z
    .array(z.object({ name: z.string().trim().min(1).max(64), permissions: z.array(PermissionKey).max(200) }))
    .max(40),
});

const EntitlementSchema = z.object({
  unrestricted: z.boolean(),
  allowed: z.array(PermissionKey).max(400),
});

type RolePolicyRole = { name: string; permissions: string[] };

export type StoredRolePolicy = {
  product: PosProduct;
  roles: RolePolicyRole[];
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
    SELECT roles, version, updated_at, updated_by_kind
    FROM pos_role_policy
    WHERE customer_id = ${customerId}::uuid AND product = ${product}
  `)) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) return { product, roles: [], version: 0, updatedAt: null, updatedByKind: null };
  return {
    product,
    roles: (row.roles as RolePolicyRole[]) ?? [],
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
  return {
    ...policy,
    roles: clampToEntitlements(product, policy.roles, ent.unrestricted ? null : ent.allowed),
    entitlementsApplied: !ent.unrestricted,
    features: {
      inventory: feat.inventory !== false,
      settings: feat.settings !== false,
    },
  };
}

async function writeRolePolicy(
  app: FastifyInstance,
  customerId: string,
  product: PosProduct,
  policy: z.infer<typeof RolePolicySchema>,
  kind: 'customer' | 'admin',
  actorId: string | null,
): Promise<StoredRolePolicy> {
  const rows = (await app.db.execute(sql`
    INSERT INTO pos_role_policy (customer_id, product, roles, version, updated_at, updated_by_kind, updated_by)
    VALUES (${customerId}::uuid, ${product}, ${JSON.stringify(policy.roles)}::jsonb, 1, now(), ${kind}, ${actorId}::uuid)
    ON CONFLICT (customer_id, product) DO UPDATE SET
      roles = EXCLUDED.roles,
      version = pos_role_policy.version + 1,
      updated_at = now(),
      updated_by_kind = EXCLUDED.updated_by_kind,
      updated_by = EXCLUDED.updated_by
    RETURNING roles, version, updated_at, updated_by_kind
  `)) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) throw new Error('role policy write returned nothing');
  return {
    product,
    roles: (row.roles as RolePolicyRole[]) ?? [],
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
    const body = parseBody(RolePolicySchema, req.body, reply);
    if (!body) return;

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
