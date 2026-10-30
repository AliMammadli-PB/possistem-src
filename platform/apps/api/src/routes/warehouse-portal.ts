import {createHash,randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod/v3';
import {requireCustomer} from '../plugins/customer-auth.js';
import {surfaceAccess} from './access.js';
import {areaAllowed} from '../lib/access-areas.js';
import {inventoryEnabled} from './inventory-access.js';
import {ownerBranchDevices,branchOnline,branchVersionSupported,branchCallKind,branchRpc} from './cloud-branches.js';

const Call=z.object({method:z.string().min(1).max(64),payload:z.record(z.unknown()).optional(),idempotencyKey:z.string().min(1).max(120).optional()});
const Body=z.object({deviceId:z.string().uuid(),requestId:z.string().uuid(),calls:z.array(Call).min(1).max(16),defer:z.boolean().optional(),fresh:z.boolean().optional()});
type CallType=z.infer<typeof Call>;
const nativeProduct=(d:any)=>d.product==='market'?'market':'restaurant';
const product=(d:any)=>['restaurant','market','geyim','aptek','topdan'].includes(d.licensed_product)?d.licensed_product:nativeProduct(d);
const readable=(grants:string[]|null)=>grants===null||['anbar','restoran','product','enter','loss','move','inventory','stock','supply','purchaseorder','demand','demandreturns','customerorders','customer','transactions','settlements','cashtransactions','shifts','retailsales','retailreturns','credittransaction','cashins','cashouts','salepoints','salereports','profit','dailyreports','producttransactions','comprehensive','cashes','stockbalance'].some(a=>areaAllowed(grants,a));
/** Method grants are checked independently of the requested UI tab. */
export function warehouseArea(c:CallType):string[]{
 const m=c.method,a=String(c.payload?.action||'');
 if(m==='__session'||m==='settings.getAll'||m==='business.call'&&a==='context')return ['anbar'];
 if(m==='business.call'){
  if(a.startsWith('transfer.'))return ['move','anbar'];
  if(a==='staff'||a.startsWith('staff.'))return ['customer'];
  if(a==='branch.summary')return ['dailyreports'];
  return ['transactions','cashes'];
 }
 if(/^(goods|ingredients|categories|catalog|recipes)\./.test(m))return ['product'];
 if(m.startsWith('inventory.'))return ['stock','enter','loss','inventory','anbar'];
 if(m.startsWith('stocktake.'))return ['inventory','anbar'];
 if(/^(suppliers|supplierItems|purchases|replenish)\./.test(m))return ['supply'];
 if(/^(sales|orders|payments)\./.test(m))return ['demand'];
 if(/^(customers|loyalty)\./.test(m))return ['customer'];
 if(/^(income|reports)\./.test(m))return ['profit','dailyreports'];
 if(/^(cash|cashAccounts|cashObjects|salary)\./.test(m))return ['cashes','transactions'];
 return ['anbar'];
}
const hideSecrets=(v:any):any=>Array.isArray(v)?v.map(hideSecrets):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/pin|password|token|secret|credential|privateKey/i.test(k)?'••••':hideSecrets(x)])):v;
const hideCosts=(v:any):any=>Array.isArray(v)?v.map(hideCosts):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!(/^(cost|unitCost|averageCost|totalCost|profit|margin)/i.test(k))).map(([k,x])=>[k,hideCosts(x)])):v;
const rowsOf=(r:any):any[]=>Array.isArray(r)?r:r?.rows||[];
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
/** Durable at-most-once dispatch, including native mutations without their own replay guard. */
export function warehouseRequestStore(app:FastifyInstance){
 return {
  async init(){await app.db.execute(sql`CREATE TABLE IF NOT EXISTS portal_warehouse_requests (
   customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
   request_id uuid NOT NULL, device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
   fingerprint text NOT NULL, status text NOT NULL DEFAULT 'running', response_json jsonb,
   http_status integer, started_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(customer_id,request_id))`);},
  async begin(customerId:string,deviceId:string,requestId:string,fingerprint:string){return rowsOf(await app.db.execute(sql`INSERT INTO portal_warehouse_requests(customer_id,device_id,request_id,fingerprint) VALUES(${customerId}::uuid,${deviceId}::uuid,${requestId}::uuid,${fingerprint}) ON CONFLICT(customer_id,request_id) DO NOTHING RETURNING request_id`)).length>0;},
  async read(customerId:string,requestId:string){return rowsOf(await app.db.execute(sql`SELECT device_id,fingerprint,status,response_json,http_status,started_at FROM portal_warehouse_requests WHERE customer_id=${customerId}::uuid AND request_id=${requestId}::uuid`))[0];},
  async finish(customerId:string,requestId:string,status:number,response:unknown){await app.db.execute(sql`UPDATE portal_warehouse_requests SET status=${status>=500?'uncertain':'done'},http_status=${status},response_json=${JSON.stringify(response)}::text::jsonb,updated_at=now() WHERE customer_id=${customerId}::uuid AND request_id=${requestId}::uuid AND status='running'`);}
 };
}
/** Shared across browsers; cache keys never cross an owner or POS device. */
export function warehouseOfflineStore(app:FastifyInstance){
 const key=(c:CallType)=>createHash('sha256').update(JSON.stringify(canonical({method:c.method,payload:c.payload||{}}))).digest('hex');
 return {
  async init(){
   await app.db.execute(sql`CREATE TABLE IF NOT EXISTS portal_warehouse_cache(customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,cache_key text NOT NULL,call_json jsonb NOT NULL,result_json jsonb NOT NULL,generation bigint NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(customer_id,device_id,cache_key))`);
   await app.db.execute(sql`ALTER TABLE portal_warehouse_cache ADD COLUMN IF NOT EXISTS generation bigint NOT NULL DEFAULT 0`);
   await app.db.execute(sql`CREATE TABLE IF NOT EXISTS portal_warehouse_outbox(customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,request_id uuid NOT NULL,device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,fingerprint text NOT NULL,calls_json jsonb NOT NULL,guards_json jsonb NOT NULL DEFAULT '[]',status text NOT NULL DEFAULT 'queued',result_json jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(customer_id,request_id))`);
   await app.db.execute(sql`CREATE TABLE IF NOT EXISTS portal_warehouse_cache_versions(customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,version bigint NOT NULL DEFAULT 0,PRIMARY KEY(customer_id,device_id))`);
   await app.db.execute(sql`CREATE INDEX IF NOT EXISTS portal_warehouse_outbox_pending ON portal_warehouse_outbox(status,created_at)`);
  },
  async get(owner:string,device:string,c:CallType){return rowsOf(await app.db.execute(sql`SELECT call_json,result_json,updated_at,generation,COALESCE((SELECT version FROM portal_warehouse_cache_versions v WHERE v.customer_id=portal_warehouse_cache.customer_id AND v.device_id=portal_warehouse_cache.device_id),0) AS version FROM portal_warehouse_cache WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid AND cache_key=${key(c)}`))[0];},
  async findEntity(owner:string,device:string,read:CallType,id:string){const rows=rowsOf(await app.db.execute(sql`SELECT call_json,result_json,updated_at,generation,COALESCE((SELECT version FROM portal_warehouse_cache_versions v WHERE v.customer_id=portal_warehouse_cache.customer_id AND v.device_id=portal_warehouse_cache.device_id),0) AS version FROM portal_warehouse_cache WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid AND call_json->>'method'=${read.method} ORDER BY updated_at DESC`));return rows.find(row=>(!read.payload?.action||row.call_json?.payload?.action===read.payload.action)&&(!read.payload?.kind||row.call_json?.payload?.kind===read.payload.kind)&&entityValue(row.result_json?.data,id)!==undefined);},
  async put(owner:string,device:string,c:CallType,result:any,version=0){if(!result?.success)return;await app.db.execute(sql`INSERT INTO portal_warehouse_cache(customer_id,device_id,cache_key,call_json,result_json,generation) SELECT ${owner}::uuid,${device}::uuid,${key(c)},${JSON.stringify(c)}::text::jsonb,${JSON.stringify(result)}::text::jsonb,${version} WHERE COALESCE((SELECT version FROM portal_warehouse_cache_versions WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid),0)=${version} ON CONFLICT(customer_id,device_id,cache_key) DO UPDATE SET call_json=EXCLUDED.call_json,result_json=EXCLUDED.result_json,generation=EXCLUDED.generation,updated_at=now()`);},
  async epoch(owner:string,device:string){return Number(rowsOf(await app.db.execute(sql`SELECT version FROM portal_warehouse_cache_versions WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid`))[0]?.version||0);},
  async invalidate(owner:string,device:string){await app.db.execute(sql`INSERT INTO portal_warehouse_cache_versions(customer_id,device_id,version) VALUES(${owner}::uuid,${device}::uuid,1) ON CONFLICT(customer_id,device_id) DO UPDATE SET version=portal_warehouse_cache_versions.version+1 RETURNING version`);},
  async metadata(owner:string){return rowsOf(await app.db.execute(sql`SELECT device_id,max(updated_at) AS cached_at,bool_or(call_json->>'method'='__session') AS has_session FROM portal_warehouse_cache WHERE customer_id=${owner}::uuid GROUP BY device_id`));},
  async enqueue(owner:string,device:string,body:z.infer<typeof Body>,guards:any[]){
   const fingerprint=createHash('sha256').update(JSON.stringify(canonical(body.calls))).digest('hex');
   await app.db.execute(sql`INSERT INTO portal_warehouse_outbox(customer_id,device_id,request_id,fingerprint,calls_json,guards_json) VALUES(${owner}::uuid,${device}::uuid,${body.requestId}::uuid,${fingerprint},${JSON.stringify(body.calls)}::text::jsonb,${JSON.stringify(guards)}::text::jsonb) ON CONFLICT(customer_id,request_id) DO NOTHING`);
   const job=await this.getJob(owner,body.requestId);if(!job||job.device_id!==device||job.fingerprint!==fingerprint)throw Object.assign(Error('Bu nömrə başqa əməliyyata aiddir'),{statusCode:409});return job;
  },
  async getJob(owner:string,id:string){return rowsOf(await app.db.execute(sql`SELECT * FROM portal_warehouse_outbox WHERE customer_id=${owner}::uuid AND request_id=${id}::uuid`))[0];},
  async list(owner:string){return rowsOf(await app.db.execute(sql`SELECT request_id,device_id,calls_json,status,error,created_at,updated_at FROM portal_warehouse_outbox WHERE customer_id=${owner}::uuid ORDER BY created_at DESC LIMIT 200`));},
  async candidates(){return rowsOf(await app.db.execute(sql`SELECT DISTINCT ON(o.customer_id,o.device_id) o.* FROM portal_warehouse_outbox o JOIN devices d ON d.id=o.device_id WHERE o.status='queued' AND (d.last_seen_at>now()-interval '5 minutes' OR d.status='revoked') ORDER BY o.customer_id,o.device_id,o.created_at,o.request_id LIMIT 100`));},
  async claim(owner:string,id:string){return rowsOf(await app.db.execute(sql`UPDATE portal_warehouse_outbox o SET status='processing',updated_at=now() WHERE o.customer_id=${owner}::uuid AND o.request_id=${id}::uuid AND o.status='queued' AND NOT EXISTS(SELECT 1 FROM portal_warehouse_outbox earlier WHERE earlier.customer_id=o.customer_id AND earlier.device_id=o.device_id AND (earlier.status='processing' OR earlier.status='queued' AND (earlier.created_at,earlier.request_id)<(o.created_at,o.request_id))) RETURNING o.*`))[0];},
  async release(owner:string,id:string){await app.db.execute(sql`UPDATE portal_warehouse_outbox SET status='queued',error='POS bağlantısı gözlənilir',updated_at=now() WHERE customer_id=${owner}::uuid AND request_id=${id}::uuid AND status='processing'`);},
  async finish(owner:string,id:string,status:string,error:string|null,result:any=null){await app.db.execute(sql`UPDATE portal_warehouse_outbox SET status=${status},error=${error},result_json=${JSON.stringify(result)}::text::jsonb,updated_at=now() WHERE customer_id=${owner}::uuid AND request_id=${id}::uuid AND status='processing'`);},
  async cancel(owner:string,id:string){return rowsOf(await app.db.execute(sql`UPDATE portal_warehouse_outbox SET status='cancelled',updated_at=now() WHERE customer_id=${owner}::uuid AND request_id=${id}::uuid AND status='queued' RETURNING request_id`)).length>0;},
  async recover(){await app.db.execute(sql`UPDATE portal_warehouse_outbox SET status='uncertain',error='Server yenidən başladılıb. POS-dakı qaiməni yoxlayın; təkrar tətbiq edilməyəcək.',updated_at=now() WHERE status='processing' AND updated_at<now()-interval '10 minutes'`);}
 };
}
const documentSources:Record<string,string>={'inventory.movements':'movement','purchases.list':'purchase','purchases.get':'purchase','purchases.returns':'purchase-return','sales.list':'sale','sales.get':'sale','stocktake.list':'stocktake','stocktake.get':'stocktake','cash.list':'cash','income.list':'income','business.call:documents':'payment','business.call:transfer.list':'transfer'};
const sourceKey=(c:CallType)=>c.method==='business.call'?c.method+':'+String(c.payload?.action||''):c.method;
const documentRows=(data:any):any[]=>Array.isArray(data)?data:data?.id?[data]:data&&typeof data==='object'?Object.values(data).find(Array.isArray) as any[]||[]:[];
export function warehouseDocumentStore(app:FastifyInstance){return {
 async init(){await app.db.execute(sql`CREATE TABLE IF NOT EXISTS portal_warehouse_documents(customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,source text NOT NULL,native_id text NOT NULL,call_json jsonb NOT NULL,row_json jsonb NOT NULL,doc_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(customer_id,device_id,source,native_id))`);await app.db.execute(sql`CREATE INDEX IF NOT EXISTS portal_warehouse_documents_date ON portal_warehouse_documents(customer_id,doc_at DESC)`);await app.db.execute(sql`ALTER TABLE portal_warehouse_requests ADD COLUMN IF NOT EXISTS calls_json jsonb NOT NULL DEFAULT '[]'`);},
 async capture(owner:string,device:string,c:CallType,result:any,version?:number){const source=documentSources[sourceKey(c)];if(!source||!result?.success)return;const seen=new Set<string>();const rows=documentRows(result.data).filter(r=>r&&typeof r==='object'&&r.id&&!seen.has(String(r.id))&&seen.add(String(r.id))).map(r=>{const stamp=r.createdAt||r.orderedAt||r.date||r.updatedAt,at=new Date(stamp||Date.now());return {id:String(r.id),row:r,at:Number.isFinite(at.getTime())?at.toISOString():new Date().toISOString()};});if(!rows.length)return;await app.db.execute(sql`INSERT INTO portal_warehouse_documents(customer_id,device_id,source,native_id,call_json,row_json,doc_at) SELECT ${owner}::uuid,${device}::uuid,${source},d->>'id',${JSON.stringify(c)}::text::jsonb,d->'row',(d->>'at')::timestamptz FROM jsonb_array_elements(${JSON.stringify(rows)}::text::jsonb) d WHERE (${version??-1}=-1 OR COALESCE((SELECT version FROM portal_warehouse_cache_versions WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid),0)=${version??-1}) ON CONFLICT(customer_id,device_id,source,native_id) DO UPDATE SET row_json=portal_warehouse_documents.row_json||EXCLUDED.row_json,call_json=EXCLUDED.call_json,doc_at=EXCLUDED.doc_at,updated_at=now()`);},
 async calls(owner:string,requestId:string,calls:CallType[]){await app.db.execute(sql`UPDATE portal_warehouse_requests SET calls_json=${JSON.stringify(hideSecrets(calls))}::text::jsonb WHERE customer_id=${owner}::uuid AND request_id=${requestId}::uuid`);},
 async list(owner:string,device:string,source:string,cursor:string,after:string,limit:number){return rowsOf(await app.db.execute(sql`SELECT source,native_id,call_json,row_json,doc_at,updated_at FROM portal_warehouse_documents WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid AND (${source}='' OR source=${source}) AND (${cursor}='' OR doc_at<NULLIF(${cursor},'')::timestamptz OR doc_at=NULLIF(${cursor},'')::timestamptz AND device_id::text||':'||source||':'||native_id>${after}) ORDER BY doc_at DESC,source,native_id LIMIT ${limit}`));},
 async activity(owner:string,device:string,cursor='',after='',limit=500){return rowsOf(await app.db.execute(sql`SELECT request_id,calls_json,response_json,status,http_status,started_at,updated_at FROM portal_warehouse_requests WHERE customer_id=${owner}::uuid AND device_id=${device}::uuid AND jsonb_array_length(calls_json)>0 AND (${cursor}='' OR started_at<NULLIF(${cursor},'')::timestamptz OR started_at=NULLIF(${cursor},'')::timestamptz AND device_id::text||':portal:'||request_id::text>${after}) ORDER BY started_at DESC,request_id LIMIT ${limit}`));},
 async owners(){return rowsOf(await app.db.execute(sql`SELECT DISTINCT l.customer_id FROM devices d JOIN licenses l ON l.id=d.license_id WHERE d.status<>'revoked' AND d.last_seen_at>now()-interval '5 minutes' AND l.status='active' AND (l.valid_until IS NULL OR l.valid_until>now()) ORDER BY l.customer_id LIMIT 500`));}
};}
const receiptStepId=(id:string)=>{const hex=createHash('sha256').update('portal-receive:'+id).digest('hex');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);};
const ReceiptBody=z.object({deviceId:z.string().uuid(),requestId:z.string().uuid(),supplierId:z.string().min(1).max(100),warehouseId:z.string().min(1).max(100),note:z.string().max(1000).default(''),reference:z.string().max(100).default(''),lines:z.array(z.object({ingredientId:z.string().min(1).max(100),qtyMilli:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),unitCostMinor:z.number().int().min(0).max(100000000000)})).min(1).max(200)}).refine(r=>r.lines.reduce((n,l)=>n+BigInt(l.qtyMilli)*BigInt(l.unitCostMinor),0n)<=BigInt(Number.MAX_SAFE_INTEGER)*1000n,'Qaimə məbləği çox böyükdür');
const captureReply=()=>({sent:false,statusCode:200,payload:null as any,code(status:number){this.statusCode=status;return this;},send(value:any){this.sent=true;this.payload=value;return this;}});
const WARM_CALLS:CallType[]=['__session','settings.getAll','warehouses.list','categories.list','goods.list','cashAccounts.list','cash.list','customers.list','suppliers.list','purchases.list','salary.list','sales.list','income.list'].map(method=>({method,payload:{}}));
WARM_CALLS.push({method:'inventory.movements',payload:{limit:1000}},{method:'stocktake.list',payload:{}},{method:'business.call',payload:{action:'documents'}},{method:'ingredients.list',payload:{search:''}},{method:'purchases.returns',payload:{supplierId:''}},{method:'business.call',payload:{action:'context'}},{method:'roles.list',payload:{}},{method:'business.call',payload:{action:'staff'}});
type WarmProfile={dayFrom:number;dayTo:number;month:string;monthFrom:number;monthTo:number};
const WarmQuery=z.object({dayFrom:z.coerce.number().int().min(0).max(8640000000000000),dayTo:z.coerce.number().int().min(0).max(8640000000000000),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),monthFrom:z.coerce.number().int().min(0).max(8640000000000000),monthTo:z.coerce.number().int().min(0).max(8640000000000000)}).refine(q=>q.dayTo>q.dayFrom&&q.dayTo-q.dayFrom<=28*3600000&&q.monthTo>q.monthFrom&&q.monthTo-q.monthFrom<=32*86400000);
const warmCalls=(profile?:WarmProfile)=>{const date=new Date(Date.now()+14400000),year=date.getUTCFullYear(),month=date.getUTCMonth();const defaults={month:date.toISOString().slice(0,7),from:Date.UTC(year,month,1)-14400000,to:Date.UTC(year,month+1,1)-14400000};const calls=WARM_CALLS.map(c=>c.method==='salary.list'?{...c,payload:profile?{month:profile.month,from:profile.monthFrom,to:profile.monthTo}:defaults}:c);if(profile)calls.push({method:'cashAccounts.list',payload:{from:profile.dayFrom,to:profile.dayTo}});return calls;};
const entityId=(c:CallType)=>String(c.payload?.id||c.payload?.ingredientId||c.payload?.purchaseId||c.payload?.saleId||c.payload?.documentId||c.payload?.accountId||c.payload?.customerId||c.payload?.supplierId||'');
const guardRead=(c:CallType):CallType|null=>{
 const id=entityId(c);if(!id)return null;if(c.method==='business.call'&&c.payload?.action==='correct')return {method:'business.call',payload:{action:'document.get',kind:c.payload?.kind}};
 const method=({'ingredients.save':'goods.list','ingredients.deactivate':'goods.list','cashAccounts.save':'cashAccounts.list','cashAccounts.deactivate':'cashAccounts.list','customers.save':'customers.list','customers.deactivate':'customers.list','suppliers.save':'suppliers.list','sales.update':'sales.get','sales.delete':'sales.get','purchases.update':'purchases.get','purchases.delete':'purchases.get'} as Record<string,string>)[c.method];
 return method?{method,payload:method.endsWith('.get')?{id}: {}}:null;
};
const entityValue=(data:any,id:string):any=>{if(Array.isArray(data))return data.find(r=>String(r.id||r.ingredientId)===id);if(data&&typeof data==='object'){if(String(data.id||data.ingredientId)===id)return data;for(const value of Object.values(data)){const found=entityValue(value,id);if(found!==undefined)return found;}}};
export const warehouseDeps={requireCustomer,surfaceAccess,devices:ownerBranchDevices,rpc:branchRpc};
/** Dependency ports keep tests isolated from merchant databases and till queues. */
export async function registerWarehousePortal(app:FastifyInstance,deps=warehouseDeps){
 const profiles=new Map<string,WarmProfile>();
 const store=warehouseRequestStore(app),offline=warehouseOfflineStore(app),documents=warehouseDocumentStore(app);await store.init();await offline.init();await documents.init();
 async function dispatch(req:any,reply:any,customerId:string,target:any,body:z.infer<typeof Body>){
  const args={customerId,source:target,target,body,auditAction:'owner.warehouse.rpc',timeoutMs:body.calls.some(c=>branchCallKind(c)==='w')?40000:10000};
  if(!body.calls.some(c=>branchCallKind(c)==='w'))return deps.rpc(app,req,reply,args);
  const fingerprint=createHash('sha256').update(JSON.stringify(canonical(body.calls.map(c=>({method:c.method,payload:c.payload||{},idempotencyKey:c.idempotencyKey||null}))))).digest('hex');
  if(!await store.begin(customerId,target.id,body.requestId,fingerprint)){
   const until=Date.now()+43000;
   do {const old=await store.read(customerId,body.requestId);
    if(!old||old.device_id!==target.id||old.fingerprint!==fingerprint)return reply.code(409).send({error:'Bu əməliyyat nömrəsi başqa sorğuya aiddir',code:'WAREHOUSE_REQUEST_CONFLICT'});
    if(old.response_json)return reply.code(old.http_status||200).send(old.response_json);
    if(Date.now()-new Date(old.started_at).getTime()>45000)break;
    await new Promise(r=>setTimeout(r,100));
   }while(Date.now()<until);
   return reply.code(503).send({error:'Əməliyyatın nəticəsi hələ təsdiqlənməyib. Qaimələri və POS-dakı siyahını yoxlayın; əməliyyatı yenidən yaratmayın.',code:'WAREHOUSE_UNCERTAIN',uncertain:true});
  }
  await documents.calls(customerId,body.requestId,body.calls);
  const capture={sent:false,statusCode:200,payload:null as any,code(status:number){this.statusCode=status;return this;},send(value:any){this.sent=true;this.payload=value;return this;}};
  try{
   const value=await deps.rpc(app,req,capture,args),status=capture.sent?capture.statusCode:200,response=capture.sent?capture.payload:value;
   await store.finish(customerId,body.requestId,status,response);
   if(status<400&&response?.results?.some((r:any)=>r.success))await offline.invalidate(customerId,target.id);
   return reply.code(status).send(response);
  }catch(error){
   req.log.error({err:error,requestId:body.requestId},'Warehouse write result is uncertain');
   const response={error:'Nəticə təsdiqlənmədi. POS-dakı siyahını və qaimələri yoxlayın; əməliyyatı yenidən təsdiqləməyin.',code:'WAREHOUSE_UNCERTAIN',uncertain:true};
   try{await store.finish(customerId,body.requestId,503,response);}catch{}
   return reply.code(503).send(response);
  }
 }

 async function authorize(req:any,reply:any,customerId:string,target:any,devices:any[],body:z.infer<typeof Body>){
  const deny=(status:number,payload:any)=>{reply.code(status).send(payload);return null;};
  const grants=await deps.surfaceAccess(app,customerId,'portal');
  if(!readable(grants))return deny(403,{error:'Anbara baxmaq icazəniz yoxdur'});
  for(const c of body.calls){
   const targets=c.method==='business.call'&&c.payload?.action==='transfer.targets';
   const kind=targets?'r':branchCallKind(c);
   if(target.license_features?.viewCost===false&&['reports.costing','inventory.valuation','income.list','reports.export'].includes(c.method))return deny(403,{error:'Maya və qazanc məlumatlarına icazəniz yoxdur'});
   if(!kind||c.method==='print.enqueue'||c.method==='business.call'&&c.payload?.action==='transfer.sync')return deny(403,{error:'Bu əməliyyat müştəri panelindən açıq deyil'});
   const areas=warehouseArea(c);
   // Broad warehouse/restaurant grants are retained; narrower area grants remain independent.
   const permitted=(suffix='')=>grants===null||['anbar','restoran',...areas].some(a=>areaAllowed(grants,a+suffix));
   if(!(kind==='r'&&(['__session','settings.getAll','warehouses.list','categories.list','roles.list'].includes(c.method)||c.method==='business.call'&&c.payload?.action==='context')?readable(grants):permitted())||kind==='w'&&!permitted('.write'))return deny(403,{error:kind==='w'?'Dəyişiklik etməyə icazəniz yoxdur (yalnız baxmaq)':'Bu bölməyə icazəniz yoxdur'});
   if(kind==='w'&&c.method.startsWith('catalog.')&&target.product!=='market'){
    const v=String(target.app_version||'0.0.0').split('.').map(Number);
    if(!((v[0]||0)>1||v[0]===1&&((v[1]||0)>9||v[1]===9&&(v[2]||0)>=24)))return deny(409,{error:'Menyu redaktəsi üçün kassada Restoran POS 1.9.24 və ya daha yeni versiyanı quraşdırın.',code:'CATALOG_UPDATE_REQUIRED'});
   }
   if(c.method==='business.call'&&c.payload?.action==='transfer.save'){
    const destination=c.payload.toDeviceId;
    if(destination&&(!devices.some(d=>d.id===destination&&d.product==='market'&&inventoryEnabled(d.license_features))||target.product!=='market'))return deny(403,{error:'Qəbul edən filial bu sahibkara bağlı deyil'});
    c.payload={...c.payload,fromDeviceId:target.id};
   }
  }

  const policy=captureReply(),policyBody={...body,calls:body.calls.map(c=>c.method==='business.call'&&c.payload?.action==='transfer.targets'?{method:'warehouses.list',payload:{}}:c)};await deps.rpc(app,req,policy,{customerId,source:target,target,body:policyBody,auditAction:'owner.warehouse.rpc',validateOnly:true});
  if(policy.sent){reply.code(policy.statusCode).send(policy.payload);return null;}
  return {grants};
 }
 async function fetchLive(req:any,owner:string,target:any,calls:CallType[]){
  const reply=captureReply(),body={deviceId:target.id,requestId:randomUUID(),calls},version=await offline.epoch(owner,target.id);
  const access=await authorize(req,reply,owner,target,await deps.devices(app,owner),body);if(!access)return null;
  const value:any=await deps.rpc(app,req,reply,{customerId:owner,source:target,target,body,auditAction:'owner.warehouse.rpc',timeoutMs:10000});if(reply.sent)return null;
  for(let i=0;i<calls.length;i++){await offline.put(owner,target.id,calls[i]!,value?.results?.[i],version);await documents.capture(owner,target.id,calls[i]!,value?.results?.[i],version);}return value;
 }
 const refreshing=new Map<string,number>();
 function refreshReads(req:any,owner:string,target:any,calls:CallType[],force=false){
  const key=owner+':'+target.id+':'+JSON.stringify(calls);if(!force&&Date.now()-(refreshing.get(key)||0)<15000)return;
  refreshing.set(key,Date.now());void fetchLive(req,owner,target,calls).catch(err=>req.log.error({err},'Warehouse cache refresh failed')).finally(()=>{if(refreshing.size>500)refreshing.clear();});
 }
 async function warmAllowed(req:any,owner:string,target:any,devices:any[],force=false){
  const calls=warmCalls(profiles.get(owner)),capture=captureReply(),body={deviceId:target.id,requestId:randomUUID(),calls};
  if(await authorize(req,capture,owner,target,devices,body)){for(let i=0;i<calls.length;i+=16)refreshReads(req,owner,target,calls.slice(i,i+16),force);}else{
  const allowed:CallType[]=[];for(const c of calls){const reply=captureReply();if(await authorize(req,reply,owner,target,devices,{...body,calls:[c]}))allowed.push(c);}for(let i=0;i<allowed.length;i+=16)refreshReads(req,owner,target,allowed.slice(i,i+16),force);}
  const warehouses=await offline.get(owner,target.id,{method:'warehouses.list',payload:{}});
  const levels=(warehouses?.result_json?.data?.warehouses||[]).filter((w:any)=>w.active!==false&&w.active!==0).slice(0,50).map((w:any)=>({method:'inventory.levels',payload:{warehouseId:String(w.id)}}));for(let i=0;i<levels.length;i+=16)refreshReads(req,owner,target,levels.slice(i,i+16),force);
  const purchases=await offline.get(owner,target.id,{method:'purchases.list',payload:{}});for(const p of (purchases?.result_json?.data?.purchases||[]).slice(0,20)){const call={method:'purchases.get',payload:{purchaseId:String(p.id)}},detail=await offline.get(owner,target.id,call);if(!detail||new Date(purchases.updated_at).getTime()-new Date(detail.updated_at).getTime()>60000)refreshReads(req,owner,target,[call],force);}
 }
 async function processPending(){
  await offline.recover();
  const jobs=await offline.candidates();
  const runCandidate=async(candidate:any)=>{
   const owner=candidate.customer_id,devices=await deps.devices(app,owner),target=devices.find(d=>d.id===candidate.device_id);
   if(target&&!branchOnline(target))return;
   const job=await offline.claim(owner,candidate.request_id);if(!job)return;
   const req={log:app.log,headers:{},ip:'127.0.0.1'},reply=captureReply(),body={deviceId:job.device_id,requestId:job.request_id,calls:job.calls_json as CallType[]};
   try{
    if(!target||!inventoryEnabled(target.license_features)){await offline.finish(owner,job.request_id,'failed','Filial və ya anbar icazəsi artıq aktiv deyil');return;}
    const access=await authorize(req,reply,owner,target,devices,body);if(!access){await offline.finish(owner,job.request_id,'failed',reply.payload?.error||'İcazə dəyişib');return;}
    const probe=await fetchLive(req,owner,target,[{method:'__session',payload:{}}]);if(!probe?.results?.[0]?.success){await offline.release(owner,job.request_id);return;}
    let conflict=false;
    for(const guard of job.guards_json||[]){if(guard.workflow)continue;const live=await fetchLive(req,owner,target,[guard.call]);const entity=entityValue(live?.results?.[0]?.data,guard.id);if(!live||JSON.stringify(canonical(entity??null))!==guard.value){conflict=true;break;}}
    if(conflict){await offline.finish(owner,job.request_id,'conflict','Məlumat POS-da dəyişib. Son məlumatı açıb düzəlişi yenidən nəzərdən keçirin.');return;}
    const result:any=await dispatch(req,reply,owner,target,body);let value=reply.sent?reply.payload:result;
    if(job.guards_json?.some((g:any)=>g.workflow==='purchase.receive')&&reply.statusCode<400&&value?.results?.[0]?.success){
     const purchaseId=value.results[0].data?.id;if(!purchaseId)throw Error('Alış qaiməsinin nömrəsi alınmadı');
     const receiveBody={deviceId:target.id,requestId:receiptStepId(job.request_id),calls:[{method:'purchases.receive',payload:{purchaseId},idempotencyKey:job.request_id+':receive'}]};const receiptReply=captureReply();
     if(!await authorize(req,receiptReply,owner,target,devices,receiveBody)){value={error:receiptReply.payload?.error||'Mal qəbulu icazəsi dəyişib',results:[{success:false,error:{message:'Alış yaradılıb; qəbul üçün qaiməni açın: '+purchaseId}}]};reply.statusCode=403;}
     else{const received:any=await dispatch(req,receiptReply,owner,target,receiveBody);value=receiptReply.sent?receiptReply.payload:received;reply.statusCode=receiptReply.statusCode;value={...value,purchaseId};}
    }
    const errors=(value?.results||[]).filter((r:any)=>!r.success).map((r:any)=>r.error?.message||r.error||'POS əməliyyatı qəbul etmədi');
    const status=reply.statusCode>=500||value?.uncertain?'uncertain':reply.statusCode>=400||errors.length?'failed':'applied';
    await offline.finish(owner,job.request_id,status,value?.error||errors.join(' · ')||null,value);
    if(status==='applied')void warmAllowed(req,owner,target,devices,true).catch(err=>app.log.error({err},'Warehouse warmup failed'));
   }catch(err){app.log.error({err,requestId:job.request_id},'Deferred warehouse result uncertain');await offline.finish(owner,job.request_id,'uncertain','Nəticə təsdiqlənmədi. POS qaiməsini yoxlayın; ikinci dəfə tətbiq edilməyəcək.');}
  };
  let cursor=0;await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(cursor<jobs.length)await runCandidate(jobs[cursor++]);}));
 }

 let sweepAt=0,sweeping=false;
 async function synchronizeConnected(force=false){if(sweeping||!force&&Date.now()-sweepAt<60000)return;sweepAt=Date.now();sweeping=true;try{const owners=await documents.owners();let cursor=0;await Promise.all(Array.from({length:Math.min(3,owners.length)},async()=>{while(cursor<owners.length){const owner=String(owners[cursor++].customer_id);try{const devices=await deps.devices(app,owner);for(const target of devices)if(branchOnline(target)&&branchVersionSupported(target)&&inventoryEnabled(target.license_features))await warmAllowed({log:app.log,headers:{},ip:'127.0.0.1'},owner,target,devices,force);}catch(err){app.log.error({err},'Warehouse background synchronization failed');}}}));}finally{sweeping=false;}}
 let working=false;const tick=()=>{if(working)return;working=true;void Promise.all([processPending(),synchronizeConnected()]).catch(err=>app.log.error({err},'Warehouse outbox worker failed')).finally(()=>{working=false;});};
 const timer=setInterval(tick,10000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));

 app.get('/customer/warehouse/branches',async(req,reply)=>{
  const who=deps.requireCustomer(req,reply);if(!who)return;
  const grants=await deps.surfaceAccess(app,who.id,'portal');
  if(!readable(grants))return reply.code(403).send({error:'Anbara baxmaq icazəniz yoxdur'});
  const devices=await deps.devices(app,who.id);
  const profile=WarmQuery.safeParse(req.query);if(profile.success){if(profiles.size>=1000&&!profiles.has(who.id))profiles.delete(profiles.keys().next().value!);profiles.set(who.id,profile.data);}
  const meta=await offline.metadata(who.id);
  for(const target of devices)if(branchOnline(target)&&branchVersionSupported(target)&&inventoryEnabled(target.license_features))void warmAllowed(req,who.id,target,devices).catch(err=>req.log.error({err},'Warehouse warmup failed'));
  return {serverTime:Date.now(),onlineTimeoutMs:300000,areas:grants,branches:devices.filter(d=>inventoryEnabled(d.license_features)).map(d=>({deviceId:d.id,cached:Boolean(meta.find(m=>m.device_id===d.id)?.has_session),cachedAt:meta.find(m=>m.device_id===d.id)?.cached_at||null,branchId:d.branch_id,name:d.name,terminalName:d.register_name||d.hostname||'',product:product(d),nativeProduct:nativeProduct(d),online:branchOnline(d),supported:branchVersionSupported(d),version:d.app_version,lastSeenAt:d.last_seen_at,updatedAt:d.updated_at})),readOnly:grants!==null&&!grants.some(a=>a.endsWith('.write'))};
 });
 app.post('/customer/warehouse/rpc',{bodyLimit:2*1024*1024,config:{rateLimit:{max:300,timeWindow:'1 minute'}}},async(req,reply)=>{
  const who=deps.requireCustomer(req,reply);if(!who)return;
  const parsed=Body.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Filial və ya əməliyyat düzgün deyil'});
  const body=parsed.data,devices=await deps.devices(app,who.id),target=devices.find(d=>d.id===body.deviceId);
   body.calls=body.calls.map((c,i)=>['inventory.adjust','inventory.waste'].includes(c.method)?{...c,idempotencyKey:c.idempotencyKey||body.requestId+':'+i,payload:{...c.payload,idempotencyKey:c.payload?.idempotencyKey||c.idempotencyKey||body.requestId+':'+i}}:c);
  if(!target)return reply.code(403).send({error:'Filial bu sahibkara bağlı deyil və ya lisenziya aktiv deyil'});
  if(!inventoryEnabled(target.license_features))return reply.code(403).send({error:'Bu filialın anbar modulu aktiv deyil'});
  const authorized=await authorize(req,reply,who.id,target,devices,body);if(!authorized)return;const {grants}=authorized;
  if(body.calls.some(c=>c.method==='business.call'&&c.payload?.action==='transfer.targets')){
   if(body.calls.length!==1||target.product!=='market')return reply.code(400).send({error:'Transfer hədəfləri ayrıca sorğulanmalıdır'});
   const id=String(body.calls[0]!.payload?.deviceId||target.id),destination=devices.find(d=>d.id===id&&d.product==='market'&&inventoryEnabled(d.license_features));
   if(!destination)return reply.code(403).send({error:'Qəbul edən filial bu sahibkara bağlı deyil'});
   const call={method:'warehouses.list',payload:{}},cached=await offline.get(who.id,destination.id,call);
   const result:any=!branchOnline(destination)&&cached?{results:[cached.result_json]}:await deps.rpc(app,req,reply,{customerId:who.id,source:target,target:destination,body:{requestId:body.requestId,calls:[call]},auditAction:'owner.warehouse.rpc',timeoutMs:10000});
   if(reply.sent)return result;
   const r=result.results?.[0];if(!r?.success)return {results:[r],deviceId:target.id,requestId:body.requestId};
   return {results:[{success:true,data:{deviceId:target.id,warehouses:r.data?.warehouses||[],devices:devices.filter(d=>d.product==='market').map(d=>({deviceId:d.id,name:d.name,branchName:d.name,terminalName:d.register_name||d.hostname,online:branchOnline(d),supported:branchVersionSupported(d)}))},error:null}],deviceId:target.id,requestId:body.requestId};
  }

  if(body.defer&&body.calls.some(c=>branchCallKind(c)==='w')){
   for(const c of body.calls)if(c.method==='inventory.adjust'&&(!String(c.payload?.ingredientId||'').trim()||!String(c.payload?.warehouseId||'').trim()||!String(c.payload?.reason||'').trim()||!Number.isSafeInteger(c.payload?.qtyDeltaMilli)||c.payload?.qtyDeltaMilli===0))return reply.code(400).send({error:'Məhsul, anbar, sıfırdan fərqli miqdar və səbəb tələb olunur.'});
   const previous=await offline.getJob(who.id,body.requestId);const guards:any[]=previous?.guards_json||[];
   if(body.calls.some(c=>c.method==='settings.set'||c.method==='business.call'&&['staff.save','staff.link'].includes(String(c.payload?.action))))return reply.code(409).send({error:'İstifadəçi və təhlükəsizlik dəyişiklikləri üçün POS onlayn olmalıdır.'});
   if(!previous)for(const c of body.calls){const read=guardRead(c);if(!read)continue;const id=entityId(c);let saved=await offline.get(who.id,target.id,read);if(entityValue(saved?.result_json?.data,id)===undefined)saved=await offline.findEntity(who.id,target.id,read,id)||saved;const entity=entityValue(saved?.result_json?.data,id);if(entity===undefined&&!(saved&&c.method.endsWith('.save')))return reply.code(409).send({error:'Bu qeydin son nüsxəsi yoxdur. Əvvəl POS onlayn ikən qeydi açın.',code:'WAREHOUSE_NO_BASELINE'});guards.push({call:saved?.call_json||read,id,value:JSON.stringify(canonical(entity??null))});}
   const job=await offline.enqueue(who.id,target.id,body,guards);if(job.status==='applied')return reply.send({...job.result_json,queued:false,status:'applied'});if(!['queued','processing'].includes(job.status))return reply.code(job.status==='uncertain'?503:409).send({error:job.error||'Əməliyyat ləğv edilib. Məlumatı yoxlayıb düzəliş edin.',uncertain:job.status==='uncertain'});return reply.code(202).send({queued:true,requestId:job.request_id,status:job.status,deviceId:target.id,results:body.calls.map(()=>({success:false,error:{code:'WAREHOUSE_QUEUED',message:'Dəyişiklik növbəyə yazıldı. POS onlayn olduqda tətbiq ediləcək.'},queued:true}))});
  }
  let result:any;
  const isRead=body.calls.every(c=>branchCallKind(c)==='r');
  if(isRead){
   const cached=await Promise.all(body.calls.map(c=>offline.get(who.id,target.id,c)));
   if(cached.every(Boolean)&&(!body.fresh||!branchOnline(target))&&(!branchOnline(target)||cached.every(c=>Number(c!.generation||0)===Number(c!.version||0)))){result={results:cached.map(c=>c!.result_json),deviceId:target.id,requestId:body.requestId,cached:true,cachedAt:new Date(Math.min(...cached.map(c=>new Date(c!.updated_at).getTime()))).toISOString()};if(branchOnline(target))refreshReads(req,who.id,target,body.calls);}
   else if(!branchOnline(target))return reply.code(409).send({error:'Bu bölmə üçün məlumat hələ göndərilməyib. POS əlaqəsi bərpa olduqda avtomatik yenilənəcək.',code:'WAREHOUSE_NO_CACHE'});
  }
  const readVersion=isRead?await offline.epoch(who.id,target.id):0;
  if(!result){result=await dispatch(req,reply,who.id,target,body);if(!reply.sent&&isRead)for(let i=0;i<body.calls.length;i++){await offline.put(who.id,target.id,body.calls[i]!,result?.results?.[i],readVersion);await documents.capture(who.id,target.id,body.calls[i]!,result?.results?.[i],readVersion);}}

  if(reply.sent)return result;
  if(!isRead&&result?.results?.some((r:any)=>r.success))await offline.invalidate(who.id,target.id);
  if(grants!==null&&!grants.some(a=>a.endsWith('.write'))){
   body.calls.forEach((c,i)=>{const session=result?.results?.[i];if(c.method==='__session'&&session?.success){session.data={...session.data,permissions:(session.data.permissions||[]).filter((p:string)=>/\.(view|export)$/.test(p)),canDocsView:true,canDocsCreate:false,canDocsEdit:false,canDocsDelete:false};}});
  }
  if(target.license_features?.viewCost===false){
   const scrub=(v:any):any=>Array.isArray(v)?v.map(scrub):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([key])=>!(/^(cost|unitCost|averageCost|totalCost|profit|margin)/i.test(key))).map(([key,value])=>[key,scrub(value)])):v;
   body.calls.forEach((c,i)=>{const r=result?.results?.[i];if(r?.success&&['goods.list','ingredients.list','inventory.levels'].includes(c.method))r.data=scrub(r.data);if(c.method==='__session'&&r?.success)r.data.permissions=(r.data.permissions||[]).filter((p:string)=>!['reports.costing','income.view'].includes(p));});
  }
  return result;
 });
 app.get('/customer/warehouse/stock',async(req,reply)=>{
  const who=deps.requireCustomer(req,reply);if(!who)return;const query=z.object({product:z.string().optional(),device:z.string().optional()}).parse(req.query);const devices=(await deps.devices(app,who.id)).filter(d=>inventoryEnabled(d.license_features)&&(!query.product||product(d)===query.product)&&(!query.device||query.device==='all'||d.id===query.device));const rows:any[]=[],errors:any[]=[],warehouses:any[]=[];
  for(const target of devices){const accessReply=captureReply();if(!await authorize(req,accessReply,who.id,target,devices,{deviceId:target.id,requestId:randomUUID(),calls:[{method:'inventory.levels',payload:{}}]})){errors.push({deviceId:target.id,denied:true,message:accessReply.payload?.error});continue;}
   const wc=await offline.get(who.id,target.id,{method:'warehouses.list',payload:{}}),gc=await offline.get(who.id,target.id,{method:'goods.list',payload:{}}),goods=new Map((gc?.result_json?.data?.goods||[]).map((g:any)=>[String(g.id),g]));
   for(const w of wc?.result_json?.data?.warehouses||[]){if(w.active===false||w.active===0)continue;const c=await offline.get(who.id,target.id,{method:'inventory.levels',payload:{warehouseId:String(w.id)}});warehouses.push({deviceId:target.id,branchId:target.branch_id,id:w.id,name:w.name,updatedAt:c?.updated_at||null});if(!c){errors.push({deviceId:target.id,warehouseId:w.id,message:'Anbarın qalıq məlumatı hazırlanır'});continue;}
    for(const l of c.result_json?.data?.levels||[]){const g:any=goods.get(String(l.id||l.ingredientId))||{};rows.push({id:String(l.id||l.ingredientId),deviceId:target.id,deviceName:target.name,branchId:target.branch_id,warehouseId:String(w.id),warehouseName:w.name,name:l.name||g.name||'',barcode:l.barcode||g.barcode||'',sku:l.sku||g.sku||'',group:g.categoryPath||g.categoryId||'',unit:l.unit||g.unit||'ədəd',qtyMilli:Number(l.qtyMilli)||0,minQtyMilli:Number(l.minQtyMilli)||0,salePriceMinor:l.salePriceMinor??g.salePriceMinor??null,costMinor:target.license_features?.viewCost===false?null:l.costMinor??g.costMinor??null,updatedAt:c.updated_at});}
   }
  }
  return {rows,warehouses,errors};
 });
 app.get('/customer/warehouse/documents',async(req,reply)=>{
  const who=deps.requireCustomer(req,reply);if(!who)return;const q=z.object({device:z.string().optional(),product:z.string().optional(),source:z.string().default(''),cursor:z.union([z.literal(''),z.string().datetime()]).optional(),after:z.string().max(500).default(''),limit:z.coerce.number().int().min(1).max(500).default(200)}).safeParse(req.query);if(!q.success)return reply.code(400).send({error:'Filtr düzgün deyil'});
  const devices=(await deps.devices(app,who.id)).filter(d=>inventoryEnabled(d.license_features)&&(!q.data.product||product(d)===q.data.product)&&(!q.data.device||q.data.device==='all'||d.id===q.data.device)),result:any[]=[],errors:any[]=[];
  for(const target of devices){const policy=new Map<string,boolean>();const permitted=async(c:CallType)=>{const k=sourceKey(c);if(policy.has(k))return policy.get(k);const r=captureReply(),access=await authorize(req,r,who.id,target,devices,{deviceId:target.id,requestId:randomUUID(),calls:[c]});policy.set(k,Boolean(access));return Boolean(access);};
   for(const r of await documents.list(who.id,target.id,q.data.source,q.data.cursor||'',q.data.after,q.data.limit+1))if(await permitted(r.call_json))result.push({id:target.id+':'+r.source+':'+r.native_id,nativeId:r.native_id,deviceId:target.id,branchName:target.name,source:r.source,createdAt:r.doc_at,updatedAt:r.updated_at,data:r.row_json});
   if(!q.data.source||q.data.source==='portal'){
    for(const r of await documents.activity(who.id,target.id,q.data.cursor||'',q.data.after,q.data.limit+1)){const calls=(r.calls_json||[]) as CallType[];if(!calls.length||!(await Promise.all(calls.map(permitted))).every(Boolean))continue;result.push({id:target.id+':portal:'+r.request_id,nativeId:r.request_id,deviceId:target.id,branchName:target.name,source:'portal',createdAt:r.started_at,updatedAt:r.updated_at,data:{calls,status:r.status,httpStatus:r.http_status,result:r.response_json,actorName:'Sahibkar portalı'}});}
    const pending=await offline.list(who.id);for(const r of pending.filter(r=>r.device_id===target.id&&!['applied'].includes(r.status))){if(q.data.cursor&&(Date.parse(r.created_at)>Date.parse(q.data.cursor)||Date.parse(r.created_at)===Date.parse(q.data.cursor)&&(target.id+':queue:'+r.request_id)<=q.data.after))continue;if(result.some(d=>d.source==='portal'&&d.nativeId===r.request_id))continue;if(!(await Promise.all((r.calls_json||[]).map(permitted))).every(Boolean))continue;result.push({id:target.id+':queue:'+r.request_id,nativeId:r.request_id,deviceId:target.id,branchName:target.name,source:'portal',createdAt:r.created_at,updatedAt:r.updated_at,data:{calls:r.calls_json,status:r.status,error:r.error,actorName:'Sahibkar portalı'}});}
   }
  }
  result.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));const more=result.length>q.data.limit,last=result[Math.min(result.length,q.data.limit)-1];return {hasMore:more,nextCursor:more?{at:new Date(last.createdAt).toISOString(),after:last.id}:null,documents:result.slice(0,q.data.limit).map(r=>{const target=devices.find(d=>d.id===r.deviceId);return {...r,data:hideSecrets(target?.license_features?.viewCost===false?hideCosts(r.data):r.data)};}),errors};
 });
 app.post('/customer/warehouse/receipts',async(req,reply)=>{
  const who=deps.requireCustomer(req,reply);if(!who)return;const parsed=ReceiptBody.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Təchizatçı, anbar, məhsul, müsbət miqdar və düzgün alış qiyməti tələb olunur'});const r=parsed.data,devices=await deps.devices(app,who.id),target=devices.find(d=>d.id===r.deviceId&&inventoryEnabled(d.license_features));if(!target)return reply.code(403).send({error:'Filial əlçatan deyil'});
  const note=[r.reference?'Təchizatçı qaiməsi: '+r.reference:'',r.note].filter(Boolean).join(' · '),calls:CallType[]=[{method:'purchases.save',payload:{supplierId:r.supplierId,warehouseId:r.warehouseId,lines:r.lines,note,idempotencyKey:r.requestId+':save'},idempotencyKey:r.requestId+':save'}],body={deviceId:target.id,requestId:r.requestId,calls};
  if(!await authorize(req,reply,who.id,target,devices,{...body,calls:[...calls,{method:'purchases.receive',payload:{purchaseId:'pending'}}]}))return;
  const job=await offline.enqueue(who.id,target.id,body,[{workflow:'purchase.receive'}]);if(!['queued','processing','applied'].includes(job.status))return reply.code(409).send({error:job.error||'Qaiməni yoxlayın; təkrar göndərilmədi',status:job.status});return reply.code(job.status==='applied'?200:202).send({requestId:r.requestId,status:job.status,queued:job.status!=='applied',result:job.result_json});
 });
 app.get('/customer/warehouse/pending',async(req,reply)=>{const who=deps.requireCustomer(req,reply);if(!who)return;const grants=await deps.surfaceAccess(app,who.id,'portal');if(!readable(grants))return reply.code(403).send({error:'İcazə yoxdur'});const devices=await deps.devices(app,who.id),ids=new Set(devices.map(d=>d.id));return {operations:(await offline.list(who.id)).filter(r=>ids.has(r.device_id)).map(r=>({requestId:r.request_id,deviceId:r.device_id,status:r.status,error:r.error,createdAt:r.created_at,updatedAt:r.updated_at,methods:(r.calls_json||[]).map((c:CallType)=>c.method),adjustments:(r.calls_json||[]).filter((c:CallType)=>c.method==='inventory.adjust').map((c:CallType)=>({ingredientId:c.payload?.ingredientId,warehouseId:c.payload?.warehouseId,qtyDeltaMilli:c.payload?.qtyDeltaMilli})),label:(r.calls_json||[]).map((c:CallType)=>String(c.payload?.label||c.payload?.name||c.payload?.reason||c.payload?.action||c.method)).join(' · ')}))};});
 app.post('/customer/warehouse/pending/:id/cancel',async(req,reply)=>{const who=deps.requireCustomer(req,reply);if(!who)return;const id=z.string().uuid().safeParse((req.params as any).id);if(!id.success)return reply.code(400).send({error:'Əməliyyat nömrəsi düzgün deyil'});const done=await offline.cancel(who.id,id.data);if(!done)return reply.code(409).send({error:'Yalnız göndərilməmiş əməliyyatı ləğv etmək olar'});return {ok:true};});
 return {processPending,offline,documents,synchronizeConnected};

}
