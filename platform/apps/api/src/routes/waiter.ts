import type{FastifyInstance}from'fastify';
import{randomUUID}from'node:crypto';
import{sql}from'drizzle-orm';
import{z}from'zod/v3';
import{hashPassword,verifyPassword,generateSessionToken,generateCsrfToken,hashSessionToken}from'@milioner/security';
import{env}from'../env.js';
import{requireCustomer}from'../plugins/customer-auth.js';
import{parseBody,clientIp}from'../lib/validate.js';
import{writeAudit}from'../lib/audit.js';
import{surfaceAccess}from'./access.js';
import{areaAllowed}from'../lib/access-areas.js';
import{ownerBranchDevices}from'./cloud-branches.js';
import{rows,fail,namespaceSuggestion,waiterDevice,waiterRpc,placeWaiterOrder,waiterOrderStatus}from'../lib/waiter/service.js';
const cookie=env.cookieName+'_waiter',cookiePath='/pos/api/waiter',secure=env.nodeEnv==='production'||env.cookieSecure;
const id=z.string().uuid(),namespace=z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,39}$/),username=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{1,39}$/),password=z.string().min(10).max(128);
const publicAccount=(a:any)=>({id:a.id,email:a.username+'@'+a.namespace+'.pos',fullName:a.full_name,deviceId:a.device_id,active:a.active,connected:!!a.native_user_id,createdAt:a.created_at});
let dummy:Promise<string>|null=null;
export async function waiterRoutes(app:FastifyInstance,deps:Partial<{rpc:typeof waiterRpc;device:typeof waiterDevice;devices:typeof ownerBranchDevices;access:typeof surfaceAccess;audit:typeof writeAudit}>={}){
 const rpc=deps.rpc||waiterRpc,device=deps.device||waiterDevice,devices=deps.devices||ownerBranchDevices,accessFor=deps.access||surfaceAccess,audit=deps.audit||writeAudit;
 app.addHook('onSend',async(_req,reply)=>{reply.header('Cache-Control','private, no-store');});
 const options={config:{rateLimit:{max:120,timeWindow:'1 minute'}}};
 const owner=async(req:any,reply:any)=>{const c=requireCustomer(req,reply);if(!c)return null;const access=await accessFor(app,c.id,'restaurant');if(!areaAllowed(access,'staff')){reply.code(403).send({error:'İşçiləri idarə etməyə icazəniz yoxdur.'});return null;}return c;};
 const staff=async(req:any,reply:any)=>{
  const token=req.cookies?.[cookie];if(!token){reply.code(401).send({error:'Ofisiant hesabınıza daxil olun.'});return null;}
  const [r]=rows(await app.db.execute(sql`SELECT w.*,c.namespace,s.id AS session_id,s.csrf_token,o.name AS company_name FROM waiter_sessions s JOIN web_waiters w ON w.id=s.waiter_id JOIN waiter_companies c ON c.customer_id=w.customer_id JOIN customers o ON o.id=w.customer_id WHERE s.token_hash=${hashSessionToken(token)} AND s.expires_at>now() AND w.active=true AND o.active=true`));
  if(!r){reply.code(401).send({error:'Sessiya bitib. Yenidən daxil olun.'});return null;}
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['x-csrf-token']!==r.csrf_token){reply.code(403).send({error:'Sorğunun təhlükəsizlik təsdiqi yoxdur.'});return null;}return r;
 };
 const bind=async(account:any)=>{const result:any=await rpc(app,account,'provision',{accountId:account.id,fullName:account.full_name,nativeUserId:account.native_user_id||''});if(result?.role!=='waiter'||typeof result.id!=='string')fail(409,'Kassada ofisiant hesabı təsdiqlənmədi.');await app.db.execute(sql`UPDATE web_waiters SET native_user_id=${result.id},updated_at=now() WHERE id=${account.id}::uuid AND customer_id=${account.customer_id}::uuid`);return{connected:true};};
 app.get('/customer/waiters',options,async(req,reply)=>{const c=await owner(req,reply);if(!c)return;const [company]=rows(await app.db.execute(sql`SELECT namespace FROM waiter_companies WHERE customer_id=${c.id}::uuid`));return{namespace:company?.namespace||null,suggestedNamespace:namespaceSuggestion(c.name),accounts:rows(await app.db.execute(sql`SELECT w.*,c.namespace FROM web_waiters w JOIN waiter_companies c ON c.customer_id=w.customer_id WHERE w.customer_id=${c.id}::uuid ORDER BY w.created_at`)).map(publicAccount),devices:(await devices(app,c.id)).filter(d=>d.product==='restaurant').map(d=>({id:d.id,name:d.name}))};});
 app.post('/customer/waiters',options,async(req,reply)=>{
  const c=await owner(req,reply);if(!c)return;const body=parseBody(z.object({namespace,username,fullName:z.string().trim().min(1).max(100),password,deviceId:id,nativeUserId:z.string().min(1).max(100).optional()}).strict(),req.body,reply);if(!body)return;
  await device(app,c.id,body.deviceId);const hash=await hashPassword(body.password),accountId=randomUUID();
  try{await app.db.transaction(async tx=>{
   await tx.execute(sql`INSERT INTO waiter_companies(customer_id,namespace) VALUES(${c.id}::uuid,${body.namespace}) ON CONFLICT(customer_id) DO NOTHING`);
   const [company]=rows(await tx.execute(sql`SELECT namespace FROM waiter_companies WHERE customer_id=${c.id}::uuid FOR UPDATE`));if(company.namespace!==body.namespace)fail(409,'Şirkət giriş adı artıq təyin edilib.');
   await tx.execute(sql`INSERT INTO web_waiters(id,customer_id,device_id,username,full_name,password_hash,native_user_id) VALUES(${accountId}::uuid,${c.id}::uuid,${body.deviceId}::uuid,${body.username},${body.fullName},${hash},${body.nativeUserId||null})`);
  });}catch(e:any){if(e.code==='23505')return reply.code(409).send({error:'Bu şirkət adı və ya ofisiant girişi artıq istifadə olunur.'});throw e;}
  await audit(app,{actorCustomerId:c.id,action:'waiter.create',entityType:'web_waiter',entityId:accountId,ip:clientIp(req),meta:{deviceId:body.deviceId,username:body.username}});
  let connected=false,connectionError='';try{await bind({id:accountId,customer_id:c.id,device_id:body.deviceId,full_name:body.fullName,native_user_id:body.nativeUserId});connected=true;}catch(e:any){connectionError=e.message;}
  return{ok:true,id:accountId,email:body.username+'@'+body.namespace+'.pos',connected,connectionError};
 });
 app.post<{Params:{id:string}}>('/customer/waiters/:id/connect',options,async(req,reply)=>{const c=await owner(req,reply);if(!c)return;if(!id.safeParse(req.params.id).success)return reply.code(404).send({error:'Hesab tapılmadı.'});const [a]=rows(await app.db.execute(sql`SELECT * FROM web_waiters WHERE id=${req.params.id}::uuid AND customer_id=${c.id}::uuid`));if(!a)return reply.code(404).send({error:'Hesab tapılmadı.'});return bind(a);});
 app.patch<{Params:{id:string}}>('/customer/waiters/:id',options,async(req,reply)=>{
  const c=await owner(req,reply);if(!c)return;if(!id.safeParse(req.params.id).success)return reply.code(404).send({error:'Hesab tapılmadı.'});const body=parseBody(z.object({active:z.boolean().optional(),password:password.optional()}).strict(),req.body,reply);if(!body)return;if(!Object.keys(body).length)return reply.code(400).send({error:'Dəyişiklik seçilməyib.'});
  const hash=body.password?await hashPassword(body.password):null;
  const found=await app.db.transaction(async tx=>{const [a]=rows(await tx.execute(sql`UPDATE web_waiters SET active=COALESCE(${body.active??null}::boolean,active),password_hash=COALESCE(${hash},password_hash),failed_logins=0,locked_until=NULL,updated_at=now() WHERE id=${req.params.id}::uuid AND customer_id=${c.id}::uuid RETURNING id`));if(a)await tx.execute(sql`DELETE FROM waiter_sessions WHERE waiter_id=${a.id}::uuid`);return a;});
  if(!found)return reply.code(404).send({error:'Hesab tapılmadı.'});await audit(app,{actorCustomerId:c.id,action:hash?'waiter.password_reset':'waiter.access',entityType:'web_waiter',entityId:found.id,ip:clientIp(req),meta:{active:body.active}});return{ok:true};
 });
 app.post('/waiter/login',{config:{rateLimit:{max:8,timeWindow:'1 minute'}}},async(req,reply)=>{
  const body=parseBody(z.object({email:z.string().trim().toLowerCase().max(100),password:z.string().min(1).max(128)}).strict(),req.body,reply);if(!body)return;
  if(req.headers.origin&&req.headers.origin!=='https://possistem.az'&&env.nodeEnv==='production')return reply.code(403).send({error:'Sorğu mənbəyi uyğun deyil.'});
  const parts=/^([a-z0-9][a-z0-9._-]{1,39})@([a-z][a-z0-9-]{1,39})\.pos$/.exec(body.email);
  const [a]=parts?rows(await app.db.execute(sql`SELECT w.*,c.namespace,o.name AS company_name FROM web_waiters w JOIN waiter_companies c ON c.customer_id=w.customer_id JOIN customers o ON o.id=w.customer_id WHERE c.namespace=${parts[2]} AND w.username=${parts[1]} AND o.active=true`)):[];
  const valid=await verifyPassword(a?.password_hash||await(dummy??=hashPassword(randomUUID())),body.password);
  if(!a||!valid||!a.active||a.locked_until&&Date.parse(a.locked_until)>Date.now()){
   if(a)await app.db.execute(sql`UPDATE web_waiters SET failed_logins=failed_logins+1,locked_until=CASE WHEN failed_logins>=7 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=${a.id}::uuid`);
   return reply.code(401).send({error:'Giriş adı və ya parol səhvdir, yaxud hesab bağlıdır.'});
  }
  const token=generateSessionToken(),csrf=generateCsrfToken(),expires=new Date(Date.now()+12*3600000);
  await app.db.transaction(async tx=>{await tx.execute(sql`DELETE FROM waiter_sessions WHERE waiter_id=${a.id}::uuid AND expires_at<now()`);await tx.execute(sql`INSERT INTO waiter_sessions(id,waiter_id,token_hash,csrf_token,expires_at) VALUES(${randomUUID()}::uuid,${a.id}::uuid,${hashSessionToken(token)},${csrf},${expires.toISOString()}::timestamptz)`);await tx.execute(sql`UPDATE web_waiters SET failed_logins=0,locked_until=NULL WHERE id=${a.id}::uuid`);});
  reply.setCookie(cookie,token,{path:cookiePath,httpOnly:true,sameSite:'strict',secure,expires});return{account:{...publicAccount(a),companyName:a.company_name},csrfToken:csrf};
 });
 app.get('/waiter/session',options,async(req,reply)=>{const a=await staff(req,reply);if(!a)return;return{account:{...publicAccount(a),companyName:a.company_name},csrfToken:a.csrf_token};});
 app.post('/waiter/logout',options,async(req,reply)=>{const a=await staff(req,reply);if(!a)return;await app.db.execute(sql`DELETE FROM waiter_sessions WHERE id=${a.session_id}::uuid`);reply.clearCookie(cookie,{path:cookiePath});return{ok:true};});
 app.get('/waiter/workspace',options,async(req,reply)=>{const a=await staff(req,reply);if(!a)return;if(!a.native_user_id)return reply.code(409).send({error:'Sahibkar hesabı kassaya bağlamalıdır. Sahibkar panelində Kassaya qoş seçin.'});return waiterRpc(app,a,'workspace');});
 app.get<{Params:{id:string}}>('/waiter/products/:id/modifiers',options,async(req,reply)=>{const a=await staff(req,reply);if(!a)return;if(!req.params.id||req.params.id.length>120)return reply.code(400).send({error:'Məhsul düzgün deyil.'});return waiterRpc(app,a,'modifiers',{productId:req.params.id});});
 app.get<{Params:{id:string}}>('/waiter/tables/:id',options,async(req,reply)=>{const a=await staff(req,reply);if(!a)return;if(req.params.id.length>120)return reply.code(400).send({error:'Masa düzgün deyil.'});return waiterRpc(app,a,'table',{tableId:req.params.id});});
 const order=z.object({requestId:id,tableId:z.string().min(1).max(120),note:z.string().max(500).default(''),lines:z.array(z.object({productId:z.string().min(1).max(120),qty:z.number().int().min(1).max(20),unitPriceMinor:z.number().int().min(0).max(100000000),modifierPriceMinor:z.number().int().min(0).max(100000000),modifiers:z.array(z.string().max(120)).max(30).default([]),note:z.string().max(500).default('')}).strict()).min(1).max(40)}).strict();
 app.post('/waiter/orders',{...options,bodyLimit:40000},async(req,reply)=>{const a=await staff(req,reply);if(!a)return;const body=parseBody(order,req.body,reply);if(!body)return;return placeWaiterOrder(app,a,body,rpc);});
 app.get<{Params:{id:string}}>('/waiter/orders/:id',options,async(req,reply)=>{const a=await staff(req,reply);if(!a)return;if(!id.safeParse(req.params.id).success)return reply.code(404).send({error:'Sifariş tapılmadı.'});return waiterOrderStatus(app,a,req.params.id,rpc);});
}
