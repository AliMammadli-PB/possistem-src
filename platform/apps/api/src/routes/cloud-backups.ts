import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {sql} from 'drizzle-orm';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile,unlink,mkdtemp,rm,rename,statfs} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CONTROL_ROOT} from '../env.js';
import {requireSuperadmin} from '../plugins/auth.js';
import {writeAudit} from '../lib/audit.js';
// Loaded on first use: a deploy that forgot this file must lose backups only, not start the whole API.
let loaded:any=null;
const F=()=>loaded??=createRequire(import.meta.url)(path.join(CONTROL_ROOT,'packages/security/cloud-backup.cjs'));
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Not under CONTROL_ROOT: a delta deploy gets a new workspace, and the service cannot write there anyway.
const directory=()=>path.resolve(process.env.POS_CLOUD_BACKUP_DIR||(process.env.NODE_ENV==='production'?'/var/lib/possistem-pos-control/cloud-backups':path.join(CONTROL_ROOT,'private-cloud-backups')));
const KEEP_FREE_BYTES=5*1024*1024*1024;
const DDL=`
CREATE TABLE IF NOT EXISTS pos_cloud_backups (
 id uuid PRIMARY KEY, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
 product text NOT NULL CHECK(product='restaurant'), sha256 text NOT NULL,
 size_bytes integer NOT NULL, db_bytes integer NOT NULL, manifest jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,device_id,sha256)
);
CREATE INDEX IF NOT EXISTS pos_cloud_backups_owner_idx ON pos_cloud_backups(customer_id,created_at DESC);
CREATE TABLE IF NOT EXISTS pos_cloud_backup_state (
 device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE, requested_id uuid, completed_request_id uuid,
 requested_at timestamptz, last_success_at timestamptz, last_attempt_at timestamptz,
 last_error text, updated_at timestamptz NOT NULL DEFAULT now()
);`;
const rows=(r:unknown)=>Array.isArray(r)?r as Record<string,any>[]:(r as {rows:Record<string,any>[]}).rows;
const same=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const error=(reply:FastifyReply,status:number,code:string)=>reply.code(status).send({error:code,code});
export async function cloudBackupRoutes(app:FastifyInstance){
 let ready:Promise<unknown>|null=null;let activeUploads=0;
 const ensure=()=>ready??=(async()=>{for(const statement of DDL.split(';').filter(x=>x.trim()))await app.db.execute(sql.raw(statement));})().catch(e=>{ready=null;throw e});
 async function device(req:FastifyRequest,reply:FastifyReply){
  const id=(req.params as {deviceId:string}).deviceId;if(!UUID.test(id))return error(reply,400,'DEVICE_INVALID'),null;
  // Same proof the sales sync uses: a licensed till need not have an owner signed in to be backed up.
  const [d]=rows(await app.db.execute(sql`SELECT d.id,d.status,d.device_fingerprint,l.id AS license_id,l.customer_id,l.features,l.status AS license_status FROM devices d JOIN licenses l ON l.id=d.license_id JOIN customers c ON c.id=l.customer_id WHERE d.id=${id}::uuid AND c.active=true`));
  if(!d||d.status==='revoked'||!same(String(d.device_fingerprint),String(req.headers['x-device-fingerprint']||'')))return error(reply,401,'DEVICE_AUTH_FAILED'),null;
  if(d.features?.product==='market'||d.features?.market===true)return error(reply,400,'PRODUCT_UNSUPPORTED'),null;
  return d;
 }
 const list=async(customerId:string)=>{
  await ensure();return{devices:rows(await app.db.execute(sql`SELECT d.id,d.hostname,d.app_version,d.status,d.last_seen_at,l.features->'cloudBackup' AS enabled,s.last_success_at,s.last_attempt_at,s.last_error,s.requested_id,s.completed_request_id FROM devices d JOIN licenses l ON l.id=d.license_id LEFT JOIN pos_cloud_backup_state s ON s.device_id=d.id WHERE l.customer_id=${customerId}::uuid AND COALESCE(l.features->>'product','restaurant')='restaurant' AND COALESCE(l.features->>'market','false')<>'true' ORDER BY d.created_at`)),backups:rows(await app.db.execute(sql`SELECT id,device_id,product,size_bytes,db_bytes,sha256,manifest,created_at FROM pos_cloud_backups WHERE customer_id=${customerId}::uuid ORDER BY created_at DESC LIMIT 100`))};
 };
 app.get('/devices/:deviceId/cloud-backup/status',async(req,reply)=>{const d=await device(req,reply);if(!d)return;await ensure();const [state]=rows(await app.db.execute(sql`SELECT * FROM pos_cloud_backup_state WHERE device_id=${d.id}::uuid`));return{enabled:d.features?.cloudBackup===true&&d.license_status==='active',intervalMs:6*3600_000,requestId:state?.requested_id!==state?.completed_request_id?state?.requested_id:null,lastSuccessAt:state?.last_success_at||null};});
 app.post('/devices/:deviceId/cloud-backup/error',async(req,reply)=>{const d=await device(req,reply);if(!d)return;await ensure();const code=String((req.body as any)?.code||'BACKUP_FAILED').replace(/[^A-Z0-9_]/g,'').slice(0,80)||'BACKUP_FAILED';await app.db.execute(sql`INSERT INTO pos_cloud_backup_state(device_id,customer_id,last_attempt_at,last_error) VALUES(${d.id}::uuid,${d.customer_id}::uuid,now(),${code}) ON CONFLICT(device_id) DO UPDATE SET last_attempt_at=now(),last_error=${code},updated_at=now()`);return{ok:true};});
 app.post('/devices/:deviceId/cloud-backup',{config:{rateLimit:{max:12,timeWindow:'1 hour'}}},async(req,reply)=>{
  const d=await device(req,reply);if(!d)return;if(d.features?.cloudBackup!==true||d.license_status!=='active')return error(reply,403,'CLOUD_BACKUP_DISABLED');await ensure();if(activeUploads)return error(reply,429,'BACKUP_BUSY');activeUploads++;try{
  const part=await req.file({limits:{fileSize:F().MAX_BUNDLE,files:1,fields:0}});if(!part)return error(reply,400,'BACKUP_FILE_REQUIRED');let bytes:Buffer;try{bytes=await part.toBuffer();}catch{return error(reply,413,'BACKUP_TOO_LARGE')}if(part.file.truncated)return error(reply,413,'BACKUP_TOO_LARGE');
  let bundle:any;try{bundle=await F().decode(bytes);}catch{return error(reply,400,'BACKUP_FORMAT_INVALID')}
  if(bundle.meta.customerId!==d.customer_id||bundle.meta.deviceId!==d.id)return error(reply,409,'BACKUP_ACCOUNT_MISMATCH');
  const temporary=await mkdtemp(path.join(os.tmpdir(),'possistem-cloud-'));let manifest:unknown,invalid=false;
  try{const dbFile=path.join(temporary,'pos.db');await writeFile(dbFile,bundle.database,{mode:0o600});manifest=await F().verifyDatabase(dbFile,bundle.assets.map((a:any)=>a.name));}catch{invalid=true}finally{await rm(temporary,{recursive:true,force:true})}if(invalid)return error(reply,400,'BACKUP_INTEGRITY_FAILED');
  const id=randomUUID(),dir=directory();await mkdir(dir,{recursive:true,mode:0o700});
  const disk=await statfs(dir);if(disk.bavail*disk.bsize<KEEP_FREE_BYTES)return error(reply,507,'SERVER_STORAGE_LOW');
  const key=await F().masterKey(dir),encrypted=F().encrypt(bytes,key,`${d.customer_id}:${id}`),target=path.join(dir,id+'.enc');
  const request=String(req.headers['x-backup-request-id']||'');const requestId=UUID.test(request)?request:null;
  let storedId:string=id,removed:string[]=[];try{
   await app.db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${d.id},913))`);
    const [existing]=rows(await tx.execute(sql`SELECT id FROM pos_cloud_backups WHERE customer_id=${d.customer_id}::uuid AND device_id=${d.id}::uuid AND sha256=${bundle.sha256}`));
    if(existing){storedId=String(existing.id);const storedFile=path.join(dir,storedId+'.enc');let valid=false;try{valid=F().sha(F().decrypt(await readFile(storedFile),key,`${d.customer_id}:${storedId}`))===bundle.sha256;}catch{}if(!valid){const repair=storedFile+'.repair';await writeFile(repair,F().encrypt(bytes,key,`${d.customer_id}:${storedId}`),{mode:0o600});await rename(repair,storedFile);}}else{
     // No plaintext database is stored in the web tree; the per-customer ID is authenticated encryption AAD.
     const partial=target+'.partial';try{await writeFile(partial,encrypted,{mode:0o600,flag:'wx'});await rename(partial,target);}finally{await unlink(partial).catch(()=>{})}
     await tx.execute(sql`INSERT INTO pos_cloud_backups(id,customer_id,device_id,product,sha256,size_bytes,db_bytes,manifest) VALUES(${id}::uuid,${d.customer_id}::uuid,${d.id}::uuid,'restaurant',${bundle.sha256},${bytes.length},${bundle.database.length},${JSON.stringify({...manifest as object,assets:bundle.assets.length,appVersion:bundle.meta.appVersion})}::jsonb)`);
    }
    // Each till keeps its newest verified copy only; older files go once this one is safely stored.
    const old=rows(await tx.execute(sql`SELECT id FROM pos_cloud_backups WHERE customer_id=${d.customer_id}::uuid AND device_id=${d.id}::uuid AND id<>${storedId}::uuid`));removed=old.map(x=>String(x.id));for(const oldId of removed)await tx.execute(sql`DELETE FROM pos_cloud_backups WHERE id=${oldId}::uuid`);
    await tx.execute(sql`INSERT INTO pos_cloud_backup_state(device_id,customer_id,last_success_at,last_attempt_at,completed_request_id) VALUES(${d.id}::uuid,${d.customer_id}::uuid,now(),now(),${requestId}::uuid) ON CONFLICT(device_id) DO UPDATE SET last_success_at=now(),last_attempt_at=now(),last_error=NULL,completed_request_id=COALESCE(${requestId}::uuid,pos_cloud_backup_state.completed_request_id),updated_at=now()`);
   });
  }catch(e){await unlink(target).catch(()=>{});throw e}
  for(const oldId of removed)await unlink(path.join(dir,oldId+'.enc')).catch(()=>{});
  return{ok:true,id:storedId,sha256:bundle.sha256,verified:true};
  }finally{activeUploads--;}
 });
 app.get('/owner/cloud-backups',async(req,reply)=>{const id=req.customer?.id;if(!id)return error(reply,401,'UNAUTHORIZED');return list(id)});
 app.get('/customers/:customerId/cloud-backups',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;const id=(req.params as any).customerId;if(!UUID.test(id))return error(reply,400,'CUSTOMER_INVALID');return list(id)});
 async function download(customerId:string,id:string,req:FastifyRequest,reply:FastifyReply){
  if(!UUID.test(id))return error(reply,400,'BACKUP_INVALID');await ensure();const [row]=rows(await app.db.execute(sql`SELECT id,sha256 FROM pos_cloud_backups WHERE id=${id}::uuid AND customer_id=${customerId}::uuid`));if(!row)return error(reply,404,'BACKUP_NOT_FOUND');const dir=directory();let bytes:Buffer;try{bytes=F().decrypt(await readFile(path.join(dir,id+'.enc')),await F().masterKey(dir),`${customerId}:${id}`);if(F().sha(bytes)!==row.sha256)throw Error('CHECKSUM');}catch{return error(reply,409,'STORED_BACKUP_INTEGRITY_FAILED')}
  await writeAudit(app,{actorUserId:req.user?.id,actorCustomerId:customerId,action:'cloud_backup.download',entityType:'cloud_backup',entityId:id});return reply.type('application/octet-stream').header('Content-Disposition',`attachment; filename="possistem-${id}.posbackup"`).header('Cache-Control','private, no-store').send(bytes);
 }
 app.get('/owner/cloud-backups/:backupId/download',async(req,reply)=>{const id=req.customer?.id;if(!id)return error(reply,401,'UNAUTHORIZED');return download(id,(req.params as any).backupId,req,reply)});
 app.get('/customers/:customerId/cloud-backups/:backupId/download',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;const {customerId,backupId}=req.params as any;if(!UUID.test(customerId))return error(reply,400,'CUSTOMER_INVALID');return download(customerId,backupId,req,reply)});
 // A new computer of the same account brings the shop back by itself, with the till's own proof: the newest copy of each till.
 app.get('/devices/:deviceId/cloud-backup/available',async(req,reply)=>{const d=await device(req,reply);if(!d)return;await ensure();return{backups:rows(await app.db.execute(sql`SELECT b.id,b.created_at,b.size_bytes,b.manifest->'tables' AS tables,b.manifest->>'appVersion' AS app_version,(b.device_id=${d.id}::uuid) AS this_device,v.hostname FROM pos_cloud_backups b LEFT JOIN devices v ON v.id=b.device_id WHERE b.customer_id=${d.customer_id}::uuid ORDER BY b.created_at DESC LIMIT 20`))}});
 app.get('/devices/:deviceId/cloud-backup/download/:backupId',{config:{rateLimit:{max:6,timeWindow:'1 hour'}}},async(req,reply)=>{const d=await device(req,reply);if(!d)return;return download(String(d.customer_id),String((req.params as any).backupId),req,reply)});
 app.post('/customers/:customerId/cloud-backups/:deviceId/:action',async(req,reply)=>{
  if(!requireSuperadmin(req,reply))return;const {customerId,deviceId,action}=req.params as any;if(!UUID.test(customerId)||!UUID.test(deviceId)||!['request','enable','disable'].includes(action))return error(reply,400,'REQUEST_INVALID');await ensure();
  const [device]=rows(await app.db.execute(sql`SELECT d.id,d.license_id FROM devices d JOIN licenses l ON l.id=d.license_id WHERE d.id=${deviceId}::uuid AND l.customer_id=${customerId}::uuid AND d.status<>'revoked'`));if(!device)return error(reply,404,'DEVICE_NOT_FOUND');
  if(action==='request'){const id=randomUUID();await app.db.execute(sql`INSERT INTO pos_cloud_backup_state(device_id,customer_id,requested_id,requested_at) VALUES(${deviceId}::uuid,${customerId}::uuid,${id}::uuid,now()) ON CONFLICT(device_id) DO UPDATE SET requested_id=${id}::uuid,requested_at=now(),updated_at=now()`)}
  else await app.db.execute(sql`UPDATE licenses SET features=jsonb_set(features,'{cloudBackup}',${action==='enable'?'true':'false'}::jsonb,true),updated_at=now() WHERE id=${device.license_id}::uuid`);
  await writeAudit(app,{actorUserId:req.user!.id,actorCustomerId:customerId,action:'cloud_backup.'+action,entityType:'device',entityId:deviceId});return{ok:true};
 });
}
