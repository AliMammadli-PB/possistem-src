import {operationResetRoutes} from './operation-reset.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { z } from 'zod';
import { customers, devices, licenses } from '@milioner/database';
import { env } from '../env.js';
import { writeAudit } from '../lib/audit.js';
import { enqueueBotCommand } from '../lib/mysql.js';
import { licensePosProduct } from '../lib/pos-product.js';
import { clientIp } from '../lib/validate.js';
import { currentUser, requireSuperadmin } from '../plugins/auth.js';

export const WIPE_COMMAND = 'data.wipeAll';
/** The row is renamed once the server's copies are gone, so a till's report is acted on once. */
const WIPE_CLEARED = `${WIPE_COMMAND}.cleared`;
/** A till that was off for days must not lose the sales it makes after coming back. */
const WIPE_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_MS = 60_000;

const LIVE_TABLES = ['floor_live', 'customer_live', 'table_live', 'staff_live', 'sales_live', 'product_live', 'report_live'];
const DEVICE_TABLES = [
  'portal_device_inventory',
  'portal_warehouse_requests',
  'portal_warehouse_cache',
  'portal_warehouse_cache_versions',
  'portal_warehouse_outbox',
  'portal_warehouse_documents',
];
const RESTAURANT_ONLY_TABLES = ['portal_inventory', 'portal_inventory_commands', 'owner_floor_snapshots'];

/** One customer at a time, by exact name, never over a wipe still in flight. */
export function wipeRequestError(input: {
  confirmName: string;
  customerName: string;
  deviceCount: number;
  inFlight: number;
}): string | null {
  if (input.confirmName !== input.customerName) return 'Müştərinin adı dəqiq yazılmayıb';
  if (input.deviceCount === 0) return 'Bu müştərinin aktiv Restoran kassası yoxdur';
  if (input.inFlight > 0) return 'Bu müştəri üçün silmə artıq gedir';
  return null;
}

type WipeRow = mysql.RowDataPacket & {
  id: string;
  customer_id: string;
  command: string;
  device_id: string | null;
  status: string;
  error: string | null;
  error_code: string | null;
  created_at: Date;
  done_at: Date | null;
  expires_at: Date;
};

