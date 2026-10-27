import {surfaceAccess} from './access.js';
import {areaAllowed} from '../lib/access-areas.js';
import {registerPortalInsights} from './portal-insights.js';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import {
  CustomerBusinessProfileSchema,
  CustomerOnboardingProgressSchema,
} from '@milioner/contracts';
import {
  auditLogs,
  customerOnboarding,
  customers,
  devices,
  licenses,
  ownerFloorSnapshots,
  ownerNotifications,
} from '@milioner/database';
import { writeAudit } from '../lib/audit.js';
import { resolveSetupInfo } from '../lib/setup-feed.js';
import { clientIp, parseBody } from '../lib/validate.js';
import { requireCustomer } from '../plugins/customer-auth.js';
import { isOwnerPosProduct as isPosProduct, licenseOwnerProduct as licensePosProduct, licenseOwnerProductSql, type OwnerPosProduct as PosProduct } from '../lib/pos-product.js';

function requestProduct(req:{query:unknown}):PosProduct|undefined{const p=(req.query as {product?:unknown})?.product;return isPosProduct(p)?p:undefined;}

const VERIFY_FRESH_MS = 5 * 60_000;

function stepsWith(existing: number[], next: number): number[] {
  return [...new Set([...existing, next])].sort((a, b) => a - b);
}

/** Resolve every installer entry point from the customer's license by default.
 * A market-family key refines a generic market license to its own installer.
 * Keys are scoped to the selected license, never another product on the account.
 */
async function setupProductFor(app: FastifyInstance, customerId: string, requested: string | undefined) {
  const selected=await latestLicense(app,customerId,isPosProduct(requested)?requested:undefined);
  return selected?.product ?? (isPosProduct(requested)?requested:'restaurant');
}

async function ensureOnboarding(app: FastifyInstance, customerId: string) {
  await app.db
    .insert(customerOnboarding)
    .values({ customerId })
    .onConflictDoNothing();
  const [row] = await app.db
    .select()
    .from(customerOnboarding)
    .where(eq(customerOnboarding.customerId, customerId))
    .limit(1);
  if (!row) throw new Error('Customer onboarding unavailable');
  return row;
}

