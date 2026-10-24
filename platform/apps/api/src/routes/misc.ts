import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { PaymentUrlSchema } from '@milioner/contracts';
import {
  contactLeads,
  customers,
  devices,
  featureFlags,
  licenses,
  resellers,
  supportTickets,
} from '@milioner/database';
import { env } from '../env.js';
import { isPosProduct, licensePosProductSql, type PosProduct } from '../lib/pos-product.js';
import { resolveSetupInfo } from '../lib/setup-feed.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { requireSuperadmin, currentUser } from '../plugins/auth.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    let dbStatus: 'up' | 'down' = 'down';
    try {
      await app.db.execute(sql`SELECT 1`);
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }
    return {
      ok: dbStatus === 'up',
      service: 'possistem-control-api' as const,
      version: env.version,
      insecureTransport: env.insecureTransport,
      db: dbStatus,
      time: new Date().toISOString(),
    };
  });
}

/**
 * What is true of one product right now.
 *
 * Every count here is bounded by the same product filter, so the numbers on the
 * screen add up to something an operator can act on. A customer who was created
 * but never sold a licence classifies as neither product and is deliberately in
 * none of these - counting them under whichever product happened to be selected
 * is how a panel ends up lying quietly.
 */
async function productScopedStats(app: FastifyInstance, product: PosProduct) {
  const ofProduct = sql`${licensePosProductSql} = ${product}`;

  const [shops] = await app.db
    .select({ count: sql<number>`count(distinct ${customers.id})::int` })
    .from(customers)
    .innerJoin(licenses, eq(licenses.customerId, customers.id))
    .where(ofProduct);

  const [active] = await app.db
    .select({ count: sql<number>`count(*)::int` })
    .from(licenses)
    .where(sql`${licenses.status} = 'active' and ${ofProduct}`);

  const [thisMonth] = await app.db
    .select({ count: sql<number>`count(distinct ${customers.id})::int` })
    .from(customers)
    .innerJoin(licenses, eq(licenses.customerId, customers.id))
    .where(sql`${customers.createdAt} >= date_trunc('month', now()) and ${ofProduct}`);

  // A till that has spoken in the last quarter of an hour is plugged in and
  // working. The rest are installed but silent, which is the number worth
  // chasing: it is either a shop that closed or one whose sync is broken.
  const [tills] = await app.db
    .select({
      total: sql<number>`count(*)::int`,
      online: sql<number>`count(*) filter (where ${devices.lastSeenAt} >= now() - interval '5 minutes')::int`,
    })
    .from(devices)
    .innerJoin(licenses, eq(licenses.id, devices.licenseId))
    .where(sql`${devices.status} <> 'revoked' and ${ofProduct}`);

  // Attributed through the licence, not through the message that opened the
  // ticket: meta.source lives on support_messages, and a ticket is long-lived
  // - a shop that ever wrote to us keeps the same one. Which product the shop
  // runs is the stable answer. A shop running both is counted under both, which
  // is correct: either operator may be the one who has to answer it.
  const [openTickets] = await app.db
    .select({ count: sql<number>`count(distinct ${supportTickets.id})::int` })
    .from(supportTickets)
    .innerJoin(customers, eq(customers.id, supportTickets.customerId))
    .innerJoin(licenses, eq(licenses.customerId, customers.id))
    .where(sql`${supportTickets.status} = 'open' and ${ofProduct}`);

  const recent = await app.db
    .select({
      customerId: customers.id,
      name: customers.name,
      email: customers.email,
      createdAt: customers.createdAt,
      resellerName: resellers.name,
      status: licenses.status,
    })
    .from(customers)
    .innerJoin(licenses, eq(licenses.customerId, customers.id))
    .leftJoin(resellers, eq(customers.resellerId, resellers.id))
    .where(ofProduct)
    .orderBy(desc(customers.createdAt))
    .limit(10);

  // One row per version actually installed, newest contact first. A till that
  // last spoke in August still counts: it is the one most likely to surprise
  // somebody, and averaging it away is how it stays forgotten.
  const versionSpread = await app.db
    .select({
      version: devices.appVersion,
      count: sql<number>`count(*)::int`,
      lastSeenAt: sql<Date | null>`max(${devices.lastSeenAt})`,
    })
    .from(devices)
    .innerJoin(licenses, eq(licenses.id, devices.licenseId))
    .where(sql`${devices.status} <> 'revoked' and ${ofProduct}`)
    .groupBy(devices.appVersion)
    .orderBy(sql`max(${devices.lastSeenAt}) desc nulls last`);

  // What the update feed is actually serving. The panel hands out this
  // installer and the tills update from it, so a stale or missing feed is a
  // thing an operator should see here rather than discover from a customer.
  let release: { version: string; fileName: string } | null = null;
  try {
    const info = await resolveSetupInfo(product);
    if (info.ok) release = { version: info.info.version, fileName: info.info.fileName };
  } catch {
    release = null;
  }

  return {
    product,
    shops: shops?.count ?? 0,
    activeLicenses: active?.count ?? 0,
    thisMonth: thisMonth?.count ?? 0,
    tills: tills?.total ?? 0,
    tillsOnline: tills?.online ?? 0,
    openTickets: openTickets?.count ?? 0,
    release,
    versions: versionSpread.map((row) => ({
      version: row.version ?? '—',
      count: row.count,
      lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
      // Compared as text: these are our own build numbers, and a till reporting
      // anything else is exactly the case worth showing rather than ranking.
      current: Boolean(release && row.version === release.version),
    })),
    behind: versionSpread.reduce(
      (sum, row) => sum + (release && row.version === release.version ? 0 : row.count),
      0,
    ),
    recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/stats', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    // Product is optional so an older panel build keeps working: without it
    // the answer is the whole business, as it always was.
    const requested = (req.query as { product?: string }).product;
    if (requested !== undefined && requested !== '' && !isPosProduct(requested)) {
      return reply.code(400).send({ error: 'product must be "market" or "restaurant"' });
    }

    const [panels] = await app.db
      .select({ count: sql<number>`count(*) filter (where ${resellers.active})::int` })
      .from(resellers);
    const [sold] = await app.db.select({ count: sql<number>`count(*)::int` }).from(customers);
    const [active] = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(licenses)
      .where(eq(licenses.status, 'active'));
    const [thisMonth] = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(customers)
      .where(sql`${customers.createdAt} >= date_trunc('month', now())`);
    const [newLeads] = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactLeads)
      .where(eq(contactLeads.status, 'new'));

    const recent = await app.db
      .select({
        customerId: customers.id,
        name: customers.name,
        email: customers.email,
        createdAt: customers.createdAt,
        resellerName: resellers.name,
      })
      .from(customers)
      .leftJoin(resellers, eq(customers.resellerId, resellers.id))
      .orderBy(desc(customers.createdAt))
      .limit(10);

    let dbStatus: 'up' | 'down' = 'down';
    try {
      await app.db.execute(sql`SELECT 1`);
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }

    const scoped = isPosProduct(requested) ? await productScopedStats(app, requested) : null;

    return {
      scoped,
      panels: panels?.count ?? 0,
      sold: sold?.count ?? 0,
      activeLicenses: active?.count ?? 0,
      thisMonth: thisMonth?.count ?? 0,
      newLeads: newLeads?.count ?? 0,
      db: dbStatus,
      version: env.version,
      insecureTransport: env.insecureTransport,
      recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  });
}

