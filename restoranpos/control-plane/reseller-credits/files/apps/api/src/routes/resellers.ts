import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  AdminRenewSchema,
  CustomerEmailUpdateSchema,
  ResellerCreateSchema,
  ResellerCreditGrantSchema,
  ResellerUpdateSchema,
  SaleCreateSchema,
} from '@possistem/contracts';
import { activationKeys, customers, devices, licenses, resellers } from '@possistem/database';
import {
  generateActivationKeyPlaintext,
  hashPassword,
  hmacActivationKey,
} from '@possistem/security';
import { env } from '../env.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { createSale, grantResellerCredits, renewLicense } from '../lib/provision.js';
import { effectiveStatus } from '../lib/reseller-terms.js';
import {
  buildCustomerLiveSnapshot,
  buildCustomerLiveSummary,
} from '../lib/customer-live.js';
import { requireSuperadmin, currentUser } from '../plugins/auth.js';
import { isPosProduct, licensePosProductSql, type PosProduct } from '../lib/pos-product.js';

/**
 * Super admin: bayi (admin panel) yönetimi + tüm satışların görünümü.
 *
 * Bayi silme yoktur — satış geçmişi bayiye bağlı kaldığı için yalnızca
 * `active=false` ile pasifleştirilir.
 */
export async function resellerRoutes(app: FastifyInstance) {
  app.get('/resellers', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;

    const rows = await app.db
      .select({
        id: resellers.id,
        slug: resellers.slug,
        name: resellers.name,
        email: resellers.email,
        phone: resellers.phone,
        quota: resellers.keyQuota,
        used: resellers.keysUsed,
        active: resellers.active,
        createdAt: resellers.createdAt,
      })
      .from(resellers)
      .orderBy(desc(resellers.createdAt));

    // Columns added by migration 0032 are not in the drizzle schema.
    const terms = (await app.db.execute(sql`SELECT id, trial_limit, max_devices FROM resellers`)) as unknown as
      Array<{ id: string; trial_limit: number; max_devices: number }>;
    const byId = new Map(terms.map((t) => [t.id, t]));

    return rows.map((r) => ({
      ...r,
      remaining: Math.max(0, r.quota - r.used),
      trialLimit: byId.get(r.id)?.trial_limit ?? 0,
      maxDevices: byId.get(r.id)?.max_devices ?? 1,
      createdAt: r.createdAt.toISOString(),
      panelPath: `/pos/bayi/${r.slug}`,
    }));
  });

  app.post('/resellers', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(ResellerCreateSchema, req.body, reply);
    if (!body) return;

    const slug = body.slug.toLowerCase();
    const email = body.email.toLowerCase().trim();
    const passwordHash = await hashPassword(body.password);

    try {
      const [row] = await app.db
        .insert(resellers)
        .values({
          slug,
          name: body.name,
          email,
          passwordHash,
          phone: body.phone ?? null,
          keyQuota: body.keyQuota,
          active: true,
        })
        .returning();
      // Every credit movement is in the ledger, the opening balance too.
      if (body.keyQuota > 0) {
        await app.db.execute(sql`
          INSERT INTO reseller_credit_ledger (reseller_id, delta, reason, months, note, actor_user_id)
          VALUES (${row.id}, ${body.keyQuota}, 'grant', ${body.keyQuota}, 'İlkin kredit', ${currentUser(req).id})
        `);
      }

      await writeAudit(app, {
        actorUserId: currentUser(req).id,
        action: 'reseller.create',
        entityType: 'reseller',
        entityId: row.id,
        ip: clientIp(req),
        meta: { slug, keyQuota: body.keyQuota },
      });

      return reply.code(201).send({
        id: row.id,
        slug: row.slug,
        name: row.name,
        email: row.email,
        quota: row.keyQuota,
        used: row.keysUsed,
        remaining: row.keyQuota,
        active: row.active,
        createdAt: row.createdAt.toISOString(),
        panelPath: `/pos/bayi/${row.slug}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('resellers_slug') || message.includes('slug')) {
        return reply.code(409).send({ error: 'Bu link (slug) artıq istifadədədir' });
      }
      if (message.includes('resellers_email_uidx') || message.includes('unique')) {
        return reply.code(409).send({ error: 'Bu e-poçt artıq istifadədədir' });
      }
      throw err;
    }
  });

  app.patch('/resellers/:id', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = parseBody(ResellerUpdateSchema, req.body, reply);
    if (!body) return;

    if (body.keyQuota !== undefined && body.addQuota !== undefined) {
      return reply.code(400).send({ error: 'keyQuota və addQuota birlikte göndərilə bilməz' });
    }

    const [current] = await app.db
      .select({ keysUsed: resellers.keysUsed, keyQuota: resellers.keyQuota })
      .from(resellers)
      .where(eq(resellers.id, id))
      .limit(1);
    if (!current) return reply.code(404).send({ error: 'Not found' });

    // Kotayı kullanılanın altına indirmek, mevcut satışları geçersiz kılmadan
    // sadece kilitler; yine de kazara veri kaybı olmasın diye engelleniyor.
    if (body.keyQuota !== undefined && body.keyQuota < current.keysUsed) {
      return reply.code(400).send({
        error: `Kota istifadə olunandan az ola bilməz (${current.keysUsed})`,
      });
    }

    const [row] = await app.db
      .update(resellers)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.keyQuota !== undefined ? { keyQuota: body.keyQuota } : {}),
        ...(body.addQuota !== undefined
          ? { keyQuota: sql`${resellers.keyQuota} + ${body.addQuota}` }
          : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.password !== undefined
          ? { passwordHash: await hashPassword(body.password) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(resellers.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Not found' });

    const quotaDelta = row.keyQuota - current.keyQuota;
    if (quotaDelta !== 0) {
      await app.db.execute(sql`
        INSERT INTO reseller_credit_ledger (reseller_id, delta, reason, months, note, actor_user_id)
        VALUES (${id}, ${quotaDelta}, ${body.addQuota !== undefined ? 'grant' : 'adjust'}, ${quotaDelta > 0 ? quotaDelta : null},
                'Kota düzəlişi', ${currentUser(req).id})
      `);
    }

    if (body.trialLimit !== undefined || body.maxDevices !== undefined || body.password !== undefined) {
      await app.db.execute(sql`
        UPDATE resellers SET
          trial_limit = COALESCE(${body.trialLimit ?? null}::int, trial_limit),
          max_devices = COALESCE(${body.maxDevices ?? null}::int, max_devices),
          password_changed_at = CASE WHEN ${body.password !== undefined} THEN now() ELSE password_changed_at END
        WHERE id = ${id}
      `);
    }

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'reseller.update',
      entityType: 'reseller',
      entityId: id,
      ip: clientIp(req),
      meta: {
        ...(body.keyQuota !== undefined ? { keyQuota: body.keyQuota } : {}),
        ...(body.addQuota !== undefined ? { addQuota: body.addQuota } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.trialLimit !== undefined ? { trialLimit: body.trialLimit } : {}),
        ...(body.maxDevices !== undefined ? { maxDevices: body.maxDevices } : {}),
        passwordReset: body.password !== undefined,
      },
    });

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      email: row.email,
      phone: row.phone,
      quota: row.keyQuota,
      used: row.keysUsed,
      remaining: Math.max(0, row.keyQuota - row.keysUsed),
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      panelPath: `/pos/bayi/${row.slug}`,
    };
  });

  /** Bayi krediti aldı: ay sayı + ödədiyi məbləğ tarixçəyə yazılır. */
  app.post('/resellers/:id/credits', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = parseBody(ResellerCreditGrantSchema, req.body, reply);
    if (!body) return;
    const actorUserId = currentUser(req).id;
    const ok = await grantResellerCredits(app.db, {
      resellerId: id,
      months: body.months,
      amountMinor: body.amountMinor ?? null,
      note: body.note ?? null,
      actorUserId,
    });
    if (!ok) return reply.code(404).send({ error: 'Not found' });
    await writeAudit(app, {
      actorUserId,
      action: 'reseller.credits',
      entityType: 'reseller',
      entityId: id,
      ip: clientIp(req),
      meta: { months: body.months, amountMinor: body.amountMinor ?? null },
    });
    return { ok: true };
  });

  /** Bayinin kredit tarixçəsi. */
  app.get('/resellers/:id/ledger', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const rows = (await app.db.execute(sql`
      SELECT g.id, g.delta, g.reason, g.months, g.amount_minor, g.note, g.created_at, c.name AS customer_name
      FROM reseller_credit_ledger g LEFT JOIN customers c ON c.id = g.customer_id
      WHERE g.reseller_id = ${id}
      ORDER BY g.created_at DESC
      LIMIT 1000
    `)) as unknown as Array<{ id: string; delta: number; reason: string; months: number | null; amount_minor: string | number | null; note: string | null; created_at: Date | string; customer_name: string | null }>;
    return rows.map((r) => ({
      id: r.id,
      delta: r.delta,
      reason: r.reason,
      months: r.months,
      amountMinor: r.amount_minor == null ? null : Number(r.amount_minor),
      note: r.note,
      customerName: r.customer_name,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  });
}

/** "Kimə satmışıq" görünümü + super adminin doğrudan satışı. */
export async function salesRoutes(app: FastifyInstance) {
  app.get('/sales', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const query = req.query as { resellerId?: string; limit?: string; product?: string };
    const limit = Math.min(Number(query.limit ?? 200) || 200, 500);
    if (query.product !== undefined && query.product !== '' && !isPosProduct(query.product)) {
      return reply.code(400).send({ error: 'product must be "market" or "restaurant"' });
    }
    const product = isPosProduct(query.product) ? query.product : null;

    const resellerFilter =
      query.resellerId === 'direct'
        ? sql`${customers.resellerId} IS NULL`
        : query.resellerId
          ? eq(customers.resellerId, query.resellerId)
          : undefined;

    // A license can carry several activation keys, and joining them directly
    // multiplied the customer rows and made .limit() cut the list short. Pick
    // the newest key per license first so the join stays one-to-one.
    const latestKeys = app.db
      .selectDistinctOn([activationKeys.licenseId], {
        licenseId: activationKeys.licenseId,
        id: activationKeys.id,
        label: activationKeys.label,
        product: activationKeys.product,
        maxDevices: activationKeys.maxDevices,
        redeemCount: activationKeys.redeemCount,
        expiresAt: activationKeys.expiresAt,
      })
      .from(activationKeys)
      .orderBy(activationKeys.licenseId, desc(activationKeys.createdAt))
      .as('latest_keys');

    const resolvedProduct = sql<
      PosProduct | null
    >`coalesce(${latestKeys.product}, ${licensePosProductSql})`;

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
        customerActive: customers.active,
        resellerId: resellers.id,
        resellerName: resellers.name,
        resellerSlug: resellers.slug,
        plan: licenses.plan,
        status: licenses.status,
        validUntil: licenses.validUntil,
        licenseId: licenses.id,
        product: resolvedProduct,
        activationKeyId: latestKeys.id,
        keyLabel: latestKeys.label,
        maxDevices: latestKeys.maxDevices,
        redeemCount: latestKeys.redeemCount,
        keyExpiresAt: latestKeys.expiresAt,
      })
      .from(customers)
      .leftJoin(resellers, eq(customers.resellerId, resellers.id))
      .leftJoin(licenses, eq(licenses.customerId, customers.id))
      .leftJoin(latestKeys, eq(latestKeys.licenseId, licenses.id))
      .where(
        and(
          resellerFilter,
          // A customer with no license yet resolves to NULL, and NULL = 'market'
          // is never true — so filtering by product used to hide every
          // not-yet-sold customer from both views. They belong in both.
          // Parentheses are load-bearing: and() joins operands with bare " and "
          // and SQL binds AND tighter than OR.
          product
            ? sql`(${resolvedProduct} = ${product} OR ${resolvedProduct} IS NULL)`
            : undefined,
        ),
      )
      .orderBy(desc(customers.createdAt))
      .limit(limit);

    const now = new Date();
    return rows.map((r) => ({
      ...r,
      status: effectiveStatus(r.status, r.validUntil, now),
      createdAt: r.createdAt.toISOString(),
      validUntil: r.validUntil?.toISOString() ?? null,
      keyExpiresAt: r.keyExpiresAt?.toISOString() ?? null,
    }));
  });

  /** Super admin: lisenziyanı uzadır — kreditsiz, istənilən gün. */
  app.post('/licenses/:id/renew', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ error: 'Not found' });
    const body = parseBody(AdminRenewSchema, req.body, reply);
    if (!body) return;
    const actorUserId = currentUser(req).id;
    const result = await renewLicense(app.db, { licenseId: id, resellerId: null, days: body.days, actorUserId });
    if (!result.ok) return reply.code(404).send({ error: 'Not found' });
    await writeAudit(app, {
      actorUserId,
      action: 'license.renew',
      entityType: 'license',
      entityId: id,
      ip: clientIp(req),
      meta: { days: body.days, validUntil: result.validUntil.toISOString() },
    });
    return { ok: true, licenseId: id, validUntil: result.validUntil.toISOString() };
  });

  /** Super adminin bayisiz, doğrudan satışı (reseller_id NULL). */
  app.post('/sales', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
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
      product: body.product,
      label: body.label ?? null,
      resellerId: null,
    });

    if (!result.ok) {
      return reply.code(409).send({ error: 'Bu e-poçt artıq qeydiyyatdadır' });
    }

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'sale.direct',
      entityType: 'customer',
      entityId: result.customerId,
      ip: clientIp(req),
      meta: { product: body.product, days: result.days, licenseId: result.licenseId, activationKeyId: result.keyId },
    });

    return reply.code(201).send({
      customer: { id: result.customerId, name: body.name, email: body.email.toLowerCase() },
      product: body.product,
      days: result.days,
      expiresAt: result.expiresAt.toISOString(),
      activationKey: result.activationKey,
    });
  });

  /** Super admin: müştəri e-poçtunu dəyiş və ya sil. */
  app.patch('/customers/:id/email', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = parseBody(CustomerEmailUpdateSchema, req.body, reply);
    if (!body) return;

    const [current] = await app.db
      .select({
        id: customers.id,
        email: customers.email,
        notifyEmail: customers.notifyEmail,
      })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    if (!current) return reply.code(404).send({ error: 'Not found' });

    if (body.email) {
      const [taken] = await app.db
        .select({ id: customers.id })
        .from(customers)
        .where(and(sql`lower(${customers.email}) = ${body.email}`, ne(customers.id, id)))
        .limit(1);
      if (taken) {
        return reply.code(409).send({ error: 'Bu e-poçt artıq qeydiyyatdadır' });
      }
    }

    const notifySame =
      current.notifyEmail != null &&
      current.email != null &&
      current.notifyEmail.toLowerCase() === current.email.toLowerCase();

    const [row] = await app.db
      .update(customers)
      .set({
        email: body.email,
        ...(notifySame || current.notifyEmail == null
          ? { notifyEmail: body.email }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Not found' });

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'customer.updateEmail',
      entityType: 'customer',
      entityId: id,
      ip: clientIp(req),
      meta: { from: current.email, to: body.email },
    });

    return { ok: true, customerId: row.id, email: row.email };
  });

  /**
   * Super admin: aktivasiya açarını yeniləyir.
   *
   * Plaintext yalnız yaradılarkən bir dəfə qaytarılır (HMAC saxlanır).
   * Köhnə açar dərhal etibarsız olur; cihaz bağları və HWID sıfırlanır.
   */
  app.post('/customers/:id/regenerate-activation-key', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };

    const [customer] = await app.db
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        licenseId: licenses.id,
        keyId: activationKeys.id,
        maxDevices: activationKeys.maxDevices,
        expiresAt: activationKeys.expiresAt,
        label: activationKeys.label,
      })
      .from(customers)
      .innerJoin(licenses, eq(licenses.customerId, customers.id))
      .innerJoin(activationKeys, eq(activationKeys.licenseId, licenses.id))
      .where(eq(customers.id, id))
      .orderBy(desc(licenses.createdAt))
      .limit(1);
    if (!customer?.keyId) return reply.code(404).send({ error: 'Not found' });

    const plaintext = generateActivationKeyPlaintext();
    const keyHmac = hmacActivationKey(env.activationPepper, plaintext);

    await app.db.transaction(async (tx) => {
      await tx
        .update(activationKeys)
        .set({
          keyHmac,
          redeemCount: 0,
          revokedAt: null,
        })
        .where(eq(activationKeys.id, customer.keyId!));
      await tx.delete(devices).where(eq(devices.licenseId, customer.licenseId!));
      await tx
        .update(customers)
        .set({ boundHwid: null, updatedAt: new Date() })
        .where(eq(customers.id, id));
    });

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'customer.regenerateActivationKey',
      entityType: 'customer',
      entityId: id,
      ip: clientIp(req),
      meta: { activationKeyId: customer.keyId, licenseId: customer.licenseId },
    });

    return {
      ok: true,
      customerId: id,
      customerName: customer.name,
      email: customer.email,
      activationKey: plaintext,
      activationKeyId: customer.keyId,
      label: customer.label,
      maxDevices: customer.maxDevices,
      expiresAt: customer.expiresAt?.toISOString() ?? null,
    };
  });

  /** Online/offline badge for the sales list (MySQL mirror when available). */
  app.post('/customers/live-summary', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = (req.body ?? {}) as { customerIds?: string[] };
    const customerIds = Array.isArray(body.customerIds)
      ? body.customerIds.filter((id) => typeof id === 'string').slice(0, 500)
      : [];
    const summary = await buildCustomerLiveSummary(customerIds);
    return { summary, fetchedAt: new Date().toISOString() };
  });

  /** Live POS snapshot for superadmin (tables, sales, connection, activity). */
  app.get('/customers/:id/live', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const { product } = req.query as { product?: string };
    if (product !== undefined && product !== '' && !isPosProduct(product)) {
      return reply.code(400).send({ error: 'product must be "market" or "restaurant"' });
    }
    const snapshot = await buildCustomerLiveSnapshot(
      app,
      id,
      isPosProduct(product) ? product : undefined,
    );
    if (!snapshot) return reply.code(404).send({ error: 'Not found' });
    return snapshot;
  });

  /** Super admin: satışı (müştərini) database-dən tam silir — lisenziya/açar cascade. */
  app.delete('/customers/:id', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };

    const [current] = await app.db
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        resellerId: customers.resellerId,
      })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    if (!current) return reply.code(404).send({ error: 'Not found' });

    let refunded = 0;
    await app.db.transaction(async (tx) => {
      if (current.resellerId) {
        // Credits come back only for a sale nobody ever switched on. Deleting a
        // customer who has been using the till must not hand the partner the
        // months back - that was a way to sell the same months twice.
        const [spent] = (await tx.execute(sql`
          SELECT
            COALESCE((SELECT -SUM(delta) FROM reseller_credit_ledger
                      WHERE customer_id = ${id} AND reseller_id = ${current.resellerId}
                        AND reason IN ('sale', 'renew')), 0)::int AS credits,
            COALESCE((SELECT SUM(k.redeem_count) FROM activation_keys k
                      JOIN licenses l ON l.id = k.license_id WHERE l.customer_id = ${id}), 0)::int AS redeemed
        `)) as unknown as Array<{ credits: number; redeemed: number }>;
        if (spent && spent.redeemed === 0 && spent.credits > 0) {
          refunded = spent.credits;
          await tx.execute(sql`
            UPDATE resellers SET keys_used = GREATEST(keys_used - ${refunded}, 0), updated_at = now()
            WHERE id = ${current.resellerId}
          `);
          await tx.execute(sql`
            INSERT INTO reseller_credit_ledger (reseller_id, delta, reason, months, note, actor_user_id)
            VALUES (${current.resellerId}, ${refunded}, 'refund', ${refunded},
                    ${'aktivləşdirilməmiş satış silindi: ' + (current.name ?? '')}, ${currentUser(req).id})
          `);
        }
      }
      await tx.delete(customers).where(eq(customers.id, id));
    });

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'customer.delete',
      entityType: 'customer',
      entityId: id,
      ip: clientIp(req),
      meta: {
        name: current.name,
        email: current.email,
        resellerId: current.resellerId,
        refundedCredits: refunded,
      },
    });

    return { ok: true, customerId: id, refundedCredits: refunded };
  });
}
