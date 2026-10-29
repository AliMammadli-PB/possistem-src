import {billingLicenseRefresh} from '../lib/billing/license-refresh.js';
import { licenseBilling } from '../lib/billing/service.js';
import { createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and, desc, ne, sql } from 'drizzle-orm';
import { z } from 'zod/v3';
import {
  ActivationLookupSchema,
  ActivationRedeemSchema,
  DeviceHeartbeatSchema,
  OfflineSignRequestSchema,
} from '@milioner/contracts';
import { activationKeys, customers, devices, featureFlags, licenses } from '@milioner/database';
import { hmacActivationKey, signLicensePayload, deriveKeyId, toHex } from '@milioner/security';
import { env } from '../env.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { requireSuperadmin, currentUser } from '../plugins/auth.js';
import { loadOrCreateSigningKeys } from '../lib/keys.js';
import { resolveTenantToken } from './tenant.js';
import { stableStringify } from './market.js';

const legacyHeartbeatWarned = new Set<string>();

function heartbeatSecretMatches(expected: string, provided: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function paymentUrlFromFlags(app: FastifyInstance): Promise<string | null> {
  const [flag] = await app.db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, 'payment.url'))
    .limit(1);
  if (!flag?.enabled) return null;
  const url =
    flag.payload && typeof flag.payload === 'object'
      ? (flag.payload as { url?: unknown }).url
      : null;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

type DbLike = {
  select: FastifyInstance['db']['select'];
  update: FastifyInstance['db']['update'];
};

async function expireLicenseIfNeeded(db: DbLike, licenseId: string) {
  const [license] = await db.select().from(licenses).where(eq(licenses.id, licenseId)).limit(1);
  if (!license) return null;
  if (license.status === 'active' && license.validUntil && license.validUntil < new Date()) {
    const [updated] = await db
      .update(licenses)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(licenses.id, licenseId))
      .returning();
    return updated;
  }
  return license;
}

