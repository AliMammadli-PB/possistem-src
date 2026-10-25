import {testShopContext,simulateCheckout} from '../lib/billing/test-shop.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod/v3';
import { env } from '../env.js';
import { requireCustomer } from '../plugins/customer-auth.js';
import { requireSuperadmin, currentUser } from '../plugins/auth.js';
import { resolveTenantToken } from './tenant.js';
import { Billing, startBillingWorker, type Settings } from '../lib/billing/service.js';
import { query, event } from '../lib/billing/store.js';
import { BillingError, MAX_MINOR } from '../lib/billing/domain.js';
import { epointConfig } from '../lib/billing/epoint.js';

const uuid=z.string().uuid(), product=z.enum(['market','restaurant','geyim','aptek','topdan']);
const idOf=(req:FastifyRequest)=>uuid.parse((req.params as {id:string}).id);
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const COOKIE='possistem_billing_handoff';
type Limited={customerId:string;product:string;exp:number;csrf:string};
function session(value:Limited){const data=Buffer.from(JSON.stringify(value)).toString('base64url');return data+'.'+createHmac('sha256',env.sessionSecret).update('billing:'+data).digest('base64url');}
function limited(req:FastifyRequest):Limited|null{
  const value=req.cookies?.[COOKIE];if(!value)return null;
  const [data,sig,...extra]=value.split('.');if(!data||!sig||extra.length)return null;
  const expected=createHmac('sha256',env.sessionSecret).update('billing:'+data).digest('base64url');
  if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
  try{const row=JSON.parse(Buffer.from(data,'base64url').toString('utf8')) as Limited;return row.exp>Date.now()&&uuid.safeParse(row.customerId).success&&product.safeParse(row.product).success?row:null;}catch{return null;}
}
function fail(reply:FastifyReply,error:unknown){
  if(error instanceof BillingError)return reply.code(error.httpStatus).send({error:error.message,code:error.code});
  if(error instanceof z.ZodError)return reply.code(400).send({error:'Məlumatları düzgün doldurun.',code:'validation'});
  if((error as {code?:string})?.code==='23505')return reply.code(409).send({error:'Əməliyyat artıq işlənir. Yeniləyib nəticəyə baxın.',code:'operation_in_progress'});
  reply.log.warn({component:'billing',code:(error as {code?:string})?.code},'billing_operation_failed');
  return reply.code(500).send({error:'Ödəniş əməliyyatı tamamlanmadı. Nəticəni yoxlayın.',code:'billing_error'});
}

