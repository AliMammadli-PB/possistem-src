import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb } from '@milioner/database';
import { Epoint,sign } from './epoint.js';
import { query,attachManagedLicense,archiveBillingCustomer } from './store.js';

const url=process.env.BILLING_TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.includes('billing_test'))throw new Error('Use an isolated billing_test database, never the production database.');
const temporary=mkdtempSync(path.join(tmpdir(),'possistem-billing-'));
process.env.PRODUCT_CATALOG_PATH=path.join(temporary,'products.json');
process.env.PRODUCT_OVERRIDES_PATH=path.join(temporary,'overrides.json');
writeFileSync(process.env.PRODUCT_CATALOG_PATH,JSON.stringify({products:[]}));writeFileSync(process.env.PRODUCT_OVERRIDES_PATH,'{}');
const {Billing}=await import('./service.js');
const {publishBillingNotifications,renewalNotice}=await import('./notifications.js');
const db=createDb(url),config={publicKey:'fixture-public',privateKey:'fixture-secret',tokenKey:Buffer.alloc(32,9),baseUrl:'https://fixture.invalid/',origin:'https://possistem.az',liveVerified:true};
let sent:{endpoint:string;payload:Record<string,unknown>}[]=[],responseMode='redirect';
const gateway=new Epoint(config,async(u,init)=>{
  const endpoint=String(u).split('/').at(-1)!;
  const p=JSON.parse(Buffer.from((init!.body as URLSearchParams).get('data')!,'base64').toString());
  sent.push({endpoint,payload:p});
  if(responseMode==='timeout')throw new Error('lost after send');
  if(endpoint==='execute-pay')return new Response(JSON.stringify(responseMode==='decline'?{status:'failed',message:'Declined'}:{status:'success',amount:p.amount,transaction:'tx-'+p.order_id,order_id:p.order_id}));
  return new Response(JSON.stringify({status:'success',redirect_url:'https://epoint.az/fixture',transaction:'tx-'+p.order_id}));
});
const billing=new Billing(db,{gateway,allowLive:true});
const cid=randomUUID(),other=randomUUID();
async function seed(product='market',paidUntil:string|null=null){
  const lid=randomUUID();
  await db.execute(sql`INSERT INTO licenses(id,customer_id,plan,features,status,valid_until) VALUES(${lid}::uuid,${cid}::uuid,${product},${JSON.stringify({product})}::jsonb,'active',now()+interval '30 days')`);
  await db.execute(sql`INSERT INTO activation_keys(id,license_id,expires_at) VALUES(${randomUUID()}::uuid,${lid}::uuid,now()+interval '30 days')`);
  await db.transaction(tx=>attachManagedLicense(tx,{customerId:cid,licenseId:lid,product,monthlyAmountMinor:3000,newCustomer:true}));
  const [s]=await query<{id:string}>(db,sql`SELECT id FROM billing_subscriptions WHERE customer_id=${cid}::uuid AND product=${product}`);
  if(paidUntil)await db.execute(sql`UPDATE billing_subscriptions SET paid_until=${paidUntil}::timestamptz WHERE id=${s!.id}::uuid`);
  return {sid:s!.id,lid};
}
async function checkout(sid:string,saveCard=true){return billing.subscriptionCheckout(cid,sid,{requestId:randomUUID(),priceVersion:1,saveCard,termsVersion:'v1'},'127.0.0.1');}
async function complete(orderId:string,overrides:Record<string,unknown>={}){
  const [a]=await query<{provider_order_id:string;transaction_id:string}>(db,sql`SELECT * FROM billing_attempts WHERE order_id=${orderId}::uuid ORDER BY created_at DESC LIMIT 1`);
  const [o]=await query<{amount_minor:string}>(db,sql`SELECT amount_minor FROM billing_orders WHERE id=${orderId}::uuid`);
  const payload={status:'success',operation_code:'100',order_id:a!.provider_order_id,transaction:a!.transaction_id,amount:(Number(o!.amount_minor)/100).toFixed(2),...overrides};
  const data=Buffer.from(JSON.stringify(payload)).toString('base64');
  return billing.callback(data,sign(data,config.privateKey));
}
before(async()=>{
  await db.$client.unsafe('CREATE TABLE customers(id uuid PRIMARY KEY,name text,email text,active boolean DEFAULT true,password_hash text); CREATE TABLE customer_sessions(id uuid,customer_id uuid); CREATE TABLE licenses(id uuid PRIMARY KEY,customer_id uuid REFERENCES customers(id),plan text,features jsonb,status text,valid_until timestamptz,updated_at timestamptz DEFAULT now()); CREATE TABLE activation_keys(id uuid PRIMARY KEY,license_id uuid REFERENCES licenses(id),expires_at timestamptz,revoked_at timestamptz);');
  await db.$client.unsafe(readFileSync(new URL('../../../../../migrations/0042_epoint_billing.sql',import.meta.url),'utf8'));
  await db.$client.unsafe(readFileSync(new URL('../../../../../migrations/0043_security_subscription_rollout.sql',import.meta.url),'utf8'));
  await db.$client.unsafe(readFileSync(new URL('../../../../../migrations/0044_private_checkout_test.sql',import.meta.url),'utf8'));
  await db.$client.unsafe(readFileSync(new URL('../../../../../migrations/0045_private_hosted_receipts.sql',import.meta.url),'utf8'));
  await db.$client.unsafe(readFileSync(new URL('../../../../../migrations/0046_subscription_payment_mode.sql',import.meta.url),'utf8'));
  await db.$client.unsafe("CREATE TABLE owner_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid REFERENCES customers(id),kind text,title text,body text,payload jsonb DEFAULT '{}',read_at timestamptz,created_at timestamptz DEFAULT now());");
  await db.$client.unsafe(readFileSync(new URL('../../../../../migrations/0047_commerce_notifications.sql',import.meta.url),'utf8'));
  await db.$client.unsafe(readFileSync(new URL('../../../../../migrations/0049_shop_order_tracking.sql',import.meta.url),'utf8'));
});
beforeEach(async()=>{
  await db.$client.unsafe('TRUNCATE billing_private_hosted_receipts,billing_test_orders,billing_events,billing_handoffs,billing_quotes,billing_period_grants,billing_order_items,billing_attempts,billing_orders,billing_consents,billing_license_links,billing_subscriptions,billing_catalog,activation_keys,licenses,customers CASCADE');
  await db.execute(sql`INSERT INTO customers(id,name,email) VALUES(${cid}::uuid,'Fixture owner','fixture@example.invalid'),(${other}::uuid,'Other owner','other@example.invalid')`);
  await db.execute(sql`UPDATE billing_settings SET enforcement_enabled=true,enabled=true,recurring_enabled=true,pickup_address='Fixture pickup',delivery_fee_minor=NULL,legal='{"version":"v1"}'::jsonb`);
  sent=[];responseMode='redirect';
});
after(async()=>{await db.$client.end();rmSync(temporary,{recursive:true,force:true});});

