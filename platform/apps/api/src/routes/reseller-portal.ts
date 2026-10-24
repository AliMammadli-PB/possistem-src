import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ResellerLoginSchema, SaleCreateSchema } from '@milioner/contracts';
import { activationKeys, customers, licenses, resellers } from '@milioner/database';
import { verifyPassword } from '@milioner/security';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { createSale, resellerQuota } from '../lib/provision.js';
import { publicSetupInfo, resolveSetupInfo } from '../lib/setup-feed.js';
import {
  bearerToken,
  requireReseller,
  revokeResellerToken,
  signResellerToken,
} from '../plugins/reseller-auth.js';

/**
 * Bayi paneli API'si (`/pos/bayi/<slug>` SPA'sı buradan beslenir).
 *
 * Bilerek yalnızca GET ve POST var: bayinin silme / düzenleme yetkisi UI'da
 * gizlenmiş değil, endpoint seviyesinde hiç yok. Ne müşteri, ne açar, ne de
 * kendi hesabı üzerinde mutasyon yapabilir; tek yazma işlemi yeni satış.
 */
export async function resellerPortalRoutes(app: FastifyInstance) {
  /**
   * Token geçerliliği + bayinin hâlâ aktif olduğu kontrolü.
   *
   * İmzalı token 12 saat yaşar, bu yüzden super admin bir paneli
   * dayandırdıqda mövcud sessiya da dərhal kəsilməlidir — yoxsa
   * dayandırılmış bayi öz satışlarını oxumağa davam edərdi.
   */
  async function activeReseller(
    req: Parameters<typeof requireReseller>[0],
    reply: Parameters<typeof requireReseller>[1] & {
      code: (n: number) => { send: (b: unknown) => unknown };
    },
  ) {
    const session = requireReseller(req, reply);
    if (!session) return null;

    const [row] = await app.db
      .select()
      .from(resellers)
      .where(eq(resellers.id, session.resellerId))
      .limit(1);
    if (!row || !row.active) {
      reply.code(401).send({ error: 'Unauthorized' });
      return null;
    }
    return row;
  }

  /** Giriş ekranı başlığı — parola denemeden önce yalnızca panel adı sızar. */
  app.get(
    '/reseller/public/:slug',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const [row] = await app.db
        .select({ name: resellers.name, active: resellers.active })
        .from(resellers)
        .where(eq(resellers.slug, slug.toLowerCase()))
        .limit(1);
      if (!row || !row.active) return reply.code(404).send({ error: 'Panel tapılmadı' });
      return { name: row.name };
    },
  );

  app.post(
    '/reseller/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(ResellerLoginSchema, req.body, reply);
      if (!body) return;

      const email = body.email.toLowerCase().trim();
      const [reseller] = await app.db
        .select()
        .from(resellers)
        .where(
          and(
            eq(resellers.slug, body.slug.toLowerCase()),
            sql`lower(${resellers.email}) = ${email}`,
          ),
        )
        .limit(1);

      // Slug eşleşmesi şart: başka bayinin linkinden giriş yapılamaz.
      if (!reseller || !reseller.active) {
        return reply.code(401).send({ error: 'Yanlış e-poçt və ya parol' });
      }
      const ok = await verifyPassword(reseller.passwordHash, body.password);
      if (!ok) {
        return reply.code(401).send({ error: 'Yanlış e-poçt və ya parol' });
      }

      const { token, expiresAt } = signResellerToken({
        resellerId: reseller.id,
        slug: reseller.slug,
        email: reseller.email,
      });

      await writeAudit(app, {
        action: 'reseller.login',
        entityType: 'reseller',
        entityId: reseller.id,
        ip: clientIp(req),
        meta: { slug: reseller.slug },
      });

      return {
        token,
        expiresAt,
        reseller: {
          name: reseller.name,
          slug: reseller.slug,
          email: reseller.email,
          quota: reseller.keyQuota,
          used: reseller.keysUsed,
          remaining: Math.max(0, reseller.keyQuota - reseller.keysUsed),
        },
      };
    },
  );

  app.post('/reseller/logout', async (req) => {
    revokeResellerToken(bearerToken(req));
    return { ok: true };
  });

  app.get('/reseller/me', async (req, reply) => {
    const row = await activeReseller(req, reply);
    if (!row) return;

    return {
      name: row.name,
      slug: row.slug,
      email: row.email,
      quota: row.keyQuota,
      used: row.keysUsed,
      remaining: Math.max(0, row.keyQuota - row.keysUsed),
    };
  });

  /** Yeni müşteri + aktivasyon açarı. Kota bu çağrıda atomik olarak düşer. */
  app.post(
    '/reseller/customers',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const reseller = await activeReseller(req, reply);
      if (!reseller) return;
      const body = parseBody(SaleCreateSchema, req.body, reply);
      if (!body) return;

      const result = await createSale(app.db, {
        name: body.name,
        email: body.email,
        password: body.password,
        address: body.address,
        phone: body.phone,
        voen: body.voen,
        contactPerson: body.contactPerson,
        notes: body.notes,
        days: body.days,
        seats: body.seats,
        maxDevices: body.maxDevices,
        plan: body.plan,
        product: body.product, /* geyim-product */
        label: body.label ?? null,
        resellerId: reseller.id,
      });

      if (!result.ok) {
        if (result.reason === 'quota_exhausted') {
          return reply
            .code(403)
            .send({ error: 'Kota bitib — admin ilə əlaqə saxlayın', code: 'QUOTA_EXHAUSTED' });
        }
        return reply.code(409).send({ error: 'Bu e-poçt artıq qeydiyyatdadır' });
      }

      await writeAudit(app, {
        action: 'reseller.sale',
        entityType: 'customer',
        entityId: result.customerId,
        ip: clientIp(req),
        meta: {
          resellerId: reseller.id,
          slug: reseller.slug,
          days: result.days,
          licenseId: result.licenseId,
          activationKeyId: result.keyId,
        },
      });

      const quota = await resellerQuota(app.db, reseller.id);

      return reply.code(201).send({
        customer: { id: result.customerId, name: body.name, email: body.email.toLowerCase() },
        days: result.days,
        expiresAt: result.expiresAt.toISOString(),
        // Yalnızca burada, bir kez.
        activationKey: result.activationKey,
        quota,
      });
    },
  );

  /** Yalnızca bu bayinin kendi satışları — salt okunur. */
  app.get('/reseller/customers', async (req, reply) => {
    const reseller = await activeReseller(req, reply);
    if (!reseller) return;

    const rows = await app.db
      .select({
        customerId: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        address: customers.address,
        voen: customers.voen,
        contactPerson: customers.contactPerson,
        createdAt: customers.createdAt,
        plan: licenses.plan,
        status: licenses.status,
        validUntil: licenses.validUntil,
        maxDevices: activationKeys.maxDevices,
        redeemCount: activationKeys.redeemCount,
        keyLabel: activationKeys.label,
      })
      .from(customers)
      .leftJoin(licenses, eq(licenses.customerId, customers.id))
      .leftJoin(activationKeys, eq(activationKeys.licenseId, licenses.id))
      .where(eq(customers.resellerId, reseller.id))
      .orderBy(desc(customers.createdAt))
      .limit(500);

    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      validUntil: r.validUntil?.toISOString() ?? null,
    }));
  });

  /** Müşteriye verilecek setup linki — feed dizini ve sha512 gösterilmez. */
  app.get('/reseller/setup', async (req, reply) => {
    const reseller = await activeReseller(req, reply);
    if (!reseller) return;

    const result = await resolveSetupInfo();
    if (!result.ok) {
      return reply.code(502).send({ error: 'Quraşdırıcı hazır deyil' });
    }
    return publicSetupInfo(result.info);
  });
}
