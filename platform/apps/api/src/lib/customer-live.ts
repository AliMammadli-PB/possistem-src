import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, ne, or,sql } from 'drizzle-orm';
import {
  auditLogs,
  customers,
  devices,
  licenses,
  ownerNotifications,
} from '@milioner/database';
import {
  getDeviceStatus,
  getFloorLive,
  getOpenTablesLive,
  getSalesLive,
  isDeviceOnline,
  listLiveCustomers,
  mysqlEnabled,
  recentBotCommands,
  type TableLiveRow,
} from './mysql.js';
import { licensePosProduct, type PosProduct } from './pos-product.js';

const POSTGRES_FRESH_MS = 5 * 60_000;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function tableRow(row: TableLiveRow) {
  return {
    id: row.table_id,
    label: row.label,
    areaName: row.area_name,
    status: row.status,
    orderId: row.order_id,
    guestCount: row.guest_count,
    itemCount: row.item_count,
    totalMinor: Number(row.total_minor ?? 0),
    paidMinor: Number(row.paid_minor ?? 0),
    dueMinor: Number(row.due_minor ?? 0),
    waiterName: row.waiter_name,
    openedAt: row.opened_at,
    updatedAt: iso(row.updated_at),
  };
}

async function postgresConnection(app: FastifyInstance, customerId: string, product?:PosProduct) {
  const licenseIds = await app.db
    .select({ id: licenses.id,plan:licenses.plan,features:licenses.features })
    .from(licenses)
    .where(eq(licenses.customerId, customerId));
  const ids = licenseIds.filter(row=>!product||licensePosProduct(row)===product).map((row) => row.id);
  const [device] =
    ids.length > 0
      ? await app.db
          .select()
          .from(devices)
          .where(and(inArray(devices.licenseId, ids), ne(devices.status, 'revoked')))
          .orderBy(desc(devices.lastSeenAt), desc(devices.updatedAt))
          .limit(1)
      : [];

  const lastSeenMs = device?.lastSeenAt?.getTime() ?? 0;
  const connected = lastSeenMs > 0 && Date.now() - lastSeenMs < POSTGRES_FRESH_MS;

  return {
    connected,
    everConnected: lastSeenMs > 0,
    lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
    appVersion: device?.appVersion ?? null,
    deviceId: device?.id ?? null,
    hostname: device?.hostname ?? null,
    restaurantName: null as string | null,
    lastError: null as string | null,
  };
}

export async function buildCustomerLiveSummary(customerIds: string[]) {
  if (customerIds.length === 0) return {};
  const out: Record<
    string,
    {
      connected: boolean;
      lastSeenAt: string | null;
      openTables: number;
      restaurantName: string | null;
    }
  > = {};

  if (mysqlEnabled()) {
    const rows = await listLiveCustomers();
    for (const row of rows) {
      if (!customerIds.includes(row.customer_id)) continue;
      out[row.customer_id] = {
        connected: isDeviceOnline(row.last_seen_at, row.connected),
        lastSeenAt: iso(row.last_seen_at),
        openTables: 0,
        restaurantName: row.restaurant_name,
      };
    }
    const missing = customerIds.filter((id) => !out[id]);
    await Promise.all(
      missing.map(async (customerId) => {
        const floor = await getFloorLive(customerId);
        if (!floor) return;
        out[customerId] = {
          connected: false,
          lastSeenAt: iso(floor.updated_at),
          openTables: Number(floor.open_tables ?? 0),
          restaurantName: null,
        };
      }),
    );
    await Promise.all(
      customerIds.map(async (customerId) => {
        const floor = await getFloorLive(customerId);
        if (!floor) return;
        const entry = out[customerId] ?? {
          connected: false,
          lastSeenAt: null,
          openTables: 0,
          restaurantName: null,
        };
        entry.openTables = Number(floor.open_tables ?? 0);
        out[customerId] = entry;
      }),
    );
    return out;
  }

  for (const customerId of customerIds) {
    out[customerId] = {
      connected: false,
      lastSeenAt: null,
      openTables: 0,
      restaurantName: null,
    };
  }
  return out;
}