test('first payment is required; concurrent callbacks grant exactly one month and cannot cross products',async()=>{
  const market=await seed(),restaurant=await seed('restaurant');
  const [initial]=await query<{status:string}>(db,sql`SELECT status FROM licenses WHERE id=${market.lid}::uuid`);assert.equal(initial!.status,'billing_pending');
  const order=await checkout(market.sid);
  await Promise.all(Array.from({length:8},()=>complete(order.id)));
  const grants=await query(db,sql`SELECT * FROM billing_period_grants`);assert.equal(grants.length,1);
  const [m]=await query<{status:string}>(db,sql`SELECT status FROM licenses WHERE id=${market.lid}::uuid`);assert.equal(m!.status,'active');
  const [r]=await query<{paid_until:unknown}>(db,sql`SELECT paid_until FROM billing_subscriptions WHERE id=${restaurant.sid}::uuid`);assert.equal(r!.paid_until,null);
});
test('same request and parallel clicks create one bank request; another customer cannot pay or read it',async()=>{
  const {sid}=await seed(),requestId=randomUUID();
  const calls=await Promise.all(Array.from({length:8},()=>billing.subscriptionCheckout(cid,sid,{requestId,priceVersion:1,saveCard:true,termsVersion:'v1'},'127.0.0.1')));
  assert.equal(new Set(calls.map(x=>x.id)).size,1);assert.equal(sent.length,1);
  await assert.rejects(()=>billing.order(other,calls[0]!.id));
  await assert.rejects(()=>billing.subscriptionCheckout(other,sid,{requestId:randomUUID(),priceVersion:1,saveCard:true,termsVersion:'v1'},'127.0.0.1'));
});
test('paid subscription rejects new charges and manual bypasses; same paid request has no bank redirect',async()=>{
 const {sid}=await seed(),requestId=randomUUID();
 const input={requestId,priceVersion:1,saveCard:true,paymentMode:'automatic' as const,termsVersion:'v1'};
 const initial=await billing.subscriptionCheckout(cid,sid,input,'fixture');await complete(initial.id,{card_id:'fixture-token',card_mask:'411111******1111'});
 const before=(await query<{paid_until:Date}>(db,sql`SELECT paid_until FROM billing_subscriptions WHERE id=${sid}::uuid`))[0]!.paid_until;
 for(const saveCard of [false,true])await assert.rejects(()=>billing.subscriptionCheckout(cid,sid,{...input,requestId:randomUUID(),saveCard},'fixture'));
 const same=await billing.subscriptionCheckout(cid,sid,input,'fixture');assert.equal(same.redirectUrl,null);
 const receipt=await billing.order(cid,initial.id);assert.equal(receipt.invoice.buyer!.email,'fixture@example.invalid');assert.equal(receipt.invoice.payment!.transaction_id,'tx-'+sent[0]!.payload.order_id);assert.ok(!JSON.stringify(receipt).includes('fixture-token'));
 assert.equal(sent.length,1);assert.equal((await query(db,sql`SELECT id FROM billing_orders`)).length,1);assert.equal(iso((await query<{paid_until:Date}>(db,sql`SELECT paid_until FROM billing_subscriptions WHERE id=${sid}::uuid`))[0]!.paid_until),iso(before));
 await billing.renew(sid);assert.equal(sent.length,1,'active auto renewal cannot charge early');
});
test('active migrated access also blocks early subscription checkout',async()=>{
 const {sid}=await seed('market',new Date(Date.now()+86400000).toISOString());await assert.rejects(()=>checkout(sid),e=>(e as BillingError).code==='subscription_paid');assert.equal(sent.length,0);
});
test('an earlier failed checkout cannot be replayed after a later successful subscription payment',async()=>{
 const {sid}=await seed(),oldInput={requestId:randomUUID(),priceVersion:1,saveCard:true,termsVersion:'v1'};
 const old=await billing.subscriptionCheckout(cid,sid,oldInput,'fixture');await complete(old.id,{status:'failed'});
 const current=await checkout(sid);await complete(current.id,{card_id:'fixture-token'});
 await assert.rejects(()=>billing.subscriptionCheckout(cid,sid,oldInput,'fixture'),e=>(e as BillingError).code==='subscription_paid');
 await assert.rejects(()=>billing.sendCheckout(old.id,cid),e=>(e as BillingError).code==='subscription_paid');assert.equal(sent.length,2);
});
test('explicit modes require matching consent and terms; changing mode cannot reuse another payment request',async()=>{
 const {sid}=await seed(),requestId=randomUUID();
 for(const input of [{saveCard:false,paymentMode:'automatic' as const,termsVersion:'v1'},{saveCard:true,paymentMode:'manual' as const,termsVersion:'v1'},{saveCard:false,paymentMode:'manual' as const,termsVersion:'old'}])await assert.rejects(()=>billing.subscriptionCheckout(cid,sid,{requestId,priceVersion:1,...input},'127.0.0.1'));
 assert.equal(sent.length,0);
 await billing.subscriptionCheckout(cid,sid,{requestId,priceVersion:1,saveCard:true,paymentMode:'automatic',termsVersion:'v1'},'127.0.0.1');assert.equal(sent.at(-1)?.endpoint,'card-registration-with-pay');
 await assert.rejects(()=>billing.subscriptionCheckout(cid,sid,{requestId,priceVersion:1,saveCard:false,paymentMode:'manual',termsVersion:'v1'},'127.0.0.1'),e=>(e as BillingError).code==='subscription_automatic_required');
 assert.equal((await query(db,sql`SELECT id FROM billing_orders`)).length,1);assert.equal(sent.length,1);
});
test('failed automatic renewal leaves the expired subscription blocked and visible for payment recovery',async()=>{
 const {sid}=await seed('market',new Date(Date.now()-10000).toISOString());
 const initial=await billing.subscriptionCheckout(cid,sid,{requestId:randomUUID(),priceVersion:1,saveCard:true,paymentMode:'automatic',termsVersion:'v1'},'127.0.0.1');await complete(initial.id,{card_id:'fixture-saved-card'});
 await db.execute(sql`UPDATE billing_subscriptions SET paid_until=now()-interval '1 minute' WHERE id=${sid}::uuid`);responseMode='decline';await billing.renew(sid);
 const status=await billing.listSubscriptions(cid),sub=status.subscriptions.find(s=>s.id===sid)!;assert.equal(sub.state,'expired');assert.equal(sub.lastPaymentStatus,'failed');assert.equal(sub.autoRenew,true);assert.equal(sub.paymentMode,'automatic');assert.ok(new Date(sub.paidUntil!)<new Date());
 assert.equal((await query(db,sql`SELECT order_id FROM billing_period_grants`)).length,1,'failed renewal cannot grant another month');
});
test('wrong amount, merchant and signature never activate a subscription',async()=>{
  const {sid}=await seed(),o=await checkout(sid);
  await assert.rejects(()=>complete(o.id,{amount:'29.99'}));
  await assert.rejects(()=>complete(o.id,{public_key:'different-merchant'}));
  await assert.rejects(()=>billing.callback('e30=','invalid'));
  assert.equal((await query(db,sql`SELECT * FROM billing_period_grants`)).length,0);
});
test('uncertain request survives a new service instance without retrying the debit',async()=>{
  const {sid}=await seed();responseMode='timeout';const o=await checkout(sid);assert.equal(o.paymentState,'unknown');
  const restarted=new Billing(db,{gateway,allowLive:true});await restarted.sendCheckout(o.id,cid);
  assert.equal(sent.length,1);assert.equal((await query(db,sql`SELECT * FROM billing_period_grants`)).length,0);
});
test('card consent may be withdrawn while payment is pending; no card or auto-renew is enabled',async()=>{
  const {sid}=await seed(),o=await checkout(sid,true);
  await billing.consent(cid,sid,{enabled:false},'127.0.0.1');
  await complete(o.id,{operation_code:'200',card_id:'fixture-token',card_mask:'411111******1111'});
  const [s]=await query<{auto_renew:boolean;card_ciphertext:string|null}>(db,sql`SELECT * FROM billing_subscriptions WHERE id=${sid}::uuid`);
  assert.equal(s!.auto_renew,false);assert.equal(s!.card_ciphertext,null);
});
test('price change requires fresh consent and preserves paid time',async()=>{
  const {sid}=await seed(),o=await checkout(sid,true);await complete(o.id,{operation_code:'200',card_id:'fixture-token',card_mask:'411111******1111'});
  const [before]=await query<{paid_until:Date}>(db,sql`SELECT * FROM billing_subscriptions WHERE id=${sid}::uuid`);
  await billing.configureSubscription('fixture-admin',{customerId:cid,product:'market',monthlyAmountMinor:4500,enabled:true});
  const [s]=await query<{auto_renew:boolean;paid_until:Date;price_version:number}>(db,sql`SELECT * FROM billing_subscriptions WHERE id=${sid}::uuid`);
  assert.equal(s!.auto_renew,false);assert.equal(s!.price_version,2);assert.equal(iso(s!.paid_until),iso(before!.paid_until));
  await assert.rejects(()=>billing.consent(cid,sid,{enabled:true,priceVersion:1,termsVersion:'v1'},'127.0.0.1'));
});
const iso=(v:Date|string)=>new Date(v).toISOString();
test('two workers cannot double renew; failed payment waits 24 hours before another attempt',async()=>{
  const {sid}=await seed(),o=await checkout(sid,true);await complete(o.id,{operation_code:'200',card_id:'fixture-token',card_mask:'411111******1111'});
  await db.execute(sql`UPDATE billing_subscriptions SET paid_until=now()-interval '1 minute' WHERE id=${sid}::uuid`);
  responseMode='decline';sent=[];
  await Promise.all([billing.renew(sid),billing.renew(sid)]);assert.equal(sent.length,1);
  await billing.renew(sid);assert.equal(sent.length,1);
  await db.execute(sql`UPDATE billing_subscriptions SET last_attempt_at=now()-interval '25 hours' WHERE id=${sid}::uuid`);
  await billing.renew(sid);assert.equal(sent.length,2);
});
test('imported price is not purchasable, changed quote is rejected and stock races do not oversell',async()=>{
  await db.execute(sql`INSERT INTO billing_catalog(product_id,name,stock_qty) VALUES('printer','Fixture printer',1)`);
  const shipping={kind:'pickup' as const,name:'Fixture owner',phone:'0500000000',address:''};
  await assert.rejects(()=>billing.quote(cid,[{id:'printer',qty:1}],shipping));
  await db.execute(sql`UPDATE billing_catalog SET sale_enabled=true,price_minor=25000 WHERE product_id='printer'`);
  const q1=await billing.quote(cid,[{id:'printer',qty:1}],shipping),q2=await billing.quote(other,[{id:'printer',qty:1}],shipping);
  const result=await Promise.allSettled([billing.shopCheckout(cid,q1.quoteId,randomUUID(),'v1'),billing.shopCheckout(other,q2.quoteId,randomUUID(),'v1')]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  const [stock]=await query<{reserved_qty:number;stock_qty:number}>(db,sql`SELECT * FROM billing_catalog WHERE product_id='printer'`);assert.equal(stock!.reserved_qty,1);assert.equal(stock!.stock_qty,1);
});
test('late paid callback after released reservation creates review, never negative inventory',async()=>{
  await db.execute(sql`INSERT INTO billing_catalog(product_id,name,stock_qty,price_minor,sale_enabled) VALUES('printer','Fixture printer',1,25000,true)`);
  const q=await billing.quote(cid,[{id:'printer',qty:1}],{kind:'pickup',name:'Fixture owner',phone:'0500000000',address:''});
  const o=await billing.shopCheckout(cid,q.quoteId,randomUUID(),'v1');
  await db.execute(sql`UPDATE billing_orders SET expires_at=now()-interval '1 minute' WHERE id=${o.id}::uuid`);await billing.expireReservations();
  await db.execute(sql`UPDATE billing_catalog SET stock_qty=0 WHERE product_id='printer'`);
  await complete(o.id);
  const [order]=await query<{status:string}>(db,sql`SELECT status FROM billing_orders WHERE id=${o.id}::uuid`);assert.equal(order!.status,'paid_review');
  const [stock]=await query<{stock_qty:number;reserved_qty:number}>(db,sql`SELECT * FROM billing_catalog`);assert.equal(stock!.stock_qty,0);assert.equal(stock!.reserved_qty,0);
});
test('returned callback is terminal, even if a late success is delivered afterwards',async()=>{
  const {sid}=await seed(),o=await checkout(sid);await complete(o.id,{status:'returned'});await complete(o.id);
  assert.equal((await query(db,sql`SELECT * FROM billing_period_grants`)).length,0);
  const [order]=await query<{status:string}>(db,sql`SELECT status FROM billing_orders WHERE id=${o.id}::uuid`);assert.equal(order!.status,'refunded');
});

test('calendar periods reject early payments, renew at expiry and restart late on confirmation',async()=>{
 const {sid}=await seed();let time=new Date('2028-01-31T08:20:00Z');
 const clock=new Billing(db,{gateway,allowLive:true,now:()=>time});
 async function pay(){const o=await clock.subscriptionCheckout(cid,sid,{requestId:randomUUID(),priceVersion:1,saveCard:true,termsVersion:'v1'},'fixture');const [a]=await query<{id:string;transaction_id:string;provider_order_id:string}>(db,sql`SELECT * FROM billing_attempts WHERE order_id=${o.id}::uuid`);await clock.recordResult(a!.id,{status:'success',operation_code:'100',transaction:a!.transaction_id,order_id:a!.provider_order_id,amount:'30.00'},'status');return (await query<{paid_until:Date}>(db,sql`SELECT paid_until FROM billing_subscriptions WHERE id=${sid}::uuid`))[0]!.paid_until;}
 assert.equal(iso(await pay()),'2028-02-29T08:20:00.000Z');time=new Date('2028-02-01T08:20:00Z');
 await assert.rejects(()=>pay(),e=>(e as BillingError).code==='subscription_paid');time=new Date('2028-02-29T08:20:00Z');assert.equal(iso(await pay()),'2028-03-31T08:20:00.000Z');time=new Date('2028-05-10T09:15:00Z');
 assert.equal(iso(await pay()),'2028-06-10T09:15:00.000Z');
});
test('delivery disabled after quote and a changed product price require a new confirmation',async()=>{
 await db.execute(sql`INSERT INTO billing_catalog(product_id,name,stock_qty,price_minor,sale_enabled) VALUES('printer','Printer',10,25000,true)`);
 await db.execute(sql`UPDATE billing_settings SET delivery_fee_minor=0`);
 const q=await billing.quote(cid,[{id:'printer',qty:1}],{kind:'delivery',name:'Fixture owner',phone:'0500000000',address:'Fixture address'});
 await db.execute(sql`UPDATE billing_settings SET delivery_fee_minor=NULL`);
 await assert.rejects(()=>billing.shopCheckout(cid,q.quoteId,randomUUID(),'v1'));
 const next=await billing.quote(cid,[{id:'printer',qty:1}],{kind:'pickup',name:'Fixture owner',phone:'0500000000',address:''});
 await db.execute(sql`UPDATE billing_catalog SET price_minor=26000 WHERE product_id='printer'`);
 await assert.rejects(()=>billing.shopCheckout(cid,next.quoteId,randomUUID(),'v1'));
});
test('HTTP boundaries reject anonymous/admin impersonation and parse signed form callbacks',async()=>{
 const {default:Fastify}=await import('fastify'),{default:cookie}=await import('@fastify/cookie'),{billingRoutes}=await import('../../routes/billing.js');
 const app=Fastify();app.decorate('db',db);app.decorateRequest('customer',null);app.decorateRequest('user',null);
 await app.register(cookie);
 app.addHook('preHandler',async req=>{if(req.headers['x-fixture-customer'])req.customer={id:String(req.headers['x-fixture-customer']),name:'Fixture',email:'fixture@example.invalid',active:true};if(req.headers['x-fixture-role'])req.user={id:randomUUID(),role:String(req.headers['x-fixture-role'])} as never;});
 await app.register(billingRoutes,{prefix:'/pos/api',billing,worker:false});
 try{
  assert.equal((await app.inject('/pos/api/customer/billing')).statusCode,401);
  assert.equal((await app.inject('/pos/api/admin/billing')).statusCode,401);
  assert.equal((await app.inject({url:'/pos/api/admin/billing',headers:{'x-fixture-role':'reseller'}})).statusCode,403);
  const {sid}=await seed(),o=await checkout(sid);const [a]=await query<{provider_order_id:string;transaction_id:string}>(db,sql`SELECT * FROM billing_attempts WHERE order_id=${o.id}::uuid`);
  const data=Buffer.from(JSON.stringify({status:'success',operation_code:'100',order_id:a!.provider_order_id,transaction:a!.transaction_id,amount:'30.00'})).toString('base64');
  const payload=new URLSearchParams({data,signature:sign(data,config.privateKey)}).toString();
  const response=await app.inject({method:'POST',url:'/pos/api/billing/epoint/callback',headers:{'content-type':'application/x-www-form-urlencoded'},payload});
  assert.equal(response.statusCode,200,response.body);assert.equal((await query(db,sql`SELECT * FROM billing_period_grants`)).length,1);
  assert.equal((await app.inject({url:'/pos/api/customer/billing/orders/'+o.id,headers:{'x-fixture-customer':other}})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/pos/api/billing/site/checkout',payload:{}})).statusCode,401);
 }finally{await app.close();}
});


test('account removal archives billing history and disables further renewals',async()=>{
 const {sid}=await seed(),o=await checkout(sid,true);await complete(o.id,{operation_code:'200',card_id:'fixture-token'});
 assert.equal(await db.transaction(tx=>archiveBillingCustomer(tx,cid)),true);
 const [c]=await query<{active:boolean}>(db,sql`SELECT active FROM customers WHERE id=${cid}::uuid`);assert.equal(c!.active,false);
 assert.equal((await query(db,sql`SELECT * FROM billing_orders WHERE id=${o.id}::uuid`)).length,1);
 const [l]=await query<{status:string}>(db,sql`SELECT status FROM licenses WHERE customer_id=${cid}::uuid`);assert.equal(l!.status,'revoked');
 sent=[];await billing.renew(sid);assert.equal(sent.length,0);
});

test('self-registration and registration OTP are blocked before any account write',async()=>{
 const {default:Fastify}=await import('fastify'),{customerAuthRoutes}=await import('../../routes/customer-auth.js');
 const app=Fastify();app.decorate('db',db);await app.register(customerAuthRoutes,{prefix:'/pos/api'});
 try{
  for(const [url,payload] of [['/customer-auth/register',{}],['/customer-auth/check-email',{email:'fixture@example.invalid'}],['/customer-auth/otp/send',{email:'new@example.invalid',purpose:'register'}]] as const){
   const r=await app.inject({method:'POST',url:'/pos/api'+url,payload});assert.equal(r.statusCode,403,r.body);assert.equal(r.json().code,'REGISTRATION_DISABLED');
  }
  assert.equal((await query(db,sql`SELECT id FROM customers`)).length,2);
 }finally{await app.close();}
});
test('signed sessions reject password-change replay, durable revocation, tampering and disabled accounts',async()=>{
 const {default:Fastify}=await import('fastify'),{tenantRequestGuard,resolveTenantToken}=await import('../../routes/tenant.js'),{env}=await import('../../env.js');
 const {createHmac,createHash}=await import('node:crypto');
 const make=(iat=Date.now(),client='owner')=>{const b=Buffer.from(JSON.stringify({customerId:cid,email:'fixture@example.invalid',client,iat,exp:Date.now()+3600000,jti:randomUUID()})).toString('base64url');return 't1.'+b+'.'+createHmac('sha256',env.sessionSecret).update(b).digest('base64url');};
 const app=Fastify();app.decorate('db',db);app.addHook('preHandler',async(r,p)=>tenantRequestGuard(app,r,p));app.get('/probe',async(r,p)=>resolveTenantToken(r.headers.authorization?.slice(7))?{ok:true}:p.code(401).send({error:'Unauthorized'}));
 const get=(t:string)=>app.inject({url:'/probe',headers:{authorization:'Bearer '+t}});
 try{
  const original=make();assert.equal((await get(original)).statusCode,200);
  assert.equal((await get(original+'x')).statusCode,401);
  assert.equal((await get(make(Date.now(),'billing'))).statusCode,401);
  await db.execute(sql`INSERT INTO customer_sessions(id,customer_id) VALUES(${randomUUID()}::uuid,${cid}::uuid)`);
  await new Promise(r=>setTimeout(r,5));await db.execute(sql`UPDATE customers SET password_hash='fixture-changed-hash' WHERE id=${cid}::uuid`);
  assert.equal((await get(original)).statusCode,401);assert.equal((await query(db,sql`SELECT * FROM customer_sessions WHERE customer_id=${cid}::uuid`)).length,0);
  const fresh=make();assert.equal((await get(fresh)).statusCode,200);
  await db.execute(sql`INSERT INTO tenant_session_revocations(token_hash,expires_at) VALUES(${createHash('sha256').update(fresh).digest('hex')},now()+interval '1 hour')`);
  assert.equal((await get(fresh)).statusCode,401);
  const another=make();await db.execute(sql`UPDATE customers SET active=false WHERE id=${cid}::uuid`);assert.equal((await get(another)).statusCode,401);
 }finally{await app.close();}
});
test('setup access is a bounded lease and does not create a payment or paid period',async()=>{
 const {licenseBilling}=await import('./service.js');const {lid}=await seed();
 await db.execute(sql`UPDATE billing_settings SET enforcement_enabled=false,enabled=false`);
 const b=await licenseBilling(db,lid);assert.equal(b?.billingEnforced,false);assert.equal(b?.paidUntil,null);assert.equal(b?.billingStatus,'awaiting_payment');
 assert.ok(new Date(b!.accessUntil!).getTime()>Date.now()+6*86400000);
 assert.equal((await query(db,sql`SELECT id FROM billing_orders`)).length,0);
 assert.equal((await query(db,sql`SELECT order_id FROM billing_period_grants`)).length,0);
});

test('logout only stores verified sessions and persists revocation for a fresh process',async()=>{
 const {default:Fastify}=await import('fastify'),{tenantRoutes}=await import('../../routes/tenant.js'),{env}=await import('../../env.js');
 const {createHmac,createHash}=await import('node:crypto');
 const app=Fastify();app.decorate('db',db);await app.register(tenantRoutes);
 try{
  const before=(await query(db,sql`SELECT token_hash FROM tenant_session_revocations`)).length;
  const bad=await app.inject({method:'POST',url:'/tenant/logout',headers:{authorization:'Bearer t1.invalid.forged'}});assert.equal(bad.statusCode,200);
  assert.equal((await query(db,sql`SELECT token_hash FROM tenant_session_revocations`)).length,before);
  const payload=Buffer.from(JSON.stringify({customerId:cid,email:'fixture@example.invalid',client:'owner',iat:Date.now(),exp:Date.now()+3600000,jti:randomUUID()})).toString('base64url');
  const token='t1.'+payload+'.'+createHmac('sha256',env.sessionSecret).update(payload).digest('base64url');
  const good=await app.inject({method:'POST',url:'/tenant/logout',headers:{authorization:'Bearer '+token}});assert.equal(good.statusCode,200);
  const hash=createHash('sha256').update(token).digest('hex');assert.equal((await query(db,sql`SELECT token_hash FROM tenant_session_revocations WHERE token_hash=${hash}`)).length,1);
 }finally{await app.close();}
});

async function privateTestApp(){
 const {default:Fastify}=await import('fastify'),{billingRoutes}=await import('../../routes/billing.js'),{publicProductRoutes}=await import('../../routes/products.js');
 const app=Fastify();app.decorate('db',db);
 for(const name of ['user','customer','csrfToken','customerCsrfToken'])app.decorateRequest(name,null);
 app.addHook('preHandler',async req=>{
  if(req.headers.authorization==='FixtureAli') {req.user={id:cid,email:'ali.mammadli@possistem.az',active:true,mustChangePassword:false,role:'superadmin'};req.csrfToken='private-test-csrf';}
  if(req.headers.authorization==='FixtureOther'){req.user={id:other,email:'other@example.invalid',active:true,mustChangePassword:false,role:'superadmin'};req.csrfToken='other-csrf';}
 });
 await app.register(billingRoutes,{billing,worker:false,prefix:'/pos/api'});await app.register(publicProductRoutes,{prefix:'/pos/api'});return app;
}
test('private test product is visible only to its authenticated account, never through email headers or a shared cache',async()=>{
 const {TEST_PRODUCT_ID}=await import('./test-shop.js'),app=await privateTestApp();
 const priorHostedUrl=process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL;
 process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL='https://epoint.az/az/inv/p/Fixture123';
 try{
  for(const headers of [{},{authorization:'FixtureOther'},{'x-email':'ali.mammadli@possistem.az'}]){
   const listing=await app.inject({url:'/pos/api/public/products?email=ali.mammadli@possistem.az',headers});assert.equal(listing.statusCode,200);assert.equal(listing.json().products.some((p:{id:string})=>p.id===TEST_PRODUCT_ID),false);
   assert.equal((await app.inject({url:'/pos/api/public/products/'+TEST_PRODUCT_ID,headers})).statusCode,404);
   assert.equal((await app.inject({url:'/pos/api/billing/test/context',headers})).statusCode,404);
  }
  const listing=await app.inject({url:'/pos/api/public/products',headers:{authorization:'FixtureAli'}});assert.match(String(listing.headers['cache-control']),/private.*no-store/);assert.match(String(listing.headers.vary),/Cookie/);
  const product=listing.json().products.find((p:{id:string})=>p.id===TEST_PRODUCT_ID);assert.equal(product.isTest,true);assert.equal(product.price,1);
  const context=(await app.inject({url:'/pos/api/billing/test/context',headers:{authorization:'FixtureAli'}})).json();assert.equal(context.mode,'simulation');assert.equal(context.hostedPayment.url,process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL);assert.equal(context.hostedPayment.verification,'manual');assert.equal(context.hostedPayment.amountMinor,100);
  assert.equal(JSON.stringify(listing.json()).includes('Fixture123'),false,'invoice URL is available only in the private checkout context');
  process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL='https://evil.invalid/pay';
  assert.equal((await app.inject({url:'/pos/api/billing/test/context',headers:{authorization:'FixtureAli'}})).json().hostedPayment,null);
 }finally{if(priorHostedUrl===undefined)delete process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL;else process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL=priorHostedUrl;await app.close();}
});
test('manually verified hosted receipt closes the exact invoice without changing simulation or subscription records',async()=>{
 const app=await privateTestApp(),prior=process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL,url='https://epoint.az/az/inv/p/Fixture123';process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL=url;
 try{
  await db.execute(sql`INSERT INTO billing_private_hosted_receipts(invoice_url_sha256,product_id,provider_invoice_id,provider_transaction_id,amount_minor,paid_at,verification_source) VALUES(${createHash('sha256').update(url).digest('hex')},'possistem-private-checkout-test','123','fixture-transaction',100,now(),'epoint_merchant_dashboard')`);
  const context=(await app.inject({url:'/pos/api/billing/test/context',headers:{authorization:'FixtureAli'}})).json();assert.equal(context.hostedPayment.status,'paid');assert.equal(context.hostedPayment.url,null);assert.equal(context.hostedPayment.invoiceId,'123');assert.ok(context.hostedPayment.paidAt);assert.equal(context.orders.length,0);
  assert.equal((await app.inject({url:'/pos/api/billing/test/context',headers:{authorization:'FixtureOther'}})).statusCode,404);
  process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL='https://epoint.az/az/inv/p/OtherInvoice';
  assert.equal((await app.inject({url:'/pos/api/billing/test/context',headers:{authorization:'FixtureAli'}})).json().hostedPayment.status,'awaiting_payment','receipt cannot mark a different invoice as paid');
  for(const table of ['billing_orders','billing_period_grants','billing_subscriptions','billing_test_orders'])assert.equal((await db.$client.unsafe('SELECT * FROM '+table)).length,0,table);
 }finally{if(prior===undefined)delete process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL;else process.env.EPOINT_PRIVATE_TEST_PAYMENT_URL=prior;await app.close();}
});
test('reusable static checkout remains ready after prior verified payments, without inventing new paid records',async()=>{
 const app=await privateTestApp(),prior=process.env.EPOINT_PRIVATE_TEST_REPEATABLE_PAYMENT_URL,url='https://epoint.az/az/inv/p/Static123';process.env.EPOINT_PRIVATE_TEST_REPEATABLE_PAYMENT_URL=url;
 try{
  await db.execute(sql`INSERT INTO billing_private_hosted_receipts(invoice_url_sha256,product_id,provider_invoice_id,provider_transaction_id,amount_minor,paid_at,verification_source) VALUES(${createHash('sha256').update(url).digest('hex')},'possistem-private-checkout-test','123','fixture-transaction',100,now(),'epoint_merchant_dashboard')`);
  for(let i=0;i<3;i++){const response=await app.inject({url:'/pos/api/billing/test/context',headers:{authorization:'FixtureAli'}}),context=response.json();assert.equal(response.statusCode,200);assert.equal(context.hostedPayment.status,'ready');assert.equal(context.hostedPayment.repeatable,true);assert.equal(context.hostedPayment.url,url);assert.equal(context.hostedPayment.amountMinor,100);assert.equal(context.hostedPayment.paidAt,null);assert.equal(context.hostedReceipts.length,1);assert.equal(context.hostedReceipts[0].invoiceId,'123');}
  for(const headers of [{},{authorization:'FixtureOther'}])assert.equal((await app.inject({url:'/pos/api/billing/test/context',headers})).statusCode,404);
  assert.equal((await query(db,sql`SELECT * FROM billing_private_hosted_receipts`)).length,1);assert.equal((await query(db,sql`SELECT * FROM billing_period_grants`)).length,0);assert.equal((await query(db,sql`SELECT * FROM billing_orders`)).length,0);assert.equal(sent.length,0);
 }finally{if(prior===undefined)delete process.env.EPOINT_PRIVATE_TEST_REPEATABLE_PAYMENT_URL;else process.env.EPOINT_PRIVATE_TEST_REPEATABLE_PAYMENT_URL=prior;await app.close();}
});
test('keyless test checkout is CSRF-protected, idempotent and cannot write real payments, stock or subscriptions',async()=>{
 const {TEST_PRODUCT_ID}=await import('./test-shop.js'),app=await privateTestApp();
 const body={mode:'simulation',accepted:true,productId:TEST_PRODUCT_ID,qty:2,outcome:'success',requestId:randomUUID()};
 const post=(payload:unknown=body,csrf='private-test-csrf',auth='FixtureAli')=>app.inject({method:'POST',url:'/pos/api/billing/test/checkout',headers:{authorization:auth,'x-csrf-token':csrf},payload});
 try{
  await db.execute(sql`UPDATE billing_settings SET enabled=false,recurring_enabled=false`);
  assert.equal((await post(body,'wrong')).statusCode,403);assert.equal((await post(body,'other-csrf','FixtureOther')).statusCode,404);
  assert.equal((await post({...body,amountMinor:1})).statusCode,400);assert.equal((await post({...body,mode:'real'})).statusCode,400);
  const results=await Promise.all(Array.from({length:4},()=>post()));for(const r of results){assert.equal(r.statusCode,200,r.body);assert.equal(r.json().mode,'simulation');assert.equal(r.json().chargedMinor,0);assert.equal(r.json().amountMinor,200);assert.equal(r.json().status,'simulated_success');}
  assert.equal(new Set(results.map(r=>r.json().id)).size,1);assert.equal((await post({...body,qty:3})).statusCode,409);
  assert.equal((await post({...body,outcome:'failure',requestId:randomUUID()})).json().status,'simulated_failure');
  for(const table of ['billing_orders','billing_attempts','billing_period_grants','billing_subscriptions'])assert.equal((await db.$client.unsafe('SELECT * FROM '+table)).length,0,table);
  assert.equal((await query(db,sql`SELECT sum(reserved_qty)::int total FROM billing_catalog`))[0]?.total??0,0);assert.equal(sent.length,0);
  assert.equal((await query(db,sql`SELECT id FROM billing_test_orders`)).length,2);
 }finally{await app.close();}
});
test('private test SKU cannot enter the real quote or checkout path even with a forged stored quote',async()=>{
 const {TEST_PRODUCT_ID}=await import('./test-shop.js');
 await assert.rejects(()=>billing.quote(cid,[{id:TEST_PRODUCT_ID,qty:1}],{kind:'pickup',name:'Fixture',phone:'0500000000',address:''}),e=>(e as BillingError).code==='test_product');
 const payload={items:[{id:TEST_PRODUCT_ID,qty:1,name:'Test',unitPriceMinor:100}],shipping:{kind:'pickup',name:'Fixture',phone:'0500000000',address:''},deliveryFeeMinor:0,termsVersion:'v1'};
 const [q]=await query<{id:string}>(db,sql`INSERT INTO billing_quotes(customer_id,payload,amount_minor) VALUES(${cid}::uuid,${JSON.stringify(payload)}::jsonb,100) RETURNING id`);
 await assert.rejects(()=>billing.shopCheckout(cid,q!.id,randomUUID(),'v1'),e=>(e as BillingError).code==='test_product');assert.equal(sent.length,0);assert.equal((await query(db,sql`SELECT id FROM billing_orders`)).length,0);
});

test('renewal reminders cover the exact three-day boundary, survive parallel workers, and reset for a new paid period',async()=>{
 const now=new Date('2026-10-25T10:00:00Z'),due=new Date(now.getTime()+3*86400000),{sid}=await seed('market',due.toISOString());
 await db.execute(sql`UPDATE billing_subscriptions SET auto_renew=true WHERE id=${sid}::uuid`);
 await Promise.all(Array.from({length:8},()=>publishBillingNotifications(db,now,true)));
 let notices=await query<{body:string;payload:{dueAt:string}}>(db,sql`SELECT * FROM owner_notifications WHERE customer_id=${cid}::uuid AND kind='billing_renewal'`);
 assert.equal(notices.length,1);assert.match(notices[0]!.body,/kartınızdan tutulacaq/);assert.equal(notices[0]!.payload.dueAt,due.toISOString());
 assert.equal((await query(db,sql`SELECT * FROM owner_notifications WHERE customer_id=${other}::uuid`)).length,0);
 await db.execute(sql`UPDATE billing_subscriptions SET paid_until=${new Date(due.getTime()+86400000).toISOString()}::timestamptz WHERE id=${sid}::uuid`);
 await publishBillingNotifications(db,new Date(now.getTime()+86400000),false);
 notices=await query(db,sql`SELECT * FROM owner_notifications WHERE kind='billing_renewal'`);assert.equal(notices.length,2);
 const sub={enabled:true,product:'market',monthly_amount_minor:3000,auto_renew:true,paid_until:due.toISOString()};
 assert.equal(renewalNotice(sub,new Date(now.getTime()-1)),null);assert.equal(renewalNotice(sub,due),null);assert.equal(renewalNotice({...sub,enabled:false},now),null);
 assert.match(renewalNotice(sub,now,false)!.body,/ödəyin/);
});
test('shop delivery notifications follow material order states once and stay attached to their customer',async()=>{
 await db.execute(sql`INSERT INTO billing_catalog(product_id,name,stock_qty,price_minor,sale_enabled) VALUES('fixture-notice','Fixture',3,2000,true)`);
 const q=await billing.quote(cid,[{id:'fixture-notice',qty:1}],{kind:'pickup',name:'Fixture',phone:'0500000000',address:''});
 const o=await billing.shopCheckout(cid,q.quoteId,randomUUID(),'v1');await complete(o.id);
 await publishBillingNotifications(db,new Date(),true);await publishBillingNotifications(db,new Date(),true);
 assert.equal((await query(db,sql`SELECT id FROM owner_notifications WHERE kind='billing_order'`)).length,1);
 await db.execute(sql`UPDATE billing_orders SET fulfillment_status='ready',updated_at=now() WHERE id=${o.id}::uuid`);await publishBillingNotifications(db,new Date(),true);
 assert.equal((await query(db,sql`SELECT id FROM owner_notifications WHERE kind='billing_order'`)).length,2);
});

test('customer notification reads and paginated order history enforce ownership and preserve microsecond cursor precision',async()=>{
 const {default:Fastify}=await import('fastify'),{billingRoutes}=await import('../../routes/billing.js');
 const app=Fastify();app.decorate('db',db);app.decorateRequest('customer',null);
 app.addHook('preHandler',async req=>{if(req.headers['x-fixture-owner']==='owner')req.customer={id:cid,email:'fixture@example.invalid',name:'Fixture',active:true};else if(req.headers['x-fixture-owner']==='other')req.customer={id:other,email:'other@example.invalid',name:'Other',active:true};});
 await app.register(billingRoutes,{prefix:'/pos/api',billing,worker:false});
 try{
 const [mine]=await query<{id:string}>(db,sql`INSERT INTO owner_notifications(customer_id,kind,title,body) VALUES(${cid}::uuid,'test','Mine','Fixture') RETURNING id`);
 const [theirs]=await query<{id:string}>(db,sql`INSERT INTO owner_notifications(customer_id,kind,title,body) VALUES(${other}::uuid,'test','Other','Fixture') RETURNING id`);
 assert.equal((await app.inject('/pos/api/customer/billing/notifications')).statusCode,401);
 const ownHeaders={'x-fixture-owner':'owner'};
 const list=await app.inject({url:'/pos/api/customer/billing/notifications',headers:ownHeaders});assert.equal(list.json().unread,1);assert.equal(list.json().notifications[0].id,mine!.id);
 await app.inject({method:'POST',url:'/pos/api/customer/billing/notifications/read',headers:ownHeaders,payload:{id:theirs!.id}});
 assert.equal((await query<{read_at:unknown}>(db,sql`SELECT read_at FROM owner_notifications WHERE id=${theirs!.id}::uuid`))[0]!.read_at,null);
 await app.inject({method:'POST',url:'/pos/api/customer/billing/notifications/read',headers:ownHeaders,payload:{id:mine!.id}});
 assert.equal((await app.inject({url:'/pos/api/customer/billing/notifications',headers:ownHeaders})).json().unread,0);
 await db.execute(sql`INSERT INTO billing_orders(order_no,customer_id,kind,amount_minor,request_key,request_hash,created_at) SELECT 'FIXTURE-'||i,${cid}::uuid,'shop',100,gen_random_uuid(),'fixture','2026-10-25T10:00:00.123456Z'::timestamptz FROM generate_series(1,27) i`);
 const first=(await app.inject({url:'/pos/api/customer/billing/shop-orders',headers:ownHeaders})).json();assert.equal(first.orders.length,25);assert.match(first.next.before,/123456Z$/);
 const second=(await app.inject({url:'/pos/api/customer/billing/shop-orders?'+new URLSearchParams(first.next),headers:ownHeaders})).json();assert.equal(second.orders.length,2);assert.equal(second.next,null);assert.equal(new Set([...first.orders,...second.orders].map(x=>x.id)).size,27);
 const otherList=(await app.inject({url:'/pos/api/customer/billing/shop-orders',headers:{'x-fixture-owner':'other'}})).json();assert.equal(otherList.orders.length,0);
 assert.equal((await app.inject({url:'/pos/api/customer/billing/orders/'+first.orders[0].id,headers:{'x-fixture-owner':'other'}})).statusCode,404);
 }finally{await app.close();}
});
