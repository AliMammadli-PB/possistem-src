import {marketRegisterCapacityRoutes} from './market-register-capacity.js';
import {marketBranchScope,marketBranchEventVisible,signedHeartbeatDocument} from './branch-sync-policy.js';
import {
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { branches, customers, devices, licenses } from '@milioner/database';
import { verifyPassword } from '@milioner/security';
import { signDeviceCommand } from '../lib/command-signing.js';
import { writeAudit } from '../lib/audit.js';
import {
  encodeMarketCatalogDisplay,
  encodeMarketCatalogWebp,
  hydrateTillCatalogImage,
  isAllowedMarketImageMime,
  MARKET_CATALOG_FILE,
  MAX_MARKET_IMAGE_BYTES,
  marketCatalogDataUrl,
  marketCatalogPublicUrl,
  openMarketCatalogStream,
  saveMarketCatalogWebp,
} from '../lib/market-catalog-media.js';
import { clientIp, parseBody } from '../lib/validate.js';
import {
  getActiveChatTicket,
  getTicketMessages,
  openSupportRequest,
  sendSupportAttachmentForCustomer,
  serializeTicket,
} from '../lib/support.js';
import { currentUser, requireSuperadmin } from '../plugins/auth.js';
import { requireCustomer } from '../plugins/customer-auth.js';
import { resolveTenantToken } from './tenant.js';
import { effectiveRolePolicy } from './pos-roles.js';

// Kept local as well as in @milioner/database so this route can be rolled out
// independently to an older control host without replacing its whole database
// package (which may contain newer, host-specific tables).
const marketPosSnapshots = pgTable(
  'market_pos_snapshots',
  {
    deviceId: uuid('device_id').primaryKey(),
    customerId: uuid('customer_id').notNull(),
    appVersion: text('app_version'),
    dailySalesMinor: integer('daily_sales_minor').notNull().default(0),
    transactionCount: integer('transaction_count').notNull().default(0),
    openRegisters: integer('open_registers').notNull().default(0),
    criticalStock: integer('critical_stock').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('market_pos_snapshots_customer_updated_idx').on(t.customerId, t.updatedAt)],
);

const marketPosCustomerConfig = pgTable('market_pos_customer_config', {
  customerId: uuid('customer_id').primaryKey(),
  loyaltyRateBps: integer('loyalty_rate_bps').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

const marketDevices = pgTable('devices', {
  id: uuid('id').primaryKey(),
  licenseId: uuid('license_id').notNull(),
  activationKeyId: uuid('activation_key_id'),
  deviceFingerprint: text('device_fingerprint').notNull(),
  hostname: text('hostname'),
  appVersion: text('app_version'),
  status: text('status').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  registerName: text('register_name'),
  registerNameUpdatedAt: timestamp('register_name_updated_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

const marketProducts = pgTable('market_products', {
  customerId: uuid('customer_id').notNull(), productId: text('product_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  logicalAt: bigint('logical_at', { mode: 'number' }).notNull(), originDeviceId: uuid('origin_device_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.customerId, t.productId] })]);
const marketStockBalances = pgTable('market_stock_balances', {
  customerId: uuid('customer_id').notNull(), productId: text('product_id').notNull(), warehouseId: text('warehouse_id').notNull(),
  qty: bigint('qty', { mode: 'number' }).notNull().default(0), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.customerId, t.productId, t.warehouseId] })]);
const marketWarehouses = pgTable('market_warehouses', {
  customerId: uuid('customer_id').notNull(), warehouseId: text('warehouse_id').notNull(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  logicalAt: bigint('logical_at', { mode: 'number' }).notNull(), originDeviceId: uuid('origin_device_id').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.customerId, t.warehouseId] })]);
const marketSyncEvents = pgTable('market_sync_events', {
  customerId: uuid('customer_id').notNull(), eventId: text('event_id').notNull(), originDeviceId: uuid('origin_device_id').notNull(),
  originSeq: integer('origin_seq').notNull(), kind: text('kind').notNull(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.customerId, t.eventId] }), uniqueIndex('market_sync_events_origin_seq_key').on(t.customerId, t.originDeviceId, t.originSeq)]);
const marketDeviceVectors = pgTable('market_device_vectors', {
  customerId: uuid('customer_id').notNull(), deviceId: uuid('device_id').notNull(), vector: jsonb('vector').$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.customerId, t.deviceId] })]);
const marketSyncState = pgTable('market_sync_state', {
  customerId: uuid('customer_id').primaryKey(), bootstrapDeviceId: uuid('bootstrap_device_id'),
  bootstrapCompletedAt: timestamp('bootstrap_completed_at', { withTimezone: true }), catalogRevision: integer('catalog_revision').notNull().default(0),
  serverSeq: integer('server_seq').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
const marketPosCommands = pgTable(
  'market_pos_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id').notNull(),
    deviceId: uuid('device_id'),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('pending'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('market_pos_commands_pending_idx').on(t.customerId, t.status, t.createdAt)],
);

/** Well-known origin for catalog events written by the owner web, not a till. */
const SERVER_ORIGIN_DEVICE_ID = '00000000-0000-4000-a000-000000000001';

const MarketConfigSchema = z.object({
  loyaltyRateBps: z.number().int().min(0).max(10_000),
});

const RegisterNameSchema = z.object({
  name: z.string().trim().min(1).max(80),
  updatedAt: z.number().int().nonnegative().optional(),
});

const RegisterSnapshotSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  status: z.enum(['open', 'closed']),
  operatorName: z.string().max(80).nullable(),
  salesMinor: z.number().int().nonnegative(),
});

const StockSnapshotSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  sku: z.string().max(64),
  barcode: z.string().max(80),
  stock: z.number().int(),
  minStock: z.number().int().nonnegative(),
});

const WarehouseSnapshotSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  totalStock: z.number().int().nonnegative(),
});

const TopProductSnapshotSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  qty: z.number().int().nonnegative(),
  revenueMinor: z.number().int().nonnegative(),
});

const ProductSaleSnapshotSchema = z.object({
  id: z.string().min(1).max(64),
  soldTodayQty: z.number().int().nonnegative(),
  soldAllQty: z.number().int().nonnegative(),
  revenueTodayMinor: z.number().int().nonnegative(),
  revenueAllMinor: z.number().int().nonnegative(),
});

const ProductCatalogSnapshotSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  sku: z.string().max(64),
  barcode: z.string().max(80),
  stock: z.number().int(),
  minStock: z.number().int().nonnegative(),
  priceMinor: z.number().int().nonnegative(),
  active: z.boolean(),
});

export const MarketHeartbeatSchema = z.object({
  deviceId: z.string().uuid(),
  deviceFingerprint: z.string().min(8).max(256),
  appVersion: z.string().max(64).optional(),
  signedAt: z.string().datetime({ offset: true }).optional(),
  nonce: z.string().regex(/^[0-9a-fA-F]{32}$/).optional(),
  deviceSignature: z.string().regex(/^[0-9a-fA-F]{128}$/).optional(),
  snapshot: z.object({
    storeName: z.string().min(1).max(120),
    terminalName: z.string().min(1).max(80),
    branchName: z.string().max(200).optional(),
    terminalNameUpdatedAt: z.number().int().nonnegative().optional(),
    dailySalesMinor: z.number().int().nonnegative(),
    transactionCount: z.number().int().nonnegative(),
    cashMinor: z.number().int().nonnegative(),
    cardMinor: z.number().int().nonnegative(),
    openRegisters: z.number().int().nonnegative(),
    criticalStock: z.number().int().nonnegative(),
    productCount: z.number().int().nonnegative().optional(),
    activeProductCount: z.number().int().nonnegative().optional(),
    stockUnitCount: z.number().int().optional(),
    products: z.array(ProductCatalogSnapshotSchema).max(10_000).optional(),
    queue: z.number().int().nonnegative(),
    registers: z.array(RegisterSnapshotSchema).max(50),
    lowStock: z.array(StockSnapshotSchema).max(100),
    warehouses: z.array(WarehouseSnapshotSchema).max(50),
    topProducts: z.array(TopProductSnapshotSchema).max(20).optional(),
    productStats: z.array(ProductSaleSnapshotSchema).max(500).optional(),
    customerDebtMinor: z.number().int().optional(),
    supplierDebtMinor: z.number().int().optional(),
    treasuryMinor: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
  }),
});

const SyncEventSchema = z.object({
  eventId: z.string().min(1).max(128), originDeviceId: z.string().uuid(), originSeq: z.number().int().positive(),
  // stock.snapshot is the absolute form a till broadcasts for its initial
  // stock. Leaving it out of the enum made the whole exchange fail schema
  // validation whenever one was in the batch, so the batch never landed.
  kind: z.enum(['stock.movement', 'stock.snapshot', 'product.upsert', 'warehouse.upsert']), payload: z.record(z.string(), z.unknown()), createdAt: z.number().int().nonnegative(),
});
const MarketSyncExchangeSchema = z.object({
  deviceId: z.string().uuid(), deviceFingerprint: z.string().min(8).max(256), appVersion: z.string().max(64).optional(),
  signedAt: z.string().datetime({ offset: true }), nonce: z.string().regex(/^[0-9a-fA-F]{32}$/), deviceSignature: z.string().regex(/^[0-9a-fA-F]{128}$/),
  vector: z.record(z.string(), z.number().int().nonnegative()).default({}), events: z.array(SyncEventSchema).max(2000).default([]),
});

/** Deterministic JSON used on both Windows and the API for Ed25519 proof. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(row[key])}`)
    .join(',')}}`;
}

function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Device proof for market calls that carry no snapshot (support, and anything
 * else that is pure device auth).
 *
 * The heartbeat canonical form includes `snapshot`; signing a support request
 * against that shape can never match, so these calls sign — and this verifies —
 * the identity fields alone. Kept next to verifyMarketProof so the two canonical
 * forms stay visible side by side.
 */
export function verifyMarketDeviceProof(
  publicKeyHex: string,
  body: { deviceId: string; appVersion?: string; signedAt?: string; nonce?: string; deviceSignature?: string },
): boolean {
  if (!body.signedAt || !body.nonce || !body.deviceSignature) return false;
  const signedMs = Date.parse(body.signedAt);
  if (!Number.isFinite(signedMs) || Math.abs(Date.now() - signedMs) > 5 * 60_000) return false;
  try {
    const raw = Buffer.from(publicKeyHex, 'hex');
    if (raw.length !== 32) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
      format: 'der',
      type: 'spki',
    });
    const canonical = stableStringify({
      deviceId: body.deviceId,
      appVersion: body.appVersion ?? null,
      signedAt: body.signedAt,
      nonce: body.nonce,
    });
    return verifySignature(
      null,
      Buffer.from(canonical, 'utf8'),
      publicKey,
      Buffer.from(body.deviceSignature, 'hex'),
    );
  } catch {
    return false;
  }
}

