import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ResellerLoginSchema, ResellerRenewSchema, ResellerSaleSchema } from '@possistem/contracts';
import { activationKeys, customers, licenses, resellers } from '@possistem/database';
import { verifyPassword } from '@possistem/security';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { createSale, renewLicense, resellerQuota } from '../lib/provision.js';
import { creditCost, effectiveStatus, saleValidUntil, termLabel } from '../lib/reseller-terms.js';
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
 * gizlenmiş değil, endpoint seviyesinde hiç yok. Yazma işlemleri yalnızca yeni
 * satış ve uzatma — ikisi de bayinin POSSISTEM'den aldığı ay kredisini harcar.
 */
export async function resellerPortalRoutes(app: FastifyInstance) {
  /** Columns added by migration 0032 (not in the drizzle schema). */
  async function resellerTerms(id: string) {
    const [row] = (await app.db.execute(sql`
      SELECT trial_limit, max_devices, password_changed_at,
        (SELECT count(*)::int FROM reseller_credit_ledger g
          WHERE g.reseller_id = r.id AND g.reason = 'sale' AND g.months = 0
            AND g.created_at >= date_trunc('month', now())) AS trials_used
      FROM resellers r WHERE r.id = ${id}
    `)) as unknown as Array<{ trial_limit: number; max_devices: number; password_changed_at: Date | string | null; trials_used: number }>;
    return {
      trialLimit: row?.trial_limit ?? 0,
      trialsUsed: row?.trials_used ?? 0,
      maxDevices: row?.max_devices ?? 1,
      passwordChangedAt: row?.password_changed_at ? new Date(row.password_changed_at).getTime() : 0,
    };
  }

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
    const terms = await resellerTerms(row.id);
    if (terms.passwordChangedAt && session.issuedAt < terms.passwordChangedAt) {
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
    const terms = await resellerTerms(row.id);

    return {
      name: row.name,
      slug: row.slug,
      email: row.email,
      // Ay krediti: 1 kredit = 1 ay lisenziya.
      quota: row.keyQuota,
      used: row.keysUsed,
      remaining: Math.max(0, row.keyQuota - row.keysUsed),
      trialLimit: terms.trialLimit,
      trialsUsed: terms.trialsUsed,
      maxDevices: terms.maxDevices,
    };
  });

  /** Yeni müşteri + aktivasyon açarı. Kota bu çağrıda atomik olarak düşer. */
  app.post(
    '/reseller/customers',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const reseller = await activeReseller(req, reply);
      if (!reseller) return;
      const body = parseBody(ResellerSaleSchema, req.body, reply);
      if (!body) return;
      const terms = await resellerTerms(reseller.id);
      if (body.maxDevices > terms.maxDevices) {
        return reply.code(400).send({ error: `Bir satışda ən çox ${terms.maxDevices} cihaz verilə bilər` });
      }

      const now = new Date();
      const trial = body.term === 'trial7';
      const validUntil = saleValidUntil(body.term, now);
      const days = Math.max(1, Math.round((validUntil.getTime() - now.getTime()) / (24 * 3600_000)));
      const credits = creditCost(body.term);

      const result = await createSale(app.db, {
        name: body.name,
        email: body.email,
        password: body.password,
        address: body.address,
        phone: body.phone,
        voen: body.voen,
        contactPerson: body.contactPerson,
        notes: body.notes,
        days,
        seats: body.maxDevices,
        maxDevices: body.maxDevices,
        plan: termLabel(body.term),
        // The partner chose the product on screen; it used to be dropped here and
        // guessed from the plan text, so a Market sale came out a restaurant key.
        product: body.product,
        label: termLabel(body.term),
        resellerId: reseller.id,
        credits,
        trial,
        termMonths: trial ? 0 : credits,
        validUntil,
      });

      if (!result.ok) {
        if (result.reason === 'trial_limit') {
          return reply.code(403).send({
            error: `Bu ay üçün sınaq limiti bitib (${terms.trialLimit})`,
            code: 'TRIAL_LIMIT',
          });
        }
        if (result.reason === 'quota_exhausted') {
          return reply.code(403).send({
            error: `Kredit kifayət etmir — bu satış ${credits} kredit tələb edir. POSSISTEM ilə əlaqə saxlayın.`,
            code: 'QUOTA_EXHAUSTED',
          });
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
          term: body.term,
          credits,
          product: body.product,
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
        licenseId: licenses.id,
        plan: licenses.plan,
        status: licenses.status,
        validUntil: licenses.validUntil,
        isTrial: sql<boolean | null>`"licenses"."is_trial"`,
        termMonths: sql<number | null>`"licenses"."term_months"`,
        product: activationKeys.product,
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

    const now = new Date();
    return rows.map((r) => ({
      ...r,
      // The stored status only flips to expired when a till checks in; the list
      // must not show a lapsed customer as active.
      status: effectiveStatus(r.status, r.validUntil, now),
      createdAt: r.createdAt.toISOString(),
      validUntil: r.validUntil?.toISOString() ?? null,
    }));
  });

  /** Uzatma — bayinin öz müştərisi, ay krediti silinir. */
  app.post(
    '/reseller/licenses/:licenseId/renew',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const reseller = await activeReseller(req, reply);
      if (!reseller) return;
      const { licenseId } = req.params as { licenseId: string };
      if (!/^[0-9a-f-]{36}$/i.test(licenseId)) return reply.code(404).send({ error: 'Lisenziya tapılmadı' });
      const body = parseBody(ResellerRenewSchema, req.body, reply);
      if (!body) return;

      const result = await renewLicense(app.db, { licenseId, resellerId: reseller.id, months: body.term });
      if (!result.ok) {
        if (result.reason === 'quota_exhausted') {
          return reply.code(403).send({
            error: `Kredit kifayət etmir — uzatma ${body.term} kredit tələb edir. POSSISTEM ilə əlaqə saxlayın.`,
            code: 'QUOTA_EXHAUSTED',
          });
        }
        return reply.code(404).send({ error: 'Lisenziya tapılmadı' });
      }

      await writeAudit(app, {
        action: 'reseller.renew',
        entityType: 'license',
        entityId: licenseId,
        ip: clientIp(req),
        meta: { resellerId: reseller.id, slug: reseller.slug, months: body.term, validUntil: result.validUntil.toISOString() },
      });
      return {
        ok: true,
        licenseId,
        validUntil: result.validUntil.toISOString(),
        quota: await resellerQuota(app.db, reseller.id),
      };
    },
  );

  /** Kredit tarixçəsi — alınan, xərclənən, qaytarılan. */
  app.get('/reseller/ledger', async (req, reply) => {
    const reseller = await activeReseller(req, reply);
    if (!reseller) return;
    const rows = (await app.db.execute(sql`
      SELECT g.id, g.delta, g.reason, g.months, g.note, g.created_at, c.name AS customer_name
      FROM reseller_credit_ledger g LEFT JOIN customers c ON c.id = g.customer_id
      WHERE g.reseller_id = ${reseller.id}
      ORDER BY g.created_at DESC
      LIMIT 500
    `)) as unknown as Array<{ id: string; delta: number; reason: string; months: number | null; note: string | null; created_at: Date | string; customer_name: string | null }>;
    return rows.map((r) => ({
      id: r.id,
      delta: r.delta,
      reason: r.reason,
      months: r.months,
      note: r.note,
      customerName: r.customer_name,
      createdAt: new Date(r.created_at).toISOString(),
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
