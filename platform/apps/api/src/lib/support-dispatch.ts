import type { FastifyInstance } from 'fastify';
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { sendSupportRequestEmail, type SupportEmailInput } from './support-email.js';
export type ServiceSettings={enabled:boolean;startMinute:number;endMinute:number;weekDays:number[];offerSeconds:number;maxActive:number;activatedAt:string};
type Runner={execute:(query:SQL)=>Promise<unknown>};
export async function rows<T=Record<string,unknown>>(db:Runner,q:SQL):Promise<T[]>{return Array.from(await db.execute(q) as Iterable<T>);}
export async function serviceSettings(db:Runner):Promise<ServiceSettings>{
 const [r]=await rows(db,sql`SELECT * FROM support_service_settings WHERE id=1`);
 return {enabled:Boolean(r.enabled),startMinute:Number(r.start_minute),endMinute:Number(r.end_minute),weekDays:r.week_days as number[],offerSeconds:Number(r.offer_seconds),maxActive:Number(r.max_active),activatedAt:new Date(r.activated_at as string).toISOString()};
}
const minuteLabel=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
/** Azerbaijan local service calendar. Instants are UTC; the configured business timezone is Asia/Baku. */
export function serviceAvailability(s:ServiceSettings,now=new Date()){
 const local=new Date(now.getTime()+4*3600000),day=local.getUTCDay()||7,minute=local.getUTCHours()*60+local.getUTCMinutes();
 const isOpen=s.enabled&&s.weekDays.includes(day)&&minute>=s.startMinute&&minute<s.endMinute;
 let nextOpen:string|null=null;
 if(s.enabled&&!isOpen)for(let offset=0;offset<8;offset++){
  const candidate=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+offset,0,s.startMinute)-4*3600000);
  if(candidate>now&&s.weekDays.includes(new Date(candidate.getTime()+4*3600000).getUTCDay()||7)){nextOpen=candidate.toISOString();break;}
 }
 const closesAt=isOpen?new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),0,s.endMinute)-4*3600000).toISOString():null;
 return {isOpen,nextOpen,closesAt,timeZone:'Asia/Baku',start:minuteLabel(s.startMinute),end:minuteLabel(s.endMinute),weekDays:s.weekDays,offerSeconds:s.offerSeconds,enabled:s.enabled};
}

