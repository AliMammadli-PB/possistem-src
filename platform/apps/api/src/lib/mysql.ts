import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { env } from '../env.js';
import { ensureLiveSchema } from './mysql-schema.js';

let pool: mysql.Pool | null = null;

export function mysqlEnabled(): boolean {
  return Boolean(env.mysqlUrl);
}

function getPool(): mysql.Pool | null {
  if (!env.mysqlUrl) return null;
  if (!pool) {
    pool = mysql.createPool(env.mysqlUrl);
  }
  return pool;
}

/** Applies the live schema once; called from the API bootstrap. */
export async function initLiveSchema(log?: {
  info: (o: unknown, m: string) => void;
  warn: (o: unknown, m: string) => void;
}): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  return ensureLiveSchema(p, log);
}

/** Splits a bulk upsert so one restaurant's whole menu never blows the placeholder limit. */
function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export type FloorLiveRow = {
  customer_id: string;
  device_id: string | null;
  open_tables: number;
  open_total_minor: number;
  today_sales_minor: number;
  today_paid_minor: number;
  payment_count: number;
  business_date: string | null;
  payload: unknown;
  updated_at: Date;
};

export type DeviceStatusRow = {
  customer_id: string;
  device_id: string | null;
  connected: number;
  app_version: string | null;
  restaurant_name: string | null;
  last_error: string | null;
  last_seen_at: Date;
  updated_at: Date;
};

export async function upsertFloorLive(input: {
  customerId: string;
  deviceId: string;
  openTables: number;
  openTotalMinor: number;
  todaySalesMinor: number;
  todayPaidMinor: number;
  paymentCount: number;
  businessDate: string | null;
  payload: unknown;
}): Promise<void> {
  const p = getPool();
  if (!p) return;
  const now = new Date();
  // MariaDB prepared statements reject CAST(? AS JSON); JSON column accepts text.
  await p.execute(
    `INSERT INTO floor_live (
      customer_id, device_id, open_tables, open_total_minor, today_sales_minor,
      today_paid_minor, payment_count, business_date, payload, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      device_id = VALUES(device_id),
      open_tables = VALUES(open_tables),
      open_total_minor = VALUES(open_total_minor),
      today_sales_minor = VALUES(today_sales_minor),
      today_paid_minor = VALUES(today_paid_minor),
      payment_count = VALUES(payment_count),
      business_date = VALUES(business_date),
      payload = VALUES(payload),
      updated_at = VALUES(updated_at)`,
    [
      input.customerId,
      input.deviceId,
      input.openTables,
      input.openTotalMinor,
      input.todaySalesMinor,
      input.todayPaidMinor,
      input.paymentCount,
      input.businessDate,
      JSON.stringify(input.payload ?? {}),
      now,
    ],
  );
}

export async function upsertDeviceStatus(input: {
  customerId: string;
  deviceId: string;
  connected: boolean;
  appVersion?: string | null;
  restaurantName?: string | null;
  lastError?: string | null;
}): Promise<void> {
  const p = getPool();
  if (!p) return;
  const now = new Date();
  await p.execute(
    `INSERT INTO device_status (
      customer_id, device_id, connected, app_version, restaurant_name, last_error, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      device_id = VALUES(device_id),
      connected = VALUES(connected),
      app_version = COALESCE(VALUES(app_version), app_version),
      restaurant_name = COALESCE(VALUES(restaurant_name), restaurant_name),
      last_error = VALUES(last_error),
      last_seen_at = VALUES(last_seen_at),
      updated_at = VALUES(updated_at)`,
    [
      input.customerId,
      input.deviceId,
      input.connected ? 1 : 0,
      input.appVersion ?? null,
      input.restaurantName ?? null,
      input.lastError ?? null,
      now,
      now,
    ],
  );
}

export async function getFloorLive(customerId: string): Promise<FloorLiveRow | null> {
  const p = getPool();
  if (!p) return null;
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    'SELECT * FROM floor_live WHERE customer_id = ? LIMIT 1',
    [customerId],
  );
  return (rows[0] as FloorLiveRow | undefined) ?? null;
}