export async function dataWipeRoutes(app: FastifyInstance) {
  await operationResetRoutes(app);
  const pool = env.mysqlUrl ? mysql.createPool({ uri: env.mysqlUrl, connectionLimit: 2 }) : null;

  async function restaurantLicenses(customerId: string) {
    const rows = await app.db
      .select({ id: licenses.id, plan: licenses.plan, features: licenses.features })
      .from(licenses)
      .where(eq(licenses.customerId, customerId));
    const own = rows.filter((row) => licensePosProduct(row) === 'restaurant');
    return { ids: own.map((row) => row.id), onlyRestaurant: own.length === rows.length };
  }

  async function restaurantDevices(customerId: string) {
    const { ids } = await restaurantLicenses(customerId);
    if (ids.length === 0) return [];
    return app.db
      .select({ id: devices.id, hostname: devices.hostname, appVersion: devices.appVersion, lastSeenAt: devices.lastSeenAt })
      .from(devices)
      .where(and(inArray(devices.licenseId, ids), ne(devices.status, 'revoked')));
  }

  async function wipeRows(customerId: string): Promise<WipeRow[]> {
    if (!pool) return [];
    await pool.execute(
      `UPDATE bot_commands SET status = 'expired', done_at = ?
       WHERE customer_id = ? AND command = ? AND status IN ('pending','taken') AND expires_at < ?`,
      [new Date(), customerId, WIPE_COMMAND, new Date()],
    );
    const [rows] = await pool.query<WipeRow[]>(
      `SELECT id, customer_id, command, status, error, error_code, created_at, done_at, expires_at,
              JSON_UNQUOTE(JSON_EXTRACT(args_json, '$.deviceId')) AS device_id
       FROM bot_commands WHERE customer_id = ? AND command IN (?, ?)
       ORDER BY created_at DESC LIMIT 50`,
      [customerId, WIPE_COMMAND, WIPE_CLEARED],
    );
    return rows;
  }

  /** The till has wiped itself, so the copies it sent earlier go too. A till not yet wiped resends its own. */
  async function clearServerCopies(row: WipeRow) {
    if (!pool) return;
    const customerId = row.customer_id;
    for (const table of LIVE_TABLES) await pool.execute(`DELETE FROM ${table} WHERE customer_id = ?`, [customerId]);
    await pool.execute(`DELETE FROM bot_commands WHERE customer_id = ? AND command NOT IN (?, ?)`, [
      customerId,
      WIPE_COMMAND,
      WIPE_CLEARED,
    ]);
    const { onlyRestaurant } = await restaurantLicenses(customerId);
    const tables = onlyRestaurant ? RESTAURANT_ONLY_TABLES : [];
    for (const table of tables) {
      await app.db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE customer_id = ${customerId}::uuid`);
    }
    if (row.device_id) {
      for (const table of DEVICE_TABLES) {
        await app.db.execute(
          sql`DELETE FROM ${sql.raw(table)} WHERE customer_id = ${customerId}::uuid AND device_id = ${row.device_id}::uuid`,
        );
      }
    }
    await pool.execute(`UPDATE bot_commands SET command = ? WHERE id = ?`, [WIPE_CLEARED, row.id]);
    await writeAudit(app, {
      action: 'customer.data_wipe.done',
      entityType: 'customer',
      entityId: customerId,
      meta: { commandId: row.id, deviceId: row.device_id },
    });
  }

  async function sweep() {
    if (!pool) return;
    const [rows] = await pool.query<WipeRow[]>(
      `SELECT id, customer_id, JSON_UNQUOTE(JSON_EXTRACT(args_json, '$.deviceId')) AS device_id
       FROM bot_commands WHERE command = ? AND status = 'done' LIMIT 20`,
      [WIPE_COMMAND],
    );
    for (const row of rows) await clearServerCopies(row);
  }

  const timer = setInterval(() => {
    sweep().catch((err) => app.log.warn({ err }, 'data_wipe_sweep_failed'));
  }, SWEEP_MS);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    await pool?.end();
  });

  async function status(customerId: string, reply: FastifyReply) {
    const [customer] = await app.db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!customer) {
      reply.code(404).send({ error: 'Not found' });
      return null;
    }
    const [deviceRows, rows] = await Promise.all([restaurantDevices(customerId), wipeRows(customerId)]);
    return {
      customerName: customer.name,
      devices: deviceRows.map((d) => ({
        id: d.id,
        hostname: d.hostname,
        appVersion: d.appVersion,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      })),
      commands: rows.map((r) => ({
        id: r.id,
        deviceId: r.device_id,
        status: r.status,
        serverCleared: r.command === WIPE_CLEARED,
        error: r.error,
        errorCode: r.error_code,
        createdAt: r.created_at.toISOString(),
        doneAt: r.done_at?.toISOString() ?? null,
        expiresAt: r.expires_at.toISOString(),
      })),
      available: Boolean(pool),
    };
  }

  app.get('/customers/:id/data-wipe', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return reply.code(400).send({ error: 'Müştəri düzgün deyil' });
    await sweep().catch((err) => app.log.warn({ err }, 'data_wipe_sweep_failed'));
    const result = await status(id, reply);
    return result ?? undefined;
  });

  app.post('/customers/:id/data-wipe', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return reply.code(400).send({ error: 'Müştəri düzgün deyil' });
    const body = z.object({ confirmName: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Müştərinin adı dəqiq yazılmayıb' });

    const current = await status(id, reply);
    if (!current) return;
    if (!current.available) return reply.code(503).send({ error: 'Əmr növbəsi əlçatan deyil' });
    const error = wipeRequestError({
      confirmName: body.data.confirmName,
      customerName: current.customerName,
      deviceCount: current.devices.length,
      inFlight: current.commands.filter((c) => c.status === 'pending' || c.status === 'taken').length,
    });
    if (error) return reply.code(409).send({ error });

    const user = currentUser(req);
    const commandIds: Array<string | null> = [];
    for (const device of current.devices) {
      commandIds.push(
        await enqueueBotCommand({
          customerId: id,
          command: WIPE_COMMAND,
          args: { deviceId: device.id },
          requestedBy: user.id,
          ttlMs: WIPE_TTL_MS,
        }),
      );
    }
    await writeAudit(app, {
      actorUserId: user.id,
      action: 'customer.data_wipe.request',
      entityType: 'customer',
      entityId: id,
      ip: clientIp(req),
      meta: { name: current.customerName, deviceIds: current.devices.map((d) => d.id), commandIds },
    });
    return reply.code(202).send(await status(id, reply));
  });
}
