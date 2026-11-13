import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type{FastifyInstance}from'fastify';
import{ownerBranchDevices,branchOnline}from'../../routes/cloud-branches.js';
import{notePortalRpc,runOnTill}from'../bot/queue.js';
export const rows=(r:any):any[]=>Array.isArray(r)?r:r?.rows||[];
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function fail(status:number,message:string):never{throw Object.assign(Error(message),{statusCode:status});}
export function namespaceSuggestion(name:string){const slug=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ə/g,'e').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/^[^a-z]+/,'').slice(0,32);return slug.length>=2?slug:slug?slug+'-pos':'restoran';}
export async function waiterDevice(app:FastifyInstance,customerId:string,deviceId:string){const device=(await ownerBranchDevices(app,customerId)).find(d=>d.id===deviceId&&d.product==='restaurant');if(!device)fail(403,'Bu kassa sahibkar hesabına aid deyil və ya istifadə müddəti bitib.');return device;}
export async function waiterRpc(app:FastifyInstance,who:any,action:string,payload:Record<string,unknown>={}){
 const device=await waiterDevice(app,who.customer_id,who.device_id);if(!branchOnline(device))fail(409,'Kassa oflayndır. Sifariş göndərilmədi; POS-u internetə qoşun.');
 notePortalRpc(who.customer_id);
 const out=await runOnTill({customerId:who.customer_id,deviceId:who.device_id,command:'waiter.portal',args:{...payload,action,customerId:who.customer_id,deviceId:who.device_id,nativeUserId:who.native_user_id||'',cloudExpiresAt:Date.now()+20000},requestedBy:'waiter:'+who.id,timeoutMs:20000});
 if(!out.ok)fail(out.timedOut?504:409,out.timedOut?'Kassadan təsdiq alınmadı. Eyni sifarişi yenidən yaratmayın; vəziyyətini yoxlayın.':out.error||'Ofisiant bağlantısı üçün kassa proqramını yeniləyin.');
 return out.result;
}
export async function placeWaiterOrder(app:FastifyInstance,who:any,body:any,rpc=waiterRpc){
 const hash=digest(JSON.stringify(body));const id=body.requestId;
 const claimed=await app.db.transaction(async tx=>{
  const inserted=rows(await tx.execute(sql`INSERT INTO waiter_requests(id,waiter_id,customer_id,device_id,request_hash,body,lease_until) VALUES(${id}::uuid,${who.id}::uuid,${who.customer_id}::uuid,${who.device_id}::uuid,${hash},${JSON.stringify(body)}::jsonb,now()+interval '25 seconds') ON CONFLICT(id) DO NOTHING RETURNING id`));
  const [r]=rows(await tx.execute(sql`SELECT * FROM waiter_requests WHERE id=${id}::uuid FOR UPDATE`));
  if(!r||r.waiter_id!==who.id||r.customer_id!==who.customer_id||r.device_id!==who.device_id||r.request_hash!==hash)fail(409,'Bu sifariş nömrəsi başqa əməliyyata aiddir.');
  if(r.state==='done')return{cached:r.result};
  if(inserted.length)return{run:true};
  // First creation and retry are claimed atomically; concurrent submissions only observe.
  const [claim]=rows(await tx.execute(sql`UPDATE waiter_requests SET state='processing',lease_until=now()+interval '25 seconds',updated_at=now() WHERE id=${id}::uuid AND (state IN ('accepted','uncertain','failed') OR lease_until<now()) RETURNING id`));
  return claim?{run:true}:{cached:{state:'processing',requestId:id}};
 });
 if(!claimed.run)return claimed.cached;
 try{
  const result:any=await rpc(app,who,'place',body);const state=result?.kitchenSent?'done':result?.accepted?'accepted':'failed';
  const output={...result,state,requestId:id};await app.db.execute(sql`UPDATE waiter_requests SET state=${state},result=${JSON.stringify(output)}::jsonb,updated_at=now() WHERE id=${id}::uuid AND waiter_id=${who.id}::uuid`);return output;
 }catch(error:any){const output={state:'uncertain',requestId:id,error:error.message};await app.db.execute(sql`UPDATE waiter_requests SET state='uncertain',result=${JSON.stringify(output)}::jsonb,updated_at=now() WHERE id=${id}::uuid AND waiter_id=${who.id}::uuid`);return output;}
}
export async function waiterOrderStatus(app:FastifyInstance,who:any,id:string,rpc=waiterRpc){
 const [r]=rows(await app.db.execute(sql`SELECT state,result,lease_until FROM waiter_requests WHERE id=${id}::uuid AND waiter_id=${who.id}::uuid AND customer_id=${who.customer_id}::uuid AND device_id=${who.device_id}::uuid`));if(!r)fail(404,'Sifariş tapılmadı.');
 if(r.state==='done')return r.result;
 if(r.state==='processing'&&Date.parse(r.lease_until)>Date.now())return{state:'processing',requestId:id};
 const status:any=await rpc(app,who,'status',{requestId:id});const output={...status,state:status?.kitchenSent?'done':status?.accepted?'accepted':status?.accepted===false?'failed':'uncertain',canEdit:status?.accepted===false,requestId:id};
 await app.db.execute(sql`UPDATE waiter_requests SET state=${output.state},result=${JSON.stringify(output)}::jsonb,updated_at=now() WHERE id=${id}::uuid AND waiter_id=${who.id}::uuid`);return output;
}