export async function getDeviceStatus(customerId: string): Promise<DeviceStatusRow | null> {
  const p = getPool();
  if (!p) return null;
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    'SELECT * FROM device_status WHERE customer_id = ? LIMIT 1',
    [customerId],
  );
  return (rows[0] as DeviceStatusRow | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Live mirror — the till writes, the WhatsApp bot reads. Every value the bot
// can be asked about lives here, so a question never has to reach the POS.
// ---------------------------------------------------------------------------

export type TableLiveRow = {
  customer_id: string;
  table_id: string;
  label: string;
  area_name: string | null;
  status: string;
  order_id: string | null;
  guest_count: number;
  item_count: number;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  waiter_name: string | null;
  opened_at: string | null;
  updated_at: Date;
};

export type StaffLiveRow = {
  customer_id: string;
  user_id: string;
  code: string | null;
  full_name: string;
  role: string | null;
  shift_id: string | null;
  logged_in: number;
  logged_in_at: Date | null;
  last_seen_at: Date;
};

export type SalesLiveRow = {
  customer_id: string;
  business_date: string | null;
  business_day_id: string | null;
  business_day_status: string | null;
  gross_minor: number;
  net_minor: number;
  paid_minor: number;
  discount_minor: number;
  tax_minor: number;
  service_minor: number;
  tips_minor: number;
  refund_minor: number;
  order_count: number;
  payment_count: number;
  avg_ticket_minor: number;
  cash_minor: number;
  card_minor: number;
  open_tables: number;
  open_total_minor: number;
  updated_at: Date;
};

export type ProductLiveRow = {
  customer_id: string;
  product_id: string;
  name: string;
  category_name: string | null;
  price_minor: number;
  sold_out: number;
  available: number;
  qty_today: number;
  revenue_today_minor: number;
  updated_at: Date;
};

export type ReportLiveRow = {
  customer_id: string;
  kind: string;
  sequence_no: number | null;
  business_date: string | null;
  totals_json: unknown;
  canonical_json: unknown;
  created_at: Date;
};

/** Opens the restaurant's place in the live database the moment it is sold. */
export async function provisionCustomerLive(input: {
  customerId: string;
  name?: string | null;
  phone?: string | null;
  notifyEmail?: string | null;
}): Promise<void> {
  const p = getPool();
  if (!p) return;
  const now = new Date();
  await p.execute(
    `INSERT INTO customer_live (customer_id, name, phone, notify_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = COALESCE(VALUES(name), name),
       phone = COALESCE(VALUES(phone), phone),
       notify_email = COALESCE(VALUES(notify_email), notify_email),
       updated_at = VALUES(updated_at)`,
    [input.customerId, input.name ?? null, input.phone ?? null, input.notifyEmail ?? null, now, now],
  );
  await p.execute(
    `INSERT IGNORE INTO sales_live (customer_id, updated_at) VALUES (?, ?)`,
    [input.customerId, now],
  );
}

export type LiveTableInput = {
  id: string;
  label: string;
  status: string;
  areaName?: string;
  orderId: string | null;
  guestCount?: number;
  itemCount?: number;
  totalMinor: number;
  paidMinor: number;
  waiterName?: string;
  openedAt?: string;
};

/**
 * Mirrors the whole floor.
 *
 * Rows the till no longer reports are deleted rather than left behind: a stale
 * "Masa 7 — 240 AZN" is worse than no answer at all.
 */
export async function replaceTablesLive(
  customerId: string,
  tables: LiveTableInput[],
): Promise<void> {
  const p = getPool();
  if (!p) return;
  const now = new Date();

  for (const batch of chunk(tables, 200)) {
    const values = batch.map((t) => [
      customerId,
      t.id,
      t.label ?? '',
      t.areaName ?? null,
      t.status ?? 'available',
      t.orderId ?? null,
      Math.max(0, Math.trunc(t.guestCount ?? 0)),
      Math.max(0, Math.trunc(t.itemCount ?? 0)),
      Math.trunc(t.totalMinor ?? 0),
      Math.trunc(t.paidMinor ?? 0),
      Math.max(0, Math.trunc((t.totalMinor ?? 0) - (t.paidMinor ?? 0))),
      t.waiterName ?? null,
      t.openedAt ?? null,
      now,
    ]);
    await p.query(
      `INSERT INTO table_live (
        customer_id, table_id, label, area_name, status, order_id, guest_count,
        item_count, total_minor, paid_minor, due_minor, waiter_name, opened_at, updated_at
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        label = VALUES(label), area_name = VALUES(area_name), status = VALUES(status),
        order_id = VALUES(order_id), guest_count = VALUES(guest_count),
        item_count = VALUES(item_count), total_minor = VALUES(total_minor),
        paid_minor = VALUES(paid_minor), due_minor = VALUES(due_minor),
        waiter_name = VALUES(waiter_name), opened_at = VALUES(opened_at),
        updated_at = VALUES(updated_at)`,
      [values],
    );
  }

  if (tables.length === 0) {
    await p.execute('DELETE FROM table_live WHERE customer_id = ?', [customerId]);
    return;
  }
  await p.query('DELETE FROM table_live WHERE customer_id = ? AND table_id NOT IN (?)', [
    customerId,
    tables.map((t) => t.id),
  ]);
}

export type LiveStaffInput = {
  userId: string;
  code?: string;
  fullName: string;
  role?: string;
  shiftId: string | null;
  loggedIn: boolean;
  loggedInAt?: number;
};

export async function replaceStaffLive(
  customerId: string,
  staff: LiveStaffInput[],
): Promise<void> {
  const p = getPool();
  if (!p) return;
  if (staff.length === 0) return;
  const now = new Date();
  for (const batch of chunk(staff, 200)) {
    const values = batch.map((s) => [
      customerId,
      s.userId,
      s.code ?? null,
      s.fullName ?? '',
      s.role ?? null,
      s.shiftId ?? null,
      s.loggedIn ? 1 : 0,
      s.loggedInAt ? new Date(s.loggedInAt) : null,
      now,
    ]);
    await p.query(
      `INSERT INTO staff_live (
        customer_id, user_id, code, full_name, role, shift_id, logged_in, logged_in_at, last_seen_at
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        code = VALUES(code), full_name = VALUES(full_name), role = VALUES(role),
        shift_id = VALUES(shift_id), logged_in = VALUES(logged_in),
        logged_in_at = COALESCE(VALUES(logged_in_at), logged_in_at),
        last_seen_at = VALUES(last_seen_at)`,
      [values],
    );
  }
  await p.query('DELETE FROM staff_live WHERE customer_id = ? AND user_id NOT IN (?)', [
    customerId,
    staff.map((s) => s.userId),
  ]);
}

export type LiveSalesInput = {
  grossMinor: number;
  netMinor: number;
  paidMinor: number;
  discountMinor: number;
  taxMinor: number;
  serviceMinor: number;
  tipsMinor: number;
  refundMinor: number;
  orderCount: number;
  paymentCount: number;
  avgTicketMinor: number;
  cashMinor: number;
  cardMinor: number;
};

/**
 * Writes today's figures.
 *
 * `sales` is optional because a till with nobody signed in cannot read them —
 * the money columns are then left exactly as they were rather than being
 * zeroed, so the bot keeps answering with the last real numbers instead of
 * claiming the restaurant took nothing today.
 */
export async function upsertSalesLive(input: {
  customerId: string;
  businessDate?: string | null;
  businessDayId?: string | null;
  businessDayStatus?: string | null;
  openTables?: number;
  openTotalMinor?: number;
  sales?: LiveSalesInput;
}): Promise<void> {
  const p = getPool();
  if (!p) return;

  if (!input.sales) {
    const hasOpen = input.openTables !== undefined;
    await p.execute(
      `INSERT INTO sales_live (
        customer_id, business_date, business_day_id, business_day_status,
        open_tables, open_total_minor, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        business_date = COALESCE(VALUES(business_date), business_date),
        business_day_id = COALESCE(VALUES(business_day_id), business_day_id),
        business_day_status = COALESCE(VALUES(business_day_status), business_day_status),
        open_tables = IF(?, VALUES(open_tables), open_tables),
        open_total_minor = IF(?, VALUES(open_total_minor), open_total_minor),
        updated_at = VALUES(updated_at)`,
      [
        input.customerId,
        input.businessDate ?? null,
        input.businessDayId ?? null,
        input.businessDayStatus ?? null,
        input.openTables ?? 0,
        input.openTotalMinor ?? 0,
        new Date(),
        hasOpen ? 1 : 0,
        hasOpen ? 1 : 0,
      ],
    );
    return;
  }

  const s = input.sales;
  const hasOpen = input.openTables !== undefined;
  await p.execute(
    `INSERT INTO sales_live (
      customer_id, business_date, business_day_id, business_day_status,
      gross_minor, net_minor, paid_minor, discount_minor, tax_minor, service_minor,
      tips_minor, refund_minor, order_count, payment_count, avg_ticket_minor,
      cash_minor, card_minor, open_tables, open_total_minor, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      business_date = VALUES(business_date), business_day_id = VALUES(business_day_id),
      business_day_status = VALUES(business_day_status),
      gross_minor = VALUES(gross_minor), net_minor = VALUES(net_minor),
      paid_minor = VALUES(paid_minor), discount_minor = VALUES(discount_minor),
      tax_minor = VALUES(tax_minor), service_minor = VALUES(service_minor),
      tips_minor = VALUES(tips_minor), refund_minor = VALUES(refund_minor),
      order_count = VALUES(order_count), payment_count = VALUES(payment_count),
      avg_ticket_minor = VALUES(avg_ticket_minor), cash_minor = VALUES(cash_minor),
      card_minor = VALUES(card_minor),
      open_tables = IF(?, VALUES(open_tables), open_tables),
      open_total_minor = IF(?, VALUES(open_total_minor), open_total_minor),
      updated_at = VALUES(updated_at)`,
    [
      input.customerId,
      input.businessDate ?? null,
      input.businessDayId ?? null,
      input.businessDayStatus ?? null,
      s.grossMinor, s.netMinor, s.paidMinor, s.discountMinor, s.taxMinor, s.serviceMinor,
      s.tipsMinor, s.refundMinor, s.orderCount, s.paymentCount, s.avgTicketMinor,
      s.cashMinor, s.cardMinor, input.openTables ?? 0, input.openTotalMinor ?? 0,
      new Date(),
      hasOpen ? 1 : 0,
      hasOpen ? 1 : 0,
    ],
  );
}

export type LiveProductInput = {
  id: string;
  name: string;
  categoryName?: string;
  priceMinor: number;
  soldOut: boolean;
  available: boolean;
  qtyToday: number;
  revenueTodayMinor: number;
};

export async function replaceProductsLive(
  customerId: string,
  products: LiveProductInput[],
): Promise<void> {
  const p = getPool();
  if (!p) return;
  if (products.length === 0) return;
  const now = new Date();
  for (const batch of chunk(products, 250)) {
    const values = batch.map((x) => [
      customerId,
      x.id,
      x.name ?? '',
      x.categoryName ?? null,
      Math.trunc(x.priceMinor ?? 0),
      x.soldOut ? 1 : 0,
      x.available === false ? 0 : 1,
      Math.max(0, Math.trunc(x.qtyToday ?? 0)),
      Math.max(0, Math.trunc(x.revenueTodayMinor ?? 0)),
      now,
    ]);
    await p.query(
      `INSERT INTO product_live (
        customer_id, product_id, name, category_name, price_minor, sold_out,
        available, qty_today, revenue_today_minor, updated_at
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        name = VALUES(name), category_name = VALUES(category_name),
        price_minor = VALUES(price_minor), sold_out = VALUES(sold_out),
        available = VALUES(available), qty_today = VALUES(qty_today),
        revenue_today_minor = VALUES(revenue_today_minor), updated_at = VALUES(updated_at)`,
      [values],
    );
  }
  await p.query('DELETE FROM product_live WHERE customer_id = ? AND product_id NOT IN (?)', [
    customerId,
    products.map((x) => x.id),
  ]);
}

export async function upsertReportLive(input: {
  customerId: string;
  kind: string;
  sequenceNo?: number;
  businessDate?: string | null;
  totals?: unknown;
  canonical?: unknown;
}): Promise<void> {
  const p = getPool();
  if (!p) return;
  await p.execute(
    `INSERT INTO report_live (
      customer_id, kind, sequence_no, business_date, totals_json, canonical_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      sequence_no = VALUES(sequence_no), business_date = VALUES(business_date),
      totals_json = VALUES(totals_json), canonical_json = VALUES(canonical_json),
      created_at = VALUES(created_at)`,
    [
      input.customerId,
      input.kind,
      input.sequenceNo ?? null,
      input.businessDate ?? null,
      JSON.stringify(input.totals ?? {}),
      JSON.stringify(input.canonical ?? {}),
      new Date(),
    ],
  );
}

// -------------------------------------------------------------- bot readers

/** Tables the bot should talk about: anything with an order or money on it. */
export async function getOpenTablesLive(customerId: string): Promise<TableLiveRow[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM table_live
     WHERE customer_id = ?
       AND (order_id IS NOT NULL OR due_minor > 0 OR status IN ('occupied','billing','ordering','preparing','ready','payment'))
     ORDER BY due_minor DESC, label ASC`,
    [customerId],
  );
  return rows as TableLiveRow[];
}

export async function findTableLive(
  customerId: string,
  needle: string,
  area?: string,
): Promise<TableLiveRow[]> {
  const p = getPool();
  if (!p) return [];
  const trimmed = needle.trim();
  const areaNeedle = area?.trim() || '';
  const areaClause = areaNeedle
    ? ' AND (LOWER(area_name) = LOWER(?) OR LOWER(area_name) LIKE LOWER(?))'
    : '';
  const areaParams = areaNeedle ? [areaNeedle, `${areaNeedle}%`] : [];

  // "masa 1" / "1" should hit "Masa 1" exactly — not Masa 10/11/12 via LIKE '%1%'.
  if (/^\d+$/.test(trimmed)) {
    const label = `Masa ${trimmed}`;
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT * FROM table_live
       WHERE customer_id = ?
         AND (
           label = ? OR LOWER(label) = LOWER(?) OR table_id = ?
           OR table_id = CONCAT('tbl-', LPAD(?, 2, '0'))
         )
         ${areaClause}
       ORDER BY label ASC, area_name ASC
       LIMIT 10`,
      [customerId, label, label, trimmed, trimmed, ...areaParams],
    );
    return rows as TableLiveRow[];
  }

  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM table_live
     WHERE customer_id = ? AND (label = ? OR label LIKE ? OR table_id = ?)
       ${areaClause}
     ORDER BY label ASC, area_name ASC
     LIMIT 10`,
    [customerId, trimmed, `%${trimmed}%`, trimmed, ...areaParams],
  );
  return rows as TableLiveRow[];
}

export async function getSalesLive(customerId: string): Promise<SalesLiveRow | null> {
  const p = getPool();
  if (!p) return null;
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    'SELECT * FROM sales_live WHERE customer_id = ? LIMIT 1',
    [customerId],
  );
  return (rows[0] as SalesLiveRow | undefined) ?? null;
}

export async function getStaffLive(
  customerId: string,
  onlyLoggedIn = false,
): Promise<StaffLiveRow[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM staff_live WHERE customer_id = ?${onlyLoggedIn ? ' AND logged_in = 1' : ''}
     ORDER BY logged_in DESC, full_name ASC`,
    [customerId],
  );
  return rows as StaffLiveRow[];
}

