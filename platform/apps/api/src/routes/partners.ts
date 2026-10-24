import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { generateSessionToken, generateCsrfToken, hashSessionToken, hashPassword, verifyPassword } from '@milioner/security';
import { env } from '../env.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { currentUser, requireSuperadmin } from '../plugins/auth.js';
import { listPartnerPrices } from '../lib/product-catalog.js';
import { partnerCheckoutProof } from '../lib/billing/partner.js';
import { requireCustomer } from '../plugins/customer-auth.js';

const COOKIE = 'possistem_partner_session';
const COOKIE_PATH = '/pos/api/partner';
const loginName = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._@-]{2,79}$/);
const password = z.string().min(8).max(128);
const CreatePartner = z.object({name:z.string().trim().min(2).max(120),login:loginName,password,phone:z.string().trim().max(40).default('')}).strict();
const EditPartner = z.object({name:z.string().trim().min(2).max(120).optional(),phone:z.string().trim().max(40).optional(),active:z.boolean().optional(),password:password.optional()}).strict().refine(value=>Object.keys(value).length>0);
const Login = z.object({login:loginName,password:z.string().min(1).max(128)}).strict();
type Partner = {id:string;name:string;login:string;phone:string;active:boolean;createdAt:string;updatedAt:string};
type Session = {partner:Partner;csrfToken:string};
const columns=sql`id, name, login, phone, active, created_at AS "createdAt", updated_at AS "updatedAt"`;
function rows<T>(result:unknown):T[]{return (Array.isArray(result)?result:(result as {rows?:T[]})?.rows??[]) as T[];}
function noStore(reply:FastifyReply){reply.header('Cache-Control','private, no-store').header('Vary','Cookie');}
function sameOrigin(req:FastifyRequest,reply:FastifyReply){
  if(req.headers.origin!==`${req.protocol}://${req.headers.host}`){reply.code(403).send({error:'Sorğunun mənbəyi düzgün deyil.'});return false;}
  return true;
}
export async function partnerRoutes(app:FastifyInstance){
  const secure=env.nodeEnv==='production'||env.cookieSecure;
  const cookieOptions={path:COOKIE_PATH,httpOnly:true,sameSite:'strict' as const,secure};
  await app.db.execute(sql`CREATE TABLE IF NOT EXISTS site_partners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, login text NOT NULL UNIQUE,
    phone text NOT NULL DEFAULT '', password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await app.db.execute(sql`CREATE TABLE IF NOT EXISTS site_partner_sessions (
    token_hash text PRIMARY KEY, partner_id uuid NOT NULL REFERENCES site_partners(id) ON DELETE CASCADE,
    csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await app.db.execute(sql`CREATE INDEX IF NOT EXISTS site_partner_sessions_partner_idx ON site_partner_sessions(partner_id)`);
  const dummyHash=await hashPassword('possistem-partner-invalid-account-sentinel');
  async function session(req:FastifyRequest,reply:FastifyReply,optional=false):Promise<Session|null>{
    noStore(reply);const token=req.cookies[COOKIE];
    if(!token||!/^[a-zA-Z0-9_-]{43}$/.test(token)){if(token)reply.clearCookie(COOKIE,cookieOptions);if(!optional)reply.code(401).send({error:'Partnyor hesabına daxil olun.'});return null;}
    const [row]=rows<Partner&{csrfToken:string}>(await app.db.execute(sql`
      SELECT p.id,p.name,p.login,p.phone,p.active,p.created_at AS "createdAt",p.updated_at AS "updatedAt",s.csrf_token AS "csrfToken"
      FROM site_partner_sessions s JOIN site_partners p ON p.id=s.partner_id
      WHERE s.token_hash=${hashSessionToken(token)} AND s.expires_at>now() AND p.active=true LIMIT 1
    `));
    if(!row){reply.clearCookie(COOKIE,cookieOptions);if(!optional)reply.code(401).send({error:'Sessiya bitib. Yenidən daxil olun.'});return null;}
    const {csrfToken,...partner}=row;return {partner,csrfToken};
  }
  // Public session discovery returns null for visitors; protected partner routes still require authentication.
  app.get('/partner/me',async(req,reply)=>session(req,reply,true));
  app.get('/partner/prices',async(req,reply)=>{
    if(!await session(req,reply))return;
    return {prices:await listPartnerPrices()};
  });
  app.post('/partner/checkout-proof',async(req,reply)=>{
    noStore(reply);if(!sameOrigin(req,reply))return;
    const active=await session(req,reply),customer=requireCustomer(req,reply);if(!active||!customer)return;
    if(req.headers['x-partner-csrf']!==active.csrfToken)return reply.code(403).send({error:'Partnyor sessiyasını yeniləyin.'});
    return {proof:partnerCheckoutProof(customer.id,active.partner.id)};
  });
  app.post('/partner/login',{config:{rateLimit:{max:10,timeWindow:'10 minutes'}}},async(req,reply)=>{
    noStore(reply);if(!sameOrigin(req,reply))return;
    const body=parseBody(Login,req.body,reply);if(!body)return;
    const [partner]=rows<Partner&{passwordHash:string}>(await app.db.execute(sql`SELECT ${columns},password_hash AS "passwordHash" FROM site_partners WHERE login=${body.login} LIMIT 1`));
    const valid=await verifyPassword(partner?.passwordHash??dummyHash,body.password);
    if(!partner||!partner.active||!valid)return reply.code(401).send({error:'Login və ya şifrə yanlışdır.'});
    const token=generateSessionToken(),csrfToken=generateCsrfToken(),expires=new Date(Date.now()+12*3600_000);
    // Do not create a session if the password or active state changed during verification.
    const inserted=rows(await app.db.execute(sql`
      INSERT INTO site_partner_sessions(token_hash,partner_id,csrf_token,expires_at)
      SELECT ${hashSessionToken(token)},id,${csrfToken},${expires.toISOString()}::timestamptz FROM site_partners
      WHERE id=${partner.id} AND active=true AND password_hash=${partner.passwordHash} RETURNING token_hash
    `));
    if(!inserted.length)return reply.code(401).send({error:'Login və ya şifrə yanlışdır.'});
    // Bound stale rows without disturbing other active partner accounts.
    await app.db.execute(sql`DELETE FROM site_partner_sessions WHERE expires_at<=now()`);
    reply.setCookie(COOKIE,token,{...cookieOptions,expires});
    const {passwordHash:_hash,...profile}=partner;
    return {partner:profile,csrfToken};
  });
  app.post('/partner/logout',async(req,reply)=>{
    noStore(reply);if(!sameOrigin(req,reply))return;
    const active=await session(req,reply);if(!active)return;
    if(req.headers['x-partner-csrf']!==active.csrfToken)return reply.code(403).send({error:'Sorğunun təhlükəsizlik kodu düzgün deyil.'});
    await app.db.execute(sql`DELETE FROM site_partner_sessions WHERE token_hash=${hashSessionToken(req.cookies[COOKIE]!)}`);
    reply.clearCookie(COOKIE,cookieOptions);return {ok:true};
  });
  app.get('/admin/partners',async(req,reply)=>{
    noStore(reply);if(!requireSuperadmin(req,reply))return;
    return {partners:rows<Partner>(await app.db.execute(sql`SELECT ${columns} FROM site_partners ORDER BY created_at DESC LIMIT 500`))};
  });
  app.post('/admin/partners',async(req,reply)=>{
    noStore(reply);if(!requireSuperadmin(req,reply))return;
    const body=parseBody(CreatePartner,req.body,reply);if(!body)return;
    const hash=await hashPassword(body.password);
    let partner:Partner|undefined;
    try{[partner]=rows<Partner>(await app.db.execute(sql`
      INSERT INTO site_partners(name,login,phone,password_hash) VALUES(${body.name},${body.login},${body.phone},${hash}) RETURNING ${columns}
    `));}catch(err){if((err as {code?:string}).code==='23505'||(err as {cause?:{code?:string}}).cause?.code==='23505')return reply.code(409).send({error:'Bu login artıq istifadə olunur.'});throw err;}
    if(!partner)throw new Error('Partner creation failed');
    await writeAudit(app,{actorUserId:currentUser(req).id,action:'partner.create',entityType:'partner',entityId:partner.id,ip:clientIp(req),meta:{login:partner.login,name:partner.name}});
    return reply.code(201).send({partner});
  });
  app.patch('/admin/partners/:id',async(req,reply)=>{
    noStore(reply);if(!requireSuperadmin(req,reply))return;
    const id=z.string().uuid().safeParse((req.params as {id:string}).id);if(!id.success)return reply.code(404).send({error:'Partnyor tapılmadı.'});
    const body=parseBody(EditPartner,req.body,reply);if(!body)return;
    const hash=body.password?await hashPassword(body.password):null;
    const partner=await app.db.transaction(async tx=>{
      const [updated]=rows<Partner>(await tx.execute(sql`
        UPDATE site_partners SET name=COALESCE(${body.name??null},name),phone=COALESCE(${body.phone??null},phone),
          active=COALESCE(${body.active??null},active),password_hash=COALESCE(${hash},password_hash),updated_at=now()
        WHERE id=${id.data} RETURNING ${columns}
      `));
      if(updated&&(hash||body.active===false))await tx.execute(sql`DELETE FROM site_partner_sessions WHERE partner_id=${id.data}`);
      return updated;
    });
    if(!partner)return reply.code(404).send({error:'Partnyor tapılmadı.'});
    await writeAudit(app,{actorUserId:currentUser(req).id,action:'partner.update',entityType:'partner',entityId:partner.id,ip:clientIp(req),meta:{passwordChanged:Boolean(hash),...(body.active!==undefined?{active:body.active}:{})}});
    return {partner};
  });
}
