import { query as billingQuery } from '../lib/billing/store.js';
import { licenseBilling } from '../lib/billing/service.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { TenantLoginRequestSchema } from '@milioner/contracts';
import { activationKeys, customers, featureFlags, licenses } from '@milioner/database';
import {
  generateSessionToken,
  hashSessionToken,
  verifyPassword,
} from '@milioner/security';
import { env } from '../env.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';

/** Owner/POS tenant session TTL. */
const TENANT_TTL_MS = 12 * 3600_000;

type TenantSession = {
  customerId: string;
  email: string;
  client: string;
  expiresAt: number;
};

/** Optional cache + logout revoke list (signed tokens survive API restart). */
const tenantTokens = new Map<string, TenantSession>();
const revoked = new Set<string>();

type SignedPayload = {
  customerId: string;
  email: string;
  client: string;
  exp: number;
  iat?: number;
  jti: string;
};

function pruneTokens(now = Date.now()) {
  for (const [hash, row] of tenantTokens) {
    if (row.expiresAt <= now) tenantTokens.delete(hash);
  }
}

function signTenantPayload(payload: SignedPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  return `t1.${body}.${sig}`;
}

function verifySignedTenantToken(raw: string): TenantSession | null {
  if (!raw.startsWith('t1.')) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const body = parts[1]!;
  const sig = parts[2]!;
  const expect = createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
    if (!payload?.customerId || !payload.exp || payload.exp <= Date.now()) return null;
    if (payload.jti && revoked.has(payload.jti)) return null;
    return {
      customerId: payload.customerId,
      email: payload.email,
      client: payload.client || 'owner',
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function resolveTenantToken(raw: string | undefined, allowBilling = false): {
  customerId: string;
  email: string;
  client: string;
} | null {
  if (!raw) return null;
  pruneTokens();

  // New durable signed tokens (survive process restart / deploy).
  const signed = verifySignedTenantToken(raw);
  if (signed) {
    if (signed.client === 'billing' && !allowBilling) return null;
    return {
      customerId: signed.customerId,
      email: signed.email,
      client: signed.client,
    };
  }

  // Legacy in-memory tokens (pre-fix logins until user re-authenticates).
  const row = tenantTokens.get(hashSessionToken(raw));
  if (!row || row.expiresAt <= Date.now() || (row.client === 'billing' && !allowBilling)) return null;
  return { customerId: row.customerId, email: row.email, client: row.client };
}

async function resolvePaymentUrl(app: FastifyInstance): Promise<string | null> {
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

export async function tenantRoutes(app: FastifyInstance) {
  app.post(
    '/tenant/login',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const body = parseBody(TenantLoginRequestSchema, req.body, reply);
      if (!body) return;

      const email = body.email.toLowerCase().trim();
      const client = body.client ?? (body.hwid ? 'pos' : 'legacy');
      const [customer] = await app.db
        .select()
        .from(customers)
        .where(and(sql`lower(${customers.email}) = ${email}`, eq(customers.active, true)))
        .limit(1);

      if (!customer?.passwordHash) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const ok = await verifyPassword(customer.passwordHash, body.password);
      if (!ok) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const requestedProduct = body.product;
      let billingOnly = false;
      if (client === 'pos' && requestedProduct) {
        const [productLicense] = await app.db
          .select({ id: licenses.id })
          .from(licenses)
          .innerJoin(activationKeys, eq(activationKeys.licenseId, licenses.id))
          .where(
            and(
              eq(licenses.customerId, customer.id),
              eq(licenses.status, 'active'),
              eq(activationKeys.product, requestedProduct),
              // The parentheses are load-bearing: drizzle's and() joins operands
              // with bare " and ", and SQL binds AND tighter than OR. Without
              // them the trailing `expiresAt >= now()` becomes its own disjunct,
              // unscoped from customerId, so ANY account passes this gate as
              // long as some activation key somewhere has a future expiry.
              sql`(${licenses.validUntil} IS NULL OR ${licenses.validUntil} >= now())`,
              sql`${activationKeys.revokedAt} IS NULL`,
              sql`(${activationKeys.expiresAt} IS NULL OR ${activationKeys.expiresAt} >= now())`,
            ),
          )
          .limit(1);
        if (!productLicense) {
          const [managed] = await billingQuery(app.db,sql`SELECT l.id FROM billing_subscriptions s JOIN billing_license_links b ON b.subscription_id=s.id JOIN licenses l ON l.id=b.license_id WHERE s.customer_id=${customer.id}::uuid AND s.product=${requestedProduct} AND s.enabled=true AND l.status NOT IN ('revoked','suspended') LIMIT 1`);
          if (managed) { const details=await licenseBilling(app.db,String((managed as {id:unknown}).id)); billingOnly=details?.billingEnforced!==false; }
          else return reply.code(403).send({
            /* geyim-product: login */
            error: `Bu hesab üçün ${({ restaurant: 'Restoran POS', market: 'Market POS', geyim: 'Geyim POS', aptek: 'Aptek POS' /* aptek-product */, topdan: 'Topdan POS' /* topdan-product */ } as Record<string, string>)[requestedProduct]} lisenziyası yoxdur`,
            code: 'POS_PRODUCT_NOT_LICENSED',
          });
        }
      }

      // POS: bind email → one PC. Owner web skips HWID. Legacy clients (pre-1.1.13) skip until upgraded.
      // Internal admin test accounts (POS_HWID_BYPASS_EMAILS) skip bind entirely so they can use any POS.
      const bypassHwid = env.posHwidBypassEmails.has(email);
      if (!billingOnly && !bypassHwid && (client === 'pos' || (client !== 'owner' && body.hwid))) {
        const hwid = (body.hwid ?? '').trim();
        if (client === 'pos' && !hwid) {
          return reply.code(400).send({ error: 'HWID (device fingerprint) required for POS login' });
        }
        if (hwid) {
          if (!customer.boundHwid) {
            await app.db
              .update(customers)
              .set({ boundHwid: hwid, updatedAt: new Date() })
              .where(eq(customers.id, customer.id));
            customer.boundHwid = hwid;
          } else if (customer.boundHwid !== hwid) {
            // A shop runs the till, the kitchen and the store room on separate
            // PCs under one account. The first PC stays in bound_hwid; the rest
            // are listed, up to the seats the customer's active licences have.
            const known = (await app.db.execute(sql`
              SELECT hwid FROM customer_hwids WHERE customer_id = ${customer.id}::uuid
            `)) as unknown as Array<{ hwid: string }>;
            if (!known.some((row) => row.hwid === hwid)) {
              const [seatRow] = (await app.db.execute(sql`
                SELECT COALESCE(SUM(seats), 1)::int AS seats FROM licenses
                WHERE customer_id = ${customer.id}::uuid AND status = 'active'
              `)) as unknown as Array<{ seats: number }>;
              const seats = Math.max(1, Number(seatRow?.seats ?? 1));
              if (1 + known.length >= seats) {
                return reply.code(403).send({
                  error: `Bu hesabda boş kompüter yeri qalmayıb (${seats}). Admin yer əlavə etməli və ya HWID-i sıfırlamalıdır.`,
                  code: 'HWID_MISMATCH',
                });
              }
              await app.db.execute(sql`
                INSERT INTO customer_hwids (customer_id, hwid) VALUES (${customer.id}::uuid, ${hwid})
                ON CONFLICT DO NOTHING
              `);
            }
          }
        }
      } else if (bypassHwid && customer.boundHwid) {
        await app.db
          .update(customers)
          .set({ boundHwid: null, updatedAt: new Date() })
          .where(eq(customers.id, customer.id));
        customer.boundHwid = null;
      }

      await app.db
        .update(licenses)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(
          and(
            eq(licenses.customerId, customer.id),
            eq(licenses.status, 'active'),
            sql`${licenses.validUntil} IS NOT NULL AND ${licenses.validUntil} < now()`,
          ),
        );

      const licenseRows = await app.db
        .select()
        .from(licenses)
        .where(eq(licenses.customerId, customer.id))
        .orderBy(desc(licenses.createdAt))
        .limit(5);

      if (!customer.notifyEmail && customer.email) {
        await app.db
          .update(customers)
          .set({ notifyEmail: customer.email, updatedAt: new Date() })
          .where(eq(customers.id, customer.id));
      }

      const billingDetails = await Promise.all(licenseRows.map(l => licenseBilling(app.db,l.id)));
      const selectedBilling = requestedProduct ? billingDetails.find((b,i)=>b && (licenseRows[i]?.features?.vertical || licenseRows[i]?.features?.product) === requestedProduct) : billingDetails.find(Boolean);
      const paymentUrl = selectedBilling?.paymentUrl ?? await resolvePaymentUrl(app);
      const expiresAt = Date.now() + TENANT_TTL_MS;
      const jti = generateSessionToken();
      const token = signTenantPayload({
        customerId: customer.id,
        email: customer.email ?? email,
        client: billingOnly ? 'billing' : client,
        exp: expiresAt,
        iat: Date.now(),
        jti,
      });
      pruneTokens();
      tenantTokens.set(hashSessionToken(token), {
        customerId: customer.id,
        email: customer.email ?? email,
        expiresAt,
        client: billingOnly ? 'billing' : client,
      });

      await writeAudit(app, {
        action: client === 'owner' ? 'owner.login' : 'tenant.login',
        entityType: 'customer',
        entityId: customer.id,
        ip: clientIp(req),
        meta: { client, product: requestedProduct ?? null },
      });

      return {
        token,
        expiresAt,
        billingOnly,
        billing: selectedBilling ?? null,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          mustChangePassword: customer.mustChangePassword,
          notifyEmail: customer.notifyEmail ?? customer.email,
          boundHwid: customer.boundHwid ? true : false,
        },
        licenses: licenseRows.map((lic, index) => ({
          ...(billingDetails[index] ?? {}),
          id: lic.id,
          plan: lic.plan,
          seats: lic.seats,
          status: lic.status,
          validUntil: lic.validUntil?.toISOString() ?? null,
          features: lic.features,
        })),
        paymentUrl,
      };
    },
  );

  app.post('/tenant/logout', async (req) => {
    const auth = req.headers.authorization;
    const raw =
      typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : null;
    if (raw && resolveTenantToken(raw, true)) {
      await app.db.execute(sql`DELETE FROM tenant_session_revocations WHERE expires_at<=now()`);
      await app.db.execute(sql`INSERT INTO tenant_session_revocations(token_hash,expires_at) VALUES(${hashSessionToken(raw)},now()+interval '12 hours') ON CONFLICT DO NOTHING`);
      tenantTokens.delete(hashSessionToken(raw));
      if (raw.startsWith('t1.')) {
        try {
          const body = raw.split('.')[1]!;
          const payload = JSON.parse(
            Buffer.from(body, 'base64url').toString('utf8'),
          ) as SignedPayload;
          if (payload.jti) revoked.add(payload.jti);
        } catch {
          /* ignore */
        }
      }
    }
    return { ok: true };
  });

  app.get('/tenant/me', async (req, reply) => {
    const auth = req.headers.authorization;
    const raw =
      typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : null;
    const session = resolveTenantToken(raw ?? undefined);
    if (!session) return reply.code(401).send({ error: 'Unauthorized' });

    const [customer] = await app.db
      .select()
      .from(customers)
      .where(eq(customers.id, session.customerId))
      .limit(1);
    if (!customer || !customer.active) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const licenseRows = await app.db
      .select()
      .from(licenses)
      .where(eq(licenses.customerId, customer.id))
      .orderBy(desc(licenses.createdAt))
      .limit(5);

    const paymentUrl = await resolvePaymentUrl(app);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        mustChangePassword: customer.mustChangePassword,
        notifyEmail: customer.notifyEmail ?? customer.email,
        boundHwid: Boolean(customer.boundHwid),
      },
      licenses: licenseRows.map((lic) => ({
        id: lic.id,
        plan: lic.plan,
        seats: lic.seats,
        status: lic.status,
        validUntil: lic.validUntil?.toISOString() ?? null,
        features: lic.features,
      })),
      paymentUrl,
    };
  });
}

// Checked on every bearer request: deactivation, password changes and logout
// remain effective across process restarts, including the billing-only session.
export async function tenantRequestGuard(app:FastifyInstance,req:import('fastify').FastifyRequest,reply:import('fastify').FastifyReply){
 const auth=req.headers.authorization;if(typeof auth!=='string'||!/^Bearer /i.test(auth))return;
 const raw=auth.slice(7).trim(),who=resolveTenantToken(raw,true);if(!who)return;
 let issuedAt=0;try{issuedAt=Number(JSON.parse(Buffer.from(raw.split('.')[1]??'','base64url').toString()).iat)||0;}catch{}
 const [row]=await billingQuery<{active:boolean;auth_epoch:string|Date;revoked:boolean}>(app.db,sql`SELECT c.active,c.auth_epoch,EXISTS(SELECT 1 FROM tenant_session_revocations r WHERE r.token_hash=${hashSessionToken(raw)} AND r.expires_at>now()) AS revoked FROM customers c WHERE c.id=${who.customerId}::uuid`);
 if(!row||!row.active||row.revoked||new Date(row.auth_epoch).getTime()>issuedAt)return reply.code(401).send({error:'Sessiya bitib. Yenidən daxil olun.'});
}