export async function searchProductsLive(
  customerId: string,
  needle: string,
  limit = 10,
): Promise<ProductLiveRow[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM product_live
     WHERE customer_id = ? AND name LIKE ?
     ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END, qty_today DESC, name ASC
     LIMIT ?`,
    [customerId, `%${needle}%`, needle, limit],
  );
  return rows as ProductLiveRow[];
}

export async function getTopProductsLive(
  customerId: string,
  limit = 10,
): Promise<ProductLiveRow[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM product_live WHERE customer_id = ? AND qty_today > 0
     ORDER BY qty_today DESC, revenue_today_minor DESC LIMIT ?`,
    [customerId, limit],
  );
  return rows as ProductLiveRow[];
}

export async function getReportLive(
  customerId: string,
  kind?: string,
): Promise<ReportLiveRow[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT * FROM report_live WHERE customer_id = ?${kind ? ' AND kind = ?' : ''}
     ORDER BY created_at DESC`,
    kind ? [customerId, kind] : [customerId],
  );
  return rows as ReportLiveRow[];
}

// --------------------------------------------------------------- command queue

export type BotCommandRow = {
  id: string;
  customer_id: string;
  command: string;
  args_json: unknown;
  requested_by: string | null;
  status: string;
  result_json: unknown;
  error: string | null;
  error_code: string | null;
  created_at: Date;
  taken_at: Date | null;
  done_at: Date | null;
  expires_at: Date;
};

/** Queues one action for the till. Returns null when the live DB is unavailable. */
export async function enqueueBotCommand(input: {
  customerId: string;
  command: string;
  args?: Record<string, unknown>;
  requestedBy?: string | null;
  ttlMs?: number;
}): Promise<string | null> {
  const p = getPool();
  if (!p) return null;
  const id = randomUUID();
  const now = new Date();
  await p.execute(
    `INSERT INTO bot_commands (
      id, customer_id, command, args_json, requested_by, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      input.customerId,
      input.command,
      JSON.stringify(input.args ?? {}),
      input.requestedBy ?? null,
      now,
      new Date(now.getTime() + (input.ttlMs ?? 120_000)),
    ],
  );
  return id;
}

