import { query as billingQuery } from '../lib/billing/store.js';
import { licenseBilling } from '../lib/billing/service.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {z} from 'zod';
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

/** Both password login and grant resumption use the same serialized seat policy. */
async function bindTenantHardware(app:FastifyInstance,customerId:string,hwid:string,bypass:boolean){
 return app.db.transaction(async tx=>{
  const [current]=await billingQuery<{bound_hwid:string|null;active:boolean}>(tx,sql`SELECT bound_hwid,active FROM customers WHERE id=${customerId}::uuid FOR UPDATE`);
  if(!current?.active)return {error:'Hesab deaktivdir.',code:'CUSTOMER_INACTIVE'};
  if(bypass){await tx.execute(sql`UPDATE customers SET bound_hwid=NULL,updated_at=now() WHERE id=${customerId}::uuid`);return {boundHwid:null};}
  if(!hwid||current.bound_hwid===hwid)return {boundHwid:current.bound_hwid};
  if(!current.bound_hwid){await tx.execute(sql`UPDATE customers SET bound_hwid=${hwid},updated_at=now() WHERE id=${customerId}::uuid`);return {boundHwid:hwid};}
  const known=await billingQuery<{hwid:string}>(tx,sql`SELECT hwid FROM customer_hwids WHERE customer_id=${customerId}::uuid`);
  if(!known.some(r=>r.hwid===hwid)){
   const [row]=await billingQuery<{seats:number}>(tx,sql`SELECT COALESCE(SUM(seats),1)::int AS seats FROM licenses WHERE customer_id=${customerId}::uuid AND status='active'`);
   const seats=Math.max(1,Number(row?.seats??1));
   if(1+known.length>=seats)return {error:`Bu hesabda boş kompüter yeri qalmayıb (${seats}). Admin yer əlavə etməli və ya HWID-i sıfırlamalıdır.`,code:'HWID_MISMATCH'};
   await tx.execute(sql`INSERT INTO customer_hwids(customer_id,hwid) VALUES(${customerId}::uuid,${hwid}) ON CONFLICT DO NOTHING`);
  }
  return {boundHwid:current.bound_hwid};
 });
}

export async function tenantRoutes(app: FastifyInstance) {
  // Reuse the normal customer, product and hardware checks when a password-
  // authenticated billing session gains access. Never turn a browser redirect
  // or a different customer's/device's grant into a POS login.
  type Resume={customerId:string;email:string;product:'restaurant'|'market'|'geyim'|'aptek'|'topdan';hwid:string;expiresAt:number};
  const login=async(req:FastifyRequest,reply:FastifyReply,resume?:Resume)=>{
      const body = resume ? {email:resume.email,password:'',client:'pos' as const,product:resume.product,hwid:resume.hwid} : parseBody(TenantLoginRequestSchema, req.body, reply);
      if (!body) return;

      const email = body.email.toLowerCase().trim();
      const client = body.client ?? (body.hwid ? 'pos' : 'legacy');
      const [customer] = await app.db
        .select()
        .from(customers)
        .where(and(sql`lower(${customers.email}) = ${email}`, eq(customers.active, true)))
        .limit(1);

      if (!customer?.passwordHash || (resume && resume.customerId!==customer.id)) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const ok = resume ? true : await verifyPassword(customer.passwordHash, body.password);
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
          const [managed] = await billingQuery(app.db,sql`SELECT l.id FROM billing_subscriptions s JOIN billing_license_links b ON b.subscription_id=s.id JOIN licenses l ON l.id=b.license_id WHERE s.customer_id=${customer.id}::uuid AND s.product=${requestedProduct} AND l.status NOT IN ('revoked','suspended') LIMIT 1`);
          if (managed) { const details=await licenseBilling(app.db,String((managed as {id:unknown}).id)); billingOnly=!(details?.hasAccess||details?.billingEnforced===false); }
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
      if (!billingOnly && (bypassHwid || client==='pos' || (client!=='owner' && body.hwid))) {
        const hwid=(body.hwid??'').trim();
        if(client==='pos'&&!hwid)return reply.code(400).send({error:'HWID (device fingerprint) required for POS login'});
        const hardware=await bindTenantHardware(app,customer.id,hwid,bypassHwid);
        if('error' in hardware)return reply.code(403).send(hardware);
        customer.boundHwid=hardware.boundHwid;
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
      const expiresAt = Math.min(Date.now() + TENANT_TTL_MS,resume?.expiresAt??Infinity);
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
        action: resume ? 'tenant.access.resume' : client === 'owner' ? 'owner.login' : 'tenant.login',
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
  };
  app.post('/tenant/login',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},(req,reply)=>login(req,reply));
  app.post('/tenant/resume',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async(req,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const raw=String(req.headers.authorization??'').replace(/^Bearer\s+/i,'');
    const session=verifySignedTenantToken(raw);
    if(!session||session.client!=='billing')return reply.code(401).send({error:'Yenidən daxil olun.'});
    const [revocation]=await billingQuery(app.db,sql`SELECT token_hash FROM tenant_session_revocations WHERE token_hash=${hashSessionToken(raw)} AND expires_at>now()`);
    if(revocation)return reply.code(401).send({error:'Yenidən daxil olun.'});
    const parsed=z.object({product:z.enum(['restaurant','market','geyim','aptek','topdan']),hwid:z.string().trim().min(8).max(512)}).strict().safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:'POS və kompüter məlumatını yoxlayın.'});
    const {product,hwid}=parsed.data;
    const [managed]=await billingQuery<{id:string}>(app.db,sql`SELECT l.id FROM billing_subscriptions s JOIN billing_license_links b ON b.subscription_id=s.id JOIN licenses l ON l.id=b.license_id JOIN customers c ON c.id=l.customer_id WHERE s.customer_id=${session.customerId}::uuid AND l.customer_id=${session.customerId}::uuid AND c.active=true AND s.product=${product} AND COALESCE(l.features->>'vertical',l.features->>'product',CASE WHEN l.plan IN ('market','geyim','aptek','topdan') THEN l.plan ELSE 'restaurant' END)=${product} AND l.status NOT IN ('revoked','suspended') LIMIT 1`);
    if(!managed||!(await licenseBilling(app.db,managed.id))?.hasAccess)return reply.code(403).send({code:'POS_ACCESS_PENDING',error:'Aktiv istifadə icazəsi yoxdur.'});
    return login(req,reply,{...session,product,hwid});
  });

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
