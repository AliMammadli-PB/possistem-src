import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { ContactLeadCreateSchema, ContactLeadStatusSchema } from '@milioner/contracts';
import { contactLeads } from '@milioner/database';
import { env } from '../env.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { currentUser, requireSuperadmin } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import { sendLeadNotificationEmail } from '../lib/lead-email.js';

const VALID_STATUSES = new Set(['new', 'contacted', 'qualified', 'closed']);

export async function publicContactRoutes(app: FastifyInstance) {
  /** Hub + marketing pages read this to show/hide the POS product. */
  app.get('/public/site-flags', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    return {
      milionerSite: env.milionerSite,
      milionerVisible: env.milionerSite === 'true',
    };
  });

  app.post(
    '/public/contact',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const body = parseBody(ContactLeadCreateSchema, req.body, reply);
      if (!body) return;

      // Honeypot bots get a normal success response without creating inbox noise.
      if (body.website) {
        return reply.code(201).send({ ok: true });
      }

      const [lead] = await app.db
        .insert(contactLeads)
        .values({
          name: body.name,
          businessName: body.businessName,
          phone: body.phone,
          city: body.city,
          message: body.message,
          product: body.product ?? null, /* topdan-product: insert */
          source: body.source,
          ip: clientIp(req),
          userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
        })
        .returning({ id: contactLeads.id });

      req.log.info({ leadId: lead?.id, source: body.source }, 'public_contact_lead_created');

      void sendLeadNotificationEmail(app, {
        name: body.name,
        businessName: body.businessName,
        phone: body.phone,
        city: body.city,
        message: body.message,
        product: body.product ?? null, /* topdan-product: email */
        source: body.source,
      });

      return reply.code(201).send({ ok: true, id: lead?.id });
    },
  );
}

export async function contactAdminRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string } }>('/leads', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;

    const status =
      typeof req.query.status === 'string' && VALID_STATUSES.has(req.query.status)
        ? req.query.status
        : null;

    const rows = status
      ? await app.db
          .select()
          .from(contactLeads)
          .where(eq(contactLeads.status, status))
          .orderBy(desc(contactLeads.createdAt))
          .limit(300)
      : await app.db.select().from(contactLeads).orderBy(desc(contactLeads.createdAt)).limit(300);

    const [newCount] = await app.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactLeads)
      .where(eq(contactLeads.status, 'new'));

    return {
      entries: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      newCount: newCount?.count ?? 0,
    };
  });

  app.patch<{ Params: { id: string } }>('/leads/:id', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(ContactLeadStatusSchema, req.body, reply);
    if (!body) return;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return reply.code(400).send({ error: 'Invalid lead id' });
    }

    const [updated] = await app.db
      .update(contactLeads)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(contactLeads.id, req.params.id))
      .returning();

    if (!updated) return reply.code(404).send({ error: 'Sorğu tapılmadı' });

    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'lead.status',
      entityType: 'contact_lead',
      entityId: updated.id,
      ip: clientIp(req),
      meta: { status: body.status },
    });

    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}