/**
 * Hands pending work to the till and marks it taken in the same breath.
 *
 * Claiming before delivery means a sync that dies mid-flight loses the command
 * rather than replaying it — for "close the business day" that is the safe
 * direction to fail in.
 */
export async function takeBotCommands(
  customerId: string,
  limit = 5,
  /** The syncing till: a command aimed at another till of the customer stays queued. */
  deviceId?: string,
): Promise<BotCommandRow[]> {
  const p = getPool();
  if (!p) return [];
  const now = new Date();
  await p.execute(
    `UPDATE bot_commands SET status = 'expired', done_at = ?
     WHERE customer_id = ? AND status IN ('pending','taken') AND expires_at < ?`,
    [now, customerId, now],
  );
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    deviceId
      ? `SELECT * FROM bot_commands WHERE customer_id = ? AND status = 'pending'
         AND (JSON_EXTRACT(args_json, '$.deviceId') IS NULL
              OR JSON_UNQUOTE(JSON_EXTRACT(args_json, '$.deviceId')) = ?)
         ORDER BY created_at ASC LIMIT ?`
      : `SELECT * FROM bot_commands WHERE customer_id = ? AND status = 'pending'
         ORDER BY created_at ASC LIMIT ?`,
    deviceId ? [customerId, deviceId, limit] : [customerId, limit],
  );
  const list = rows as BotCommandRow[];
  if (list.length === 0) return [];
  await p.query(
    `UPDATE bot_commands SET status = 'taken', taken_at = ? WHERE id IN (?)`,
    [now, list.map((r) => r.id)],
  );
  return list;
}

