import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod/v3';
import { licenses } from '@milioner/database';
import { parseBody } from '../lib/validate.js';
import { requireSuperadmin } from '../plugins/auth.js';
import { requireCustomer } from '../plugins/customer-auth.js';
import {
  ACCESS_AREAS,
  areaAllowed,
  areaKeys,
  readGrant,
  tighten,
  type AccessGrant,
  type AccessSurface,
} from '../lib/access-areas.js';

const SaveSchema = z.object({
  portal: z.array(z.string()).nullable(),
  market: z.array(z.string()).nullable(),
  restaurant: z.array(z.string()).nullable(),
});

const ANBAR_PORTAL = new Set([
  'anbar', 'product', 'enter', 'loss', 'move', 'inventory', 'stock', 'stockbalance',
  'supply', 'purchaseorder',
  'anbar.write', 'product.write', 'enter.write', 'loss.write', 'move.write', 'inventory.write',
  'purchaseorder.write', 'supply.write',
]);

async function grantFor(app: FastifyInstance, customerId: string): Promise<AccessGrant | null> {
  const rows = await app.db
    .select({ features: licenses.features })
    .from(licenses)
    .where(and(eq(licenses.customerId, customerId), eq(licenses.status, 'active')));
  for (const row of rows) {
    const grant = readGrant((row.features ?? {}) as Record<string, unknown>);
    if (grant) return grant;
  }
  return null;
}

export async function surfaceAccess(app: FastifyInstance, customerId: string, surface: AccessSurface) {
  const grant = await grantFor(app, customerId);
  return grant ? grant[surface] : null;
}

function catalogue() {
  return (Object.keys(ACCESS_AREAS) as AccessSurface[]).map((surface) => ({
    surface,
    areas: ACCESS_AREAS[surface].map(([key, label]) => ({ key, label })),
  }));
}

function inventoryEnabledFromAccess(access: AccessGrant): boolean {
  if (access.portal == null && access.restaurant == null && access.market == null) return true;
  const portalOk = access.portal == null || [...ANBAR_PORTAL].some((key) => access.portal!.includes(key));
  const restOk = access.restaurant == null || areaAllowed(access.restaurant, 'stock');
  const marketOk = access.market == null || areaAllowed(access.market, 'inventory');
  return portalOk || restOk || marketOk;
}

function settingsEnabledFromAccess(access: AccessGrant): boolean {
  if (access.portal == null && access.restaurant == null && access.market == null) return true;
  return (
    areaAllowed(access.portal, 'settings') ||
    areaAllowed(access.restaurant, 'settings') ||
    areaAllowed(access.market, 'settings')
  );
}

/** Keep till policy version moving so heartbeat re-applies admin strips. */
async function bumpRolePolicy(app: FastifyInstance, customerId: string) {
  await app.db.execute(sql`
    UPDATE pos_role_policy
    SET version = version + 1, updated_at = now(), updated_by_kind = 'admin'
    WHERE customer_id = ${customerId}::uuid
  `);
  // Ensure a row exists for restaurant so the till has a version to compare.
  await app.db.execute(sql`
    INSERT INTO pos_role_policy (customer_id, product, roles, version, updated_at, updated_by_kind)
    VALUES (${customerId}::uuid, 'restaurant', '[]'::jsonb, 1, now(), 'admin')
    ON CONFLICT (customer_id, product) DO NOTHING
  `);
}

