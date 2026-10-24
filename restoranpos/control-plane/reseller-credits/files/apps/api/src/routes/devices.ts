import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import {
  ActivationLookupSchema,
  ActivationRedeemSchema,
  DeviceHeartbeatSchema,
  OfflineSignRequestSchema,
} from '@possistem/contracts';
import { activationKeys, customers, devices, featureFlags, licenses } from '@possistem/database';
import { hmacActivationKey, signLicensePayload, deriveKeyId, toHex } from '@possistem/security';
import { env } from '../env.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { requireSuperadmin, currentUser } from '../plugins/auth.js';
import { loadOrCreateSigningKeys } from '../lib/keys.js';
import { licenseEnvelope } from '../lib/license-envelope.js';

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
    if (!device) return reply.code(404).send({ error: 'Not found' });

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
      authentication: fingerprint ? 'fingerprint' : 'legacy',
      upgradeRequired: !fingerprint,
      // Renewals reach the till here; activation alone signed the old end date.
      licenseRefresh: await licenseEnvelope(app, row).catch(() => null),
    };
  });
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

    const result = await app.db.transaction(async (tx) => {
      // SELECT … FOR UPDATE serializes concurrent redeems of the same key
      const [keyRow] = await tx
        .select()
        .from(activationKeys)
        .where(eq(activationKeys.keyHmac, keyHmac))
        .for('update')
        .limit(1);

      if (!keyRow) {
        return { error: 'Invalid activation key' as const, status: 401 };
      }
      if (keyRow.revokedAt) {
        return { error: 'Activation key revoked' as const, status: 403 };
      }
      if (keyRow.expiresAt && keyRow.expiresAt < new Date()) {
        return { error: 'Activation key expired' as const, status: 403 };
      }

      // Legacy restaurant tills omit product; treat that as restaurant so a
      // market key cannot activate the restaurant POS by accident.
      const requestedProduct = body.product ?? 'restaurant';
      if (keyRow.product !== requestedProduct) {
        return {
          error:
            requestedProduct === 'market'
              ? 'Bu aktivləşdirmə açarı Restoran POS üçündür'
              : 'Bu aktivləşdirmə açarı Market POS üçündür',
          status: 403 as const,
        };
      }

      const license = await expireLicenseIfNeeded(tx, keyRow.licenseId);
      if (!license || license.status !== 'active') {
        return { error: 'License inactive or expired' as const, status: 403 };
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

      let device = existing;
      if (!device) {
        // Capacity is the number of tills CURRENTLY activated, not the number of
        // times the key has ever been redeemed. redeem_count only ever went up,
        // so revoking a register (replacing a broken till, say) freed a row in
        // `devices` and made the admin panel show a slot available while this
        // endpoint still refused the activation. Counting live devices makes the
        // panel and the gate agree, and it is safe here because the SELECT … FOR
        // UPDATE above serialises every redeem of this key.
        const [{ activeDevices }] = await tx
          .select({ activeDevices: sql<number>`count(*)::int` })
          .from(devices)
          .where(and(eq(devices.licenseId, keyRow.licenseId), sql`${devices.status} <> 'revoked'`));

        if (activeDevices >= keyRow.maxDevices) {
          return {
            error:
              `Bu aktivləşdirmə açarı ${keyRow.maxDevices} cihaz üçündür və hamısı istifadə olunub ` +
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
      const signed = signLicensePayload(
        keys.privateKey,
        {
          licenseId: license.id,
          customerId: license.customerId,
          customerEmail: customer?.email ?? null,
          plan: license.plan,
          seats: license.seats,
          features,
          deviceId: device.id,
          deviceFingerprint: device.deviceFingerprint,
          devicePublicKey: device.devicePublicKey,
          validUntil: license.validUntil?.toISOString() ?? null,
          status: 'active',
        },
        keys.publicKey,
      );

      return { device, license, customer, signed, status: 200 as const };
    });

    if ('error' in result && result.error) {
      return reply.code(result.status).send({ error: result.error });
    }

    await writeAudit(app, {
      action: 'activation.redeem',
      entityType: 'device',
      entityId: result.device!.id,
      ip: clientIp(req),
      meta: { licenseId: result.license!.id },
    });

    const paymentUrl =
      (result.license!.features && typeof result.license!.features === 'object'
        ? (result.license!.features as { paymentUrl?: string }).paymentUrl
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
        id: result.license!.id,
        plan: result.license!.plan,
        seats: result.license!.seats,
        status: result.license!.status,
        customerId: result.license!.customerId,
        customerEmail: result.customer?.email ?? null,
        validUntil: result.license!.validUntil?.toISOString() ?? null,
        features: result.license!.features,
        paymentUrl,
      },
      signedLicense: result.signed,
    };
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