export async function billingRoutes(app:FastifyInstance,opts:{billing?:Billing;worker?:boolean}={}){
  const billing=opts.billing??new Billing(app.db);
  app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string',bodyLimit:65536},(_req,body,done)=>{done(null,Object.fromEntries(new URLSearchParams(String(body))));});
  const guarded=(fn:(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{reply.header('Cache-Control','private, no-store');try{return await fn(req,reply);}catch(error){return fail(reply,error);}};
  const customer=(fn:(id:string,req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>guarded(async(req,reply)=>{const c=requireCustomer(req,reply);if(!c)return;return fn(c.id,req,reply);});
  const admin=(fn:(actor:string,req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>guarded(async(req,reply)=>{if(!requireSuperadmin(req,reply))return;return fn(currentUser(req).id,req,reply);});

  app.post('/billing/epoint/callback',{config:{rateLimit:{max:600,timeWindow:'1 minute'}}},guarded(async(req)=>{const b=req.body as {data?:unknown;signature?:unknown};return billing.callback(b?.data,b?.signature);}));
  app.get('/billing/test/context',guarded(async req=>testShopContext(app.db,req)));
  app.post('/billing/test/checkout',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},guarded(async req=>{
    const input=z.object({mode:z.literal('simulation'),accepted:z.literal(true),productId:z.string().min(1).max(150),qty:z.number().int().min(1).max(10),outcome:z.enum(['success','failure']),requestId:uuid}).strict().parse(req.body);
    return simulateCheckout(app.db,req,input);
  }));
  app.get('/billing/options',guarded(async()=>{const s=await billing.settings();return {pickupAddress:s.pickup_address,deliveryAvailable:s.delivery_fee_minor!==null,deliveryFeeMinor:s.delivery_fee_minor===null?null:Number(s.delivery_fee_minor),legal:s.legal,paymentsAvailable:s.enabled&&Boolean(billing.gateway()?.config.liveVerified)};}));
  app.get('/billing/terms',guarded(async(req)=>{
    const version=String((req.query as {version?:string}).version??'').slice(0,100);
    if(version){const [row]=await query<{content:unknown}>(app.db,sql`SELECT content FROM billing_terms WHERE version=${version}`);return {legal:row?.content??null};}
    return {legal:(await billing.settings()).legal};
  }));
  app.get('/customer/billing/notifications',customer(async id=>({notifications:await query(app.db,sql`SELECT id,kind,title,body,payload,read_at AS "readAt",created_at AS "createdAt" FROM owner_notifications WHERE customer_id=${id}::uuid ORDER BY created_at DESC LIMIT 100`),...((await query(app.db,sql`SELECT count(*)::int AS unread FROM owner_notifications WHERE customer_id=${id}::uuid AND read_at IS NULL`))[0]??{})})));
  app.post('/customer/billing/notifications/read',customer(async(id,req)=>{const b=z.object({id:uuid.optional()}).parse(req.body??{});await app.db.execute(sql`UPDATE owner_notifications SET read_at=now() WHERE customer_id=${id}::uuid AND read_at IS NULL AND (${b.id??null}::uuid IS NULL OR id=${b.id??null}::uuid)`);return {ok:true};}));
  app.get('/customer/billing',customer(async id=>billing.listSubscriptions(id)));
  app.get('/customer/billing/orders',customer(async id=>({orders:await billing.orders(id)})));
  app.get('/customer/billing/shop-orders',customer(async(id,req)=>{
    const b=z.object({before:z.string().datetime().optional(),beforeId:uuid.optional(),q:z.string().max(100).default(''),filter:z.enum(['all','paid','pending']).default('all')}).parse(req.query);
    if(Boolean(b.before)!==Boolean(b.beforeId))throw new BillingError('invalid_cursor','Səhifəni yenidən açın.',400);
    const rows=await query<{id:string;created_at:string|Date;cursor_created_at:string}>(app.db,sql`SELECT id,order_no,amount_minor,currency,kind,status,fulfillment_status,created_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM billing_orders WHERE customer_id=${id}::uuid AND kind='shop' AND (${b.q}='' OR position(lower(${b.q}) in lower(order_no))>0) AND (${b.filter}='all' OR (${b.filter}='paid' AND status='paid') OR (${b.filter}='pending' AND status IN ('awaiting_payment','processing','unknown'))) AND (${b.before??null}::timestamptz IS NULL OR (created_at,id)<(${b.before??null}::timestamptz,${b.beforeId??null}::uuid)) ORDER BY created_at DESC,id DESC LIMIT 26`);
    const more=rows.length>25,orders=rows.slice(0,25),last=orders.at(-1);return {orders,next:more&&last?{before:last.cursor_created_at,beforeId:last.id}:null};
  }));
  app.get('/customer/billing/orders/:id',customer(async(id,req)=>billing.order(id,idOf(req))));
  app.post('/customer/billing/subscriptions/:id/checkout',customer(async(id,req)=>{
    const body=z.object({requestId:uuid,priceVersion:z.number().int().positive(),saveCard:z.boolean().default(false),paymentMode:z.enum(['manual','automatic']).optional(),termsVersion:z.string().max(100).optional()}).parse(req.body);
    return billing.subscriptionCheckout(id,idOf(req),body,req.ip);
  }));
  app.post('/customer/billing/subscriptions/:id/consent',customer(async(id,req)=>billing.consent(id,idOf(req),z.object({enabled:z.boolean(),priceVersion:z.number().int().positive().optional(),termsVersion:z.string().max(100).optional()}).parse(req.body),req.ip)));
  app.post('/customer/billing/quote',customer(async(id,req)=>{
    const b=z.object({partnerProof:z.string().max(2000).optional(),items:z.array(z.object({id:z.string().min(1).max(150),qty:z.number().int().min(1).max(1000000)})).min(1).max(50).refine(xs=>new Set(xs.map(x=>x.id)).size===xs.length),shipping:z.object({kind:z.enum(['pickup','delivery']),name:z.string().trim().min(2).max(150),phone:z.string().trim().min(7).max(40),address:z.string().trim().max(1000)}).refine(s=>s.kind==='pickup'||s.address.length>=5)}).parse(req.body);
    return billing.quote(id,b.items,b.shipping,b.partnerProof);
  }));
  app.post('/customer/billing/checkout',customer(async(id,req)=>{const b=z.object({quoteId:uuid,requestId:uuid,termsVersion:z.string().min(1).max(100)}).parse(req.body);return billing.shopCheckout(id,b.quoteId,b.requestId,b.termsVersion);}));

  app.get('/admin/billing/customers',admin(async(_actor,req)=>{
    const term=String((req.query as {q?:string}).q??'').trim().slice(0,100);
    const rows=await query(app.db,sql`SELECT id,name,email FROM customers WHERE active=true AND (name ILIKE ${'%'+term+'%'} OR email ILIKE ${'%'+term+'%'}) ORDER BY name LIMIT 50`);
    return {customers:rows};
  }));
  app.get('/admin/billing',admin(async()=>{
    const [subscriptions,orders,payments,events]=await Promise.all([
      query(app.db,sql`SELECT s.id,s.customer_id,c.name,c.email,s.product,s.monthly_amount_minor,s.enabled,s.paid_until,s.price_version,s.auto_renew,s.card_mask FROM billing_subscriptions s JOIN customers c ON c.id=s.customer_id ORDER BY s.updated_at DESC LIMIT 300`),
      query(app.db,sql`SELECT o.*,c.name AS customer_name,c.email FROM billing_orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC LIMIT 300`),
      query(app.db,sql`SELECT a.id,a.order_id,a.provider_order_id,a.kind,a.status,a.transaction_id,a.response,a.created_at,a.updated_at,o.order_no,o.amount_minor,c.name AS customer_name FROM billing_attempts a JOIN billing_orders o ON o.id=a.order_id JOIN customers c ON c.id=o.customer_id ORDER BY a.created_at DESC LIMIT 300`),
      query(app.db,sql`SELECT * FROM billing_events ORDER BY id DESC LIMIT 200`),
    ]);return {subscriptions,orders,payments,events};
  }));
  app.post('/admin/billing/subscriptions',admin(async(actor,req)=>{
    const b=z.object({customerId:uuid,product,monthlyAmountMinor:z.number().int().min(1).max(MAX_MINOR),enabled:z.boolean().default(true),startsAt:z.string().datetime().optional()}).parse(req.body);
    return billing.configureSubscription(actor,b);
  }));
  app.get('/admin/billing/orders/:id',admin(async(_actor,req)=>{const [o]=await query<{customer_id:string}>(app.db,sql`SELECT customer_id FROM billing_orders WHERE id=${idOf(req)}::uuid`);if(!o)throw new BillingError('order_missing','Sifariş tapılmadı.',404);return billing.order(o.customer_id,idOf(req));}));
  app.post('/admin/billing/orders/:id/refund',admin(async(actor,req)=>billing.refund(actor,idOf(req),z.object({reason:z.string().trim().min(3).max(1000)}).parse(req.body).reason)));
  app.post('/admin/billing/payments/:id/reconcile',admin(async(actor,req)=>{
    const id=idOf(req),b=z.object({transactionId:z.string().trim().regex(/^[a-zA-Z0-9_-]{3,150}$/).optional()}).parse(req.body??{});
    if(b.transactionId)await app.db.transaction(async tx=>{
      const [a]=await query<{transaction_id:string|null;status:string}>(tx,sql`SELECT transaction_id,status FROM billing_attempts WHERE id=${id}::uuid FOR UPDATE`);
      if(!a||a.transaction_id||a.status!=='unknown')throw new BillingError('cannot_attach','Yalnız nömrəsi olmayan qeyri-müəyyən əməliyyata bank nömrəsi bağlamaq olar.');
      // Do not accept an arbitrary successful bank transaction as payment for
      // this order. Reconciliation still validates amount AND provider order ID.
      const gateway=billing.gateway();if(!gateway)throw new BillingError('gateway_unavailable','Epoint qoşulmayıb.',503);
      const status=await gateway.call('get-status',{transaction:b.transactionId});
      const [full]=await query<{provider_order_id:string}>(tx,sql`SELECT provider_order_id FROM billing_attempts WHERE id=${id}::uuid`);
      if(status.order_id!==full!.provider_order_id)throw new BillingError('bank_reference_unverified','Bank cavabında sifariş əlaqəsi təsdiqlənmədi. Epoint dəstəyi ilə dəqiqləşdirin.');
      await tx.execute(sql`UPDATE billing_attempts SET transaction_id=${b.transactionId},updated_at=now() WHERE id=${id}::uuid`);
      await event(tx,actor,'payment.reference.attach',id,{transactionId:b.transactionId});
    });
    await billing.reconcile(id);return {ok:true};
  }));
  app.patch('/admin/billing/orders/:id',admin(async(actor,req)=>{
    const b=z.object({fulfillmentStatus:z.enum(['preparing','ready','dispatched','completed','cancelled']),note:z.string().max(2000).default('')}).parse(req.body);
    const id=idOf(req);
    await app.db.transaction(async tx=>{
      const [o]=await query<{status:string;fulfillment_status:string}>(tx,sql`SELECT status,fulfillment_status FROM billing_orders WHERE id=${id}::uuid AND kind='shop' FOR UPDATE`);
      if(!o||o.status!=='paid')throw new BillingError('not_paid','Yalnız stoku təsdiqlənmiş ödənilmiş sifariş təhvil verilə bilər.');
      if(o.fulfillment_status==='completed'&&b.fulfillmentStatus!=='completed')throw new BillingError('already_delivered','Təhvil verilmiş sifarişi geriyə keçirmək olmaz.');
      await tx.execute(sql`UPDATE billing_orders SET fulfillment_status=${b.fulfillmentStatus},note=${b.note},updated_at=now() WHERE id=${id}::uuid`);
      await event(tx,actor,'order.fulfillment',id,b);
    });return {ok:true};
  }));
  app.get('/admin/billing/settings',admin(async()=>{
    const config=epointConfig();return {settings:await billing.settings(),configured:Boolean(config),liveVerified:Boolean(config?.liveVerified),callbackUrl:'https://possistem.az/pos/api/billing/epoint/callback'};
  }));
  app.patch('/admin/billing/settings',admin(async(actor,req)=>{
    const b=z.object({enabled:z.boolean(),recurringEnabled:z.boolean(),enforcementEnabled:z.boolean().default(false),pickupAddress:z.string().trim().max(1000),deliveryFeeMinor:z.number().int().min(0).max(MAX_MINOR).nullable(),legal:z.object({version:z.string().trim().max(100),sellerName:z.string().trim().max(300),voen:z.string().trim().max(30),address:z.string().trim().max(1000),phone:z.string().trim().max(50),subscriptionTerms:z.string().max(20000),refundTerms:z.string().max(20000),deliveryTerms:z.string().max(20000),privacyPolicy:z.string().max(20000)})}).parse(req.body);
    if(b.enforcementEnabled&&!b.enabled)throw new BillingError('enforcement_requires_payments','Məcburi abunəlik üçün yoxlanılmış onlayn ödəniş açıq olmalıdır.');
    if(b.enabled){
      const config=epointConfig();if(!config?.liveVerified)throw new BillingError('live_not_verified','Epoint açarları və real bank yoxlaması serverdə təsdiqlənməlidir.');
      if(Object.values(b.legal).some(v=>!v.trim())||!b.pickupAddress)throw new BillingError('legal_required','Satıcı məlumatları və ödəniş şərtlərini tamamlayın.');
    }
    await app.db.transaction(async tx=>{
      const [previous]=await query<Settings>(tx,sql`SELECT * FROM billing_settings WHERE id=true FOR UPDATE`);
      if(b.legal.version){
        const [existing]=await query<{content:Record<string,unknown>}>(tx,sql`SELECT content FROM billing_terms WHERE version=${b.legal.version}`);
        const same=(v:Record<string,unknown>)=>Object.keys(b.legal).every(k=>v[k]===b.legal[k as keyof typeof b.legal]);
        if(existing&&!same(existing.content))throw new BillingError('terms_version_used','Mətn dəyişib. Şərtlərə yeni versiya nömrəsi verin.');
        if(previous?.legal.version===b.legal.version&&!same(previous.legal))throw new BillingError('terms_version_used','Şərtlərin yeni versiyasını yazın.');
        await tx.execute(sql`INSERT INTO billing_terms(version,content) VALUES(${b.legal.version},${JSON.stringify(b.legal)}::jsonb) ON CONFLICT DO NOTHING`);
      }
      await tx.execute(sql`UPDATE billing_settings SET enforcement_enabled=${b.enforcementEnabled},enabled=${b.enabled},recurring_enabled=${b.recurringEnabled},pickup_address=${b.pickupAddress},delivery_fee_minor=${b.deliveryFeeMinor},legal=${JSON.stringify(b.legal)}::jsonb,updated_at=now() WHERE id=true`);
      await event(tx,actor,'billing.settings','settings',{enabled:b.enabled,recurringEnabled:b.recurringEnabled,termsVersion:b.legal.version});
    });return {ok:true};
  }));

  // Native applications authenticate with their existing tenant bearer token.
  app.post('/billing/desktop/status',guarded(async(req,reply)=>{
    const raw=req.headers.authorization,who=resolveTenantToken(typeof raw==='string'?raw.replace(/^Bearer\s+/i,''):undefined,true);
    if(!who)return reply.code(401).send({error:'Yenidən daxil olun.'});
    const b=z.object({product}).parse(req.body);
    const [active]=await query(app.db,sql`SELECT id FROM customers WHERE id=${who.customerId}::uuid AND active=true`);if(!active)return reply.code(401).send({error:'Hesab deaktivdir.'});
    const data=await billing.listSubscriptions(who.customerId);return {...data,subscriptions:data.subscriptions.filter(s=>s.product===b.product),billingOnly:who.client==='billing'};
  }));
  app.post('/billing/desktop/handoff',guarded(async(req,reply)=>{
    const raw=req.headers.authorization,identity=resolveTenantToken(typeof raw==='string'?raw.replace(/^Bearer\s+/i,''):undefined,true);
    if(!identity)return reply.code(401).send({error:'Yenidən daxil olun.'});
    const b=z.object({product}).parse(req.body);
    const [exists]=await query(app.db,sql`SELECT s.id FROM billing_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.customer_id=${identity.customerId}::uuid AND s.product=${b.product} AND c.active AND s.enabled`);
    if(!exists)throw new BillingError('subscription_missing','Abunəlik tapılmadı.',404);
    const token=randomBytes(32).toString('base64url');
    await app.db.execute(sql`INSERT INTO billing_handoffs(token_hash,customer_id,product,expires_at) VALUES(${digest(token)},${identity.customerId}::uuid,${b.product},now()+interval '90 seconds')`);
    return {url:'https://possistem.az/odenis/davam?handoff='+token};
  }));
  app.post('/billing/handoff',guarded(async(req,reply)=>{
    const token=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).parse(req.body).token;
    const [row]=await query<{customer_id:string;product:string}>(app.db,sql`UPDATE billing_handoffs h SET used_at=now() FROM customers c WHERE h.token_hash=${digest(token)} AND h.used_at IS NULL AND h.expires_at>now() AND c.id=h.customer_id AND c.active RETURNING h.customer_id,h.product`);
    if(!row)throw new BillingError('handoff_expired','Keçidin vaxtı bitib. Tətbiqdən yenidən açın.',401);
    const limitedSession:Limited={customerId:row.customer_id,product:row.product,exp:Date.now()+3600_000,csrf:randomBytes(24).toString('base64url')};
    reply.setCookie(COOKIE,session(limitedSession),{httpOnly:true,secure:true,sameSite:'lax',path:'/pos/api/billing/site',maxAge:3600});
    return {ok:true,csrfToken:limitedSession.csrf};
  }));
  const site=(fn:(who:Limited,req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>guarded(async(req,reply)=>{
    const who=limited(req);if(!who)return reply.code(401).send({error:'Keçidin vaxtı bitib. Tətbiqdən yenidən açın.'});
    const [active]=await query(app.db,sql`SELECT id FROM customers WHERE id=${who.customerId}::uuid AND active=true`);if(!active)return reply.code(401).send({error:'Hesab deaktivdir.'});
    if(req.method!=='GET'&&req.headers['x-csrf-token']!==who.csrf)return reply.code(403).send({error:'Ödənişi yenidən açın.'});
    return fn(who,req,reply);
  });
  app.get('/billing/site',site(async who=>{const result=await billing.listSubscriptions(who.customerId);return {...result,subscriptions:result.subscriptions.filter(s=>s.product===who.product),csrfToken:who.csrf};}));
  app.post('/billing/site/checkout',site(async(who,req)=>{
    const b=z.object({requestId:uuid,priceVersion:z.number().int().positive(),saveCard:z.boolean(),paymentMode:z.enum(['manual','automatic']).optional(),termsVersion:z.string().max(100).optional()}).parse(req.body);
    const [sub]=await query<{id:string}>(app.db,sql`SELECT id FROM billing_subscriptions WHERE customer_id=${who.customerId}::uuid AND product=${who.product}`);
    if(!sub)throw new BillingError('subscription_missing','Abunəlik yoxdur.',404);
    return billing.subscriptionCheckout(who.customerId,sub.id,b,req.ip);
  }));
  app.get('/billing/site/orders/:id',site(async(who,req)=>{
    const id=idOf(req),[allowed]=await query(app.db,sql`SELECT o.id FROM billing_orders o JOIN billing_subscriptions s ON s.id=o.subscription_id WHERE o.id=${id}::uuid AND o.customer_id=${who.customerId}::uuid AND s.product=${who.product}`);
    if(!allowed)throw new BillingError('order_missing','Sifariş tapılmadı.',404);
    const info=await billing.order(who.customerId,id);return {order:info.order};
  }));
  if(opts.worker!==false){const stop=startBillingWorker(billing,app.log);app.addHook('onClose',async()=>stop());}
}
