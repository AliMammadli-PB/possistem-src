import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod/v3';
import { devices, licenses } from '@milioner/database';
import { parseBody } from '../lib/validate.js';
import { requireCustomer } from '../plugins/customer-auth.js';
import {
  commandError,
  inventoryEnabled,
  portalAccess,
  type PortalProduct,
} from './inventory-access.js';
import { areaAllowed, PORTAL_BOOK_KEYS, PORTAL_STOCK_KEYS } from '../lib/access-areas.js';
import { surfaceAccess } from './access.js';
import { writeAudit } from '../lib/audit.js';
import { clientIp } from '../lib/validate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SqlRow = Record<string, unknown>;

function rowsOf(result: unknown): SqlRow[] {
  if (Array.isArray(result)) return result as SqlRow[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: SqlRow[] }).rows;
  }
  return [];
}

function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

let tablesReady: Promise<void> | null = null;

function ensureTables(app: FastifyInstance): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await app.db.execute(sql`
        CREATE TABLE IF NOT EXISTS portal_inventory (
          customer_id uuid NOT NULL,
          product text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}',
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (customer_id, product)
        )
      `);
      await app.db.execute(sql`
        CREATE TABLE IF NOT EXISTS portal_inventory_commands (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id uuid NOT NULL,
          product text NOT NULL,
          kind text NOT NULL,
          body jsonb NOT NULL,
          status text NOT NULL DEFAULT 'pending',
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await app.db.execute(sql`
        CREATE TABLE IF NOT EXISTS portal_device_inventory (
          device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          product text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (device_id, product)
        )
      `);
      await app.db.execute(sql`
        CREATE INDEX IF NOT EXISTS portal_device_inventory_customer_idx
          ON portal_device_inventory (customer_id, product, updated_at DESC)
      `);
      await app.db.execute(sql`
        ALTER TABLE portal_inventory_commands
          ADD COLUMN IF NOT EXISTS target_device_id uuid,
          ADD COLUMN IF NOT EXISTS error_reason text,
          ADD COLUMN IF NOT EXISTS settled_at timestamptz
      `);
      await app.db.execute(sql`
        CREATE INDEX IF NOT EXISTS portal_inventory_commands_pending_idx
          ON portal_inventory_commands (customer_id, product, status, created_at)
      `);
    })()
      .catch((err) => {
        tablesReady = null;
        throw err;
      });
  }
  return tablesReady;
}

async function licenseFeatures(app: FastifyInstance, customerId: string) {
  const rows = await app.db
    .select({ features: licenses.features })
    .from(licenses)
    .where(and(eq(licenses.customerId, customerId), eq(licenses.status, 'active')));
  return rows.map((row) => (row.features ?? {}) as Record<string, unknown>);
}

export async function saveInventorySnapshot(
  app: FastifyInstance,
  customerId: string,
  product: string,
  payload: unknown,
  deviceId?: string,
) {
  await ensureTables(app);
  const json = JSON.stringify(payload ?? {});
  const mergeBooks = product.startsWith('books-');
  await app.db.execute(sql`
    INSERT INTO portal_inventory (customer_id, product, payload, updated_at)
    VALUES (${customerId}::uuid, ${product}, ${json}::jsonb, now())
    ON CONFLICT (customer_id, product)
    DO UPDATE SET payload = CASE WHEN ${mergeBooks} THEN portal_inventory.payload || EXCLUDED.payload
                                 ELSE EXCLUDED.payload END, updated_at = now()
  `);
  if (deviceId && UUID.test(deviceId)) {
    await app.db.execute(sql`
      INSERT INTO portal_device_inventory (device_id, customer_id, product, payload, updated_at)
      VALUES (${deviceId}::uuid, ${customerId}::uuid, ${product}, ${json}::jsonb, now())
      ON CONFLICT (device_id, product)
      DO UPDATE SET payload = CASE WHEN ${mergeBooks} THEN portal_device_inventory.payload || EXCLUDED.payload
                                   ELSE EXCLUDED.payload END, updated_at = now()
    `);
  }
}

export async function takeInventoryCommands(
  app: FastifyInstance,
  customerId: string,
  product: PortalProduct,
  deviceId: string,
  allowedKinds: readonly string[],
) {
  await ensureTables(app);
  if (allowedKinds.length === 0) return [];
  const kindList = sql.join(allowedKinds.map((kind) => sql`${kind}`), sql`, `);
  const result = await app.db.execute(sql`
    SELECT id, kind, body FROM portal_inventory_commands
    WHERE customer_id = ${customerId}::uuid AND product = ${product} AND status = 'pending'
      AND target_device_id = ${deviceId}::uuid
      AND kind IN (${kindList})
    ORDER BY created_at ASC
    LIMIT 20
  `);
  return rowsOf(result).map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    body: (row.body ?? {}) as Record<string, unknown>,
  }));
}

export async function settleInventoryCommands(
  app: FastifyInstance,
  customerId: string,
  product: PortalProduct,
  applied: string[],
  failed: string[],
  deviceId: string,
  failureReasons: Array<{ id: string; reason: string }> = [],
) {
  await ensureTables(app);
  const mark = async (ids: string[], status: 'applied' | 'rejected') => {
    const clean = ids.filter((id) => UUID.test(id));
    if (clean.length === 0) return;
    const list = sql.join(clean.map((id) => sql`${id}::uuid`), sql`, `);
    await app.db.execute(sql`
      UPDATE portal_inventory_commands
      SET status = ${status}, settled_at = now()
      WHERE customer_id = ${customerId}::uuid AND product = ${product}
        AND target_device_id = ${deviceId}::uuid AND status = 'pending' AND id IN (${list})
    `);
  };
  await mark(applied, 'applied');
  await mark(failed, 'rejected');
  for (const item of failureReasons) {
    if (!UUID.test(item.id) || !failed.includes(item.id)) continue;
    await app.db.execute(sql`
      UPDATE portal_inventory_commands SET error_reason = ${item.reason.slice(0, 500)}
      WHERE customer_id = ${customerId}::uuid AND product = ${product}
        AND target_device_id = ${deviceId}::uuid AND id = ${item.id}::uuid
        AND status = 'rejected'
    `);
  }
}

const CommandBody = z.object({
  product: z.enum(['market', 'restaurant']),
  kind: z.string().min(1).max(40),
  body: z.record(z.unknown()).default({}),
});

export const STOCK_COMMAND_KINDS = [
  'warehouse.create', 'warehouse.rename', 'warehouse.close', 'product.save', 'product.deactivate',
  'stock.receive', 'stock.adjust', 'stock.waste', 'stock.transfer', 'stock.count',
  'menu.product.save', 'menu.category.save',
] as const;
export const CASH_COMMAND_KINDS = ['cash.in', 'cash.out'] as const;
export const PAYMENT_COMMAND_KINDS = ['customer.pay', 'supplier.pay'] as const;
export const PURCHASE_COMMAND_KINDS = ['purchase.order', 'purchase.receive'] as const;

const DeviceInventoryBody = z.object({
  deviceId: z.string().uuid(),
  deviceFingerprint: z.string().min(8).max(256),
  includeBranches: z.boolean().optional(),
  warehouses: z.array(z.record(z.unknown())).max(50).optional(),
  lines: z.array(z.record(z.unknown())).max(20000).optional(),
  menu: z.array(z.record(z.unknown())).max(20000).optional(),
  categories: z.array(z.record(z.unknown())).max(2000).optional(),
  books: z.object({
    customers: z.array(z.record(z.unknown())).max(5000),
    suppliers: z.array(z.record(z.unknown())).max(5000),
    purchases: z.array(z.record(z.unknown())).max(5000),
    cashMovements: z.array(z.record(z.unknown())).max(5000),
    payments: z.array(z.record(z.unknown())).max(5000).optional(),
    accounts: z.array(z.record(z.unknown())).max(500).optional(),
  }).optional(),
  appliedCommandIds: z.array(z.string()).max(40).optional(),
  failedCommandIds: z.array(z.string()).max(40).optional(),
  failedCommandReasons: z.array(z.object({ id: z.string().uuid(), reason: z.string().max(500) })).max(40).optional(),
});

function num(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, max: number): string {
  return String(value ?? '').slice(0, max);
}

function stamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function booksFromMarket(payload: Record<string, unknown>) {
  const products = Array.isArray(payload.products) ? payload.products : [];
  const registers = Array.isArray(payload.registers) ? payload.registers : [];
  const top = Array.isArray(payload.topProducts) ? payload.topProducts : [];
  return {
    sales: [],
    orders: [],
    points: registers.slice(0, 30).map((row) => {
      const item = row as Record<string, unknown>;
      return { id: text(item.id, 64), name: text(item.name, 80), status: text(item.status, 20) };
    }),
    products: products.slice(0, 20000).map((row) => {
      const item = row as Record<string, unknown>;
      return { id: text(item.id, 64), name: text(item.name, 160), qty: num(item.stock), price: Math.max(0, num(item.priceMinor)) };
    }),
    customers: [],
    suppliers: [],
    daily: {
      sales: Math.max(0, num(payload.dailySalesMinor)),
      cash: Math.max(0, num(payload.cashMinor)),
      card: Math.max(0, num(payload.cardMinor)),
      count: Math.max(0, num(payload.transactionCount)),
      profit: 0,
    },
    turnover: top.slice(0, 30).map((row) => {
      const item = row as Record<string, unknown>;
      return { name: text(item.name, 160), qty: Math.max(0, num(item.qty)), total: Math.max(0, num(item.revenueMinor)) };
    }),
  };
}

function booksFromFloor(payload: Record<string, unknown>, todaySalesMinor: number) {
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  return {
    sales: [],
    orders: tables.slice(0, 40).map((row) => {
      const item = row as Record<string, unknown>;
      return { id: text(item.id, 64), label: text(item.label, 80) || 'Masa', at: stamp(item.openedAt), lines: Math.max(0, num(item.itemCount)) };
    }),
    points: tables.slice(0, 30).map((row) => {
      const item = row as Record<string, unknown>;
      return { id: text(item.id, 64), name: text(item.label || item.areaName, 80), status: text(item.status, 20) };
    }),
    products: [],
    customers: [],
    suppliers: [],
    daily: {
      sales: Math.max(0, todaySalesMinor),
      cash: 0,
      card: Math.max(0, num(payload.todayPaidMinor)),
      count: Math.max(0, num(payload.paymentCount)),
      profit: 0,
    },
    turnover: [],
  };
}

function stockFromMarket(payload: Record<string, unknown>) {
  const warehouses = Array.isArray(payload.warehouses) ? payload.warehouses : [];
  const products = Array.isArray(payload.products) ? payload.products : [];
  const warehouseName = new Map(warehouses.map((row) => {
    const item = row as Record<string, unknown>;
    return [text(item.id, 64), text(item.name, 100)] as const;
  }));
  return {
    warehouses: warehouses.slice(0, 50).map((row) => {
      const item = row as Record<string, unknown>;
      return { id: text(item.id, 64), name: text(item.name, 100), kind: 'store', active: item.active !== false };
    }),
    lines: products.slice(0, 20000).map((row) => {
      const item = row as Record<string, unknown>;
      // Older market builds sent aggregate products without a warehouse id.
      // Attribute that aggregate to the first warehouse until the full
      // per-warehouse lines arrive from a newer build.
      const firstWarehouse = warehouses[0] as Record<string, unknown> | undefined;
      const warehouseId = text(item.warehouseId || firstWarehouse?.id, 64);
      return {
        id: text(item.id, 64),
        name: text(item.name, 160),
        barcode: text(item.barcode, 80),
        group: text(item.sku, 80),
        unit: 'əd',
        salePrice: Math.max(0, num(item.priceMinor)),
        costPrice: 0,
        warehouseId,
        warehouseName: warehouseName.get(warehouseId) || '',
        qty: num(item.stock),
        minQty: Math.max(0, num(item.minStock)),
      };
    }),
  };
}

async function liveBooks(app: FastifyInstance, customerId: string, product: 'market' | 'restaurant') {
  try {
  if (product === 'market') {
    const result = await app.db.execute(sql`
      SELECT payload, updated_at FROM market_pos_snapshots
      WHERE customer_id = ${customerId}::uuid
      ORDER BY updated_at DESC LIMIT 1
    `);
    const row = rowsOf(result)[0];
    if (!row?.payload || typeof row.payload !== 'object') return null;
    return {
      updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
      books: booksFromMarket(row.payload as Record<string, unknown>),
    };
  }
  const result = await app.db.execute(sql`
    SELECT payload, today_sales_minor, updated_at FROM owner_floor_snapshots
    WHERE customer_id = ${customerId}::uuid
    LIMIT 1
  `);
  const row = rowsOf(result)[0];
  if (!row?.payload || typeof row.payload !== 'object') return null;
  return {
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    books: booksFromFloor(row.payload as Record<string, unknown>, num(row.today_sales_minor)),
  };
  } catch {
    return null;
  }
}

const BOOK_FIELDS: Record<string, string[]> = {
  demand: ['sales'], retailsales: ['sales'], demandreturns: ['sales'], retailreturns: ['sales'],
  customerorders: ['orders'], customer: ['customers'], shifts: ['points'], salepoints: ['points'],
  supply: ['purchases'], purchaseorder: ['purchases'], comprehensive: ['suppliers'],
  producttransactions: ['turnover'],
  transactions: ['payments', 'customers', 'suppliers'], settlements: ['customers', 'suppliers'], cashtransactions: ['transfers'],
  credittransaction: ['payments', 'customers'], cashins: ['cashMovements', 'points'], cashouts: ['cashMovements', 'points'],
  salereports: ['daily'], profit: ['daily'], dailyreports: ['daily'], cashes: ['cashMovements'],
  emeliyyat: ['sales', 'orders', 'points', 'products', 'customers', 'suppliers', 'purchases', 'payments', 'cashMovements', 'daily', 'turnover'],
};

function scopeBooks(books: Record<string, unknown> | null, area: string) {
  if (!books) return null;
  const fields = BOOK_FIELDS[area] ?? [];
  return Object.fromEntries(fields.filter((key) => key in books).map((key) => [key, books[key]]));
}

export async function branchSnapshots(app: FastifyInstance, customerId: string, deviceId: string, inventory: boolean, cash: boolean) {
// Device credentials select the owner; a body/query customerId is never trusted.
// Share snapshots, not database files, PIN hashes or another tenant's rows.
const peers = rowsOf(await app.db.execute(sql`
  SELECT d.id AS device_id, d.hostname, i.payload, i.updated_at,
         COALESCE(b.payload->'accounts', '[]'::jsonb) AS accounts
  FROM devices d JOIN licenses l ON l.id=d.license_id
  LEFT JOIN portal_device_inventory i ON i.device_id=d.id AND i.product='restaurant'
    AND i.customer_id=${customerId}::uuid
  LEFT JOIN portal_device_inventory b ON b.device_id=d.id AND b.product='books-restaurant'
    AND b.customer_id=${customerId}::uuid
  WHERE d.id<>${deviceId}::uuid
    AND d.status<>'revoked' AND l.customer_id=${customerId}::uuid
    AND l.status='active' AND (l.valid_until IS NULL OR l.valid_until>now())
    AND (i.device_id IS NOT NULL OR b.device_id IS NOT NULL)
  ORDER BY d.hostname,d.id LIMIT 100
`));
return peers.map((row) => {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return { deviceId: String(row.device_id), name: String(row.hostname || row.device_id),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    warehouses: inventory && Array.isArray(payload.warehouses) ? payload.warehouses : [],
    lines: inventory && Array.isArray(payload.lines) ? payload.lines : [],
    accounts: cash && Array.isArray(row.accounts) ? row.accounts : [],
  };
});
}

export async function inventoryRoutes(app: FastifyInstance) {
  app.get('/owner/books', async (req, reply) => {
    const customer = requireCustomer(req, reply);
    if (!customer) return;
    const area = (req.query as { area?: string }).area;
    if (!area || !PORTAL_BOOK_KEYS.some((key) => key === area) ||
        !areaAllowed(await surfaceAccess(app, customer.id, 'portal'), area)) {
      return reply.code(403).send({ error: 'Buna icazəniz yoxdur' });
    }
    await ensureTables(app);
    const read = async (product: string) => {
      const result = await app.db.execute(sql`
        SELECT payload, updated_at FROM portal_inventory
        WHERE customer_id = ${customer.id}::uuid AND product = ${product}
        LIMIT 1
      `);
      const row = rowsOf(result)[0];
      const deviceRows = rowsOf(await app.db.execute(sql`
        SELECT i.device_id, i.payload, i.updated_at, d.hostname
        FROM portal_device_inventory i JOIN devices d ON d.id = i.device_id
        WHERE i.customer_id = ${customer.id}::uuid AND i.product = ${product}
          AND d.status <> 'revoked'
        ORDER BY i.updated_at DESC
      `));
      return {
        updatedAt: row?.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
        books: (row?.payload ?? null) as Record<string, unknown> | null,
        devices: deviceRows.map((item) => ({
          deviceId: String(item.device_id),
          deviceName: String(item.hostname || String(item.device_id).slice(0, 8)),
          updatedAt: item.updated_at ? new Date(String(item.updated_at)).toISOString() : null,
          books: (item.payload ?? null) as Record<string, unknown> | null,
        })),
      };
    };
    const [market, restaurant] = await Promise.all([read('books-market'), read('books-restaurant')]);
    if (!market.books) Object.assign(market, (await liveBooks(app, customer.id, 'market')) ?? {});
    const floor = await liveBooks(app, customer.id, 'restaurant');
    if (!restaurant.books) Object.assign(restaurant, floor ?? {});
    else if (floor?.books) restaurant.books = { ...floor.books, ...restaurant.books };
    if (floor?.books) restaurant.devices = restaurant.devices.map((item) => ({
      ...item, books: { ...floor.books, ...(item.books ?? {}) },
    }));
    const features = await licenseFeatures(app, customer.id);
    const licensed: PortalProduct[] = features.length === 0
      ? ['market', 'restaurant']
      : features.map((row) => row.product === 'market' || row.market === true ? 'market' : 'restaurant');
    if (!licensed.includes('market')) { market.books = null; market.devices = []; }
    if (!licensed.includes('restaurant')) { restaurant.books = null; restaurant.devices = []; }
    market.books = scopeBooks(market.books, area);
    restaurant.books = scopeBooks(restaurant.books, area);
    market.devices = market.devices.map((item) => ({ ...item, books: scopeBooks(item.books, area) }));
    restaurant.devices = restaurant.devices.map((item) => ({ ...item, books: scopeBooks(item.books, area) }));
    const portalLicense = portalAccess(features);
    if (!portalLicense.cost.market) {
      const hideProfit = (books: Record<string, unknown> | null) => {
        if (!books?.daily || typeof books.daily !== 'object') return;
        const { profit: _profit, ...daily } = books.daily as Record<string, unknown>;
        books.daily = daily;
      };
      hideProfit(market.books);
      market.devices.forEach((item) => hideProfit(item.books));
    }
    return { market, restaurant };
  });

  app.get('/owner/inventory/access', async (req, reply) => {
    const customer = requireCustomer(req, reply);
    if (!customer) return;
    const access = portalAccess(await licenseFeatures(app, customer.id));
    return access;
  });

  app.get('/owner/inventory', async (req, reply) => {
    const customer = requireCustomer(req, reply);
    if (!customer) return;
    const product = (req.query as { product?: string }).product;
    if (product !== 'market' && product !== 'restaurant') {
      return reply.code(400).send({ error: 'product tələb olunur' });
    }
    const access = portalAccess(await licenseFeatures(app, customer.id));
    const area = (req.query as { area?: string }).area;
    const stockAllowed = access.products.includes(product);
    const menuOnly = product === 'restaurant' && area === 'product' &&
      access.catalogProducts.includes('restaurant') &&
      areaAllowed(await surfaceAccess(app, customer.id, 'restaurant'), 'catalog');
    if (!stockAllowed && !menuOnly) {
      return reply.code(403).send({ error: 'Anbar bu lisenziyada bağlıdır' });
    }
    if (!area || !PORTAL_STOCK_KEYS.some((key) => key === area) ||
        !areaAllowed(await surfaceAccess(app, customer.id, 'portal'), area)) {
      return reply.code(403).send({ error: 'Buna icazəniz yoxdur' });
    }
    await ensureTables(app);
    const result = await app.db.execute(sql`
      SELECT payload, updated_at FROM portal_inventory
      WHERE customer_id = ${customer.id}::uuid AND product = ${product}
      LIMIT 1
    `);
    const row = rowsOf(result)[0];
    const problems = rowsOf(
      await app.db.execute(sql`
        SELECT kind FROM portal_inventory_commands
        WHERE customer_id = ${customer.id}::uuid AND product = ${product} AND status = 'rejected'
        ORDER BY created_at DESC LIMIT 5
      `),
    ).map((item) => String(item.kind));
    let snapshot = (row?.payload ?? { warehouses: [], lines: [] }) as { warehouses?: unknown[]; lines?: unknown[]; menu?: unknown[]; categories?: unknown[] };
    let updatedAt = row?.updated_at ? new Date(String(row.updated_at)).toISOString() : null;
    const deviceRows = rowsOf(await app.db.execute(sql`
      SELECT i.device_id, i.payload, i.updated_at, d.hostname
      FROM portal_device_inventory i JOIN devices d ON d.id = i.device_id
      WHERE i.customer_id = ${customer.id}::uuid AND i.product = ${product}
        AND d.status <> 'revoked'
      ORDER BY i.updated_at DESC
    `));
    if (deviceRows.length) {
      const warehouses: Record<string, unknown>[] = [];
      const lines: Record<string, unknown>[] = [];
      const menu: Record<string, unknown>[] = [];
      const categories: Record<string, unknown>[] = [];
      for (const deviceRow of deviceRows) {
        const payload = (deviceRow.payload ?? {}) as { warehouses?: unknown[]; lines?: unknown[]; menu?: unknown[]; categories?: unknown[] };
        const deviceId = String(deviceRow.device_id);
        const deviceName = String(deviceRow.hostname || deviceId.slice(0, 8));
        for (const value of payload.warehouses ?? []) {
          if (value && typeof value === 'object') warehouses.push({ ...(value as object), deviceId, deviceName });
        }
        for (const value of payload.lines ?? []) {
          if (value && typeof value === 'object') lines.push({ ...(value as object), deviceId, deviceName });
        }
        for (const value of payload.menu ?? []) {
          if (value && typeof value === 'object') menu.push({ ...(value as object), deviceId, deviceName });
        }
        for (const value of payload.categories ?? []) {
          if (value && typeof value === 'object') categories.push({ ...(value as object), deviceId, deviceName });
        }
      }
      snapshot = { warehouses, lines, menu, categories };
      updatedAt = deviceRows[0]?.updated_at
        ? new Date(String(deviceRows[0].updated_at)).toISOString() : updatedAt;
    }
    if (product === 'market' && !(snapshot.lines?.length)) {
      const payload = rowsOf(await app.db.execute(sql`
        SELECT payload, updated_at FROM market_pos_snapshots
        WHERE customer_id = ${customer.id}::uuid
        ORDER BY updated_at DESC LIMIT 1
      `))[0];
      if (payload?.payload && typeof payload.payload === 'object') {
        snapshot = stockFromMarket(payload.payload as Record<string, unknown>);
        updatedAt = payload.updated_at ? new Date(String(payload.updated_at)).toISOString() : updatedAt;
      }
    }
    if (!stockAllowed) snapshot = { warehouses: [], lines: [], menu: snapshot.menu ?? [], categories: snapshot.categories ?? [] };
    if (!access.cost[product]) {
      snapshot = { ...snapshot, lines: (snapshot.lines ?? []).map((line) => {
        if (!line || typeof line !== 'object') return line;
        const { costPrice: _costPrice, ...safe } = line as Record<string, unknown>;
        return safe;
      }) };
    }
    return {
      product,
      showCost: access.cost[product],
      updatedAt,
      snapshot,
      problems,
    };
  });

  app.post('/owner/inventory/commands', async (req, reply) => {
    const customer = requireCustomer(req, reply);
    if (!customer) return;
    const body = parseBody(CommandBody, req.body ?? {}, reply);
    if (!body) return;
    const featureRows = await licenseFeatures(app, customer.id);
    const access = portalAccess(featureRows);
    const licensed = featureRows.length === 0 || featureRows.some((features) =>
      (features.product === 'market' || features.market === true ? 'market' : 'restaurant') === body.product);
    const needsInventory = !body.kind.startsWith('cash.') && !body.kind.startsWith('menu.') && !body.kind.endsWith('.pay') && body.kind !== 'purchase.receive';
    if (!licensed || (needsInventory && !access.products.includes(body.product))) {
      return reply.code(403).send({ error: 'Anbar bu lisenziyada bağlıdır' });
    }
    const posAccess = await surfaceAccess(app, customer.id, body.product);
    const posArea = body.product === 'market'
      ? body.kind.startsWith('cash.') ? 'registers'
        : body.kind === 'customer.pay' ? 'customers'
          : body.kind === 'supplier.pay' || body.kind.startsWith('purchase.') ? 'purchases' : 'inventory'
      : body.kind.startsWith('cash.') ? 'cash'
        : body.kind.startsWith('menu.') ? 'catalog'
          : body.kind === 'customer.pay' ? 'guests'
            : body.kind === 'supplier.pay' || body.kind.startsWith('purchase.') ? 'suppliers' : 'stock';
    if (!areaAllowed(posAccess, posArea)) {
      return reply.code(403).send({ error: 'POS bölməsi bu hesab üçün bağlıdır' });
    }
    const writeArea: Record<string, string> = {
      'warehouse.create': 'anbar.write', 'warehouse.rename': 'anbar.write',
      'warehouse.close': 'anbar.write', 'product.save': 'product.write',
      'product.deactivate': body.body.area === 'product' ? 'product.write' : 'anbar.write',
      'menu.product.save': 'product.write', 'menu.category.save': 'product.write',
      'stock.receive': 'enter.write', 'stock.adjust': 'anbar.write',
      'stock.waste': 'loss.write', 'stock.transfer': 'move.write',
      'stock.count': 'inventory.write',
      'cash.in': 'cashins.write', 'cash.out': 'cashouts.write',
      'customer.pay': 'transactions.write', 'supplier.pay': 'transactions.write',
      'purchase.order': 'purchaseorder.write', 'purchase.receive': 'supply.write',
    };
    const needed = writeArea[body.kind];
    const grants = await surfaceAccess(app, customer.id, 'portal');
    const paymentAllowed = body.kind === 'customer.pay' && areaAllowed(grants, 'credittransaction.write');
    if (!needed || (!areaAllowed(grants, needed) && !paymentAllowed)) {
      return reply.code(403).send({ error: 'Buna icazəniz yoxdur' });
    }
    if (body.kind === 'product.deactivate' && body.product !== 'restaurant') {
      return reply.code(400).send({ error: 'Bu silmə əməliyyatı restoran xammalı üçündür' });
    }
    const problem = commandError(body.kind, body.body);
    if (problem) return reply.code(400).send({ error: problem });
    if (body.kind.startsWith('menu.') && body.product !== 'restaurant') {
      return reply.code(400).send({ error: 'Menyu yalnız restoran POS üçündür' });
    }
    if (body.kind.startsWith('cash.') && body.product === 'market' &&
        (typeof body.body.registerId !== 'string' || !body.body.registerId)) {
      return reply.code(400).send({ error: 'Kassa seçilməlidir' });
    }
    if (body.kind === 'purchase.order') {
      const lines = body.body.lines as Array<Record<string, unknown>>;
      const market = body.product === 'market';
      if (typeof body.body[market ? 'supplierName' : 'supplierId'] !== 'string' ||
          !body.body[market ? 'supplierName' : 'supplierId'] ||
          lines.some((line) => typeof line[market ? 'productId' : 'ingredientId'] !== 'string' ||
            !Number.isSafeInteger(line[market ? 'qty' : 'qtyMilli']) || Number(line[market ? 'qty' : 'qtyMilli']) <= 0)) {
        return reply.code(400).send({ error: 'Alış sifarişinin təchizatçısı və sətirləri düzgün deyil' });
      }
    }
    await ensureTables(app);
    const sourceProduct = body.kind.startsWith('cash.') || body.kind.endsWith('.pay') || body.kind.startsWith('purchase.')
      ? `books-${body.product}` : body.product;
    const candidates = rowsOf(await app.db.execute(sql`
      SELECT i.device_id, i.payload
      FROM portal_device_inventory i JOIN devices d ON d.id = i.device_id
      WHERE i.customer_id = ${customer.id}::uuid AND i.product = ${sourceProduct}
        AND d.status <> 'revoked'
      ORDER BY i.updated_at DESC
    `));
    const selectedId = typeof body.body.deviceId === 'string' ? body.body.deviceId : '';
    const warehouseId = String(body.body.warehouseId || body.body.fromWarehouseId || body.body.id || '');
    const matches = candidates.filter((row) => {
      if (selectedId) return String(row.device_id) === selectedId;
      if (sourceProduct.startsWith('books-')) return true;
      if (!warehouseId) return true;
      const payload = row.payload as { warehouses?: Array<{ id?: string }> };
      return Array.isArray(payload?.warehouses) && payload.warehouses.some((item) => item.id === warehouseId);
    });
    if (matches.length !== 1) {
      return reply.code(409).send({ error: matches.length ? 'POS cihazını seçin' : 'Uyğun POS cihazı tapılmadı' });
    }
    const deviceId = String(matches[0].device_id);
    if (body.kind === 'product.deactivate') {
      // The till owns stock and recipes. Use its existing, signed RPC path and
      // native deactivate handler; never delete history from a portal snapshot.
      const ingredientId = String(body.body.productId);
      const payload = matches[0].payload as { lines?: Array<{ id?: string }> };
      if (!payload?.lines?.some((line) => line.id === ingredientId)) {
        return reply.code(404).send({ error: 'Məhsul bu POS cihazının anbarında tapılmadı' });
      }
      // Queued like every other portal change: the till applies it on its next
      // sync - now, or as soon as it is back online. It is never lost.
      const queued = rowsOf(
        await app.db.execute(sql`
          INSERT INTO portal_inventory_commands (customer_id, product, kind, body, target_device_id)
          VALUES (${customer.id}::uuid, ${body.product}, ${body.kind}, ${JSON.stringify({ productId: ingredientId, deviceId })}::jsonb, ${deviceId}::uuid)
          RETURNING id
        `),
      );
      const commandId = queued[0] ? String(queued[0].id) : null;
      await writeAudit(app, {
        actorCustomerId: customer.id, action: 'owner.inventory.deactivate',
        entityType: 'ingredient', entityId: ingredientId, ip: clientIp(req),
        meta: { deviceId, commandId, queued: true },
      });
      return { ok: true, id: commandId, status: 'pending' };
    }
    const json = JSON.stringify(body.body);
    const inserted = rowsOf(
      await app.db.execute(sql`
        INSERT INTO portal_inventory_commands (customer_id, product, kind, body, target_device_id)
        VALUES (${customer.id}::uuid, ${body.product}, ${body.kind}, ${json}::jsonb, ${deviceId}::uuid)
        RETURNING id
      `),
    );
    return { ok: true, id: inserted[0] ? String(inserted[0].id) : null, status: 'pending' };
  });

  app.get('/owner/inventory/commands', async (req, reply) => {
    const customer = requireCustomer(req, reply);
    if (!customer) return;
    const area = (req.query as { area?: string }).area ?? 'anbar';
    const kinds: Record<string, readonly string[]> = {
      anbar: STOCK_COMMAND_KINDS, product: ['product.save', 'menu.product.save', 'menu.category.save'], enter: ['stock.receive'], loss: ['stock.waste'],
      move: ['stock.transfer'], inventory: ['stock.count'], stock: STOCK_COMMAND_KINDS, stockbalance: STOCK_COMMAND_KINDS,
      cashins: ['cash.in'], cashouts: ['cash.out'],
      transactions: PAYMENT_COMMAND_KINDS, credittransaction: ['customer.pay'],
      supply: PURCHASE_COMMAND_KINDS, purchaseorder: ['purchase.order'],
    };
    if (!(area in kinds) || !areaAllowed(await surfaceAccess(app, customer.id, 'portal'), area)) {
      return reply.code(403).send({ error: 'Buna icazəniz yoxdur' });
    }
    const product = (req.query as { product?: string }).product;
    if (product !== 'market' && product !== 'restaurant') {
      return reply.code(400).send({ error: 'product tələb olunur' });
    }
    await ensureTables(app);
    const featureRows = await licenseFeatures(app, customer.id);
    const access = portalAccess(featureRows);
    const licensed = featureRows.length === 0 || featureRows.some((features) =>
      (features.product === 'market' || features.market === true ? 'market' : 'restaurant') === product);
    const menuOnly = area === 'product' && product === 'restaurant' && access.catalogProducts.includes('restaurant') &&
      areaAllowed(await surfaceAccess(app, customer.id, 'restaurant'), 'catalog');
    if (!licensed || ((area !== 'cashins' && area !== 'cashouts' && area !== 'transactions' && area !== 'credittransaction' && area !== 'supply' && area !== 'purchaseorder') && !access.products.includes(product) && !menuOnly)) {
      return reply.code(403).send({ error: 'Bölmə bu lisenziyada bağlıdır' });
    }
    const commands = rowsOf(await app.db.execute(sql`
      SELECT id, kind, body, status, error_reason, created_at, settled_at, target_device_id
      FROM portal_inventory_commands
      WHERE customer_id = ${customer.id}::uuid AND product = ${product}
      ORDER BY created_at DESC LIMIT 500
    `));
    return { commands: commands.filter((item) => kinds[area].includes(String(item.kind)) &&
        (!menuOnly || access.products.includes(product) || String(item.kind).startsWith('menu.')))
      .map((item) => {
        const body = (item.body ?? {}) as Record<string, unknown>;
        const safeBody = { ...body };
        delete safeBody.deviceFingerprint;
        if (!access.cost[product]) delete safeBody.costPrice;
        return { ...item, body: safeBody };
      }) };
  });

  app.post(
    '/owner/device/inventory',
    { bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(DeviceInventoryBody, req.body ?? {}, reply);
      if (!body) return;
      const [device] = await app.db.select().from(devices).where(eq(devices.id, body.deviceId)).limit(1);
      if (!device || device.status === 'revoked' || !secretsMatch(device.deviceFingerprint, body.deviceFingerprint)) {
        return reply.code(401).send({ error: 'Device authentication failed' });
      }
      const [license] = await app.db.select().from(licenses).where(eq(licenses.id, device.licenseId)).limit(1);
      if (!license || license.status !== 'active' || (license.validUntil && license.validUntil < new Date())) {
        return reply.code(403).send({ error: 'License inactive or expired' });
      }
      const features = (license.features ?? {}) as Record<string, unknown>;
      const access = await surfaceAccess(app, license.customerId, 'restaurant');
      const inventory = inventoryEnabled(features) && areaAllowed(access, 'stock');
      const catalog = areaAllowed(access, 'catalog');
      const cash = areaAllowed(access, 'cash');
      const suppliers = areaAllowed(access, 'suppliers');
      const guests = areaAllowed(access, 'guests');
      if (!inventory && !catalog && !cash && !suppliers && !guests) {
        return reply.code(403).send({ error: 'Buna icazəniz yoxdur', inventory: false });
      }
      if (inventory) {
        await saveInventorySnapshot(app, license.customerId, 'restaurant', {
          warehouses: body.warehouses ?? [], lines: body.lines ?? [],
          ...(catalog ? { menu: body.menu ?? [], categories: body.categories ?? [] } : {}),
        }, device.id);
      } else if (catalog) {
        await saveInventorySnapshot(app, license.customerId, 'restaurant', {
          warehouses: [], lines: [], menu: body.menu ?? [], categories: body.categories ?? [],
        }, device.id);
      }
      if (body.books) {
        const bookData: Record<string, unknown> = {};
        if (guests) bookData.customers = body.books.customers;
        if (suppliers) Object.assign(bookData, { suppliers: body.books.suppliers, purchases: body.books.purchases });
        if (cash) { bookData.cashMovements = body.books.cashMovements; if (body.books.accounts) bookData.accounts = body.books.accounts; }
        if ((guests || suppliers) && body.books.payments) bookData.payments = body.books.payments.filter((row) =>
          row.partyType === 'customer' ? guests : row.partyType === 'supplier' ? suppliers : false);
        if (Object.keys(bookData).length) {
          await saveInventorySnapshot(app, license.customerId, 'books-restaurant', bookData, device.id);
        }
      }
      await settleInventoryCommands(
        app,
        license.customerId,
        'restaurant',
        body.appliedCommandIds ?? [],
        body.failedCommandIds ?? [],
        device.id,
        body.failedCommandReasons ?? [],
      );
      const allowedKinds = [
        ...(inventory ? STOCK_COMMAND_KINDS.filter((kind) => !kind.startsWith('menu.')) : []),
        ...(catalog ? STOCK_COMMAND_KINDS.filter((kind) => kind.startsWith('menu.')) : []),
        ...(cash ? CASH_COMMAND_KINDS : []),
        ...(guests ? ['customer.pay'] : []),
        ...(suppliers ? ['supplier.pay', ...PURCHASE_COMMAND_KINDS] : []),
      ];
      // A till older than 1.8.2 cannot delete a stock card from a portal
      // command: keep it waiting until that till has updated.
      const [maj, min, pat] = String(device.appVersion || '0.0.0').split('.').map((x) => Number.parseInt(x, 10) || 0);
      const canDelete = maj > 1 || (maj === 1 && (min > 8 || (min === 8 && pat >= 2)));
      const commands = await takeInventoryCommands(app, license.customerId, 'restaurant', device.id,
        canDelete ? allowedKinds : allowedKinds.filter((kind) => kind !== 'product.deactivate'));
      const branches = body.includeBranches ? await branchSnapshots(app, license.customerId, device.id, inventory, cash) : [];
      return { ok: true, inventory, commands, ...(body.includeBranches ? { branches } : {}) };
    },
  );
}

export function inventoryFlag(features: Record<string, unknown> | null | undefined): boolean {
  return inventoryEnabled(features);
}