export async function drainSupportDispatch(app:FastifyInstance,now=new Date()){
 const stamp=now.toISOString();
 return app.db.transaction(async tx=>{
  const [lock]=await rows(tx,sql`SELECT pg_try_advisory_xact_lock(7831041) AS locked`);if(!lock?.locked)return;
  const settings=await serviceSettings(tx),availability=serviceAvailability(settings,now);
  // Pull new customer events from both existing channels. Existing historical messages do not ring again on upgrade.
  await tx.execute(sql`INSERT INTO support_dispatch_jobs(source_type,source_id,title,preview,event_at,retry_after)
   SELECT 'ticket',t.id,coalesce(c.name,'Müştəri'),left(m.body,300),t.last_customer_at,${stamp} FROM support_tickets t
   JOIN customers c ON c.id=t.customer_id
   JOIN LATERAL(SELECT body FROM support_messages WHERE ticket_id=t.id AND author_kind='customer' ORDER BY created_at DESC LIMIT 1)m ON true
   WHERE t.kind='chat' AND t.status IN('open','claimed') AND t.last_customer_at>=${settings.activatedAt}::timestamptz
   ON CONFLICT(source_type,source_id) DO UPDATE SET title=excluded.title,preview=excluded.preview,event_at=excluded.event_at,
    version=support_dispatch_jobs.version+1,status=CASE WHEN support_dispatch_jobs.status='resolved' THEN 'waiting' ELSE support_dispatch_jobs.status END,
    retry_after=least(support_dispatch_jobs.retry_after,${stamp}),updated_at=${stamp}
   WHERE excluded.event_at>support_dispatch_jobs.event_at`);
  await tx.execute(sql`INSERT INTO support_dispatch_jobs(source_type,source_id,title,preview,event_at,retry_after)
   SELECT 'public_chat',t.id,t.title,left(m.body,300),m.created_at,${stamp} FROM public_chat_threads t
   JOIN LATERAL(SELECT body,created_at FROM public_chat_messages WHERE thread_id=t.id AND NOT is_staff ORDER BY created_at DESC LIMIT 1)m ON true
   WHERE m.created_at>=${settings.activatedAt}::timestamptz
   ON CONFLICT(source_type,source_id) DO UPDATE SET title=excluded.title,preview=excluded.preview,event_at=excluded.event_at,
    version=support_dispatch_jobs.version+1,status=CASE WHEN support_dispatch_jobs.status='resolved' THEN 'waiting' ELSE support_dispatch_jobs.status END,
    retry_after=least(support_dispatch_jobs.retry_after,${stamp}),updated_at=${stamp}
   WHERE excluded.event_at>support_dispatch_jobs.event_at`);
  await tx.execute(sql`UPDATE support_dispatch_jobs j SET status='resolved',expires_at=NULL,updated_at=${stamp}
   WHERE source_type='ticket' AND status<>'resolved' AND EXISTS(SELECT 1 FROM support_tickets t WHERE t.id=j.source_id AND t.status='resolved')`);
  const lost=await rows(tx,sql`SELECT j.id,j.offer_id,j.status FROM support_dispatch_jobs j LEFT JOIN support_staff_devices d ON d.id=j.device_id
   LEFT JOIN users u ON u.id=d.user_id WHERE j.status IN('offered','accepted') AND
    (${!availability.isOpen} OR (j.status='offered' AND j.expires_at<=${stamp}) OR d.id IS NULL OR NOT d.enabled OR NOT d.available OR NOT u.active OR u.role<>'superadmin' OR d.last_seen_at<${new Date(now.getTime()-60000).toISOString()})`);
  for(const j of lost){
   await tx.execute(sql`UPDATE support_dispatch_attempts SET decision=${availability.isOpen?'expired_or_offline':'outside_hours'},decided_at=${stamp} WHERE offer_id=${j.offer_id}::uuid AND decision='offered'`);
   await tx.execute(sql`UPDATE support_dispatch_jobs SET status='waiting',device_id=NULL,offer_id=NULL,expires_at=NULL,retry_after=${stamp},updated_at=${stamp} WHERE id=${j.id}::uuid`);
  }
  if(!availability.isOpen)return;
  const waiting=await rows(tx,sql`SELECT * FROM support_dispatch_jobs WHERE status='waiting' AND retry_after<=${stamp} ORDER BY created_at LIMIT 100 FOR UPDATE`);
  for(const job of waiting){
   const candidates=await rows(tx,sql`SELECT d.id FROM support_staff_devices d JOIN users u ON u.id=d.user_id
    WHERE d.enabled AND d.available AND u.active AND u.role='superadmin' AND d.last_seen_at>=${new Date(now.getTime()-60000).toISOString()}
    AND (SELECT count(*) FROM support_dispatch_jobs a WHERE a.device_id=d.id AND a.status IN('offered','accepted'))<${settings.maxActive}
    ORDER BY d.priority,d.last_offer_at NULLS FIRST,d.created_at`);
   const tried=job.attempted_devices as string[];
   const device=candidates.find(d=>!tried.includes(String(d.id)));
   if(!device){if(candidates.length)await tx.execute(sql`UPDATE support_dispatch_jobs SET attempted_devices='{}',retry_after=${new Date(now.getTime()+60000).toISOString()} WHERE id=${job.id}::uuid`);continue;}
   const offer=randomUUID(),expires=new Date(now.getTime()+settings.offerSeconds*1000);
   await tx.execute(sql`UPDATE support_dispatch_jobs SET status='offered',device_id=${device.id}::uuid,offer_id=${offer}::uuid,expires_at=${expires.toISOString()},attempted_devices=array_append(attempted_devices,${device.id}::uuid),updated_at=${stamp} WHERE id=${job.id}::uuid`);
   await tx.execute(sql`UPDATE support_staff_devices SET last_offer_at=${stamp} WHERE id=${device.id}::uuid`);
   await tx.execute(sql`INSERT INTO support_dispatch_attempts(job_id,device_id,offer_id,offered_at,expires_at) VALUES(${job.id}::uuid,${device.id}::uuid,${offer}::uuid,${stamp},${expires.toISOString()})`);
  }
 });
}
export function dispatchDto(j:Record<string,unknown>,now=new Date()){
 return {id:j.id,sourceType:j.source_type,sourceId:j.source_id,title:j.title,preview:j.preview,status:j.status,version:Number(j.version),offerId:j.offer_id,
  expiresAt:j.expires_at?new Date(j.expires_at as string).toISOString():null,remainingMs:j.expires_at?Math.max(0,new Date(j.expires_at as string).getTime()-now.getTime()):30000,
  href:j.source_type==='ticket'?`/support/${j.source_id}`:`/destek/chat/?thread=${j.source_id}`,kind:j.status==='accepted'?'message':'offer'};
}
export async function acceptDispatch(app:FastifyInstance,userId:string,deviceId:string,jobId:string,offerId:string,version:number,now=new Date()){
 const stamp=now.toISOString();
 return app.db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(7831041)`);
  const [j]=await rows(tx,sql`SELECT j.*,d.user_id FROM support_dispatch_jobs j JOIN support_staff_devices d ON d.id=j.device_id WHERE j.id=${jobId}::uuid FOR UPDATE OF j`);
  if(!j||j.user_id!==userId||j.device_id!==deviceId||j.offer_id!==offerId||!['offered','accepted'].includes(String(j.status)))return null;
  const a=serviceAvailability(await serviceSettings(tx),now);if(!a.isOpen)return null;
  if(j.status==='offered'&&new Date(j.expires_at as string)<=now)return null;
  if(j.status==='accepted'&&Number(j.acknowledged_version)>=Math.min(Number(j.version),version))return {...dispatchDto(j,now),changed:false};
  await tx.execute(sql`UPDATE support_dispatch_jobs SET status='accepted',acknowledged_version=greatest(acknowledged_version,least(version,${version})),expires_at=NULL,updated_at=${stamp} WHERE id=${jobId}::uuid`);
  await tx.execute(sql`UPDATE support_dispatch_attempts SET decision='accepted',decided_at=${stamp} WHERE offer_id=${offerId}::uuid AND decision='offered'`);
  if(j.source_type==='ticket')await tx.execute(sql`UPDATE support_tickets SET status='claimed',claimed_by=${userId}::uuid,claimed_at=${stamp},updated_at=${stamp} WHERE id=${j.source_id}::uuid AND status<>'resolved'`);
  return {...dispatchDto({...j,status:'accepted',expires_at:null},now),changed:true};
 });
}
export async function drainSupportEmails(app:FastifyInstance,deliver=sendSupportRequestEmail){
 const s=await serviceSettings(app.db);if(!serviceAvailability(s).isOpen)return;
 const batch=await app.db.transaction(async tx=>{
  const pending=await rows(tx,sql`SELECT id,payload FROM support_email_queue WHERE EXISTS(SELECT 1 FROM support_tickets t WHERE t.id=support_email_queue.ticket_id AND t.status<>'resolved') AND delivered_at IS NULL AND next_attempt_at<=now() ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED`);
  for(const r of pending)await tx.execute(sql`UPDATE support_email_queue SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=${r.id}::uuid`);
  return pending;
 });
 for(const r of batch){if(!serviceAvailability(await serviceSettings(app.db)).isOpen)break;
  if(await deliver(app,r.payload as SupportEmailInput))await app.db.execute(sql`UPDATE support_email_queue SET delivered_at=now() WHERE id=${r.id}::uuid AND payload=${JSON.stringify(r.payload)}::jsonb`);
 }
}
export function startSupportDispatcher(app:FastifyInstance){
 let busy=false,emailBusy=false;
 const timer=setInterval(()=>{if(!busy){busy=true;void drainSupportDispatch(app).catch(err=>app.log.error({err},'support_dispatch_failed')).finally(()=>{busy=false;});}
  if(!emailBusy){emailBusy=true;void drainSupportEmails(app).catch(err=>app.log.error({err},'support_email_queue_failed')).finally(()=>{emailBusy=false;});}
 },2000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
}