export function verifyMarketProof(
  publicKeyHex: string,
  body: z.infer<typeof MarketHeartbeatSchema>,
): boolean {
  if (!body.signedAt || !body.nonce || !body.deviceSignature) return false;
  const signedMs = Date.parse(body.signedAt);
  if (!Number.isFinite(signedMs) || Math.abs(Date.now() - signedMs) > 5 * 60_000) return false;
  try {
    const raw = Buffer.from(publicKeyHex, 'hex');
    if (raw.length !== 32) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
      format: 'der',
      type: 'spki',
    });
    const canonical = stableStringify({
      deviceId: body.deviceId,
      appVersion: body.appVersion ?? null,
      signedAt: body.signedAt,
      nonce: body.nonce,
      snapshot: body.snapshot,
    });
    return verifySignature(
      null,
      Buffer.from(canonical, 'utf8'),
      publicKey,
      Buffer.from(body.deviceSignature, 'hex'),
    );
  } catch {
    return false;
  }
}

function verifySyncProof(publicKeyHex: string, body: z.infer<typeof MarketSyncExchangeSchema>): boolean {
  const signedMs = Date.parse(body.signedAt);
  if (!Number.isFinite(signedMs) || Math.abs(Date.now() - signedMs) > 5 * 60_000) return false;
  try {
    const raw = Buffer.from(publicKeyHex, 'hex');
    if (raw.length !== 32) return false;
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
    const canonical = stableStringify({ deviceId: body.deviceId, appVersion: body.appVersion ?? null, signedAt: body.signedAt, nonce: body.nonce, vector: body.vector, events: body.events });
    return verifySignature(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(body.deviceSignature, 'hex'));
  } catch { return false; }
}

async function readCentralInventory(app: FastifyInstance, customerId: string) {
  const [products, warehouses, balances, events, state, vectors] = await Promise.all([
    app.db.select().from(marketProducts).where(eq(marketProducts.customerId, customerId)),
    app.db.select().from(marketWarehouses).where(eq(marketWarehouses.customerId, customerId)),
    app.db.select().from(marketStockBalances).where(eq(marketStockBalances.customerId, customerId)),
    app.db.select().from(marketSyncEvents).where(eq(marketSyncEvents.customerId, customerId)).orderBy(desc(marketSyncEvents.receivedAt)).limit(1000),
    app.db.select().from(marketSyncState).where(eq(marketSyncState.customerId, customerId)).limit(1),
    app.db.select().from(marketDeviceVectors).where(eq(marketDeviceVectors.customerId, customerId)),
  ]);
  const lastByProduct = new Map<string, typeof events[number]>();
  for (const event of events) {
    const productId = String(event.payload.productId ?? (event.payload.product as Record<string, unknown> | undefined)?.id ?? '');
    if (productId && !lastByProduct.has(productId)) lastByProduct.set(productId, event);
  }
  // Annotated because the `...payload` spread otherwise loses its index signature
  // and callers can no longer read catalog fields such as minStock / active.
  const rows: Array<Record<string, any>> = products.map((row) => {
    const payload = row.payload as Record<string, any>;
    const warehouseStock = Object.fromEntries(balances.filter((balance) => balance.productId === row.productId).map((balance) => [balance.warehouseId, balance.qty]));
    const last = lastByProduct.get(row.productId);
    const stock = Object.values(warehouseStock).reduce((sum, qty) => sum + Number(qty), 0);
    return { ...payload, id: row.productId, name: typeof payload.name === 'object' ? String(payload.name?.az ?? payload.name?.en ?? payload.name?.ru ?? row.productId) : String(payload.name ?? row.productId),
      image: panelProductImage(payload.image),
      stock, stockMismatch: stock < 0, warehouseStock,
      lastMovement: last ? { kind: last.kind, at: last.createdAt.toISOString(), deviceId: last.originDeviceId, delta: Number(last.payload.qtyDelta ?? 0) } : null };
  });
  return { products: rows, warehouses: warehouses.map((row) => ({ ...row.payload, id: row.warehouseId,
      totalStock: balances.filter((balance) => balance.warehouseId === row.warehouseId).reduce((sum, balance) => sum + Number(balance.qty), 0) })),
    balances, catalogRevision: state[0]?.catalogRevision ?? 0, updatedAt: state[0]?.updatedAt?.toISOString() ?? null,
    pendingDevices: vectors.filter((row) => Date.now() - row.updatedAt.getTime() > 15_000).map((row) => row.deviceId) };
}

type InventoryFilter = 'all' | 'instock' | 'out' | 'critical';

function productMatchesQuery(product: Record<string, any>, needle: string): boolean {
  if (!needle) return true;
  const name = String(product.name ?? '').toLocaleLowerCase('az');
  return (
    name.includes(needle) ||
    String(product.sku ?? '').toLowerCase().includes(needle) ||
    String(product.barcode ?? '').includes(needle)
  );
}

function productStockFilter(product: Record<string, any>, filter: InventoryFilter): boolean {
  const stock = Number(product.stock) || 0;
  const minStock = Number(product.minStock) || 0;
  if (filter === 'instock') return stock > 0;
  if (filter === 'out') return stock <= 0;
  if (filter === 'critical') return stock <= minStock;
  return true;
}

function activeCatalog<T extends { active?: boolean }>(products: T[]): T[] {
  return products.filter((product) => product.active !== false);
}

function liveAgainstCatalog<T extends { id: string }>(
  rows: unknown,
  central: Array<{ id?: string; active?: boolean }>,
): T[] {
  const list = Array.isArray(rows) ? (rows as T[]) : [];
  if (!central.length) return list;
  const ids = new Set(
    activeCatalog(central)
      .map((product) => product.id)
      .filter((id): id is string => Boolean(id)),
  );
  return list.filter((row) => ids.has(row.id));
}

function productSaleBits(live: { topProducts?: unknown; productStats?: unknown }) {
  const map = new Map<
    string,
    { soldTodayQty: number; soldAllQty: number; revenueTodayMinor: number; revenueAllMinor: number }
  >();
  const write = (
    id: string,
    row: { soldTodayQty: number; soldAllQty: number; revenueTodayMinor: number; revenueAllMinor: number },
  ) => {
    if (!id) return;
    const previous = map.get(id);
    if (!previous || row.soldAllQty >= previous.soldAllQty) map.set(id, row);
  };
  if (Array.isArray(live.productStats)) {
    for (const raw of live.productStats) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      write(String(row.id ?? ''), {
        soldTodayQty: Math.max(0, Math.trunc(Number(row.soldTodayQty) || 0)),
        soldAllQty: Math.max(0, Math.trunc(Number(row.soldAllQty) || 0)),
        revenueTodayMinor: Math.max(0, Math.trunc(Number(row.revenueTodayMinor) || 0)),
        revenueAllMinor: Math.max(0, Math.trunc(Number(row.revenueAllMinor) || 0)),
      });
    }
  }
  if (Array.isArray(live.topProducts)) {
    for (const raw of live.topProducts) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const id = String(row.id ?? '');
      if (!id || map.has(id)) continue;
      const sold = Math.max(0, Math.trunc(Number(row.qty) || 0));
      const revenue = Math.max(0, Math.trunc(Number(row.revenueMinor) || 0));
      write(id, {
        soldTodayQty: sold,
        soldAllQty: sold,
        revenueTodayMinor: revenue,
        revenueAllMinor: revenue,
      });
    }
  }
  return map;
}

function attachProductSales(
  products: unknown,
  live: { topProducts?: unknown; productStats?: unknown },
) {
  const list = Array.isArray(products) ? products : [];
  const bits = productSaleBits(live);
  return list.map((item) => {
    const product = item && typeof item === 'object' ? (item as { id?: string; costMinor?: number }) : {};
    const row = bits.get(String(product.id ?? ''));
    const cost = Number(product.costMinor) || 0;
    const soldTodayQty = row?.soldTodayQty ?? 0;
    const soldAllQty = row?.soldAllQty ?? 0;
    const revenueTodayMinor = row?.revenueTodayMinor ?? 0;
    const revenueAllMinor = row?.revenueAllMinor ?? 0;
    return {
      ...product,
      soldTodayQty,
      soldAllQty,
      revenueTodayMinor,
      revenueAllMinor,
      profitTodayMinor: revenueTodayMinor - cost * soldTodayQty,
      profitAllMinor: revenueAllMinor - cost * soldAllQty,
    };
  });
}

function paginateInventory(
  central: Awaited<ReturnType<typeof readCentralInventory>>,
  opts: { q?: string; filter?: string; sort?: string; page?: number; limit?: number },
) {
  const catalog = activeCatalog(central.products);
  const needle = (opts.q ?? '').trim().toLocaleLowerCase('az');
  const filter: InventoryFilter =
    opts.filter === 'instock' || opts.filter === 'out' || opts.filter === 'critical' ? opts.filter : 'all';
  const filtered = catalog.filter(
    (product) => productMatchesQuery(product, needle) && productStockFilter(product, filter),
  );
  const sort = opts.sort === 'stock' || opts.sort === 'sku' ? opts.sort : 'name';
  filtered.sort((a, b) => {
    if (sort === 'stock') return Number(b.stock) - Number(a.stock);
    if (sort === 'sku') return String(a.sku ?? '').localeCompare(String(b.sku ?? ''), 'az');
    return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'az');
  });
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const start = (page - 1) * limit;
  const totals = {
    all: catalog.length,
    instock: catalog.filter((product) => Number(product.stock) > 0).length,
    out: catalog.filter((product) => Number(product.stock) <= 0).length,
    critical: catalog.filter(
      (product) => Number(product.stock) <= Number(product.minStock ?? 0),
    ).length,
    units: catalog.reduce((sum, product) => sum + Number(product.stock || 0), 0),
  };
  return {
    products: filtered.slice(start, start + limit),
    total: filtered.length,
    page,
    limit,
    warehouses: central.warehouses,
    totals,
    catalogRevision: central.catalogRevision,
    updatedAt: central.updatedAt,
    pendingDevices: central.pendingDevices,
  };
}