/**
 * Lisans bitince POS'un gösterdiği ödeme/iletişim adresi.
 *
 * `feature_flags` tablosunun `payment.url` satırında tutulur — POS ve owner
 * tarafı bunu `resolvePaymentUrl` ile okur, bu yüzden feature flag CRUD'u
 * kaldırılırken tek bu ayar için dar bir uç bırakıldı.
 */
export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings/payment-url', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const [flag] = await app.db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, 'payment.url'))
      .limit(1);
    const url =
      flag?.payload && typeof flag.payload === 'object'
        ? ((flag.payload as { url?: unknown }).url ?? null)
        : null;
    return {
      url: typeof url === 'string' ? url : env.defaultPaymentUrl,
      enabled: flag?.enabled ?? false,
    };
  });

  app.patch('/settings/payment-url', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(PaymentUrlSchema, req.body, reply);
    if (!body) return;

    await app.db
      .insert(featureFlags)
      .values({
        key: 'payment.url',
        description: 'Public payment / contact URL shown in POS when license expires',
        enabled: true,
        scope: 'global',
        payload: { url: body.url },
      })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: { enabled: true, payload: { url: body.url }, updatedAt: new Date() },
      });

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'settings.payment_url',
      entityType: 'feature_flag',
      entityId: 'payment.url',
      ip: clientIp(req),
      meta: { url: body.url },
    });

    return { url: body.url, enabled: true };
  });
}
