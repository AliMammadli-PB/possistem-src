import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser, requireSuperadmin } from '../plugins/auth.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { acceptDispatch, dispatchDto, drainSupportDispatch, rows, serviceAvailability, serviceSettings } from '../lib/support-dispatch.js';
const uuid=z.string().uuid();
export async function supportServiceRoutes(app:FastifyInstance){
 app.get('/public/support/availability',async(_req,reply)=>{reply.header('Cache-Control','no-store');return serviceAvailability(await serviceSettings(app.db));});
 app.post('/public/chat/assistant-reports',{bodyLimit:2*1024*1024,config:{rateLimit:{max:5,timeWindow:'1 hour'}}},async(req,reply)=>{
  const origin=req.headers.origin;if(origin&&origin!=='https://possistem.az')return reply.code(403).send({error:'Origin not allowed'});
  const body=parseBody(z.object({requestKey:uuid,language:z.enum(['az','en','ru']),reason:z.enum(['wrong_answer','not_understood','technical','other']),comment:z.string().max(2000).default(''),transcript:z.array(z.object({author:z.enum(['me','helper']),body:z.string().min(1).max(16000),createdAt:z.string().datetime().optional(),topic:z.string().max(80).optional()})).min(1).max(500)}),req.body,reply);if(!body)return;
  if(body.transcript.reduce((n,m)=>n+m.body.length,0)>1500000)return reply.code(413).send({error:'Söhbət çox uzundur'});
  const [r]=await rows(app.db,sql`INSERT INTO support_assistant_reports(request_key,customer_id,language,reason,comment,transcript)
   VALUES(${body.requestKey}::uuid,${req.customer?.id??null}::uuid,${body.language},${body.reason},${body.comment},${JSON.stringify(body.transcript)}::jsonb)
   ON CONFLICT(request_key) DO UPDATE SET request_key=excluded.request_key RETURNING id`);
  return reply.code(201).send({ok:true,id:r.id});
 });
 app.get('/support/assistant-reports',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;
  return {entries:await rows(app.db,sql`SELECT r.id,r.language,r.reason,r.comment,r.status,r.created_at AS "createdAt",jsonb_array_length(r.transcript) AS "messageCount",c.name AS "customerName" FROM support_assistant_reports r LEFT JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC LIMIT 200`)};
 });
 app.get<{Params:{id:string}}>('/support/assistant-reports/:id',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;if(!uuid.safeParse(req.params.id).success)return reply.code(404).send({error:'Tapılmadı'});
  const [r]=await rows(app.db,sql`SELECT r.*,c.name AS "customerName" FROM support_assistant_reports r LEFT JOIN customers c ON c.id=r.customer_id WHERE r.id=${req.params.id}::uuid`);if(!r)return reply.code(404).send({error:'Tapılmadı'});return r;
 });
 app.patch<{Params:{id:string}}>('/support/assistant-reports/:id',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;if(!uuid.safeParse(req.params.id).success)return reply.code(404).send({error:'Tapılmadı'});
  const body=parseBody(z.object({status:z.enum(['new','reviewed','resolved']),adminNote:z.string().max(4000).default('')}),req.body,reply);if(!body)return;
  const [r]=await rows(app.db,sql`UPDATE support_assistant_reports SET status=${body.status},admin_note=${body.adminNote},updated_at=now() WHERE id=${req.params.id}::uuid RETURNING id`);if(!r)return reply.code(404).send({error:'Tapılmadı'});
  await writeAudit(app,{actorUserId:currentUser(req).id,action:'support.assistant_report.review',entityType:'support_assistant_report',entityId:req.params.id,ip:clientIp(req)});return{ok:true};
 });
 app.get('/support/dispatch/settings',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;const settings=await serviceSettings(app.db);
  return {settings,availability:serviceAvailability(settings),devices:await rows(app.db,sql`SELECT d.id,d.name,d.kind,d.enabled,d.priority,d.app_version AS "appVersion",d.last_seen_at AS "lastSeenAt",(d.last_seen_at>=now()-interval '60 seconds') AS online,d.available,u.email FROM support_staff_devices d JOIN users u ON u.id=d.user_id ORDER BY d.priority,d.created_at`),jobs:await rows(app.db,sql`SELECT j.id,j.title,j.source_type AS "sourceType",j.status,j.device_id AS "deviceId",j.expires_at AS "expiresAt",j.created_at AS "createdAt",d.name AS "deviceName",(SELECT count(*) FROM support_dispatch_attempts a WHERE a.job_id=j.id) AS attempts FROM support_dispatch_jobs j LEFT JOIN support_staff_devices d ON d.id=j.device_id ORDER BY j.updated_at DESC LIMIT 100`)};
 });
 app.put('/support/dispatch/settings',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;
  const body=parseBody(z.object({enabled:z.boolean(),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440),weekDays:z.array(z.number().int().min(1).max(7)).min(1).max(7),offerSeconds:z.number().int().min(10).max(180),maxActive:z.number().int().min(1).max(20),devices:z.array(z.object({id:uuid,name:z.string().trim().min(1).max(80),enabled:z.boolean(),priority:z.number().int().min(0).max(10000)})).max(200).optional()}).refine(b=>b.endMinute>b.startMinute,{message:'Bitmə vaxtı başlama vaxtından sonra olmalıdır'}),req.body,reply);if(!body)return;
  await app.db.transaction(async tx=>{
   await tx.execute(sql`UPDATE support_service_settings SET enabled=${body.enabled},start_minute=${body.startMinute},end_minute=${body.endMinute},week_days=${'{'+[...new Set(body.weekDays)].join(',')+'}'}::integer[],offer_seconds=${body.offerSeconds},max_active=${body.maxActive},updated_at=now() WHERE id=1`);
   for(const d of body.devices??[])await tx.execute(sql`UPDATE support_staff_devices SET name=${d.name},enabled=${d.enabled},priority=${d.priority} WHERE id=${d.id}::uuid`);
  });await writeAudit(app,{actorUserId:currentUser(req).id,action:'support.settings.update',entityType:'support_service_settings',entityId:'1',ip:clientIp(req)});await drainSupportDispatch(app);return{ok:true};
 });
 app.post('/support/dispatch/poll',{config:{rateLimit:{max:300,timeWindow:'1 minute'}}},async(req,reply)=>{if(!requireSuperadmin(req,reply))return;
  const body=parseBody(z.object({deviceId:uuid,name:z.string().trim().min(1).max(80),kind:z.enum(['android','web']),appVersion:z.string().max(80).default(''),available:z.boolean().optional()}),req.body,reply);if(!body)return;
  const user=currentUser(req);
  const [device]=await rows(app.db,sql`INSERT INTO support_staff_devices(id,user_id,name,kind,app_version,available) VALUES(${body.deviceId}::uuid,${user.id}::uuid,${body.name},${body.kind},${body.appVersion},${body.available??true})
   ON CONFLICT(id) DO UPDATE SET app_version=excluded.app_version,available=coalesce(${body.available??null}::boolean,support_staff_devices.available),last_seen_at=now() WHERE support_staff_devices.user_id=excluded.user_id RETURNING id`);
  if(!device)return reply.code(409).send({error:'Cihaz başqa hesabla bağlıdır. Yenidən daxil olun.'});
  await drainSupportDispatch(app);const s=await serviceSettings(app.db),availability=serviceAvailability(s);
  const jobs=availability.isOpen?await rows(app.db,sql`SELECT * FROM support_dispatch_jobs WHERE device_id=${body.deviceId}::uuid AND (status='offered' AND expires_at>now() OR status='accepted' AND version>acknowledged_version) ORDER BY created_at`):[];
  return {availability,notifications:jobs.map(j=>{const dto=dispatchDto(j);return {...dto,remainingMs:Math.min(dto.remainingMs,availability.closesAt?Math.max(0,new Date(availability.closesAt).getTime()-Date.now()):dto.remainingMs)};}),serverTime:new Date().toISOString()};
 });
 app.post<{Params:{id:string}}>('/support/dispatch/:id/accept',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;if(!uuid.safeParse(req.params.id).success)return reply.code(404).send({error:'Tapılmadı'});
  const body=parseBody(z.object({deviceId:uuid,offerId:uuid,version:z.number().int().min(1)}),req.body,reply);if(!body)return;
  const accepted=await acceptDispatch(app,currentUser(req).id,body.deviceId,req.params.id,body.offerId,body.version);
  if(!accepted)return reply.code(409).send({error:'Təklifin vaxtı bitib və ya başqa cihaza ötürülüb. Siyahını yeniləyin.'});
  if(accepted.changed)await writeAudit(app,{actorUserId:currentUser(req).id,action:'support.dispatch.accept',entityType:'support_dispatch_job',entityId:req.params.id,ip:clientIp(req)});return{ok:true,job:accepted};
 });
 app.post<{Params:{id:string}}>('/support/dispatch/:id/resolve',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;if(!uuid.safeParse(req.params.id).success)return reply.code(404).send({error:'Tapılmadı'});
  const [r]=await rows(app.db,sql`UPDATE support_dispatch_jobs SET status='resolved',expires_at=NULL,updated_at=now() WHERE id=${req.params.id}::uuid RETURNING source_type,source_id`);if(!r)return reply.code(404).send({error:'Tapılmadı'});
  if(r.source_type==='ticket')await app.db.execute(sql`UPDATE support_tickets SET status='resolved',updated_at=now() WHERE id=${r.source_id}::uuid`);
  await writeAudit(app,{actorUserId:currentUser(req).id,action:'support.dispatch.resolve',entityType:'support_dispatch_job',entityId:req.params.id,ip:clientIp(req)});return{ok:true};
 });
}