async function inventoryPageWithSales(
  app: FastifyInstance,
  customerId: string,
  central: Awaited<ReturnType<typeof readCentralInventory>>,
  opts: { q?: string; filter?: string; sort?: string; page?: number; limit?: number },
) {
  const page = paginateInventory(central, opts);
  const rows = await app.db
    .select()
    .from(marketPosSnapshots)
    .where(eq(marketPosSnapshots.customerId, customerId));
  return { ...page, products: attachProductSales(page.products, mergeMarketSnapshots(rows)) };
}

function inventoryCsv(central: Awaited<ReturnType<typeof readCentralInventory>>, products: Array<Record<string, any>>) {
  const warehouses = central.warehouses as Array<{ id: string; code?: string; name?: string }>;
  const header = [
    'Ad',
    'SKU',
    'Barkod',
    'Ümumi',
    ...warehouses.map((warehouse) => String(warehouse.code || warehouse.name || warehouse.id)),
    'Minimum',
    'Qiymət (AZN)',
    'Status',
  ];
  // Quoting alone does not stop a spreadsheet from evaluating a cell that opens
  // with =, +, -, @ or a control character. Product names are typed by till
  // operators and this file is opened in Excel by the owner, so neutralise the
  // formula prefix before quoting.
  const escape = (value: unknown) => {
    const text = String(value ?? '');
    const armed = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${armed.replaceAll('"', '""')}"`;
  };
  const lines = [header.join(',')];
  for (const product of products) {
    const stockMap = (product.warehouseStock ?? {}) as Record<string, number>;
    lines.push(
      [
        product.name,
        product.sku,
        product.barcode,
        product.stock,
        ...warehouses.map((warehouse) => stockMap[warehouse.id] ?? 0),
        product.minStock,
        (Number(product.priceMinor || 0) / 100).toFixed(2),
        product.active === false ? 'Deaktiv' : 'Aktiv',
      ]
        .map(escape)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\n')}`;
}

function resolveOwnerCustomerId(
  req: { headers: { authorization?: string } },
  reply: Parameters<typeof requireCustomer>[1],
): string | null {
  const auth = req.headers.authorization;
  const raw =
    typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : undefined;
  const tenant = resolveTenantToken(raw);
  const customerIdentity = tenant ? null : requireCustomer(req as never, reply);
  if (!tenant && !customerIdentity) return null;
  return tenant?.customerId ?? customerIdentity!.id;
}

async function enqueueServerEvent(
  tx: FastifyInstance['db'],
  customerId: string,
  kind: 'product.upsert' | 'stock.snapshot' | 'stock.movement' | 'warehouse.upsert',
  payload: Record<string, unknown>,
) {
  const now = new Date();
  const [state] = await tx
    .select()
    .from(marketSyncState)
    .where(eq(marketSyncState.customerId, customerId))
    .limit(1);
  const nextSeq = (state?.serverSeq ?? 0) + 1;
  const eventId = `server:${customerId}:${nextSeq}:${randomBytes(4).toString('hex')}`;
  await tx.insert(marketSyncEvents).values({
    customerId,
    eventId,
    originDeviceId: SERVER_ORIGIN_DEVICE_ID,
    originSeq: nextSeq,
    kind,
    payload,
    createdAt: now,
    receivedAt: now,
  });
  await tx
    .insert(marketSyncState)
    .values({
      customerId,
      catalogRevision: 1,
      serverSeq: nextSeq,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: marketSyncState.customerId,
      set: {
        catalogRevision: sql`${marketSyncState.catalogRevision} + 1`,
        serverSeq: nextSeq,
        updatedAt: now,
      },
    });
}

type ProductImage =
  | { kind: 'sprite'; index: number }
  | { kind: 'url'; url: string; remoteUrl?: string };

function asProductImage(value: unknown): ProductImage {
  if (!value || typeof value !== 'object') return { kind: 'sprite', index: 0 };
  const image = value as Record<string, unknown>;
  if (image.kind === 'url') {
    const url = String(image.url ?? '').trim();
    const remote = String(image.remoteUrl ?? '').trim();
    if (url || remote) {
      const href = url || remote;
      const remoteHref = /^https?:\/\//i.test(remote) ? remote : (/^https?:\/\//i.test(url) ? url : undefined);
      return remoteHref ? { kind: 'url', url: href, remoteUrl: remoteHref } : { kind: 'url', url: href };
    }
  }
  return { kind: 'sprite', index: Number(image.index) || 0 };
}

/** Owner panel only needs the public URL — data URLs stay in sync events for the till. */
function panelProductImage(value: unknown): ProductImage {
  const parsed = asProductImage(value);
  if (parsed.kind !== 'url') return parsed;
  const http = parsed.remoteUrl || (/^https?:\/\//i.test(parsed.url) ? parsed.url : '');
  if (http) return { kind: 'url', url: http, remoteUrl: http };
  return parsed;
}

const catalogHydratedCustomers = new Set<string>();

async function pushCatalogPhotosToTills(app: FastifyInstance, customerId: string) {
  if (catalogHydratedCustomers.has(customerId)) return;
  catalogHydratedCustomers.add(customerId);
  const rows = await app.db.select().from(marketProducts).where(eq(marketProducts.customerId, customerId));
  for (const row of rows) {
    const payload = row.payload as Record<string, unknown>;
    const current = asProductImage(payload.image);
    if (current.kind === 'url' && current.url.startsWith('data:')) continue;
    const next = await hydrateTillCatalogImage(current);
    if (next.kind !== 'url' || !String(next.url).startsWith('data:')) continue;
    const product = { ...payload, id: row.productId, image: next };
    const logicalAt = Date.now();
    const now = new Date();
    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO market_products(customer_id,product_id,payload,logical_at,origin_device_id,updated_at)
        VALUES (${customerId},${row.productId},${JSON.stringify(product)}::jsonb,${logicalAt},${SERVER_ORIGIN_DEVICE_ID}::uuid,${now.toISOString()}::timestamptz)
        ON CONFLICT(customer_id,product_id) DO UPDATE SET payload=EXCLUDED.payload,logical_at=EXCLUDED.logical_at,origin_device_id=EXCLUDED.origin_device_id,updated_at=EXCLUDED.updated_at
      `);
      await enqueueServerEvent(tx as never, customerId, 'product.upsert', { product, logicalAt });
    });
  }
}

function namedProduct(
  input: {
    id: string;
    name: string | { az: string; ru?: string; en?: string };
    sku: string;
    barcode?: string;
    priceMinor: number;
    costMinor?: number;
    minStock?: number;
    unit?: string;
    category?: string;
    active?: boolean;
    createdAt?: number;
  },
  image: ProductImage = { kind: 'sprite', index: 0 },
) {
  const name =
    typeof input.name === 'string'
      ? { az: input.name, ru: input.name, en: input.name }
      : { az: input.name.az, ru: input.name.ru ?? '', en: input.name.en ?? '' };
  return {
    id: input.id,
    sku: input.sku,
    barcode: input.barcode ?? '',
    name,
    category: input.category ?? '',
    unit: input.unit ?? 'əd',
    priceMinor: input.priceMinor,
    costMinor: input.costMinor ?? 0,
    minStock: input.minStock ?? 0,
    taxRate: 18,
    supplier: '',
    accent: '#0a4f9c',
    image,
    active: input.active !== false,
    createdAt: input.createdAt ?? Date.now(),
  };
}

type SnapshotRow = {
  deviceId: string;
  updatedAt: Date;
  dailySalesMinor: number;
  transactionCount: number;
  openRegisters: number;
  appVersion: string | null;
  payload: unknown;
};

export type LiveRegister = {
  id: string;
  name: string;
  status: 'open' | 'closed';
  operatorName: string | null;
  salesMinor: number;
  deviceId: string;
  lastSeenAt: string;
  connected: boolean;
  terminalName: string | null;
};

function mergeMarketSnapshots(rows: SnapshotRow[], fallbackStoreName = 'Market') {
  const now = Date.now();
  const onlineMs = 90_000;
  const sorted = [...rows].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  const lastRow = sorted[sorted.length - 1] ?? null;
  const connectedRows = sorted.filter((row) => now - row.updatedAt.getTime() < onlineMs);
  const registerMap = new Map<string, LiveRegister>();
  let storeName = fallbackStoreName;
  let terminalName: string | null = lastRow
    ? String(((lastRow.payload ?? {}) as { terminalName?: string }).terminalName ?? '') || null
    : null;
  let queue = 0;
  let topProducts: unknown[] = [];
  let productStats: unknown[] = [];
  let lowStock: unknown[] = [];

  for (const row of sorted) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    if (payload.storeName) storeName = String(payload.storeName);
    if (payload.terminalName) terminalName = String(payload.terminalName);
    queue = Number(payload.queue) || queue;
    if (Array.isArray(payload.topProducts)) topProducts = payload.topProducts;
    if (Array.isArray(payload.productStats)) productStats = payload.productStats;
    if (Array.isArray(payload.lowStock)) lowStock = payload.lowStock;
    const connected = now - row.updatedAt.getTime() < onlineMs;
    const registers = Array.isArray(payload.registers) ? payload.registers : [];
    for (const raw of registers) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const id = String(item.id ?? '').trim();
      if (!id) continue;
      registerMap.set(id, {
        id,
        name: String(item.name ?? 'Kassa'),
        status: item.status === 'open' ? 'open' : 'closed',
        operatorName: item.operatorName == null || item.operatorName === '' ? null : String(item.operatorName),
        salesMinor: Math.max(0, Math.trunc(Number(item.salesMinor) || 0)),
        deviceId: row.deviceId,
        lastSeenAt: row.updatedAt.toISOString(),
        connected,
        terminalName: payload.terminalName ? String(payload.terminalName) : null,
      });
    }
  }

  const cashSource = connectedRows.length ? connectedRows : sorted.slice(-1);
  let bestCash = 0;
  let bestCard = 0;
  let bestSales = 0;
  for (const row of cashSource) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const sales = Number(row.dailySalesMinor) || 0;
    const cash = Number(payload.cashMinor) || 0;
    const card = Number(payload.cardMinor) || 0;
    if (cash + card > bestCash + bestCard || sales > bestSales) {
      bestCash = cash;
      bestCard = card;
      bestSales = sales;
    }
  }
  const registers = [...registerMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'az'));
  const registerSales = registers.reduce((sum, row) => sum + row.salesMinor, 0);
  const dailySalesMinor = registerSales || bestSales;
  let cashMinor = bestCash;
  let cardMinor = bestCard;
  if (bestCash + bestCard > 0 && dailySalesMinor > 0) {
    const scale = dailySalesMinor / Math.max(bestCash + bestCard, 1);
    cashMinor = Math.round(bestCash * Math.min(scale, 1));
    cardMinor = Math.max(0, dailySalesMinor - cashMinor);
  }

  return {
    storeName,
    terminalName,
    lastSeenAt: lastRow?.updatedAt.toISOString() ?? null,
    appVersion: lastRow?.appVersion ?? null,
    connected: connectedRows.length > 0,
    dailySalesMinor,
    transactionCount: cashSource.length
      ? Math.max(...cashSource.map((row) => row.transactionCount || 0))
      : 0,
    cashMinor,
    cardMinor,
    openRegisters: registers.filter((row) => row.status === 'open' && row.connected).length,
    registers,
    queue,
    topProducts,
    productStats,
    lowStock,
  };
}

async function ensureWarehouses(
  tx: typeof marketWarehouses extends never ? never : {
    execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
    select: () => {
      from: (table: typeof marketWarehouses) => {
        where: (clause: unknown) => Promise<Array<{ warehouseId: string }>>;
      };
    };
  },
  customerId: string,
  warehouseIds: string[],
  now: Date,
  logicalAt: number,
) {
  const unique = [...new Set(warehouseIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  const existing = await tx
    .select()
    .from(marketWarehouses)
    .where(eq(marketWarehouses.customerId, customerId));
  const known = new Set(existing.map((row) => row.warehouseId));
  for (const warehouseId of unique) {
    if (known.has(warehouseId)) continue;
    const warehouse = {
      id: warehouseId,
      code: warehouseId === 'wh-sales' ? 'ZAL-01' : warehouseId.slice(0, 16),
      name: warehouseId === 'wh-sales' ? 'Satış zalı' : warehouseId,
      address: '',
      manager: '',
      active: true,
    };
    await tx.execute(sql`
      INSERT INTO market_warehouses(customer_id,warehouse_id,payload,logical_at,origin_device_id,updated_at)
      VALUES (${customerId},${warehouseId},${JSON.stringify(warehouse)}::jsonb,${logicalAt},${SERVER_ORIGIN_DEVICE_ID}::uuid,${now.toISOString()}::timestamptz)
      ON CONFLICT(customer_id,warehouse_id) DO NOTHING
    `);
    await enqueueServerEvent(tx as never, customerId, 'warehouse.upsert', { warehouse, logicalAt });
  }
}

/**
 * A till that claims a command and then dies (crash, power cut, lost network
 * before it could report) leaves the row in `running` forever: `claimed_at` was
 * recorded but never read, so the owner's X/Z request just hangs in the panel
 * with no way to tell it will never finish.
 *
 * These are failed rather than requeued on purpose. `z_report` closes a shift,
 * and a till that stopped responding may well have executed it already —
 * re-issuing it automatically would be a second close. Surfacing the timeout
 * lets the owner retry deliberately.
 */
const COMMAND_RUNNING_TIMEOUT_MS = 5 * 60 * 1000;

async function expireStaleCommands(app: FastifyInstance, customerId: string) {
  const cutoff = new Date(Date.now() - COMMAND_RUNNING_TIMEOUT_MS);
  await app.db
    .update(marketPosCommands)
    .set({
      status: 'failed',
      error: 'Kassa əmri vaxtında tamamlamadı (bağlantı kəsildi və ya proqram bağlandı)',
      completedAt: new Date(),
    })
    .where(
      and(
        eq(marketPosCommands.customerId, customerId),
        eq(marketPosCommands.status, 'running'),
        lt(marketPosCommands.claimedAt, cutoff),
      ),
    );
}

async function claimPendingCommands(
  app: FastifyInstance,
  customerId: string,
  deviceId: string,
) {
  await expireStaleCommands(app, customerId);
  const pending = await app.db
    .select()
    .from(marketPosCommands)
    .where(
      and(
        eq(marketPosCommands.customerId, customerId),
        eq(marketPosCommands.status, 'pending'),
        or(isNull(marketPosCommands.deviceId), eq(marketPosCommands.deviceId, deviceId)),
      ),
    )
    .orderBy(marketPosCommands.createdAt)
    .limit(5);
  if (pending.length === 0) return [];
  const now = new Date();
  const claimed = [];
  for (const command of pending) {
    const [row] = await app.db
      .update(marketPosCommands)
      .set({ status: 'running', deviceId, claimedAt: now })
      .where(and(eq(marketPosCommands.id, command.id), eq(marketPosCommands.status, 'pending')))
      .returning();
    if (row) claimed.push(row);
  }
  return claimed.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
    // Signed for this till only; it refuses an unsigned or foreign command.
    signed: signDeviceCommand({ id: row.id, kind: row.kind, payload: row.payload, customerId, deviceId }),
  }));
}

const OwnerProductSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.union([
    z.string().trim().min(1).max(200),
    z.object({
      az: z.string().trim().min(1).max(200),
      ru: z.string().max(200).optional(),
      en: z.string().max(200).optional(),
    }),
  ]),
  sku: z.string().trim().min(1).max(64),
  barcode: z.string().max(64).optional().default(''),
  priceMinor: z.number().int().nonnegative(),
  costMinor: z.number().int().nonnegative().optional(),
  minStock: z.number().int().nonnegative().optional().default(0),
  unit: z.string().max(16).optional().default('əd'),
  category: z.string().max(80).optional().default(''),
  active: z.boolean().optional().default(true),
  warehouseStock: z.record(z.string(), z.number().int()).optional(),
});

const OwnerCommandSchema = z.object({
  kind: z.enum(['x_report', 'z_report']),
  deviceId: z.string().uuid().nullable().optional(),
  actualCashMinor: z.number().int().nonnegative().optional(),
});

const OwnerDeleteProductSchema = z.object({
  password: z.string().min(1).max(200),
});

const OwnerStockAdjustSchema = z.object({
  warehouseId: z.string().trim().min(1).max(64).optional(),
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0 && Math.abs(value) <= 1_000_000, {
      message: 'Miqdar 0 ola bilməz',
    }),
});

const CommandResultSchema = z.object({
  status: z.enum(['done', 'failed']),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(500).optional(),
});

import { surfaceAccess as marketSurfaceAccess } from './access.js';
import { deviceStation as marketDeviceStation } from './device-stations.js';

export async function marketRoutes(app: FastifyInstance) {
  await marketRegisterCapacityRoutes(app);
  app.get('/public/market-catalog/:file', async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!MARKET_CATALOG_FILE.test(file)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    try {
      const stream = await openMarketCatalogStream(file);
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=604800, immutable');
      return reply.send(stream);
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
  });

  app.get('/market-pos/customers/:id/config', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const [row] = await app.db
      .select()
      .from(marketPosCustomerConfig)
      .where(eq(marketPosCustomerConfig.customerId, id))
      .limit(1);
    return { loyaltyRateBps: row?.loyaltyRateBps ?? 0 };
  });

  app.patch('/market-pos/customers/:id/config', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = parseBody(MarketConfigSchema, req.body ?? {}, reply);
    if (!body) return;
    const now = new Date();
    const [row] = await app.db
      .insert(marketPosCustomerConfig)
      .values({
        customerId: id,
        loyaltyRateBps: body.loyaltyRateBps,
        updatedAt: now,
        updatedBy: currentUser(req).id,
      })
      .onConflictDoUpdate({
        target: marketPosCustomerConfig.customerId,
        set: {
          loyaltyRateBps: body.loyaltyRateBps,
          updatedAt: now,
          updatedBy: currentUser(req).id,
        },
      })
      .returning();
    return { loyaltyRateBps: row!.loyaltyRateBps };
  });

  app.patch('/market-pos/customers/:id/registers/:deviceId', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id, deviceId } = req.params as { id: string; deviceId: string };
    const body = parseBody(RegisterNameSchema, req.body ?? {}, reply);
    if (!body) return;
    const [license] = await app.db
      .select({ id: licenses.id })
      .from(licenses)
      .where(and(eq(licenses.customerId, id), eq(licenses.plan, 'market')))
      .orderBy(desc(licenses.createdAt))
      .limit(1);
    if (!license) return reply.code(404).send({ error: 'Market license not found' });
    const changedAt = new Date(body.updatedAt ?? Date.now());
    const [row] = await app.db
      .update(marketDevices)
      .set({ registerName: body.name, registerNameUpdatedAt: changedAt, updatedAt: new Date() })
      .where(and(
        eq(marketDevices.id, deviceId),
        eq(marketDevices.licenseId, license.id),
        // ISO string, not the Date: postgres.js cannot bind a Date inside a raw
        // sql`` template (no column mapping applies there).
        //
        // Parentheses are load-bearing: and() joins with bare " and " and SQL
        // binds AND tighter than OR, so without them the `<= changedAt` half
        // becomes its own disjunct — unscoped from device id AND license id —
        // turning this UPDATE into a mass rename across every tenant's devices.
        sql`(${marketDevices.registerNameUpdatedAt} IS NULL OR ${marketDevices.registerNameUpdatedAt} <= ${changedAt.toISOString()}::timestamptz)`,
      ))
      .returning({ name: marketDevices.registerName, nameUpdatedAt: marketDevices.registerNameUpdatedAt });
    if (!row) return reply.code(409).send({ error: 'A newer register name already exists' });
    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'market.register.rename',
      entityType: 'device',
      entityId: deviceId,
      ip: clientIp(req),
      meta: { customerId: id, name: body.name, updatedAt: changedAt.toISOString() },
    });
    return { ok: true, name: row.name, nameUpdatedAt: row.nameUpdatedAt?.getTime() ?? 0 };
  });

  app.get('/market-pos/customers/:id/overview', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const rows = await app.db.select().from(marketPosSnapshots).where(eq(marketPosSnapshots.customerId, id));
    const live = mergeMarketSnapshots(rows, 'Market POS');
    const newest = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const payload = (newest?.payload ?? {}) as Record<string, unknown>;
    const central = await readCentralInventory(app, id);
    const centralProducts = central.products;
    return {
      market: {
        available: Boolean(rows.length || centralProducts.length),
        connected: live.connected,
        lastSeenAt: live.lastSeenAt,
        appVersion: live.appVersion,
        storeName: live.storeName,
        terminalName: live.terminalName,
        dailySalesMinor: live.dailySalesMinor,
        transactionCount: live.transactionCount,
        cashMinor: live.cashMinor,
        cardMinor: live.cardMinor,
        openRegisters: live.openRegisters,
        registers: live.registers,
        criticalStock: activeCatalog(centralProducts).filter((product) => Number(product.stock) <= Number(product.minStock ?? 0)).length,
        productCount: activeCatalog(centralProducts).length || Number(payload.productCount) || 0,
        activeProductCount: centralProducts.length ? activeCatalog(centralProducts).length : Number(payload.activeProductCount) || 0,
        stockUnitCount: centralProducts.length ? centralProducts.reduce((sum, product) => sum + Number(product.stock || 0), 0) : Number(payload.stockUnitCount) || 0,
        customerDebtMinor: Number(payload.customerDebtMinor) || 0,
        supplierDebtMinor: Number(payload.supplierDebtMinor) || 0,
        treasuryMinor: Number(payload.treasuryMinor) || 0,
        products: attachProductSales(
          centralProducts.length ? activeCatalog(centralProducts) : Array.isArray(payload.products) ? payload.products : [],
          live,
        ),
        topProducts: liveAgainstCatalog(live.topProducts, centralProducts),
        lowStock: liveAgainstCatalog(live.lowStock, centralProducts),
        catalogRevision: central.catalogRevision,
        centralUpdatedAt: central.updatedAt,
        pendingDevices: central.pendingDevices,
        warehouses: central.warehouses,
      },
    };
  });

  app.get('/market-pos/customers/:id/inventory', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const query = req.query as {
      q?: string;
      filter?: string;
      sort?: string;
      page?: string;
      limit?: string;
      format?: string;
    };
    const central = await readCentralInventory(app, id);
    if (query.format === 'csv') {
      const needle = (query.q ?? '').trim().toLocaleLowerCase('az');
      const filter =
        query.filter === 'instock' || query.filter === 'out' || query.filter === 'critical'
          ? query.filter
          : 'all';
      const rows = activeCatalog(central.products).filter(
        (product) => productMatchesQuery(product, needle) && productStockFilter(product, filter),
      );
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="market-stok.csv"');
      return inventoryCsv(central, rows);
    }
    return inventoryPageWithSales(app, id, central, {
      q: query.q,
      filter: query.filter,
      sort: query.sort,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 50,
    });
  });

  app.get('/owner/market-overview', async (req, reply) => {
    const auth = req.headers.authorization;
    const raw =
      typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : undefined;
    const tenant = resolveTenantToken(raw);
    const customerIdentity = tenant ? null : requireCustomer(req, reply);
    if (!tenant && !customerIdentity) return;
    const customerId = tenant?.customerId ?? customerIdentity!.id;

    const rows = await app.db
      .select()
      .from(marketPosSnapshots)
      .where(eq(marketPosSnapshots.customerId, customerId));
    const [customer] = await app.db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    const live = mergeMarketSnapshots(rows, customer?.name ?? 'Market');
    const newest = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const payload = (newest?.payload ?? {}) as Record<string, unknown>;
    await pushCatalogPhotosToTills(app, customerId).catch((error) => {
      app.log.warn({ err: error, customerId }, 'market_catalog_photo_push_failed');
    });
    const central = await readCentralInventory(app, customerId);
    const centralProducts = central.products;

    return {
      market: {
        available: Boolean(rows.length || centralProducts.length),
        connected: live.connected,
        lastSeenAt: live.lastSeenAt,
        appVersion: live.appVersion,
        storeName: live.storeName,
        terminalName: live.terminalName,
        dailySalesMinor: live.dailySalesMinor,
        transactionCount: live.transactionCount,
        cashMinor: live.cashMinor,
        cardMinor: live.cardMinor,
        openRegisters: live.openRegisters,
        criticalStock: activeCatalog(centralProducts).filter((product) => Number(product.stock) <= Number(product.minStock ?? 0)).length,
        productCount: activeCatalog(centralProducts).length || Number(payload.productCount) || 0,
        activeProductCount: centralProducts.length ? activeCatalog(centralProducts).length : Number(payload.activeProductCount) || 0,
        stockUnitCount: centralProducts.length ? centralProducts.reduce((sum, product) => sum + Number(product.stock || 0), 0) : Number(payload.stockUnitCount) || 0,
        queue: live.queue,
        registers: live.registers,
        lowStock: liveAgainstCatalog(live.lowStock, centralProducts),
        warehouses: central.warehouses.length ? central.warehouses : payload.warehouses ?? [],
        topProducts: liveAgainstCatalog(live.topProducts, centralProducts),
        products: attachProductSales(
          centralProducts.length ? activeCatalog(centralProducts) : payload.products ?? [],
          live,
        ),
        customerDebtMinor: Number(payload.customerDebtMinor) || 0,
        supplierDebtMinor: Number(payload.supplierDebtMinor) || 0,
        treasuryMinor: Number(payload.treasuryMinor) || 0,
        catalogRevision: central.catalogRevision,
        centralUpdatedAt: central.updatedAt,
        pendingDevices: central.pendingDevices,
      },
    };
  });

  app.get('/owner/market/inventory', async (req, reply) => {
    const customerId = resolveOwnerCustomerId(req, reply);
    if (!customerId) return;
    const query = req.query as {
      q?: string;
      filter?: string;
      sort?: string;
      page?: string;
      limit?: string;
      format?: string;
    };
    const central = await readCentralInventory(app, customerId);
    if (query.format === 'csv') {
      const needle = (query.q ?? '').trim().toLocaleLowerCase('az');
      const filter =
        query.filter === 'instock' || query.filter === 'out' || query.filter === 'critical'
          ? query.filter
          : 'all';
      const rows = activeCatalog(central.products).filter(
        (product) => productMatchesQuery(product, needle) && productStockFilter(product, filter),
      );
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="market-stok.csv"');
      return inventoryCsv(central, rows);
    }
    return inventoryPageWithSales(app, customerId, central, {
      q: query.q,
      filter: query.filter,
      sort: query.sort,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 50,
    });
  });

  app.post('/owner/market/products', async (req, reply) => {
    const customerId = resolveOwnerCustomerId(req, reply);
    if (!customerId) return;
    const body = parseBody(OwnerProductSchema, req.body ?? {}, reply);
    if (!body) return;
    const id = body.id || `p-${randomBytes(6).toString('hex')}`;
    const warehouseStock =
      body.warehouseStock && Object.keys(body.warehouseStock).length
        ? body.warehouseStock
        : { 'wh-sales': 0 };
    const product = { ...namedProduct({ ...body, id, active: true }), warehouseStock };
    const now = new Date();
    const logicalAt = Date.now();
    await app.db.transaction(async (tx) => {
      await ensureWarehouses(tx as never, customerId, Object.keys(warehouseStock), now, logicalAt);
      await tx.execute(sql`
        INSERT INTO market_products(customer_id,product_id,payload,logical_at,origin_device_id,updated_at)
        VALUES (${customerId},${id},${JSON.stringify(product)}::jsonb,${logicalAt},${SERVER_ORIGIN_DEVICE_ID}::uuid,${now.toISOString()}::timestamptz)
        ON CONFLICT(customer_id,product_id) DO UPDATE SET payload=EXCLUDED.payload,logical_at=EXCLUDED.logical_at,origin_device_id=EXCLUDED.origin_device_id,updated_at=EXCLUDED.updated_at
      `);
      await enqueueServerEvent(tx as never, customerId, 'product.upsert', { product, logicalAt });
      for (const [warehouseId, qty] of Object.entries(warehouseStock)) {
        const amount = Math.trunc(Number(qty) || 0);
        await tx
          .insert(marketStockBalances)
          .values({ customerId, productId: id, warehouseId, qty: amount, updatedAt: now })
          .onConflictDoUpdate({
            target: [marketStockBalances.customerId, marketStockBalances.productId, marketStockBalances.warehouseId],
            set: { qty: amount, updatedAt: now },
          });
        await enqueueServerEvent(tx as never, customerId, 'stock.snapshot', {
          productId: id,
          warehouseId,
          qty: amount,
          logicalAt,
        });
      }
    });
    return reply.code(201).send({ ok: true, product });
  });

  app.patch('/owner/market/products/:id', async (req, reply) => {
    const customerId = resolveOwnerCustomerId(req, reply);
    if (!customerId) return;
    const { id } = req.params as { id: string };
    const body = parseBody(OwnerProductSchema, { ...(req.body as object), id }, reply);
    if (!body) return;
    const [existing] = await app.db
      .select()
      .from(marketProducts)
      .where(and(eq(marketProducts.customerId, customerId), eq(marketProducts.productId, id)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'Məhsul tapılmadı' });
    const previous = existing.payload as Record<string, unknown>;
    const product = {
      ...namedProduct({
        ...body,
        id,
        createdAt: Number(previous.createdAt) || Date.now(),
        costMinor: body.costMinor ?? (Number(previous.costMinor) || 0),
        active: true,
      }, asProductImage(previous.image)),
      ...(body.warehouseStock && Object.keys(body.warehouseStock).length
        ? { warehouseStock: body.warehouseStock }
        : {}),
    };
    const now = new Date();
    const logicalAt = Date.now();
    const warehouseStock = body.warehouseStock ?? {};
    await app.db.transaction(async (tx) => {
      await ensureWarehouses(tx as never, customerId, Object.keys(warehouseStock), now, logicalAt);
      await tx.execute(sql`
        INSERT INTO market_products(customer_id,product_id,payload,logical_at,origin_device_id,updated_at)
        VALUES (${customerId},${id},${JSON.stringify(product)}::jsonb,${logicalAt},${SERVER_ORIGIN_DEVICE_ID}::uuid,${now.toISOString()}::timestamptz)
        ON CONFLICT(customer_id,product_id) DO UPDATE SET payload=EXCLUDED.payload,logical_at=EXCLUDED.logical_at,origin_device_id=EXCLUDED.origin_device_id,updated_at=EXCLUDED.updated_at
      `);
      await enqueueServerEvent(tx as never, customerId, 'product.upsert', { product, logicalAt });
      for (const [warehouseId, qty] of Object.entries(warehouseStock)) {
        const amount = Math.trunc(Number(qty) || 0);
        await tx
          .insert(marketStockBalances)
          .values({ customerId, productId: id, warehouseId, qty: amount, updatedAt: now })
          .onConflictDoUpdate({
            target: [marketStockBalances.customerId, marketStockBalances.productId, marketStockBalances.warehouseId],
            set: { qty: amount, updatedAt: now },
          });
        await enqueueServerEvent(tx as never, customerId, 'stock.snapshot', {
          productId: id,
          warehouseId,
          qty: amount,
          logicalAt,
        });
      }
    });
    return { ok: true, product };
  });

  app.delete(
    '/owner/market/products/:id',
    { config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } },
    async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const customerId = identity.id;
    const body = parseBody(OwnerDeleteProductSchema, req.body ?? {}, reply);
    if (!body) return;
    const [owner] = await app.db
      .select({ passwordHash: customers.passwordHash })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!owner?.passwordHash || !(await verifyPassword(owner.passwordHash, body.password))) {
      return reply.code(400).send({
        error: 'Şifrə düzgün deyil.',
        code: 'CURRENT_PASSWORD_INVALID',
      });
    }
    const { id } = req.params as { id: string };
    const [existing] = await app.db
      .select()
      .from(marketProducts)
      .where(and(eq(marketProducts.customerId, customerId), eq(marketProducts.productId, id)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'Məhsul tapılmadı' });
    const previous = existing.payload as Record<string, any>;
    const product = namedProduct({
      id,
      name: previous.name ?? id,
      sku: String(previous.sku ?? id),
      barcode: String(previous.barcode ?? ''),
      priceMinor: Number(previous.priceMinor) || 0,
      costMinor: Number(previous.costMinor) || 0,
      minStock: Number(previous.minStock) || 0,
      unit: String(previous.unit ?? 'əd'),
      category: String(previous.category ?? ''),
      active: false,
      createdAt: Number(previous.createdAt) || Date.now(),
    }, asProductImage(previous.image));
    const now = new Date();
    const logicalAt = Date.now();
    await app.db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO market_products(customer_id,product_id,payload,logical_at,origin_device_id,updated_at)
        VALUES (${customerId},${id},${JSON.stringify(product)}::jsonb,${logicalAt},${SERVER_ORIGIN_DEVICE_ID}::uuid,${now.toISOString()}::timestamptz)
        ON CONFLICT(customer_id,product_id) DO UPDATE SET payload=EXCLUDED.payload,logical_at=EXCLUDED.logical_at,origin_device_id=EXCLUDED.origin_device_id,updated_at=EXCLUDED.updated_at
      `);
      await enqueueServerEvent(tx as never, customerId, 'product.upsert', { product, logicalAt });
    });
    await writeAudit(app, {
      actorCustomerId: customerId,
      action: 'market.product.delete',
      entityType: 'market_product',
      entityId: id,
      ip: clientIp(req),
    });
    return { ok: true, product };
  });

  app.post(
    '/owner/market/products/:id/image',
    { config: { rateLimit: { max: 40, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const customerId = resolveOwnerCustomerId(req, reply);
      if (!customerId) return;
      const { id } = req.params as { id: string };
      const [existing] = await app.db
        .select()
        .from(marketProducts)
        .where(and(eq(marketProducts.customerId, customerId), eq(marketProducts.productId, id)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Məhsul tapılmadı' });

      const part = await req.file({
        limits: { files: 1, fileSize: MAX_MARKET_IMAGE_BYTES, fields: 0 },
      });
      if (!part) return reply.code(400).send({ error: 'Şəkil faylı seçin.' });
      if (!isAllowedMarketImageMime(part.mimetype || '')) {
        return reply.code(400).send({ error: 'Yalnız şəkil faylı yükləyin.' });
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of part.file) {
        total += chunk.length;
        if (total > MAX_MARKET_IMAGE_BYTES) {
          return reply.code(400).send({ error: 'Şəkil 8 MB-dan böyük ola bilməz.' });
        }
        chunks.push(chunk);
      }

      const raw = Buffer.concat(chunks);
      let webp: Buffer;
      let display: Buffer;
      try {
        webp = await encodeMarketCatalogWebp(raw);
        display = await encodeMarketCatalogDisplay(raw);
      } catch {
        return reply.code(400).send({ error: 'Şəkil emal edilə bilmədi.' });
      }

      const storedName = await saveMarketCatalogWebp(webp);
      const imageUrl = marketCatalogPublicUrl(storedName);
      const previous = existing.payload as Record<string, unknown>;
      const product = namedProduct(
        {
          id,
          name: (previous.name as string | { az: string }) ?? id,
          sku: String(previous.sku ?? id),
          barcode: String(previous.barcode ?? ''),
          priceMinor: Number(previous.priceMinor) || 0,
          costMinor: Number(previous.costMinor) || 0,
          minStock: Number(previous.minStock) || 0,
          unit: String(previous.unit ?? 'əd'),
          category: String(previous.category ?? ''),
          active: previous.active !== false,
          createdAt: Number(previous.createdAt) || Date.now(),
        },
        { kind: 'url', url: marketCatalogDataUrl(display), remoteUrl: imageUrl },
      );
      const now = new Date();
      const logicalAt = Date.now();
      await app.db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO market_products(customer_id,product_id,payload,logical_at,origin_device_id,updated_at)
          VALUES (${customerId},${id},${JSON.stringify(product)}::jsonb,${logicalAt},${SERVER_ORIGIN_DEVICE_ID}::uuid,${now.toISOString()}::timestamptz)
          ON CONFLICT(customer_id,product_id) DO UPDATE SET payload=EXCLUDED.payload,logical_at=EXCLUDED.logical_at,origin_device_id=EXCLUDED.origin_device_id,updated_at=EXCLUDED.updated_at
        `);
        await enqueueServerEvent(tx as never, customerId, 'product.upsert', { product, logicalAt });
      });
      return {
        ok: true,
        product: { ...product, image: { kind: 'url', url: imageUrl, remoteUrl: imageUrl } },
        imageUrl,
      };
    },
  );

  app.post('/owner/market/products/:id/stock', async (req, reply) => {
    const customerId = resolveOwnerCustomerId(req, reply);
    if (!customerId) return;
    const { id } = req.params as { id: string };
    const body = parseBody(OwnerStockAdjustSchema, req.body ?? {}, reply);
    if (!body) return;
    const [existing] = await app.db
      .select()
      .from(marketProducts)
      .where(and(eq(marketProducts.customerId, customerId), eq(marketProducts.productId, id)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: 'Məhsul tapılmadı' });

    const central = await readCentralInventory(app, customerId);
    const warehouses = central.warehouses as Array<{ id: string; code?: string; name?: string }>;
    const floor =
      warehouses.find(
        (warehouse) =>
          warehouse.id === 'wh-sales' ||
          warehouse.code === 'ZAL-01' ||
          /satış|zal|sales/i.test(String(warehouse.name ?? warehouse.code ?? '')),
      ) ?? warehouses[0];
    const warehouseId = body.warehouseId || floor?.id || 'wh-sales';
    const now = new Date();
    const logicalAt = Date.now();

    const result = await app.db.transaction(async (tx) => {
      await ensureWarehouses(tx as never, customerId, [warehouseId], now, logicalAt);
      const [balance] = await tx
        .select()
        .from(marketStockBalances)
        .where(
          and(
            eq(marketStockBalances.customerId, customerId),
            eq(marketStockBalances.productId, id),
            eq(marketStockBalances.warehouseId, warehouseId),
          ),
        )
        .limit(1);
      const current = Number(balance?.qty) || 0;
      const next = Math.max(0, current + body.delta);
      const applied = next - current;
      if (applied === 0) return { qty: current, applied: 0, warehouseId };
      await tx
        .insert(marketStockBalances)
        .values({ customerId, productId: id, warehouseId, qty: next, updatedAt: now })
        .onConflictDoUpdate({
          target: [marketStockBalances.customerId, marketStockBalances.productId, marketStockBalances.warehouseId],
          set: { qty: next, updatedAt: now },
        });
      await enqueueServerEvent(tx as never, customerId, 'stock.movement', {
        productId: id,
        warehouseId,
        qtyDelta: applied,
        type: 'ADJUST',
        refType: 'owner',
        refId: 'owner-panel',
        actorId: 'owner',
        note: 'Sahibkar paneli',
      });
      return { qty: next, applied, warehouseId };
    });

    if (result.applied === 0) {
      return reply.code(400).send({ error: 'Stok 0-dan aşağı düşə bilməz' });
    }
    return { ok: true, ...result };
  });

  app.post('/owner/market/commands', async (req, reply) => {
    const customerId = resolveOwnerCustomerId(req, reply);
    if (!customerId) return;
    const body = parseBody(OwnerCommandSchema, req.body ?? {}, reply);
    if (!body) return;
    const [row] = await app.db
      .insert(marketPosCommands)
      .values({
        customerId,
        deviceId: body.deviceId ?? null,
        kind: body.kind,
        payload: {
          actualCashMinor: body.actualCashMinor ?? null,
        },
      })
      .returning();
    return reply.code(202).send({
      ok: true,
      command: {
        id: row!.id,
        kind: row!.kind,
        status: row!.status,
        createdAt: row!.createdAt.toISOString(),
      },
    });
  });

  app.get('/owner/market/commands', async (req, reply) => {
    const customerId = resolveOwnerCustomerId(req, reply);
    if (!customerId) return;
    const rows = await app.db
      .select()
      .from(marketPosCommands)
      .where(eq(marketPosCommands.customerId, customerId))
      .orderBy(desc(marketPosCommands.createdAt))
      .limit(30);
    return {
      commands: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        deviceId: row.deviceId,
        payload: row.payload,
        result: row.result,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post('/market-pos/commands/:id/result', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CommandResultSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed' });
    }
    const proof = (req.body ?? {}) as { deviceId?: string; deviceFingerprint?: string };
    if (!proof.deviceId || !proof.deviceFingerprint) {
      return reply.code(401).send({ error: 'Device authentication failed' });
    }
    const [device] = await app.db.select().from(devices).where(eq(devices.id, proof.deviceId)).limit(1);
    if (!device || !secretsMatch(device.deviceFingerprint, proof.deviceFingerprint)) {
      return reply.code(401).send({ error: 'Device authentication failed' });
    }
    const now = new Date();
    const [row] = await app.db
      .update(marketPosCommands)
      .set({
        status: parsed.data.status,
        result: parsed.data.result ?? null,
        error: parsed.data.error ?? null,
        completedAt: now,
      })
      .where(and(eq(marketPosCommands.id, id), eq(marketPosCommands.deviceId, device.id)))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Command not found' });
    return { ok: true, status: row.status };
  });

  app.post('/market-pos/sync/exchange', {
    bodyLimit: 8 * 1024 * 1024,
    config: { rateLimit: { max: 180, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(MarketSyncExchangeSchema, req.body ?? {}, reply);
    if (!body) return;
    const [device] = await app.db.select().from(devices).where(eq(devices.id, body.deviceId)).limit(1);
    if (!device || device.status === 'revoked' || !secretsMatch(device.deviceFingerprint, body.deviceFingerprint)) {
      return reply.code(401).send({ error: 'Device authentication failed' });
    }
    if (!device.devicePublicKey || !verifySyncProof(device.devicePublicKey, body)) {
      return reply.code(401).send({ error: 'Device proof failed' });
    }
    const [license] = await app.db.select().from(licenses).where(eq(licenses.id, device.licenseId)).limit(1);
    if (!license || license.status !== 'active' || (license.validUntil && license.validUntil < new Date())) {
      return reply.code(403).send({ error: 'License inactive or expired' });
    }
    const licensedDevices = await app.db.select({ id: devices.id }).from(devices).where(eq(devices.licenseId, license.id));
    const allowedOrigins = new Set(licensedDevices.map((row) => row.id));
    if (body.events.some((event) => !allowedOrigins.has(event.originDeviceId))) {
      return reply.code(403).send({ error: 'Event origin is not licensed for this customer' });
    }
    const now = new Date();
    // Raw sql`` templates below bypass Drizzle's column mapping, and postgres.js
    // refuses to bind a Date object directly. Typed .insert() calls are fine.
    const nowIso = now.toISOString();
    const accepted: string[] = [];
    await app.db.transaction(async (tx) => {
      for (const event of body.events) {
        const [inserted] = await tx.insert(marketSyncEvents).values({
          customerId: license.customerId, eventId: event.eventId, originDeviceId: event.originDeviceId,
          originSeq: event.originSeq, kind: event.kind, payload: event.payload,
          createdAt: new Date(event.createdAt), receivedAt: now,
        }).onConflictDoNothing().returning({ eventId: marketSyncEvents.eventId });
        if (!inserted) {
          const [existing] = await tx.select({ eventId: marketSyncEvents.eventId }).from(marketSyncEvents)
            .where(and(eq(marketSyncEvents.customerId, license.customerId), eq(marketSyncEvents.eventId, event.eventId))).limit(1);
          if (existing) accepted.push(event.eventId);
          continue;
        }
        accepted.push(event.eventId);
        if (event.kind === 'stock.movement') {
          const productId = String(event.payload.productId ?? '');
          const warehouseId = String(event.payload.warehouseId ?? '');
          const delta = Number(event.payload.qtyDelta);
          if (!productId || !warehouseId || !Number.isSafeInteger(delta)) throw new Error('Invalid stock movement');
          await tx.insert(marketStockBalances).values({ customerId: license.customerId, productId, warehouseId, qty: delta, updatedAt: now })
            .onConflictDoUpdate({ target: [marketStockBalances.customerId, marketStockBalances.productId, marketStockBalances.warehouseId], set: { qty: sql`${marketStockBalances.qty} + ${delta}`, updatedAt: now } });
        } else if (event.kind === 'stock.snapshot') {
          // Absolute, not a delta: the till is stating what it actually holds.
          const productId = String(event.payload.productId ?? '');
          const warehouseId = String(event.payload.warehouseId ?? '');
          const qty = Number(event.payload.qty);
          if (!productId || !warehouseId || !Number.isSafeInteger(qty)) throw new Error('Invalid stock snapshot');
          await tx.insert(marketStockBalances).values({ customerId: license.customerId, productId, warehouseId, qty, updatedAt: now })
            .onConflictDoUpdate({ target: [marketStockBalances.customerId, marketStockBalances.productId, marketStockBalances.warehouseId], set: { qty, updatedAt: now } });
        } else if (event.kind === 'product.upsert') {
          const product = event.payload.product as Record<string, unknown> | undefined;
          const productId = String(product?.id ?? '');
          const logicalAt = Number(event.payload.logicalAt ?? event.createdAt);
          if (!productId || !Number.isSafeInteger(logicalAt)) throw new Error('Invalid product event');
          await tx.execute(sql`
            INSERT INTO market_products(customer_id,product_id,payload,logical_at,origin_device_id,updated_at)
            VALUES (${license.customerId},${productId},${JSON.stringify(product)}::jsonb,${logicalAt},${event.originDeviceId},${nowIso}::timestamptz)
            ON CONFLICT(customer_id,product_id) DO UPDATE SET payload=EXCLUDED.payload,logical_at=EXCLUDED.logical_at,origin_device_id=EXCLUDED.origin_device_id,updated_at=EXCLUDED.updated_at
            WHERE EXCLUDED.logical_at > market_products.logical_at OR (EXCLUDED.logical_at = market_products.logical_at AND EXCLUDED.origin_device_id::text > market_products.origin_device_id::text)
          `);
        } else if (event.kind === 'warehouse.upsert') {
          const warehouse = event.payload.warehouse as Record<string, unknown> | undefined;
          const warehouseId = String(warehouse?.id ?? '');
          const logicalAt = Number(event.payload.logicalAt ?? event.createdAt);
          if (!warehouseId || !Number.isSafeInteger(logicalAt)) throw new Error('Invalid warehouse event');
          await tx.execute(sql`
            INSERT INTO market_warehouses(customer_id,warehouse_id,payload,logical_at,origin_device_id,updated_at)
            VALUES (${license.customerId},${warehouseId},${JSON.stringify(warehouse)}::jsonb,${logicalAt},${event.originDeviceId},${nowIso}::timestamptz)
            ON CONFLICT(customer_id,warehouse_id) DO UPDATE SET payload=EXCLUDED.payload,logical_at=EXCLUDED.logical_at,origin_device_id=EXCLUDED.origin_device_id,updated_at=EXCLUDED.updated_at
            WHERE EXCLUDED.logical_at > market_warehouses.logical_at OR (EXCLUDED.logical_at = market_warehouses.logical_at AND EXCLUDED.origin_device_id::text > market_warehouses.origin_device_id::text)
          `);
        }
      }
      await tx.insert(marketDeviceVectors).values({ customerId: license.customerId, deviceId: device.id, vector: body.vector, updatedAt: now })
        .onConflictDoUpdate({ target: [marketDeviceVectors.customerId, marketDeviceVectors.deviceId], set: { vector: body.vector, updatedAt: now } });
      // A till's initial stock broadcast. It used to arrive as a delta
      // (`stock.movement` tagged BOOTSTRAP); it is now an absolute
      // `stock.snapshot`, because two tills seeded from the same catalog each
      // applied the other's delta and doubled the stock. Both shapes are
      // accepted so a till on either build can complete the handshake —
      // matching only the old one left bootstrapCompletedAt null forever, and
      // the tills then refused to let cashiers sign in.
      const hasBootstrap = body.events.some(
        (event) =>
          (event.kind === 'stock.movement' && event.payload.type === 'BOOTSTRAP') ||
          (event.kind === 'stock.snapshot' && event.payload.refType === 'bootstrap'),
      );
      await tx.insert(marketSyncState).values({ customerId: license.customerId, bootstrapDeviceId: hasBootstrap ? device.id : null, bootstrapCompletedAt: hasBootstrap ? now : null, catalogRevision: body.events.length, updatedAt: now })
        .onConflictDoUpdate({ target: marketSyncState.customerId, set: { catalogRevision: sql`${marketSyncState.catalogRevision} + ${body.events.length}`, updatedAt: now, ...(hasBootstrap ? { bootstrapDeviceId: device.id, bootstrapCompletedAt: now } : {}) } });
    });
    // A shop can have several tills. Another branch under the same email is
    // remotely manageable, but its stock/catalog events must not change this shop.
    const peers = await app.db.select({id:devices.id,branchId:devices.branchId})
      .from(devices).innerJoin(licenses,eq(licenses.id,devices.licenseId))
      .where(and(eq(licenses.customerId,license.customerId),eq(licenses.status,'active'),
        or(isNull(licenses.validUntil),sql`${licenses.validUntil}>now()`),sql`${devices.status}<>'revoked'`));
    const {origins,multipleBranches}=marketBranchScope(peers,device.branchId,SERVER_ORIGIN_DEVICE_ID);
    const all = await app.db.select().from(marketSyncEvents)
      .where(and(eq(marketSyncEvents.customerId,license.customerId),inArray(marketSyncEvents.originDeviceId,origins),
        sql`${marketSyncEvents.originSeq}>COALESCE((${JSON.stringify(body.vector)}::jsonb->>${marketSyncEvents.originDeviceId}::text)::bigint,0)`,
        multipleBranches ? sql`NOT (${marketSyncEvents.originDeviceId}=${SERVER_ORIGIN_DEVICE_ID} AND ${marketSyncEvents.kind} LIKE 'stock.%' AND COALESCE(${marketSyncEvents.payload}->>'targetDeviceId','')<>${device.id} AND COALESCE(${marketSyncEvents.payload}->>'branchId','')<>${device.branchId})` : sql`true`))
      .orderBy(marketSyncEvents.receivedAt,marketSyncEvents.originSeq).limit(5000);
    const visible=all.filter(event=>marketBranchEventVisible(event,multipleBranches,SERVER_ORIGIN_DEVICE_ID,device));
    const events = visible.filter((event) => event.originSeq > Number(body.vector[event.originDeviceId] ?? 0)).map((event) => ({
      eventId: event.eventId, originDeviceId: event.originDeviceId, originSeq: event.originSeq, kind: event.kind,
      payload: event.payload, createdAt: event.createdAt.getTime(),
    }));
    const balances = await app.db.select().from(marketStockBalances).where(eq(marketStockBalances.customerId, license.customerId));
    const [state] = await app.db.select().from(marketSyncState).where(eq(marketSyncState.customerId, license.customerId)).limit(1);
    const serverVector = visible.reduce<Record<string, number>>((vector, event) => {
      vector[event.originDeviceId] = Math.max(vector[event.originDeviceId] ?? 0, event.originSeq); return vector;
    }, {...body.vector});
    const commands = await claimPendingCommands(app, license.customerId, device.id);
    const [branch]=device.branchId?await app.db.select({name:branches.name}).from(branches).where(and(eq(branches.id,device.branchId),eq(branches.customerId,license.customerId))).limit(1):[];
    return { ok: true, branchId:device.branchId,branchName:branch?.name||null,acceptedEventIds: accepted, events, serverVector, commands,
      balances: (multipleBranches ? [] : balances).map((row) => ({ productId: row.productId, warehouseId: row.warehouseId, qty: row.qty, updatedAt: row.updatedAt.getTime() })),
      bootstrapRequired: !state?.bootstrapCompletedAt, catalogRevision: state?.catalogRevision ?? 0, updatedAt: now.toISOString() };
  });

  /**
   * Device auth for the market till, the same three checks the heartbeat makes:
   * the device exists and is not revoked, the fingerprint matches, and a
   * proof-required device presents a valid Ed25519 signature.
   *
   * ponytail: heartbeat and command-result still inline these checks. Route them
   * through here too when one of them next needs touching.
   */
  const authenticateMarketDevice = async (
    body: { deviceId: string; deviceFingerprint: string } & Record<string, unknown>,
    reply: FastifyReply,
  ): Promise<{ customerId: string; deviceId: string } | null> => {
    const [device] = await app.db
      .select()
      .from(devices)
      .where(eq(devices.id, body.deviceId))
      .limit(1);
    if (
      !device ||
      device.status === 'revoked' ||
      !secretsMatch(device.deviceFingerprint, body.deviceFingerprint)
    ) {
      reply.code(401).send({ error: 'Device authentication failed' });
      return null;
    }
    if (
      device.heartbeatAuthRequired &&
      (!device.devicePublicKey || !verifyMarketDeviceProof(device.devicePublicKey, body))
    ) {
      reply.code(401).send({ error: 'Device proof failed' });
      return null;
    }
    const [license] = await app.db
      .select({ customerId: licenses.customerId, status: licenses.status })
      .from(licenses)
      .where(eq(licenses.id, device.licenseId))
      .limit(1);
    if (!license || license.status !== 'active') {
      reply.code(403).send({ error: 'License inactive or expired' });
      return null;
    }
    return { customerId: license.customerId, deviceId: device.id };
  };

  const MarketSupportAuthSchema = z.object({
    deviceId: z.string().uuid(),
    deviceFingerprint: z.string().min(8).max(256),
    appVersion: z.string().max(64).optional(),
    signedAt: z.string().datetime({ offset: true }).optional(),
    nonce: z.string().regex(/^[0-9a-fA-F]{32}$/).optional(),
    deviceSignature: z.string().regex(/^[0-9a-fA-F]{128}$/).optional(),
  });

  /** The cashier asks for help from inside the till. */
  app.post(
    '/market-pos/support/request',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(
        MarketSupportAuthSchema.extend({
          message: z.string().max(4000).optional(),
          // Free-shaped on purpose: the till knows best what is worth reporting,
          // and a rigid schema would silently drop a new field on old servers.
          diagnostics: z.record(z.unknown()).optional(),
        }),
        req.body ?? {},
        reply,
      );
      if (!body) return;
      const auth = await authenticateMarketDevice(body, reply);
      if (!auth) return;

      const { ticket, message, created } = await openSupportRequest(
        app,
        auth.customerId,
        auth.deviceId,
        body.message?.trim() || 'Market POS-dan dəstək sorğusu',
        'market_pos',
        body.diagnostics,
      );
      return reply.code(created ? 201 : 200).send({
        ok: true,
        ticketId: ticket.id,
        messageId: message.id,
        created,
      });
    },
  );

  /**
   * The staff role policy for this shop, as the website has it.
   *
   * Polled on the heartbeat. What comes back is already narrowed to what
   * POSSISTEM sold this customer, so a permission the shop was not sold cannot
   * be granted by editing roles in their own portal.
   *
   * 'market' is fixed here rather than taken from the body: the two tills check
   * different permission vocabularies, and a device must not be able to ask for
   * the other product's policy.
   */
  app.post(
    '/market-pos/roles',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(MarketSupportAuthSchema, req.body ?? {}, reply);
      if (!body) return;
      const auth = await authenticateMarketDevice(body, reply);
      if (!auth) return;
      return { ok: true, ...(await effectiveRolePolicy(app, auth.customerId, 'market')) };
    },
  );

  /** The till fetches a file support attached to its own ticket. */
  app.post(
    '/market-pos/support/attachment',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(
        MarketSupportAuthSchema.extend({ attachmentId: z.string().uuid() }),
        req.body ?? {},
        reply,
      );
      if (!body) return;
      const auth = await authenticateMarketDevice(body, reply);
      if (!auth) return;
      return sendSupportAttachmentForCustomer(app, reply, body.attachmentId, auth.customerId);
    },
  );

  /** ...and reads the answer, so support is a conversation rather than a shout. */
  app.post(
    '/market-pos/support/active',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(
        MarketSupportAuthSchema.extend({ after: z.string().datetime().optional() }),
        req.body ?? {},
        reply,
      );
      if (!body) return;
      const auth = await authenticateMarketDevice(body, reply);
      if (!auth) return;

      const ticket = await getActiveChatTicket(app, auth.customerId);
      if (!ticket) return { ok: true, ticket: null, messages: [] };
      const after = body.after ? new Date(body.after) : undefined;
      const messages = await getTicketMessages(
        app,
        ticket.id,
        after && !Number.isNaN(after.getTime()) ? after : undefined,
      );
      return { ok: true, ticket: serializeTicket(ticket), messages };
    },
  );

  app.post(
    '/market-pos/heartbeat',
    {
      bodyLimit: 4 * 1024 * 1024,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const body = parseBody(MarketHeartbeatSchema, req.body ?? {}, reply);
      if (!body) return;

      const [device] = await app.db
        .select()
        .from(devices)
        .where(eq(devices.id, body.deviceId))
        .limit(1);
      if (
        !device ||
        device.status === 'revoked' ||
        !secretsMatch(device.deviceFingerprint, body.deviceFingerprint)
      ) {
        return reply.code(401).send({ error: 'Device authentication failed' });
      }

      if (
        device.heartbeatAuthRequired &&
        (!device.devicePublicKey || !verifyMarketProof(device.devicePublicKey, signedHeartbeatDocument(body,req.body)))
      ) {
        app.log.warn({ deviceId: body.deviceId }, 'market_heartbeat_bad_signature');
        return reply.code(401).send({ error: 'Device proof failed' });
      }

      const [license] = await app.db
        .select()
        .from(licenses)
        .where(eq(licenses.id, device.licenseId))
        .limit(1);
      if (
        !license ||
        license.status !== 'active' ||
        (license.validUntil && license.validUntil < new Date())
      ) {
        return reply.code(403).send({ error: 'License inactive or expired' });
      }

      const now = new Date();
      const [deviceRegister] = await app.db
        .select({
          registerName: marketDevices.registerName,
          registerNameUpdatedAt: marketDevices.registerNameUpdatedAt,
        })
        .from(marketDevices)
        .where(eq(marketDevices.id, device.id))
        .limit(1);
      const incomingNameAt = new Date(body.snapshot.terminalNameUpdatedAt ?? 0);
      const serverNameAt = deviceRegister?.registerNameUpdatedAt ?? new Date(0);
      let terminalName = deviceRegister?.registerName || body.snapshot.terminalName;
      let terminalNameUpdatedAt = serverNameAt;
      const incomingNameWins = Boolean(
        body.snapshot.terminalName && incomingNameAt > serverNameAt,
      );
      if (incomingNameWins) {
        terminalName = body.snapshot.terminalName;
        terminalNameUpdatedAt = incomingNameAt;
      }
      const where = device.heartbeatAuthRequired
        ? and(
            eq(devices.id, device.id),
            sql`${devices.lastHeartbeatNonce} IS DISTINCT FROM ${body.nonce ?? null}`,
          )
        : eq(devices.id, device.id);
      const [touched] = await app.db
        .update(devices)
        .set({
          lastSeenAt: now,
          updatedAt: now,
          appVersion: body.appVersion ?? device.appVersion,
          status: 'active',
          ...(device.heartbeatAuthRequired
            ? {
                lastHeartbeatNonce: body.nonce ?? null,
                lastHeartbeatSignedAt: body.signedAt ? new Date(body.signedAt) : null,
              }
            : {}),
        })
        .where(where)
        .returning({ id: devices.id });
      if (!touched) return reply.code(409).send({ error: 'Heartbeat replay rejected' });
      if (incomingNameWins) {
        await app.db
          .update(marketDevices)
          .set({ registerName: terminalName, registerNameUpdatedAt: terminalNameUpdatedAt })
          .where(eq(marketDevices.id, device.id));
      }

      const [previousSnapshot] = await app.db
        .select({ payload: marketPosSnapshots.payload })
        .from(marketPosSnapshots)
        .where(eq(marketPosSnapshots.deviceId, device.id))
        .limit(1);
      const storedSnapshot = {
        ...((previousSnapshot?.payload ?? {}) as Record<string, unknown>),
        ...body.snapshot,
        terminalName,
        terminalNameUpdatedAt: terminalNameUpdatedAt.getTime(),
      };

      await app.db
        .insert(marketPosSnapshots)
        .values({
          deviceId: device.id,
          customerId: license.customerId,
          appVersion: body.appVersion ?? null,
          dailySalesMinor: body.snapshot.dailySalesMinor,
          transactionCount: body.snapshot.transactionCount,
          openRegisters: body.snapshot.openRegisters,
          criticalStock: body.snapshot.criticalStock,
          payload: storedSnapshot,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: marketPosSnapshots.deviceId,
          set: {
            customerId: license.customerId,
            appVersion: body.appVersion ?? null,
            dailySalesMinor: body.snapshot.dailySalesMinor,
            transactionCount: body.snapshot.transactionCount,
            openRegisters: body.snapshot.openRegisters,
            criticalStock: body.snapshot.criticalStock,
            payload: storedSnapshot,
            updatedAt: now,
          },
        });

      const [config] = await app.db
        .select()
        .from(marketPosCustomerConfig)
        .where(eq(marketPosCustomerConfig.customerId, license.customerId))
        .limit(1);
      const commands = await claimPendingCommands(app, license.customerId, device.id);
      return {
        ok: true,
        connected: true,
        updatedAt: now.toISOString(),
        config: {
          loyaltyRateBps: config?.loyaltyRateBps ?? 0,
          terminalName,
          terminalNameUpdatedAt: terminalNameUpdatedAt.getTime(),
        },
        commands,
        access: await marketSurfaceAccess(app, license.customerId, 'market').catch(() => null),
        device: await marketDeviceStation(app, license.customerId, device.id, null).catch(() => null),
      };
    },
  );
}