async function syncEntitlements(
  app: FastifyInstance,
  customerId: string,
  inventoryOn: boolean,
  settingsOn: boolean,
) {
  // Restaurant vocabulary — strip module keys when the gate is off.
  const rows = (await app.db.execute(sql`
    SELECT allowed, unrestricted FROM pos_entitlements
    WHERE customer_id = ${customerId}::uuid AND product = 'restaurant'
  `)) as Array<{ allowed: string[] | null; unrestricted: boolean }>;

  const inventoryKeys = [
    'inventory.view', 'inventory.manage', 'inventory.adjust', 'inventory.transfer',
    'inventory.count', 'inventory.receive', 'suppliers.view', 'suppliers.manage',
    'suppliers.receive', 'suppliers.pay',
  ];
  const settingsKeys = ['settings.manage'];

  let allowed = rows[0]?.allowed ?? [];

  if (!inventoryOn || !settingsOn) {
    if (!rows[0] || rows[0].unrestricted) {
      allowed = [];
    }
  }
  const drop = new Set<string>();
  if (!inventoryOn) for (const key of inventoryKeys) drop.add(key);
  if (!settingsOn) for (const key of settingsKeys) drop.add(key);

  if (!inventoryOn || !settingsOn) {
    // When turning restricted for the first time with empty allowed, seed by
    // omitting only the closed modules (device clamp treats unrestricted=false
    // + empty allowed as nothing — so seed a wide allow-list minus drops).
    const seed = [
      'tables.view', 'tables.manage', 'tables.layout', 'order.view', 'order.manage',
      'payment.view', 'payment.manage', 'receipt.print', 'printer.manage', 'cash.manage', 'businessDay.manage',
      'catalog.manage', 'catalog.import', 'kds.view', 'reports.view', 'reports.export',
      'users.manage', 'roles.manage', 'audit.view', 'backup.manage', 'customers.view',
      'customers.manage', 'delivery.view', 'delivery.manage', 'schedule.view', 'schedule.manage',
      'gifts.manage', 'discount.rules', 'settings.manage',
      ...inventoryKeys,
    ];
    const base = (allowed.length > 0 ? allowed : seed).filter((key) => !drop.has(key));
    await app.db.execute(sql`
      INSERT INTO pos_entitlements (customer_id, product, allowed, unrestricted, updated_at, updated_by)
      VALUES (${customerId}::uuid, 'restaurant', ${JSON.stringify(base)}::jsonb, false, now(), null)
      ON CONFLICT (customer_id, product) DO UPDATE SET
        allowed = ${JSON.stringify(base)}::jsonb,
        unrestricted = false,
        updated_at = now()
    `);
  } else if (rows[0] && !rows[0].unrestricted) {
    // Both modules open again — restore unrestricted package.
    await app.db.execute(sql`
      UPDATE pos_entitlements
      SET unrestricted = true, allowed = '[]'::jsonb, updated_at = now()
      WHERE customer_id = ${customerId}::uuid AND product = 'restaurant'
    `);
  }
}

export async function accessRoutes(app: FastifyInstance) {
  app.get('/access-areas', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    return { surfaces: catalogue() };
  });

  app.get('/customers/:id/access', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const grant = await grantFor(app, id);
    const checked = (surface: AccessSurface) => grant?.[surface] ?? areaKeys(surface);
    return {
      portal: checked('portal'),
      market: checked('market'),
      restaurant: checked('restaurant'),
    };
  });

  app.put('/customers/:id/access', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = parseBody(SaveSchema, req.body ?? {}, reply);
    if (!body) return;
    const access: AccessGrant = {
      portal: tighten('portal', body.portal),
      market: tighten('market', body.market),
      restaurant: tighten('restaurant', body.restaurant),
    };
    const inventory = inventoryEnabledFromAccess(access);
    const settings = settingsEnabledFromAccess(access);
    const patch = JSON.stringify({ access, inventory, settings });
    const updated = await app.db
      .update(licenses)
      .set({
        features: sql`${licenses.features} || ${patch}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(licenses.customerId, id), eq(licenses.status, 'active')))
      .returning({ id: licenses.id });
    if (updated.length === 0) return reply.code(404).send({ error: 'Aktiv lisenziya yoxdur' });

    await syncEntitlements(app, id, inventory, settings);
    await bumpRolePolicy(app, id);

    return { ok: true, access, inventory, settings };
  });

  app.get('/customer/access', async (req, reply) => {
    const customer = requireCustomer(req, reply);
    if (!customer) return;
    const grant = await grantFor(app, customer.id);
    return { portal: grant?.portal ?? null };
  });
}