/** POS istemcisinin çağırdığı tek cihaz ucu — panelden cihaz yönetimi yok. */
export async function deviceRoutes(app: FastifyInstance) {
  app.post('/devices/:id/heartbeat', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(DeviceHeartbeatSchema, req.body ?? {}, reply);
    if (!body) return;

    const [device] = await app.db
      .select()
      .from(devices)
      .where(eq(devices.id, id))
      .limit(1);
    if (!device) {
      // Deleting a customer cascades to its licences and devices. Tell the till
      // so it locks - but only when nothing here still knows this PC: a stale id
      // whose fingerprint maps to a live device stays a plain 404.
      const fp = body.deviceFingerprint?.trim();
      if (fp) {
        const [known] = await app.db
          .select({ id: devices.id })
          .from(devices)
          .where(and(eq(devices.deviceFingerprint, fp), sql`${devices.status} <> 'revoked'`))
          .limit(1);
        if (!known) {
          req.log.warn({ deviceId: id }, 'device_heartbeat_license_revoked');
          return reply.code(403).send({ error: 'Lisenziya ləğv edilib', code: 'LICENSE_REVOKED' });
        }
      }
      return reply.code(404).send({ error: 'Not found' });
    }

    const fingerprint = body.deviceFingerprint?.trim();
    if (fingerprint && !heartbeatSecretMatches(device.deviceFingerprint, fingerprint)) {
      req.log.warn({ deviceId: id, ip: clientIp(req) }, 'device_heartbeat_auth_rejected');
      return reply.code(401).send({ error: 'Device authentication failed' });
    }
    if (device.heartbeatAuthRequired && !fingerprint) {
      return reply.code(401).send({
        error: 'Device fingerprint required',
        code: 'DEVICE_FINGERPRINT_REQUIRED',
      });
    }
    if (!fingerprint && !legacyHeartbeatWarned.has(id)) {
      legacyHeartbeatWarned.add(id);
      req.log.warn({ deviceId: id }, 'legacy_device_heartbeat_accepted');
    }

    const [licence] = await app.db
      .select({ status: licenses.status })
      .from(licenses)
      .where(eq(licenses.id, device.licenseId))
      .limit(1);
    if (device.status === 'revoked' || !licence || licence.status === 'revoked') {
      req.log.warn({ deviceId: id }, 'device_heartbeat_license_revoked');
      return reply.code(403).send({ error: 'Lisenziya ləğv edilib', code: 'LICENSE_REVOKED' });
    }

    const [row] = await app.db
      .update(devices)
      .set({
        lastSeenAt: new Date(),
        updatedAt: new Date(),
        ...(body.appVersion ? { appVersion: body.appVersion } : {}),
        ...(fingerprint ? { heartbeatAuthRequired: true } : {}),
        status: 'active',
      })
      .where(eq(devices.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return {
      ok: true,
      lastSeenAt: row.lastSeenAt,
      licenseRefresh: fingerprint ? await billingLicenseRefresh(app.db,row.id) : null,
      authentication: fingerprint ? 'fingerprint' : 'legacy',
      upgradeRequired: !fingerprint,
    };
  });
}

type Tx = Parameters<Parameters<FastifyInstance['db']['transaction']>[0]>[0];
type KeyRow = typeof activationKeys.$inferSelect;
type RedeemInput = {
  deviceFingerprint: string;
  hostname?: string | null;
  appVersion?: string | null;
  devicePublicKey?: string | null;
  product: string;
};
type RedeemError = { error: string; status: 401 | 403 };
type RedeemOk = {
  device: typeof devices.$inferSelect;
  license: typeof licenses.$inferSelect;
  customer: typeof customers.$inferSelect | undefined;
  signed: ReturnType<typeof signLicensePayload>;
  rebound: Array<{ id: string; licenseId: string }>;
};

const TenantActivateSchema = z.object({
  deviceFingerprint: z.string().min(8).max(256),
  hostname: z.string().max(255).optional(),
  appVersion: z.string().max(64).optional(),
  devicePublicKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
  product: z.literal('market'),
  signedAt: z.string().datetime({ offset: true }),
  nonce: z.string().regex(/^[0-9a-fA-F]{32}$/),
  deviceSignature: z.string().regex(/^[0-9a-fA-F]{128}$/),
});

/** Ed25519 by the PC's own key over the same stableStringify the market calls use. */
export function verifyTenantActivateSignature(body: z.infer<typeof TenantActivateSchema>): boolean {
  const signedMs = Date.parse(body.signedAt);
  if (!Number.isFinite(signedMs) || Math.abs(Date.now() - signedMs) > 5 * 60_000) return false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(body.devicePublicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    const canonical = stableStringify({
      purpose: 'tenant-activate',
      deviceFingerprint: body.deviceFingerprint,
      devicePublicKey: body.devicePublicKey,
      signedAt: body.signedAt,
      nonce: body.nonce,
    });
    return verifySignature(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(body.deviceSignature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Activates (or re-activates) one PC on an already locked key row and signs
 * its licence. Shared by /activation/redeem and /tenant/pos/activate.
 */
export async function redeemWithKey(
  tx: Tx,
  keyRow: KeyRow,
  body: RedeemInput,
  capacityError?: (maxDevices: number, activeDevices: number) => string,
): Promise<RedeemError | RedeemOk> {
  if (keyRow.revokedAt) {
    return { error: 'Activation key revoked', status: 403 as const };
  }
  if (keyRow.expiresAt && keyRow.expiresAt < new Date()) {
    return { error: 'Activation key expired', status: 403 as const };
  }
  if (keyRow.product !== body.product) {
    return {
      /* geyim-product: redeem */
      error: `Bu aktivləşdirmə açarı ${({ restaurant: 'Restoran POS', market: 'Market POS', geyim: 'Geyim POS', aptek: 'Aptek POS' /* aptek-product */, topdan: 'Topdan POS' /* topdan-product */ } as Record<string, string>)[keyRow.product ?? 'restaurant'] ?? 'başqa POS'} üçündür`,
      status: 403 as const,
    };
  }

  const license = await expireLicenseIfNeeded(tx, keyRow.licenseId);
  const managed = license ? await licenseBilling(tx,license.id) : null;
  if(managed?.billingEnforced&&managed.billingStatus!=='active')return {error:'Aylıq abunəlik ödənilməyib',status:403 as const};
  if(license&&managed){if(!managed.billingEnforced&&!['revoked','suspended'].includes(license.status))license.status='active';if(managed.accessUntil||managed.paidUntil)license.validUntil=new Date((managed.accessUntil||managed.paidUntil)!);}
  if (!license || license.status !== 'active') {
    return { error: 'License inactive or expired', status: 403 as const };
  }

  const [customer] = await tx
    .select()
    .from(customers)
    .where(eq(customers.id, license.customerId))
    .limit(1);

  const [existing] = await tx
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.licenseId, keyRow.licenseId),
        eq(devices.deviceFingerprint, body.deviceFingerprint),
      ),
    )
    .limit(1);

  // device_public_key is unique across every licence. A PC activated before
  // under another account (or another fingerprint) still holds its key on the
  // old row, and inserting it again was a 500 on devices_public_key_uidx.
  // The key proves it is the same PC, so the old row lets go of it and is
  // revoked - before the slot count, so it does not cost this key a slot.
  const rebound = body.devicePublicKey
    ? await tx
        .update(devices)
        .set({ status: 'revoked', devicePublicKey: null, updatedAt: new Date() })
        .where(
          existing
            ? and(eq(devices.devicePublicKey, body.devicePublicKey), ne(devices.id, existing.id))
            : eq(devices.devicePublicKey, body.devicePublicKey),
        )
        .returning({ id: devices.id, licenseId: devices.licenseId })
    : [];

  let device = existing;
  if (!device) {
    // Capacity is the number of tills CURRENTLY activated, not the number of
    // times the key has ever been redeemed. redeem_count only ever went up,
    // so revoking a register (replacing a broken till, say) freed a row in
    // `devices` and made the admin panel show a slot available while this
    // endpoint still refused the activation. Counting live devices makes the
    // panel and the gate agree, and it is safe here because the caller's
    // SELECT … FOR UPDATE serialises every redeem of this key.
    const [{ activeDevices }] = await tx
      .select({ activeDevices: sql<number>`count(*)::int` })
      .from(devices)
      .where(and(eq(devices.licenseId, keyRow.licenseId), sql`${devices.status} <> 'revoked'`));

    if (activeDevices >= keyRow.maxDevices) {
      return {
        error: capacityError
          ? capacityError(keyRow.maxDevices, activeDevices)
          : `Bu aktivləşdirmə açarı ${keyRow.maxDevices} cihaz üçündür və hamısı istifadə olunub ` +
            `(${activeDevices} aktiv cihaz). Admin panelində kassa sayını artırın və ya ` +
            `köhnə cihazı ləğv edin.`,
        status: 403 as const,
      };
    }

    const [created] = await tx
      .insert(devices)
      .values({
        licenseId: keyRow.licenseId,
        branchId: license.branchId,
        activationKeyId: keyRow.id,
        deviceFingerprint: body.deviceFingerprint,
        hostname: body.hostname ?? null,
        appVersion: body.appVersion ?? null,
        devicePublicKey: body.devicePublicKey ?? null,
        heartbeatAuthRequired: Boolean(body.devicePublicKey),
        status: 'active',
        lastSeenAt: new Date(),
      })
      .returning();
    device = created;

    // redeem_count is kept as a lifetime tally for audit only — capacity is
    // enforced above off the live device count. It deliberately no longer
    // carries `redeem_count < max_devices`: that condition is what made a
    // key permanently unusable once it had been redeemed maxDevices times,
    // even after those devices were revoked.
    const claimed = await tx.execute(sql`
      UPDATE activation_keys
      SET redeem_count = redeem_count + 1
      WHERE id = ${keyRow.id}
        AND revoked_at IS NULL
      RETURNING id
    `);
    if (!claimed.length) {
      // The key was revoked between the FOR UPDATE and here; fail closed.
      throw new Error('Activation redeem: key revoked mid-transaction');
    }
  } else {
    const [updated] = await tx
      .update(devices)
      .set({
        lastSeenAt: new Date(),
        hostname: body.hostname ?? device.hostname,
        appVersion: body.appVersion ?? device.appVersion,
        devicePublicKey: body.devicePublicKey ?? device.devicePublicKey,
        heartbeatAuthRequired: Boolean(body.devicePublicKey ?? device.devicePublicKey),
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(devices.id, device.id))
      .returning();
    device = updated;
  }

  const keys = loadOrCreateSigningKeys();
  const features =
    typeof license.features === 'object' && license.features !== null
      ? { ...(license.features as Record<string, unknown>) }
      : {};
  if(managed){Object.assign(features,{billingManaged:true,billingStatus:managed.billingStatus,billingAccessMode:managed.accessMode,trialUntil:managed.trialUntil,offlineGraceDays:0});}
  const signed = signLicensePayload(
    keys.privateKey,
    {
      ...(managed ? {...managed,offlineGraceDays:0,expiresAt:license.validUntil?.getTime()??0} : {}),
      licenseId: license.id,
      customerId: license.customerId,
      customerEmail: customer?.email ?? null,
      plan: license.plan,
      seats: license.seats,
      features,
      deviceId: device!.id,
      deviceFingerprint: device!.deviceFingerprint,
      devicePublicKey: device!.devicePublicKey,
      validUntil: license.validUntil?.toISOString() ?? null,
      status: 'active',
    },
    keys.publicKey,
  );

  return { device: device!, license, customer, signed, rebound };
}

async function auditRedeem(
  app: FastifyInstance,
  result: RedeemOk,
  ip: string | null,
  action: string,
  actorCustomerId: string | null,
) {
  for (const old of result.rebound) {
    await writeAudit(app, {
      actorCustomerId,
      action: 'device.rebound',
      entityType: 'device',
      entityId: old.id,
      ip,
      meta: { fromLicenseId: old.licenseId, toLicenseId: result.license.id, newDeviceId: result.device.id },
    });
  }
  await writeAudit(app, {
    actorCustomerId,
    action,
    entityType: 'device',
    entityId: result.device.id,
    ip,
    meta: { licenseId: result.license.id },
  });
}

/** The success body both activation routes return; the till verifies it the same way. */
async function redeemResponse(app: FastifyInstance, result: RedeemOk) {
  const billing = await licenseBilling(app.db,result.license.id);
  const paymentUrl =
    (result.license.features && typeof result.license.features === 'object'
      ? (result.license.features as { paymentUrl?: string }).paymentUrl
      : null) ?? (await paymentUrlFromFlags(app));

  const signingKeys = loadOrCreateSigningKeys();

  return {
    signingKey: {
      algorithm: 'Ed25519' as const,
      keyId: deriveKeyId(signingKeys.publicKey),
      publicKeyHex: toHex(signingKeys.publicKey),
    },
    device: result.device,
    license: {
      ...(billing ?? {}),
      id: result.license.id,
      plan: result.license.plan,
      seats: result.license.seats,
      status: result.license.status,
      customerId: result.license.customerId,
      customerEmail: result.customer?.email ?? null,
      validUntil: result.license.validUntil?.toISOString() ?? null,
      features: result.license.features,
      paymentUrl: billing?.paymentUrl ?? paymentUrl,
    },
    signedLicense: result.signed,
  };
}


export async function activationRoutes(app: FastifyInstance) {
  /** Non-destructive key lookup for Settings → Yoxla. */
  app.post('/activation/lookup', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(ActivationLookupSchema, req.body, reply);
    if (!body) return;

    const keyHmac = hmacActivationKey(env.activationPepper, body.activationKey);
    const [keyRow] = await app.db
      .select()
      .from(activationKeys)
      .where(eq(activationKeys.keyHmac, keyHmac))
      .limit(1);

    if (!keyRow) {
      return {
        valid: false,
        email: null,
        used: false,
        redeemCount: 0,
        maxDevices: 0,
        expiresAt: null,
        licenseStatus: null,
        customerName: null,
        plan: null,
        seats: null,
        paymentUrl: await paymentUrlFromFlags(app),
      };
    }

    const license = await expireLicenseIfNeeded(app.db, keyRow.licenseId);
    const [customer] = license
      ? await app.db.select().from(customers).where(eq(customers.id, license.customerId)).limit(1)
      : [null];

    const keyExpired = Boolean(keyRow.expiresAt && keyRow.expiresAt < new Date());

    // Live device count, matching what /activation/redeem now enforces. Reporting
    // "used" off the lifetime redeem_count told a multi-register shop its key was
    // spent while slots were in fact free, and said nothing about how many.
    const [{ activeDevices }] = await app.db
      .select({ activeDevices: sql<number>`count(*)::int` })
      .from(devices)
      .where(and(eq(devices.licenseId, keyRow.licenseId), sql`${devices.status} <> 'revoked'`));
    const used = activeDevices >= keyRow.maxDevices;

    return {
      valid: !keyRow.revokedAt && !keyExpired && license?.status === 'active',
      email: customer?.email ?? null,
      customerName: customer?.name ?? null,
      used,
      activeDevices,
      availableDevices: Math.max(0, keyRow.maxDevices - activeDevices),
      redeemCount: keyRow.redeemCount,
      maxDevices: keyRow.maxDevices,
      expiresAt: keyRow.expiresAt?.toISOString() ?? license?.validUntil?.toISOString() ?? null,
      licenseStatus: license?.status ?? null,
      plan: license?.plan ?? null,
      seats: license?.seats ?? null,
      revoked: Boolean(keyRow.revokedAt),
      keyExpired,
      paymentUrl:
        (license?.features && typeof license.features === 'object'
          ? (license.features as { paymentUrl?: string }).paymentUrl
          : null) ?? (await paymentUrlFromFlags(app)),
    };
  });

  app.post('/activation/redeem', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(ActivationRedeemSchema, req.body, reply);
    if (!body) return;

    const keyHmac = hmacActivationKey(env.activationPepper, body.activationKey);

    const result = await app.db.transaction(async (tx): Promise<RedeemError | RedeemOk> => {
      // SELECT … FOR UPDATE serializes concurrent redeems of the same key
      const [keyRow] = await tx
        .select()
        .from(activationKeys)
        .where(eq(activationKeys.keyHmac, keyHmac))
        .for('update')
        .limit(1);

      if (!keyRow) {
        return { error: 'Invalid activation key' as const, status: 401 as const };
      }
      // Legacy restaurant tills omit product; treat that as restaurant so a
      // market key cannot activate the restaurant POS by accident.
      return redeemWithKey(tx, keyRow, { ...body, product: body.product ?? 'restaurant' });
    });

    if ('error' in result) {
      return reply.code(result.status).send({ error: result.error });
    }
    await auditRedeem(app, result, clientIp(req), 'activation.redeem', null);
    return redeemResponse(app, result);
  });

  /**
   * Market POS activation from the owner's login: no key typed. The PC proves
   * it holds the private key it will sign with from now on, and takes a slot
   * of the account's market activation key exactly as /activation/redeem would.
   */
  app.post('/tenant/pos/activate', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const auth = req.headers.authorization;
    const raw =
      typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : undefined;
    const session = resolveTenantToken(raw);
    if (!session) return reply.code(401).send({ error: 'Unauthorized' });

    const body = parseBody(TenantActivateSchema, req.body ?? {}, reply);
    if (!body) return;
    if (!verifyTenantActivateSignature(body)) {
      return reply.code(401).send({ error: 'Cihaz imzası yanlışdır və ya vaxtı keçib', code: 'DEVICE_SIGNATURE_INVALID' });
    }

    const [customer] = await app.db
      .select({ id: customers.id, active: customers.active })
      .from(customers)
      .where(eq(customers.id, session.customerId))
      .limit(1);
    if (!customer?.active) return reply.code(401).send({ error: 'Unauthorized' });

    const result = await app.db.transaction(async (tx): Promise<RedeemError | RedeemOk> => {
      // The account's newest live market key; FOR UPDATE serialises this with
      // /activation/redeem of the same key, so the slot count stays exact.
      const [row] = await tx
        .select({ key: activationKeys })
        .from(activationKeys)
        .innerJoin(licenses, eq(licenses.id, activationKeys.licenseId))
        .where(
          and(
            eq(licenses.customerId, customer.id),
            eq(licenses.status, 'active'),
            eq(activationKeys.product, 'market'),
            sql`(${licenses.features} ->> 'product' = 'market' OR ${licenses.plan} = 'market')`,
            sql`(${licenses.validUntil} IS NULL OR ${licenses.validUntil} >= now())`,
            sql`${activationKeys.revokedAt} IS NULL`,
            sql`(${activationKeys.expiresAt} IS NULL OR ${activationKeys.expiresAt} >= now())`,
          ),
        )
        .orderBy(desc(licenses.updatedAt), desc(activationKeys.createdAt))
        .for('update')
        .limit(1);
      if (!row) {
        return { error: 'Bu hesab üçün aktiv Market POS lisenziyası yoxdur', status: 403 as const };
      }
      return redeemWithKey(
        tx,
        row.key,
        { ...body, product: 'market' },
        (max) => `Bu hesabda boş kompüter yeri qalmayıb (${max}). Admin yer əlavə etməlidir.`,
      );
    });

    if ('error' in result) {
      return reply.code(result.status).send({ error: result.error });
    }
    await auditRedeem(app, result, clientIp(req), 'activation.tenant', customer.id);
    return redeemResponse(app, result);
  });

  app.post('/activation/offline/sign', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(OfflineSignRequestSchema, req.body, reply);
    if (!body) return;
    const keys = loadOrCreateSigningKeys();
    const signed = signLicensePayload(keys.privateKey, body.payload, keys.publicKey);
    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'activation.offline_sign',
      entityType: 'license_payload',
      ip: clientIp(req),
    });
    return {
      ...signed,
      signingKey: {
        algorithm: 'Ed25519' as const,
        keyId: deriveKeyId(keys.publicKey),
        publicKeyHex: toHex(keys.publicKey),
      },
    };
  });
}
