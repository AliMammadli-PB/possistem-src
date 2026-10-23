import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { customers, licenses } from '@possistem/database';
import { deriveKeyId, signLicensePayload, toHex } from '@possistem/security';
import { loadOrCreateSigningKeys } from './keys.js';

/**
 * The signed licence a till stores, rebuilt from the licence as it is now.
 *
 * A till used to receive this only once, at activation, so a licence renewed
 * later still locked the till on its old end date. The heartbeats now carry it
 * (same shape and signer as `/activation/redeem`), and the till replaces its
 * copy when the end date moved. Only an active licence that has not ended is
 * signed - an expired one is never refreshed into looking valid.
 */
export async function licenseEnvelope(
  app: FastifyInstance,
  device: { id: string; licenseId: string; deviceFingerprint: string; devicePublicKey: string | null },
) {
  const [license] = await app.db.select().from(licenses).where(eq(licenses.id, device.licenseId)).limit(1);
  if (!license || license.status !== 'active') return null;
  if (license.validUntil && license.validUntil.getTime() <= Date.now()) return null;
  const [customer] = await app.db
    .select({ email: customers.email })
    .from(customers)
    .where(eq(customers.id, license.customerId))
    .limit(1);

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

  return {
    signingKey: {
      algorithm: 'Ed25519' as const,
      keyId: deriveKeyId(keys.publicKey),
      publicKeyHex: toHex(keys.publicKey),
    },
    device: { id: device.id },
    license: {
      id: license.id,
      plan: license.plan,
      seats: license.seats,
      status: license.status,
      customerId: license.customerId,
      customerEmail: customer?.email ?? null,
      validUntil: license.validUntil?.toISOString() ?? null,
      features: license.features,
    },
    signedLicense: signed,
  };
}
