import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../env.js';
import { parseBody } from '../lib/validate.js';
import { requireCustomer } from '../plugins/customer-auth.js';

/**
 * One shop, several computers.
 *
 * Each PC of a customer has a job - everything, the till, a waiter's screen,
 * the kitchen, the store room - and at most one PC per product is the host:
 * it keeps the database, and the others send it every call over the LAN, so a
 * burger sold at the till comes out of the store room's stock because it is
 * the same stock. The owner sets both from the portal; the till reads them on
 * its 5 s sync (restaurant) or 30 s heartbeat (market).
 */
export const STATIONS = ['all', 'cashier', 'waiter', 'kitchen', 'warehouse'] as const;
export type Station = (typeof STATIONS)[number];

const PRODUCT_SQL = sql`(CASE WHEN nullif(l.features ->> 'product', '') IS NOT NULL THEN l.features ->> 'product'
                              WHEN l.plan = 'market' THEN 'market' ELSE 'restaurant' END)`;

/**
 * The key the host and its terminals sign LAN calls with. Derived, not stored:
 * every PC of one customer gets the same key, and no other customer's PC on the
 * same network can produce it.
 */
export function lanKeyFor(customerId: string): string {
  return createHmac('sha256', env.sessionSecret).update(`pos-lan:${customerId}`).digest('hex');
}

export type DeviceStation = {
  station: Station;
  lanHost: boolean;
  /** `ip:port` of this customer's host PC for the same product, if any. */
  hostAddress: string | null;
  lanKey: string;
};

/** What one device is told on sync, and records the host's LAN address. */
export async function deviceStation(
  app: FastifyInstance,
  customerId: string,
  deviceId: string,
  lanAddresses: unknown,
): Promise<DeviceStation | null> {
  const rows = (await app.db.execute(sql`
    SELECT d.id, d.station, d.lan_host, ${PRODUCT_SQL} AS product
    FROM devices d JOIN licenses l ON l.id = d.license_id
    WHERE d.id = ${deviceId}::uuid AND l.customer_id = ${customerId}::uuid
    LIMIT 1
  `)) as Array<{ id: string; station: string; lan_host: boolean; product: string }>;
  const me = rows[0];
  if (!me) return null;

  if (me.lan_host && Array.isArray(lanAddresses)) {
    // Private IPv4 only: a host announcing a public or link-local address
    // would send its terminals somewhere they cannot or must not reach.
    const address = lanAddresses.find((value): value is string =>
      typeof value === 'string' &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}(:\d{2,5})?$/.test(value));
    if (address) {
      await app.db.execute(sql`
        UPDATE devices SET lan_address = ${address} WHERE id = ${deviceId}::uuid
          AND lan_address IS DISTINCT FROM ${address}
      `);
    }
  }

  const host = me.lan_host ? [] : (await app.db.execute(sql`
    SELECT d.lan_address FROM devices d JOIN licenses l ON l.id = d.license_id
    WHERE l.customer_id = ${customerId}::uuid AND d.lan_host AND d.status = 'active'
      AND ${PRODUCT_SQL} = ${me.product} AND d.id <> ${deviceId}::uuid
    LIMIT 1
  `)) as Array<{ lan_address: string | null }>;

  return {
    station: (STATIONS as readonly string[]).includes(me.station) ? (me.station as Station) : 'all',
    lanHost: Boolean(me.lan_host),
    hostAddress: host[0]?.lan_address ?? null,
    lanKey: lanKeyFor(customerId),
  };
}

const UpdateSchema = z.object({
  station: z.enum(STATIONS).optional(),
  lanHost: z.boolean().optional(),
});

/** The customer's portal: their computers, and what each one is for. */
export async function deviceStationRoutes(app: FastifyInstance) {
  app.get('/customer/devices', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const rows = (await app.db.execute(sql`
      SELECT d.id, d.hostname, d.app_version, d.last_seen_at, d.status, d.station, d.lan_host,
             d.lan_address, ${PRODUCT_SQL} AS product
      FROM devices d JOIN licenses l ON l.id = d.license_id
      WHERE l.customer_id = ${identity.id}::uuid AND d.status = 'active'
      ORDER BY d.last_seen_at DESC NULLS LAST
    `)) as Array<Record<string, unknown>>;
    return {
      devices: rows.map((row) => ({
        id: String(row.id),
        name: (row.hostname as string | null) || 'Adsız kompüter',
        appVersion: (row.app_version as string | null) ?? null,
        lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as string).toISOString() : null,
        product: row.product === 'market' ? 'market' : 'restaurant',
        station: row.station as Station,
        lanHost: Boolean(row.lan_host),
        lanAddress: (row.lan_address as string | null) ?? null,
      })),
    };
  });

  app.put('/customer/devices/:id', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return reply.code(400).send({ error: 'Cihaz tapılmadı' });
    const body = parseBody(UpdateSchema, req.body, reply);
    if (!body) return;

    const owned = (await app.db.execute(sql`
      SELECT d.id, ${PRODUCT_SQL} AS product FROM devices d JOIN licenses l ON l.id = d.license_id
      WHERE d.id = ${id}::uuid AND l.customer_id = ${identity.id}::uuid AND d.status = 'active'
    `)) as Array<{ id: string; product: string }>;
    if (!owned[0]) return reply.code(404).send({ error: 'Cihaz tapılmadı' });

    if (body.lanHost === true) {
      // One host per product: two hosts would be two databases again.
      await app.db.execute(sql`
        UPDATE devices d SET lan_host = false FROM licenses l
        WHERE l.id = d.license_id AND l.customer_id = ${identity.id}::uuid
          AND ${PRODUCT_SQL} = ${owned[0].product} AND d.id <> ${id}::uuid
      `);
    }
    if (body.station !== undefined) {
      await app.db.execute(sql`UPDATE devices SET station = ${body.station} WHERE id = ${id}::uuid`);
    }
    if (body.lanHost !== undefined) {
      await app.db.execute(sql`UPDATE devices SET lan_host = ${body.lanHost} WHERE id = ${id}::uuid`);
    }
    return { ok: true };
  });
}
