import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod/v3';
import { parseBody } from '../lib/validate.js';
import { requireSuperadmin } from '../plugins/auth.js';

const text = (max: number) => z.string().trim().max(max);

const LangContent = z.object({
  name: text(40),
  badge: text(24),
  tagline: text(80),
  features: z.array(text(120).min(1)).max(20),
});

const PlanContent = z.object({
  az: LangContent.extend({ name: text(40).min(1) }),
  en: LangContent,
  ru: LangContent,
});

const UpdatePlanSchema = z
  .object({
    monthlyPriceMinor: z.number().int().min(0).max(100_000_000).optional(),
    content: PlanContent.optional(),
  })
  .refine((b) => b.monthlyPriceMinor !== undefined || b.content !== undefined, {
    message: 'Nothing to update',
  });

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export async function subscriptionPlansRoutes(app: FastifyInstance) {
  // Public — website and admin Tariflər page read these.
  app.get('/subscription-plans', async () => {
    const result = await app.db.execute(sql`
      SELECT id,
             name,
             name_az AS "nameAz",
             description_az AS "descriptionAz",
             features,
             content,
             monthly_price_minor AS "monthlyPriceMinor",
             sort_order AS "sortOrder"
      FROM subscription_plans
      WHERE active = true
      ORDER BY sort_order
    `);
    return { plans: rowsOf(result) };
  });

  // Admin — price and/or website card texts (features, badge, chat bullets…).
  app.patch('/subscription-plans/:planId', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { planId } = req.params as { planId: string };
    const body = parseBody(UpdatePlanSchema, req.body, reply);
    if (!body) return;

    const price = body.monthlyPriceMinor ?? null;
    const content = body.content ? JSON.stringify(body.content) : null;
    const result = await app.db.execute(sql`
      UPDATE subscription_plans
      SET monthly_price_minor = COALESCE(${price}::bigint, monthly_price_minor),
          content = COALESCE(${content}::jsonb, content),
          name_az = COALESCE(${body.content?.az.name ?? null}::text, name_az),
          updated_at = now()
      WHERE id = ${planId} AND active = true
      RETURNING id
    `);
    if (rowsOf(result).length === 0) {
      return reply.code(404).send({ error: 'Plan tapılmadı' });
    }

    return { planId, ok: true };
  });
}
