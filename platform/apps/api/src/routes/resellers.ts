import {archiveBillingCustomer} from '../lib/billing/store.js';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod/v3';
import {
  CustomerEmailUpdateSchema,
  ResellerCreateSchema,
  ResellerUpdateSchema,
  SaleCreateSchema,
} from '@milioner/contracts';
import { activationKeys, customers, devices, licenses, resellers } from '@milioner/database';
import {
  generateActivationKeyPlaintext,
  hashPassword,
  hmacActivationKey,
} from '@milioner/security';
import { env } from '../env.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { createSale } from '../lib/provision.js';
import { licenseOwnerProductSql } from '../lib/pos-product.js';
import {
  buildCustomerLiveSnapshot,
  buildCustomerLiveSummary,
} from '../lib/customer-live.js';
import { requireSuperadmin, currentUser } from '../plugins/auth.js';

/**
 * Super admin: bayi (admin panel) yönetimi + tüm satışların görünümü.
 *
 * Silmə: satılmış müştərilər qalır (reseller_id NULL olur), panel linki
 * (`/pos/bayi/<slug>`) database-dən silindiyi üçün artıq açılmır.
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

    return rows.map((r) => ({
      ...r,
      remaining: Math.max(0, r.quota - r.used),
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
      .select({ keysUsed: resellers.keysUsed })
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

  /**
   * Admin paneli tam sil: reseller sətri + slug (link).
   * Bağlı müştəri/açarlar qalır — FK ON DELETE SET NULL ilə birbaşa satış olur.
   */
  app.delete('/resellers/:id', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };

    const [current] = await app.db
      .select({
        id: resellers.id,
        slug: resellers.slug,
        name: resellers.name,
        email: resellers.email,
        keysUsed: resellers.keysUsed,
        active: resellers.active,
      })
      .from(resellers)
      .where(eq(resellers.id, id))
      .limit(1);
    if (!current) return reply.code(404).send({ error: 'Panel tapılmadı' });

    const [custCount] = await app.db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(eq(customers.resellerId, id));
    const linkedCustomers = Number(custCount?.n ?? 0);

    await app.db.delete(resellers).where(eq(resellers.id, id));

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'reseller.delete',
      entityType: 'reseller',
      entityId: id,
      ip: clientIp(req),
      meta: {
        slug: current.slug,
        name: current.name,
        email: current.email,
        keysUsed: current.keysUsed,
        linkedCustomers,
        panelPath: `/pos/bayi/${current.slug}`,
      },
    });

    return {
      ok: true,
      resellerId: id,
      slug: current.slug,
      panelPath: `/pos/bayi/${current.slug}`,
      linkedCustomers,
    };
  });
}

