import type {FastifyInstance} from 'fastify';
import {sql} from 'drizzle-orm';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {env} from '../env.js';
import {requireSuperadmin,currentUser} from '../plugins/auth.js';
import {writeAudit} from '../lib/audit.js';
import {clientIp} from '../lib/validate.js';
interface CommandRow extends RowDataPacket{id:string;customer_id:string;status:string;command:string;args_json:unknown;result_json:unknown;error:string|null;created_at:Date;done_at:Date|null}
const PREVIEW='data.previewOperations',RESET='data.resetOperations',CLEARED=RESET+'.cleared';
const uuid=z.string().uuid(),rows=(value:any):any[]=>Array.isArray(value)?value:value.rows;
const parse=(value:any)=>typeof value==='string'?JSON.parse(value):value;
export function resetDeviceError(device:{app_version?:string;last_seen_at?:Date|string|null},now=Date.now()){
 const v=(device.app_version||'').split('.').map(Number);
 if(v.length!==3||v.some(n=>!Number.isSafeInteger(n)||n<0)||v[0]<1||(v[0]===1&&(v[1]<10||(v[1]===10&&v[2]<17))))return 'Menyunu qoruyan sıfırlama üçün Restoran POS 1.10.17 və ya yenisi lazımdır.';
 if(!device.last_seen_at||!Number.isFinite(new Date(device.last_seen_at).getTime())||now-new Date(device.last_seen_at).getTime()>90000)return 'Kassa oflayndır. POS-u açın və internetə qoşun.';
 return null;
}
export async function operationResetRoutes(app:FastifyInstance){
 const pool=env.mysqlUrl?mysql.createPool({uri:env.mysqlUrl,connectionLimit:2}):null;
 let ready:Promise<unknown>|undefined;
 const ensure=()=>ready??=app.db.execute(sql`CREATE TABLE IF NOT EXISTS pos_operational_resets(command_id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id),device_id uuid NOT NULL REFERENCES devices(id),catalog_hash text NOT NULL,kept_copy text NOT NULL,done_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`).catch(e=>{ready=undefined;throw e});
 async function devices(customerId:string){return rows(await app.db.execute(sql`SELECT d.id,d.hostname,d.app_version,d.last_seen_at FROM devices d JOIN licenses l ON l.id=d.license_id WHERE l.customer_id=${customerId}::uuid AND d.status='active' AND COALESCE(l.features->>'product',CASE WHEN l.plan='market' THEN 'market' ELSE 'restaurant' END)='restaurant'`));}
 async function commands(customerId:string){if(!pool)return [];await pool.execute("UPDATE bot_commands SET status='expired',done_at=? WHERE customer_id=? AND command IN (?,?) AND status='pending' AND expires_at<?",[new Date(),customerId,PREVIEW,RESET,new Date()]);const [result]=await pool.execute<CommandRow[]>("SELECT id,status,command,args_json,result_json,error,error_code,created_at,done_at FROM bot_commands WHERE customer_id=? AND command IN (?,?,?) ORDER BY created_at DESC LIMIT 20",[customerId,PREVIEW,RESET,CLEARED]);return result.map(r=>({...r,args:parse(r.args_json)||{},result:parse(r.result_json)||{}}));}
 async function sweep(){
  if(!pool)return;await ensure();
  const [pending]=await pool.execute<RowDataPacket[]>("SELECT id,customer_id,args_json,result_json,done_at FROM bot_commands WHERE command=? AND status='done' LIMIT 20",[RESET]);
  for(const row of pending){
   const args=parse(row.args_json)||{},result=parse(row.result_json)||{},owner=row.customer_id,device=args.deviceId;
   if(!uuid.safeParse(device).success||result.reset!==true||!/^[a-f0-9]{64}$/.test(result.catalogHash||'')||!String(result.keptCopy||'').includes('-before-operational-reset-')||!row.done_at)continue;
   if(!(await devices(owner)).some(d=>d.id===device))continue;
   const cutoff=new Date(row.done_at);
   await app.db.transaction(async tx=>{
    const inserted=rows(await tx.execute(sql`INSERT INTO pos_operational_resets(command_id,customer_id,device_id,catalog_hash,kept_copy,done_at) VALUES(${row.id}::uuid,${owner}::uuid,${device}::uuid,${result.catalogHash},${result.keptCopy},${cutoff}) ON CONFLICT DO NOTHING RETURNING command_id`));
    if(!inserted.length)return;
    // New post-reset data survives retries or a restart halfway through server cleanup.
    for(const table of ['portal_device_inventory','owner_floor_snapshots'])await tx.execute(sql`DELETE FROM ${sql.raw(table)} WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid AND updated_at<=${cutoff}`);
    for(const table of ['portal_warehouse_cache','portal_warehouse_documents','portal_warehouse_requests']){
     const columns=rows(await tx.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table}`)).map(r=>r.column_name);
     if(!columns.includes('device_id')||!columns.includes('customer_id'))continue;
     const stamp=columns.includes('updated_at')?'updated_at':columns.includes('created_at')?'created_at':null;
     if(stamp)await tx.execute(sql`DELETE FROM ${sql.raw(table)} WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid AND ${sql.raw(stamp)}<=${cutoff}`);
    }
    // Aggregated copies can contain other devices; remove only stale copies when this is the sole till.
    if((await devices(owner)).length===1)await tx.execute(sql`DELETE FROM portal_inventory WHERE customer_id=${owner}::uuid AND product IN ('restaurant','books-restaurant') AND updated_at<=${cutoff}`);
    await tx.execute(sql`DELETE FROM restaurant_qr_events WHERE order_id IN (SELECT o.id FROM restaurant_qr_orders o JOIN restaurant_qr_menus m ON m.id=o.menu_id WHERE m.customer_id=${owner}::uuid AND m.device_id=${device}::uuid AND o.updated_at<=${cutoff})`);
    await tx.execute(sql`DELETE FROM restaurant_qr_orders o USING restaurant_qr_menus m WHERE m.id=o.menu_id AND m.customer_id=${owner}::uuid AND m.device_id=${device}::uuid AND o.updated_at<=${cutoff}`);
    await tx.execute(sql`UPDATE restaurant_qr_menus SET revision=revision+1,updated_at=now() WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid`);
   });
   if((await devices(owner)).length===1){
    for(const [table,stamp]of [['floor_live','updated_at'],['table_live','updated_at'],['sales_live','updated_at'],['report_live','created_at']])await pool.execute(`DELETE FROM ${table} WHERE customer_id=? AND ${stamp}<=?`,[owner,cutoff]);
   }
   await pool.execute('UPDATE bot_commands SET command=? WHERE id=? AND customer_id=? AND command=? AND status=\'done\'',[CLEARED,row.id,owner,RESET]);
   await writeAudit(app,{action:'customer.operation_reset.done',entityType:'device',entityId:device,actorCustomerId:owner,meta:{commandId:row.id,catalogHash:result.catalogHash,keptCopy:result.keptCopy}});
  }
 }
 const timer=setInterval(()=>void sweep().catch(err=>app.log.warn({err},'operation_reset_cleanup_failed')),15000);timer.unref();app.addHook('onClose',async()=>{clearInterval(timer);if(pool)await pool.end()});
 app.get('/customers/:id/operation-reset',async(req,reply)=>{
  if(!requireSuperadmin(req,reply))return;const id=(req.params as any).id;if(!uuid.safeParse(id).success)return reply.code(400).send({error:'Müştəri düzgün deyil'});
  const [customer]=rows(await app.db.execute(sql`SELECT name FROM customers WHERE id=${id}::uuid`));if(!customer)return reply.code(404).send({error:'Müştəri tapılmadı'});
  return {customerName:customer.name,available:!!pool,devices:(await devices(id)).map(d=>({...d,error:resetDeviceError(d)})),commands:(await commands(id)).map(c=>({id:c.id,deviceId:c.args.deviceId,action:c.command===PREVIEW?'preview':'reset',status:c.status,serverCleared:c.command===CLEARED,error:c.error,result:c.status==='done'?c.result:null,createdAt:c.created_at}))};
 });
 app.post('/customers/:id/operation-reset',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
  if(!requireSuperadmin(req,reply))return;if(!pool)return reply.code(503).send({error:'Əmr növbəsi əlçatan deyil'});
  const id=(req.params as any).id,b=z.object({action:z.enum(['preview','reset']),deviceId:uuid,previewId:uuid.optional(),confirmName:z.string().optional(),reason:z.string().trim().min(3).max(500).default('Müştərinin istəyi ilə test məlumatları sıfırlanır')}).safeParse(req.body);
  if(!uuid.safeParse(id).success||!b.success)return reply.code(400).send({error:'Sorğu düzgün deyil'});
  const body=b.data,device=(await devices(id)).find(d=>d.id===body.deviceId);if(!device)return reply.code(404).send({error:'Kassa bu müştərinin deyil'});const fault=resetDeviceError(device);if(fault)return reply.code(409).send({error:fault});
  const [customer]=rows(await app.db.execute(sql`SELECT name FROM customers WHERE id=${id}::uuid`));if(!customer)return reply.code(404).send({error:'Müştəri tapılmadı'});
  const result=await app.db.transaction(async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'operation-reset:'+id+':'+device.id}))`);
   const history=await commands(id),running=history.find(c=>c.args.deviceId===device.id&&['pending','taken'].includes(c.status));
   if(running)return {status:409,error:'Bu kassada əvvəlki yoxlama və ya sıfırlama hələ bitməyib'};
   let args:Record<string,unknown>={deviceId:device.id};
   if(body.action==='reset'){
    if(body.confirmName!==customer.name)return {status:400,error:'Müştərinin adını dəqiq yazın'};
    const preview=history.find(c=>c.id===body.previewId&&c.command===PREVIEW&&c.status==='done'&&c.args.deviceId===device.id&&Date.now()-new Date(c.created_at).getTime()<600000&&/^[a-f0-9]{64}$/.test(c.result.catalogHash||''));
    if(!preview)return {status:409,error:'Əvvəlcə bu kassanın yeni yoxlamasını aparın'};
    const existing=history.find(c=>c.args.previewId===preview.id&&c.command!==PREVIEW);if(existing)return {status:202,commandId:existing.id};
    args={...args,previewId:preview.id,catalogHash:preview.result.catalogHash,reason:body.reason};
   }
   const commandId=randomUUID(),command=body.action==='preview'?PREVIEW:RESET;
   await pool.execute("INSERT INTO bot_commands(id,customer_id,command,args_json,requested_by,status,created_at,expires_at) VALUES(?,?,?,?,?,'pending',?,?)",[commandId,id,command,JSON.stringify(args),currentUser(req).id,new Date(),new Date(Date.now()+5*60000)]);
   return {status:202,commandId};
  });
  if('error' in result)return reply.code(result.status).send({error:result.error});
  await writeAudit(app,{actorUserId:currentUser(req).id,action:'customer.operation_reset.'+body.action,entityType:'device',entityId:device.id,actorCustomerId:id,ip:clientIp(req),meta:{commandId:result.commandId}});
  return reply.code(202).send({commandId:result.commandId});
 });
}