export async function completeBotCommand(input: {
  customerId: string;
  commandId: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  const [res] = await p.execute<mysql.ResultSetHeader>(
    `UPDATE bot_commands
     SET status = ?, result_json = ?, error = ?, error_code = ?, done_at = ?
     WHERE id = ? AND customer_id = ? AND status = 'taken'`,
    [
      input.ok ? 'done' : 'failed',
      JSON.stringify(input.result ?? {}),
      input.error ?? null,
      input.errorCode ?? null,
      new Date(),
      input.commandId,
      input.customerId,
    ],
  );
  return res.affectedRows > 0;
}

export async function recentBotCommands(
  customerId: string,
  limit = 10,
): Promise<BotCommandRow[]> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    'SELECT * FROM bot_commands WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?',
    [customerId, limit],
  );
  return rows as BotCommandRow[];
}

/** Every restaurant with a live row — the offline sweep walks this. */
export async function listLiveCustomers(): Promise<
  { customer_id: string; connected: number; last_seen_at: Date; restaurant_name: string | null }[]
> {
  const p = getPool();
  if (!p) return [];
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    'SELECT customer_id, connected, last_seen_at, restaurant_name FROM device_status',
  );
  return rows as { customer_id: string; connected: number; last_seen_at: Date; restaurant_name: string | null }[];
}

/** Treat as online if last heartbeat within this window. */
export function isDeviceOnline(
  lastSeenAt: Date | string | null | undefined,
  connectedFlag: number | boolean = 1,
): boolean {
  if (!lastSeenAt || !connectedFlag) return false;
  const t =
    lastSeenAt instanceof Date ? lastSeenAt.getTime() : new Date(lastSeenAt).getTime();
  if (Number.isNaN(t)) return false;
  // Floor sync is ~15–20s; allow a wider window + mild future skew.
  const delta = Date.now() - t;
  return delta < 180_000 && delta > -120_000;
}