export async function buildCustomerLiveSnapshot(
  app: FastifyInstance,
  customerId: string,
  product?: PosProduct,
) {
  const [customer] = await app.db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) return null;

  // A customer can hold both a restaurant and a market license. Picking only
  // the newest one hid the other product from the admin panel entirely, so the
  // caller may ask for a specific one; without it the newest still wins.
  const customerLicenses = await app.db
    .select()
    .from(licenses)
    .where(eq(licenses.customerId, customerId))
    .orderBy(desc(licenses.createdAt));
  const availableProducts = [
    ...new Set(customerLicenses.map((row) => licensePosProduct(row))),
  ];
  const license =
    (product
      ? customerLicenses.find((row) => licensePosProduct(row) === product)
      : customerLicenses[0]) ?? null;

  const selectedProduct=product??(license?licensePosProduct(license):'restaurant');
  let connection = await postgresConnection(app, customerId,selectedProduct);
  let floor = null as Awaited<ReturnType<typeof getFloorLive>>;
  let sales = null as Awaited<ReturnType<typeof getSalesLive>>;
  let tables: ReturnType<typeof tableRow>[] = [];

  if (selectedProduct==='restaurant'&&mysqlEnabled()) {
    const [deviceStatus, floorLive, salesLive, tableRows] = await Promise.all([
      getDeviceStatus(customerId),
      getFloorLive(customerId),
      getSalesLive(customerId),
      getOpenTablesLive(customerId),
    ]);
    floor = floorLive;
    sales = salesLive;
    tables = tableRows.map(tableRow);

    if (deviceStatus) {
      connection = {
        connected: isDeviceOnline(deviceStatus.last_seen_at, deviceStatus.connected),
        everConnected: Boolean(deviceStatus.last_seen_at),
        lastSeenAt: iso(deviceStatus.last_seen_at),
        appVersion: deviceStatus.app_version ?? connection.appVersion,
        deviceId: deviceStatus.device_id ?? connection.deviceId,
        hostname: connection.hostname,
        restaurantName: deviceStatus.restaurant_name,
        lastError: deviceStatus.last_error,
      };
    } else if (floorLive?.updated_at) {
      connection = {
        ...connection,
        lastSeenAt: iso(floorLive.updated_at),
        connected: isDeviceOnline(floorLive.updated_at, true),
        everConnected: true,
      };
    }
  }

  if(selectedProduct==='market'){
    const result=await app.db.execute(sql`SELECT payload,daily_sales_minor,transaction_count,updated_at FROM market_pos_snapshots WHERE customer_id=${customerId}::uuid AND device_id=${connection.deviceId}::uuid LIMIT 1`);
    const row=(Array.isArray(result)?result:(result as any).rows||[])[0];
    if(row){const p=(row as any).payload||{};floor={today_sales_minor:Number((row as any).daily_sales_minor)||0,today_paid_minor:Number((row as any).daily_sales_minor)||0,payment_count:Number((row as any).transaction_count)||0,open_tables:0,open_total_minor:0,updated_at:(row as any).updated_at,payload:{tables:[]}} as any;
      sales={gross_minor:Number((row as any).daily_sales_minor)||0,net_minor:Number((row as any).daily_sales_minor)||0,order_count:Number((row as any).transaction_count)||0,payment_count:Number((row as any).transaction_count)||0,cash_minor:Number(p.cashMinor)||0,card_minor:Number(p.cardMinor)||0,updated_at:(row as any).updated_at} as any;
    }
  }else if(!floor){
    const result=await app.db.execute(sql`SELECT payload,today_sales_minor,open_tables,open_total_minor,updated_at FROM owner_floor_snapshots WHERE customer_id=${customerId}::uuid AND device_id=${connection.deviceId}::uuid LIMIT 1`);
    const row=(Array.isArray(result)?result:(result as any).rows||[])[0];if(row)floor=row as any;
  }

  const payloadTables =
    floor?.payload && typeof floor.payload === 'object' && floor.payload !== null
      ? ((floor.payload as { tables?: unknown[] }).tables ?? [])
      : [];
  if (tables.length === 0 && Array.isArray(payloadTables)) {
    tables = payloadTables.map((row) => {
      const t = row as Record<string, unknown>;
      return {
        id: String(t.id ?? t.tableId ?? ''),
        label: String(t.label ?? ''),
        areaName: typeof t.areaName === 'string' ? t.areaName : null,
        status: String(t.status ?? 'available'),
        orderId: typeof t.orderId === 'string' ? t.orderId : null,
        guestCount: Number(t.guestCount ?? 0),
        itemCount: Number(t.itemCount ?? 0),
        totalMinor: Number(t.totalMinor ?? 0),
        paidMinor: Number(t.paidMinor ?? 0),
        dueMinor: Math.max(0, Number(t.totalMinor ?? 0) - Number(t.paidMinor ?? 0)),
        waiterName: typeof t.waiterName === 'string' ? t.waiterName : null,
        openedAt: typeof t.openedAt === 'string' ? t.openedAt : null,
        updatedAt: iso(floor?.updated_at),
      };
    });
  }

  const [notifications, events, commands] = await Promise.all([
    app.db
      .select()
      .from(ownerNotifications)
      .where(eq(ownerNotifications.customerId, customerId))
      .orderBy(desc(ownerNotifications.createdAt))
      .limit(20),
    app.db
      .select()
      .from(auditLogs)
      .where(
        or(
          eq(auditLogs.actorCustomerId, customerId),
          and(eq(auditLogs.entityType, 'customer'), eq(auditLogs.entityId, customerId)),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(30),
    selectedProduct==='restaurant'?recentBotCommands(customerId, 15):Promise.resolve([]),
  ]);

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      contactPerson: customer.contactPerson,
      active: customer.active,
    },
    license: license
      ? {
          id: license.id,
          status: license.status,
          plan: license.plan,
          product: licensePosProduct(license),
          validUntil: license.validUntil?.toISOString() ?? null,
        }
      : null,
    /** Products this customer holds a license for, for the admin panel's tabs. */
    availableProducts,
    connection,
    mysql: mysqlEnabled(),
    floor: {
      openTables: Number(floor?.open_tables ?? sales?.open_tables ?? tables.filter((t) => t.orderId || t.status === 'occupied' || t.status === 'billing').length),
      openTotalMinor: Number(floor?.open_total_minor ?? sales?.open_total_minor ?? 0),
      todaySalesMinor: Number(floor?.today_sales_minor ?? sales?.gross_minor ?? 0),
      todayPaidMinor: Number(floor?.today_paid_minor ?? sales?.paid_minor ?? 0),
      paymentCount: Number(floor?.payment_count ?? sales?.payment_count ?? 0),
      businessDate: floor?.business_date ?? sales?.business_date ?? null,
      businessDayStatus: sales?.business_day_status ?? null,
      updatedAt: iso(floor?.updated_at ?? sales?.updated_at),
      tables,
      allTablesCount: tables.length,
    },
    sales: sales
      ? {
          grossMinor: Number(sales.gross_minor ?? 0),
          netMinor: Number(sales.net_minor ?? 0),
          orderCount: Number(sales.order_count ?? 0),
          paymentCount: Number(sales.payment_count ?? 0),
          cashMinor: Number(sales.cash_minor ?? 0),
          cardMinor: Number(sales.card_minor ?? 0),
          updatedAt: iso(sales.updated_at),
        }
      : null,
    notifications: notifications.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    })),
    events: events.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      meta: row.meta,
      createdAt: row.createdAt.toISOString(),
    })),
    commands: commands.map((row) => ({
      id: row.id,
      command: row.command,
      status: row.status,
      error: row.error,
      createdAt: iso(row.created_at),
      doneAt: iso(row.done_at),
    })),
    fetchedAt: new Date().toISOString(),
  };
}