/** "Kimə satmışıq" görünümü + super adminin doğrudan satışı. */
export async function salesRoutes(app: FastifyInstance) {
  app.get('/sales', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const query = req.query as { resellerId?: string; product?: 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan'; limit?: string }; /* topdan-product: type */ /* aptek-product: type */ /* geyim-product: type */
    const limit = Math.min(Number(query.limit ?? 200) || 200, 500);

    const filters = [
      query.resellerId === 'direct'
        ? sql`${customers.resellerId} IS NULL`
        : query.resellerId
          ? eq(customers.resellerId, query.resellerId)
          : undefined,
      query.product === 'market' || query.product === 'geyim' || query.product === 'aptek' || query.product === 'topdan' /* topdan-product: filter */ /* aptek-product: filter */ /* geyim-product: filter */
        ? eq(activationKeys.product, query.product)
        : query.product === 'restaurant'
          ? sql`coalesce(${activationKeys.product}, 'restaurant') = 'restaurant'`
          : undefined,
    ].filter(Boolean);
    const filter = filters.length ? and(...filters) : undefined;

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
        activationKeyId: activationKeys.id,
        product: activationKeys.product,
        keyLabel: activationKeys.label,
        maxDevices: activationKeys.maxDevices,
        redeemCount: activationKeys.redeemCount,
        keyExpiresAt: activationKeys.expiresAt,
      })
      .from(customers)
      .leftJoin(resellers, eq(customers.resellerId, resellers.id))
      .leftJoin(licenses, eq(licenses.customerId, customers.id))
      .leftJoin(activationKeys, eq(activationKeys.licenseId, licenses.id))
      .where(filter)
      .orderBy(desc(customers.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      validUntil: r.validUntil?.toISOString() ?? null,
      keyExpiresAt: r.keyExpiresAt?.toISOString() ?? null,
    }));
  });

  app.get('/customers/:id/pos-licenses',async(req,reply)=>{
    if(!requireSuperadmin(req,reply))return;
    const parsed=z.string().uuid().safeParse((req.params as {id:string}).id);if(!parsed.success)return reply.code(400).send({error:'Sahibkar seçin'});
    const id=parsed.data;const [customer]=await app.db.select({id:customers.id,name:customers.name,email:customers.email,active:customers.active}).from(customers).where(eq(customers.id,id)).limit(1);
    if(!customer)return reply.code(404).send({error:'Sahibkar tapılmadı'});
    const rows=await app.db.select({id:licenses.id,product:licenseOwnerProductSql,branchId:licenses.branchId,status:licenses.status,validUntil:licenses.validUntil,seats:licenses.seats}).from(licenses).where(eq(licenses.customerId,id)).orderBy(desc(licenses.createdAt));
    const branches=await app.db.execute(sql`SELECT id,name FROM branches WHERE customer_id=${id}::uuid AND active=true ORDER BY name,id`);
    return {customer,licenses:rows,branches};
  });
  app.post('/customers/:id/pos-licenses',async(req,reply)=>{
    if(!requireSuperadmin(req,reply))return;
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);
    const parsed=z.object({requestId:z.string().uuid(),product:z.enum(['restaurant','market','geyim','aptek','topdan']),monthlyAmountMinor:z.number().int().min(1).max(100000000).optional(),branchId:z.string().uuid().optional(),branchName:z.string().trim().min(2).max(120).optional(),days:z.number().int().min(1).max(36500),maxDevices:z.number().int().min(1).max(100000),plan:z.enum(['standart','biznes','premium']).default('standart')}).refine(b=>Boolean(b.branchId||b.branchName),'Filial seçin və ya adını yazın').safeParse(req.body);
    if(!id.success||!parsed.success)return reply.code(400).send({error:'POS növü, filial, müddət və kompüter sayını düzgün daxil edin'});
    const [customer]=await app.db.select().from(customers).where(eq(customers.id,id.data)).limit(1);
    if(!customer?.active||!customer.email)return reply.code(404).send({error:'Aktiv sahibkar hesabı tapılmadı'});
    const b=parsed.data;
    if((b.product==='market'||b.product==='restaurant')&&!b.monthlyAmountMinor){const current=await app.db.execute(sql`SELECT id FROM billing_subscriptions WHERE customer_id=${customer.id}::uuid AND product=${b.product} AND enabled=true`);if(!current.length)return reply.code(400).send({error:'Bu proqram üçün aylıq haqqı daxil edin.'});}
    try{
      const result=await createSale(app.db,{...b,existingCustomerId:customer.id,name:customer.name,email:customer.email,password:'',address:customer.address||'',phone:customer.phone,seats:b.maxDevices,resellerId:null});
      if(!result.ok)return reply.code(409).send({error:'POS əlavə edilmədi'});
      await writeAudit(app,{actorUserId:currentUser(req).id,action:'owner.pos.add',entityType:'license',entityId:result.licenseId,ip:clientIp(req),meta:{customerId:customer.id,product:b.product,requestId:b.requestId}});
      return reply.code(201).send({customer:{id:customer.id,name:customer.name,email:customer.email},product:b.product,licenseId:result.licenseId,activationKey:result.activationKey,expiresAt:result.expiresAt.toISOString()});
    }catch(error){return reply.code(409).send({error:error instanceof Error?error.message:'POS əlavə edilmədi'});}
  });

  /** Super adminin bayisiz, doğrudan satışı (reseller_id NULL). */
  app.post('/sales', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(SaleCreateSchema, req.body, reply);
    if (!body) return;
    if ((body.product === 'market' || body.product === 'restaurant') && !body.monthlyAmountMinor) return reply.code(400).send({error:'Aylıq abunə haqqını daxil edin.'});

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
      monthlyAmountMinor: body.monthlyAmountMinor,
      seats: body.seats,
      maxDevices: body.maxDevices,
      plan: body.plan,
      product: body.product,
      label: body.label ?? null,
      resellerId: null,
    });

    if (!result.ok) {
      return reply.code(409).send({ error: 'Bu e-poçtla sahibkar artıq var. Satışlar bölməsində hesabı açıb POS və filial əlavə edin.' });
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
      billingRequired: Boolean(body.monthlyAmountMinor),
      monthlyAmountMinor: body.monthlyAmountMinor ?? null,
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
        return reply.code(409).send({ error: 'Bu e-poçtla sahibkar artıq var. Satışlar bölməsində hesabı açıb POS və filial əlavə edin.' });
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
   * Super admin: satışın kompüter limitini dəyişir.
   * Aktivasiya `max_devices`, POS girişi isə lisenziya `seats` ilə yoxlanır —
   * ikisi eyni rəqəmdə qalmalıdır, yoxsa əlavə kompüter ya açarı, ya da girişi rədd edir.
   */
  app.patch('/customers/:id/device-capacity', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = parseBody(
      z.object({
        licenseId: z.string().uuid(),
        maxDevices: z.number().int().min(1).max(100000),
      }),
      req.body,
      reply,
    );
    if (!body) return;

    const [license] = await app.db
      .select({ id: licenses.id, seats: licenses.seats })
      .from(licenses)
      .where(and(eq(licenses.id, body.licenseId), eq(licenses.customerId, id)))
      .limit(1);
    if (!license) return reply.code(404).send({ error: 'Lisenziya tapılmadı' });

    const [{ activeDevices }] = await app.db
      .select({ activeDevices: sql<number>`count(*)::int` })
      .from(devices)
      .where(and(eq(devices.licenseId, license.id), sql`${devices.status} <> 'revoked'`));
    const active = Number(activeDevices) || 0;
    if (body.maxDevices < active) {
      return reply.code(409).send({
        error: `Aktiv kompüter sayı ${active}-dir. İstifadə sayı bundan az ola bilməz.`,
      });
    }

    await app.db.transaction(async (tx) => {
      await tx
        .update(licenses)
        .set({ seats: body.maxDevices, updatedAt: new Date() })
        .where(eq(licenses.id, license.id));
      await tx
        .update(activationKeys)
        .set({ maxDevices: body.maxDevices })
        .where(eq(activationKeys.licenseId, license.id));
    });

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'customer.updateDeviceCapacity',
      entityType: 'customer',
      entityId: id,
      ip: clientIp(req),
      meta: { licenseId: license.id, from: license.seats, to: body.maxDevices, activeDevices: active },
    });

    return { ok: true, customerId: id, licenseId: license.id, maxDevices: body.maxDevices, activeDevices: active };
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
    const body=parseBody(z.object({licenseId:z.string().uuid().optional()}),req.body??{},reply);if(!body)return;

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
      .where(and(eq(customers.id, id),body.licenseId?eq(licenses.id,body.licenseId):undefined))
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
    const selected=z.object({product:z.enum(['market','restaurant']).optional()}).safeParse(req.query);
    if(!selected.success)return reply.code(400).send({error:'POS seçimi düzgün deyil'});
    const snapshot = await buildCustomerLiveSnapshot(app, id,selected.data.product);
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
        active: customers.active,
        email: customers.email,
        resellerId: customers.resellerId,
      })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    if (!current) return reply.code(404).send({ error: 'Not found' });

    const archived=await app.db.transaction(async (tx) => {
      const keepHistory=await archiveBillingCustomer(tx,id);
      if (current.resellerId && (!keepHistory || current.active)) {
        await tx.execute(sql`
          UPDATE resellers
          SET keys_used = GREATEST(keys_used - 1, 0), updated_at = now()
          WHERE id = ${current.resellerId}
        `);
      }
      if(!keepHistory)await tx.delete(customers).where(eq(customers.id, id));
      return keepHistory;
    });

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: archived?'customer.archive':'customer.delete',
      entityType: 'customer',
      entityId: id,
      ip: clientIp(req),
      meta: {
        name: current.name,
        email: current.email,
        resellerId: current.resellerId,
      },
    });

    return { ok: true, customerId: id, archived };
  });
}