function onboardingJson(row: typeof customerOnboarding.$inferSelect) {
  return {
    currentStep: row.currentStep,
    completedSteps: row.completedSteps,
    installationStatus: row.installationStatus,
    downloadedVersion: row.downloadedVersion,
    installedVersion: row.installedVersion,
    lastDownloadAt: row.lastDownloadAt?.toISOString() ?? null,
    lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

/**
 * A customer may hold both a restaurant and a market license. Returning only
 * the newest one meant the owner portal showed whichever was sold last, so the
 * other product's dashboard was unreachable. `product` picks one explicitly;
 * `availableProducts` lets the caller offer a switch.
 */
async function latestLicense(
  app: FastifyInstance,
  customerId: string,
  product?: PosProduct,
) {
  const rows = await app.db
    .select({...getTableColumns(licenses),keyProduct:licenseOwnerProductSql})
    .from(licenses)
    .where(eq(licenses.customerId, customerId))
    .orderBy(desc(licenses.createdAt));
  const availableProducts = [...new Set(rows.map((row) => licensePosProduct(row,row.keyProduct)))];
  const candidates=product?rows.filter(row=>licensePosProduct(row,row.keyProduct)===product):rows;
  const license=candidates.find(row=>row.status==='active'&&(!row.validUntil||row.validUntil.getTime()>Date.now()))??candidates[0]??null;
  if (!license) return null;
  const expired = Boolean(license.validUntil && license.validUntil.getTime() < Date.now());
  return {
    id: license.id,
    plan: license.plan,
    product: licensePosProduct(license,license.keyProduct),
    availableProducts,
    seats: license.seats,
    status: expired && license.status === 'active' ? 'expired' : license.status,
    validFrom: license.validFrom.toISOString(),
    validUntil: license.validUntil?.toISOString() ?? null,
    features: license.features,
  };
}

async function connectionState(app: FastifyInstance, customerId: string, product?:PosProduct) {
  const licenseIds = await app.db
    .select({ id: licenses.id })
    .from(licenses)
    .where(and(eq(licenses.customerId, customerId),product?sql`${licenseOwnerProductSql}=${product}`:undefined));
  const ids = licenseIds.map((row) => row.id);
  const [device] =
    ids.length > 0
      ? await app.db
          .select()
          .from(devices)
          .where(and(inArray(devices.licenseId, ids), ne(devices.status, 'revoked')))
          .orderBy(desc(devices.lastSeenAt), desc(devices.updatedAt))
          .limit(1)
      : [];
  const [floor] = await app.db
    .select()
    .from(ownerFloorSnapshots)
    .where(eq(ownerFloorSnapshots.customerId, customerId))
    .limit(1);

  const deviceSeenAt = device?.lastSeenAt?.getTime() ?? 0;
  const scopedFloor=(!product||product==='restaurant')&&floor?.deviceId===device?.id?floor:null;
  const floorSeenAt = scopedFloor?.updatedAt?.getTime() ?? 0;
  const lastSeenMs = Math.max(deviceSeenAt, floorSeenAt);
  const connected = lastSeenMs > 0 && Date.now() - lastSeenMs < VERIFY_FRESH_MS;

  return {
    connected,
    everConnected: lastSeenMs > 0,
    lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
    appVersion: device?.appVersion ?? null,
    deviceId: device?.id ?? null,
    hostname: device?.hostname ?? null,
    floor:scopedFloor,
  };
}

export async function customerRoutes(app: FastifyInstance) {
  await registerPortalInsights(app);
  app.get('/customer/pos-portfolio',async(req,reply)=>{
    const identity=requireCustomer(req,reply);if(!identity)return;
    const rows=await app.db.select({deviceId:devices.id,branchId:devices.branchId,hostname:devices.hostname,product:licenseOwnerProductSql}).from(devices).innerJoin(licenses,eq(licenses.id,devices.licenseId)).where(and(eq(licenses.customerId,identity.id),ne(devices.status,'revoked')));
    return {devices:rows};
  });

  app.get('/customer/onboarding', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const [customer] = await app.db
      .select()
      .from(customers)
      .where(eq(customers.id, identity.id))
      .limit(1);
    const onboarding = await ensureOnboarding(app, identity.id);
    const { product } = req.query as { product?: string };
    const license = await latestLicense(
      app,
      identity.id,
      isPosProduct(product) ? product : undefined,
    );
    // Offer the installer for the product this customer actually holds, not a
    // link pinned to whichever build was current when the page was written.
    const setup = await resolveSetupInfo(await setupProductFor(app, identity.id, product));

    return {
      customer: {
        name: customer?.name ?? identity.name,
        contactPerson: customer?.contactPerson ?? '',
        email: customer?.email ?? identity.email,
        phone: customer?.phone ?? '',
        address: customer?.address ?? '',
        voen: customer?.voen ?? '',
        notifyEmail: customer?.notifyEmail ?? customer?.email ?? identity.email,
      },
      onboarding: onboardingJson(onboarding),
      license,
      setup: setup.ok ? setup.info : null,
      setupError: setup.ok ? null : 'Yükləmə məlumatı hazırda əlçatan deyil.',
    };
  });

  app.patch('/customer/profile', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const body = parseBody(CustomerBusinessProfileSchema, req.body, reply);
    if (!body) return;

    const [customer] = await app.db
      .update(customers)
      .set({
        name: body.businessName,
        contactPerson: body.contactPerson,
        phone: body.phone,
        address: body.address,
        voen: body.voen,
        notifyEmail: body.notifyEmail,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, identity.id))
      .returning();
    const onboarding = await ensureOnboarding(app, identity.id);
    const completedSteps = stepsWith(onboarding.completedSteps, 2);
    await app.db
      .update(customerOnboarding)
      .set({
        completedSteps,
        currentStep: Math.max(onboarding.currentStep, 3),
        updatedAt: new Date(),
      })
      .where(eq(customerOnboarding.customerId, identity.id));
    await writeAudit(app, {
      actorCustomerId: identity.id,
      action: 'customer.profile_update',
      entityType: 'customer',
      entityId: identity.id,
      ip: clientIp(req),
    });
    return {
      customer: {
        name: customer?.name,
        contactPerson: customer?.contactPerson,
        email: customer?.email,
        phone: customer?.phone,
        address: customer?.address,
        voen: customer?.voen,
        notifyEmail: customer?.notifyEmail,
      },
    };
  });

  app.post('/customer/onboarding/progress', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const body = parseBody(CustomerOnboardingProgressSchema, req.body, reply);
    if (!body) return;
    const onboarding = await ensureOnboarding(app, identity.id);
    const completedSteps = stepsWith(onboarding.completedSteps, body.completedStep);
    const [updated] = await app.db
      .update(customerOnboarding)
      .set({
        completedSteps,
        currentStep: Math.max(onboarding.currentStep, Math.min(body.completedStep + 1, 6)),
        installationStatus:
          body.completedStep === 5 && onboarding.installationStatus === 'downloaded'
            ? 'awaiting_connection'
            : onboarding.installationStatus,
        updatedAt: new Date(),
      })
      .where(eq(customerOnboarding.customerId, identity.id))
      .returning();
    return { onboarding: onboardingJson(updated ?? onboarding) };
  });

  app.get('/customer/downloads/latest', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    reply.header('cache-control', 'private, no-store');
    const { product } = req.query as { product?: string };
    const setup = await resolveSetupInfo(await setupProductFor(app, identity.id, product)); /* geyim-product: latest */
    if (!setup.ok) {
      req.log.warn({ details: setup.error.details }, 'customer_setup_feed_unavailable');
      return reply.code(503).send({
        error: 'Yükləmə məlumatı hazırda əlçatan deyil. Bir qədər sonra yenidən yoxlayın.',
        code: 'SETUP_UNAVAILABLE',
      });
    }
    return setup.info;
  });

  app.post('/customer/onboarding/download', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    reply.header('cache-control', 'private, no-store');
    const { product } = req.query as { product?: string };
    const setup = await resolveSetupInfo(await setupProductFor(app, identity.id, product)); /* geyim-product: onboarding */
    if (!setup.ok) {
      return reply.code(503).send({
        error: 'Yükləmə məlumatı hazırda əlçatan deyil.',
        code: 'SETUP_UNAVAILABLE',
      });
    }
    const onboarding = await ensureOnboarding(app, identity.id);
    const [updated] = await app.db
      .update(customerOnboarding)
      .set({
        completedSteps: stepsWith(onboarding.completedSteps, 4),
        currentStep: Math.max(onboarding.currentStep, 5),
        installationStatus: 'downloaded',
        downloadedVersion: setup.info.version,
        lastDownloadAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(customerOnboarding.customerId, identity.id))
      .returning();
    await writeAudit(app, {
      actorCustomerId: identity.id,
      action: 'customer.setup_download',
      entityType: 'customer',
      entityId: identity.id,
      meta: { version: setup.info.version, fileName: setup.info.fileName },
      ip: clientIp(req),
    });
    return { setup: setup.info, onboarding: onboardingJson(updated ?? onboarding) };
  });

  app.post('/customer/onboarding/verify', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const onboarding = await ensureOnboarding(app, identity.id);
    const connection = await connectionState(app, identity.id,requestProduct(req));
    const now = new Date();

    if (!connection.connected) {
      const reason = connection.everConnected
        ? 'POS daha əvvəl qoşulub, amma hazırda son bağlantı köhnədir.'
        : 'Bu hesab üçün serverə qoşulmuş POS cihazı tapılmadı.';
      const [updated] = await app.db
        .update(customerOnboarding)
        .set({
          currentStep: Math.max(onboarding.currentStep, 6),
          installationStatus: connection.everConnected ? 'error' : 'awaiting_connection',
          lastCheckAt: now,
          lastError: reason,
          updatedAt: now,
        })
        .where(eq(customerOnboarding.customerId, identity.id))
        .returning();
      return {
        verified: false,
        reason,
        connection,
        onboarding: onboardingJson(updated ?? onboarding),
      };
    }

    const completedSteps = stepsWith(onboarding.completedSteps, 6);
    const [updated] = await app.db
      .update(customerOnboarding)
      .set({
        currentStep: 7,
        completedSteps,
        installationStatus: 'verified',
        installedVersion: connection.appVersion,
        lastCheckAt: now,
        verifiedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(customerOnboarding.customerId, identity.id))
      .returning();
    await writeAudit(app, {
      actorCustomerId: identity.id,
      action: 'customer.setup_verified',
      entityType: 'device',
      entityId: connection.deviceId ?? undefined,
      meta: { appVersion: connection.appVersion },
      ip: clientIp(req),
    });
    return {
      verified: true,
      connection,
      onboarding: onboardingJson(updated ?? onboarding),
    };
  });

  app.post('/customer/onboarding/complete', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const onboarding = await ensureOnboarding(app, identity.id);
    if (!onboarding.verifiedAt) {
      return reply.code(409).send({
        error: 'Quraşdırma server tərəfindən təsdiqlənmədən tamamlana bilməz.',
        code: 'SETUP_NOT_VERIFIED',
      });
    }
    const completedSteps = stepsWith(stepsWith(onboarding.completedSteps, 7), 6);
    const [updated] = await app.db
      .update(customerOnboarding)
      .set({
        currentStep: 7,
        completedSteps,
        completedAt: onboarding.completedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(customerOnboarding.customerId, identity.id))
      .returning();
    return { onboarding: onboardingJson(updated ?? onboarding) };
  });

  app.get('/customer/dashboard', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const onboarding = await ensureOnboarding(app, identity.id);
    const { product } = req.query as { product?: string };
    const license = await latestLicense(
      app,
      identity.id,
      isPosProduct(product) ? product : undefined,
    );
    const connection = await connectionState(app, identity.id,requestProduct(req));
    const setup = await resolveSetupInfo(await setupProductFor(app, identity.id, product));
    const notifications = await app.db
      .select()
      .from(ownerNotifications)
      .where(eq(ownerNotifications.customerId, identity.id))
      .orderBy(desc(ownerNotifications.createdAt))
      .limit(6);
    const floor = connection.floor;

    return {
      customer: { id: identity.id, name: identity.name, email: identity.email },
      onboarding: onboardingJson(onboarding),
      license,
      connection: {
        connected: connection.connected,
        everConnected: connection.everConnected,
        lastSeenAt: connection.lastSeenAt,
        appVersion: connection.appVersion,
        hostname: connection.hostname,
      },
      update: setup.ok
        ? {
            latestVersion: setup.info.version,
            installedVersion: connection.appVersion,
            available: Boolean(
              connection.appVersion && connection.appVersion !== setup.info.version,
            ),
          }
        : null,
      floor: {
        tables: (floor?.payload as { tables?: unknown[] } | null)?.tables ?? [],
        openTables: floor?.openTables ?? 0,
        openTotalMinor: floor?.openTotalMinor ?? 0,
        todaySalesMinor: floor?.todaySalesMinor ?? 0,
        updatedAt: floor?.updatedAt?.toISOString() ?? null,
        hasSnapshot: Boolean(floor),
      },
      notifications: notifications.map((notification) => ({
        id: notification.id,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
      })),
    };
  });

  // Live floor for the portal's "Masalar" page - the till's last sync.
  app.get('/customer/tables', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    if(!areaAllowed(await surfaceAccess(app,identity.id,'portal'),'tables')||!areaAllowed(await surfaceAccess(app,identity.id,'restaurant'),'tables'))return reply.code(403).send({error:'Masalara baxmaq icazəniz yoxdur'});
    const license=await latestLicense(app,identity.id,'restaurant');
    if(requestProduct(req)&&requestProduct(req)!=='restaurant'||!license||license.status!=='active')return reply.code(403).send({error:'Masalar yalnız aktiv Restoran POS üçün açıqdır'});
    const connection = await connectionState(app, identity.id,requestProduct(req));
    const floor = connection.floor;
    reply.header('cache-control', 'no-store');
    return {
      connected: connection.connected,
      tables: (floor?.payload as { tables?: unknown[] } | null)?.tables ?? [],
      openTables: floor?.openTables ?? 0,
      openTotalMinor: floor?.openTotalMinor ?? 0,
      updatedAt: floor?.updatedAt?.toISOString() ?? null,
    };
  });

  app.get('/customer/activity', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const notifications = await app.db
      .select()
      .from(ownerNotifications)
      .where(eq(ownerNotifications.customerId, identity.id))
      .orderBy(desc(ownerNotifications.createdAt))
      .limit(50);
    const audit = await app.db
      .select()
      .from(auditLogs)
      .where(
        sql`${auditLogs.actorCustomerId} = ${identity.id} OR (${auditLogs.entityType} = 'customer' AND ${auditLogs.entityId} = ${identity.id})`,
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(50);

    return {
      notifications: notifications.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        payload: row.payload,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      events: audit.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        meta: row.meta,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}
