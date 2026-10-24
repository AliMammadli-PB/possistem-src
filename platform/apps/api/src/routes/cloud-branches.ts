import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {inflateRawSync} from 'node:zlib';
import type {FastifyInstance} from 'fastify';
import {sql} from 'drizzle-orm';
import {z} from 'zod/v3';
import {resolveTenantToken} from './tenant.js';
import {surfaceAccess} from './access.js';
import {areaAllowed} from '../lib/access-areas.js';
import {notePortalRpc,runOnTill} from '../lib/bot/queue.js';
import {writeAudit} from '../lib/audit.js';
import {clientIp} from '../lib/validate.js';

export const BRANCH_METHODS:Record<string,'r'|'w'>={"business.call": "r", "orders.get": "r", "print.enqueue": "w", "cash.list": "r", "cash.movement": "w", "cashAccounts.list": "r", "cashAccounts.moves": "r", "cashAccounts.save": "w", "cashAccounts.deactivate": "w", "cashAccounts.transfer": "w", "cashObjects.save": "w", "couriers.list": "r", "couriers.save": "w", "customers.list": "r", "customers.ledger": "r", "customers.save": "w", "customers.charge": "w", "customers.deactivate": "w", "customers.payDebt": "w", "loyalty.redeem": "w", "delivery.list": "r", "delivery.courierReport": "r", "delivery.assign": "w", "delivery.setStatus": "w", "delivery.settle": "w", "ingredients.list": "r", "ingredients.save": "w", "ingredients.deactivate": "w", "inventory.levels": "r", "inventory.lowStock": "r", "inventory.movements": "r", "inventory.valuation": "r", "inventory.adjust": "w", "inventory.waste": "w", "inventory.costingMethod": "w", "warehouses.list": "r", "locations.list": "r", "locations.save": "w", "lots.list": "r", "lots.relocate": "w", "lots.writeOff": "w", "lots.extend": "w", "payments.refund": "w", "purchases.list": "r", "purchases.get": "r", "purchases.returns": "r", "purchases.save": "w", "purchases.confirm": "w", "purchases.receive": "w", "purchases.inspect": "w", "purchases.invoice": "w", "purchases.addCost": "w", "purchases.removeCost": "w", "purchases.update": "w", "purchases.delete": "w", "purchases.return": "w", "purchases.deleteReturn": "w", "recipes.get": "r", "recipes.save": "w", "replenish.suggestions": "r", "replenish.run": "w", "replenish.createDraft": "w", "reports.costing": "r", "reports.expiry": "r", "reports.stockLoss": "r", "reports.suppliers": "r", "reports.export": "r", "salary.list": "r", "salary.pay": "w", "sales.list": "r", "sales.get": "r", "sales.update": "w", "sales.delete": "w", "settings.getAll": "r", "settings.set": "w", "stockRules.list": "r", "stockRules.save": "w", "supplierItems.list": "r", "supplierItems.save": "w", "suppliers.list": "r", "suppliers.ledger": "r", "suppliers.save": "w", "suppliers.pay": "w", "tables.list": "r", "users.list": "r", "categories.list": "r", "categories.save": "w", "categories.delete": "w", "goods.list": "r", "goods.prices": "w", "goods.import": "w", "stocktake.list": "r", "stocktake.get": "r", "stocktake.create": "w", "stocktake.count": "w", "stocktake.post": "w", "stocktake.import": "w", "stocktake.update": "w", "stocktake.cancel": "w", "income.list": "r", "income.save": "w", "income.delete": "w", "__session": "r", "reports.dashboard": "r", "reports.salesSummary": "r", "reports.period": "r", "reports.topProducts": "r", "reports.list": "r", "reports.getSnapshot": "r", "catalog.categories": "r", "catalog.products": "r", "roles.list": "r"};
const businessReads=['context','documents','document.get','staff','branch.summary','transfer.list','transfer.get','waste.list','waste.get'];
const businessWrites=['correct','delivery.update','staff.save','staff.link','catalog.publish','transfer.save','transfer.dispatch','transfer.receive','transfer.returnConfirm','transfer.cancel','transfer.reverse','transfer.recall','transfer.revoke','transfer.sync','waste.save','waste.delete'];
export function branchCallKind(call:{method:string;payload?:Record<string,unknown>}):'r'|'w'|null {
 if(call.method==='business.call'){const action=String(call.payload?.action||'');return businessReads.includes(action)?'r':businessWrites.includes(action)?'w':null;}
 if(call.method==='settings.set' && call.payload?.key!=='costing.resetAt')return null;
 return BRANCH_METHODS[call.method]||null;
}
const Body=z.object({sourceDeviceId:z.string().uuid(),deviceId:z.string().uuid(),requestId:z.string().uuid(),calls:z.array(z.object({method:z.string().max(64),payload:z.record(z.unknown()).optional(),idempotencyKey:z.string().min(1).max(120).optional()})).min(1).max(16)});
const rows=(r:unknown):Array<Record<string,any>>=>Array.isArray(r)?r:((r as any)?.rows||[]);
export async function ownerBranchDevices(app:FastifyInstance,customerId:string){
 return rows(await app.db.execute(sql`
 SELECT d.id,d.branch_id,d.hostname,d.register_name,d.app_version,d.last_seen_at,l.features->>'product' AS licensed_product,l.features AS license_features,
 COALESCE(m.updated_at,d.last_seen_at) AS updated_at,
 CASE WHEN m.device_id IS NOT NULL OR l.features->>'product' IN ('market','geyim','aptek','topdan') OR l.features->>'market'='true' THEN 'market' ELSE 'restaurant' END AS product,
 COALESCE(b.name,m.payload->>'branchName',d.register_name,d.hostname,'Filial') AS name,
 COALESCE(m.daily_sales_minor,0) AS daily_sales_minor
 FROM devices d JOIN licenses l ON l.id=d.license_id
 LEFT JOIN branches b ON b.id=d.branch_id AND b.customer_id=l.customer_id
 LEFT JOIN market_pos_snapshots m ON m.device_id=d.id AND m.customer_id=l.customer_id
 WHERE l.customer_id=${customerId}::uuid AND d.status<>'revoked'
 AND l.status='active' AND (l.valid_until IS NULL OR l.valid_until>now())
 ORDER BY b.name,d.register_name,d.hostname,d.id
 `));
}
export function branchOnline(d:Record<string,any>,now=Date.now()){const seen=Date.parse(d.last_seen_at instanceof Date?d.last_seen_at.toISOString():String(d.last_seen_at||''));return Number.isFinite(seen)&&now-seen<300000;}
export function branchVersionSupported(d:Record<string,any>){const version=String(d.app_version||'').split('.').map(Number);const min=d.product==='market'?[1,5,19]:[1,9,2];for(let i=0;i<3;i++){if(!Number.isFinite(version[i]))return false;if(version[i]!==min[i])return version[i]>min[i];}return true;}
/** The checks, queueing and wait of a branch RPC once the caller has resolved the customer and both devices.
  source is the till the request comes from, or null for the owner website (no transfer.* then). */
export async function branchRpc(app:FastifyInstance,req:any,reply:any,{customerId,source,target,body,auditAction,validateOnly=false,timeoutMs=40000}:{customerId:string;source:Record<string,any>|null;target:Record<string,any>;body:{requestId:string;calls:Array<{method:string;payload?:Record<string,unknown>;idempotencyKey?:string}>};auditAction:string;validateOnly?:boolean;timeoutMs?:number}){
  if(!branchVersionSupported(target))return reply.code(409).send({error:'Hədəf filialın POS proqramını yeniləyin: Restoran 1.9.2 / Market 1.5.19'});
  const kinds=body.calls.map(branchCallKind);if(kinds.includes('w')&&!target.branch_id)return reply.code(409).send({error:'Dəyişiklikdən əvvəl bu kassaya Filial təyin et bölməsindən filial adı verin'});if(kinds.some(k=>!k))return reply.code(403).send({error:'Bu əməliyyat filialdan uzaqdan açıq deyil'});
  const access=await surfaceAccess(app,customerId,target.product);
  // The owner login is authoritative; product surface permissions still apply.
  if(!areaAllowed(access,'reports')&&!areaAllowed(access,'stock')&&!areaAllowed(access,'ops')&&!areaAllowed(access,'dashboard'))return reply.code(403).send({error:'Bu məhsulun idarəsinə icazə yoxdur'});
  const methodArea=(c:{method:string;payload?:Record<string,unknown>})=>{
   const m=c.method,market=target.product==='market';
   if(m==='__session')return null;
   if(m==='payments.refund')return market?'returns':'refund';
   if(m==='print.enqueue')return 'reports';
   if(m==='business.call'){const a=String(c.payload?.action||'');if(a==='context')return null;if(a.startsWith('transfer.')||a.startsWith('waste.'))return market?'inventory':'stock';if(a==='branch.summary')return 'reports';if(a.startsWith('staff'))return 'staff';if(a==='catalog.publish')return market?'inventory':'catalog';return market?'registers':'cash';}
   if(/^(reports\.|sales\.|orders\.)/.test(m))return 'reports';
   if(/^(cash|cashAccounts|cashObjects|income|salary)\./.test(m))return market?'registers':'cash';
   if(/^(customers|loyalty)\./.test(m))return market?'customers':'guests';
   if(/^(suppliers|supplierItems|purchases)\./.test(m))return market?'purchases':'suppliers';
   if(m.startsWith('delivery.')||m.startsWith('couriers.'))return market?'ops':'delivery';
   if(m.startsWith('users.')||m.startsWith('roles.'))return 'staff';
   if(m.startsWith('catalog.'))return market?'inventory':'catalog';
   return market?'inventory':'stock';
  };
  if(body.calls.some(c=>{const area=methodArea(c);return area&&!areaAllowed(access,area);}))return reply.code(403).send({error:'Bu bölmənin uzaqdan idarəsinə icazə yoxdur'});
  if(body.calls.some(c=>c.method==='business.call'&&String(c.payload?.action||'').startsWith('transfer.'))&&(!source||source.product!=='market'||target.product!=='market'||[source,target].some(d=>String(d.app_version||'').localeCompare('1.5.29',undefined,{numeric:true})<0)))return reply.code(409).send({error:'Hər iki Market POS-u 1.5.29 versiyasına yeniləyin'});
  if(validateOnly)return {authorized:true};
  if(!branchOnline(target))return reply.code(409).send({error:'Filial oflayndır. POS açıq və internetə bağlı olmalıdır; dəyişiklik göndərilmədi'});
  const calls=body.calls.map((c,i)=>({...c,...(c.method==='business.call'&&String(c.payload?.action||'').startsWith('transfer.')?{payload:{...c.payload,cloudSourceDeviceId:source!.id,cloudTargetDeviceId:target.id}}:{}),...(kinds[i]==='w'?{idempotencyKey:c.idempotencyKey||body.requestId+':'+i}:{})}));
  const expiresAt=Date.now()+Math.max(1000,Math.min(40000,timeoutMs));
  let results:unknown;
  const uncertain=kinds.includes('w');
  const failure=(status:number,code:string,message:string)=>reply.code(status).send({error:message+(uncertain?' Nəticəni qaimələrdən yoxlayın; əməliyyatı yenidən təsdiqləməyin.':''),code,uncertain});
  const decode=(result:any)=>{
   const value=result?.z?JSON.parse(inflateRawSync(Buffer.from(String(result.z),'base64'),{maxOutputLength:16*1024*1024}).toString('utf8')):result?.results;
   if(!Array.isArray(value)||value.length!==calls.length||value.some(r=>!r||typeof r.success!=='boolean'))throw Error('Invalid branch result envelope');
   return value;
  };
  try{
   if(target.product==='market'){
    const id=body.requestId;
    await app.db.execute(sql`INSERT INTO market_pos_commands(id,customer_id,device_id,kind,payload) VALUES(${id}::uuid,${customerId}::uuid,${target.id}::uuid,'core_batch',${JSON.stringify({calls,expiresAt})}::text::jsonb) ON CONFLICT(id) DO NOTHING`);
    // A retry may observe an existing command, but cannot change its target or calls.
    const normalize=(items:any[])=>items.map(c=>({method:c.method,payload:c.payload||{},idempotencyKey:c.idempotencyKey||null}));
    const existing=rows(await app.db.execute(sql`SELECT kind,payload FROM market_pos_commands WHERE id=${id}::uuid AND customer_id=${customerId}::uuid AND device_id=${target.id}::uuid`))[0];
    if(!existing||existing.kind!=='core_batch'||!Array.isArray(existing.payload?.calls)||!isDeepStrictEqual(normalize(existing.payload.calls),normalize(calls)))return reply.code(409).send({error:'Bu sorğu nömrəsi başqa əməliyyata aiddir. Filial məlumatını yeniləyin.',code:'BRANCH_REQUEST_CONFLICT'});
    while(Date.now()<expiresAt){
     const command=rows(await app.db.execute(sql`SELECT status,result,error FROM market_pos_commands WHERE id=${id}::uuid AND customer_id=${customerId}::uuid AND device_id=${target.id}::uuid`))[0];
     if(command?.status==='done'){results=decode(command.result);break;}
     if(command?.status==='failed')return failure(502,'BRANCH_COMMAND_FAILED',command.error||'Filial əməliyyatı tamamlamadı.');
     if(command?.status==='cancelled')return failure(409,'BRANCH_COMMAND_CANCELLED','Filial sorğusu ləğv edilib.');
     if(!command)return failure(503,'BRANCH_COMMAND_MISSING','Filial sorğusunun vəziyyəti tapılmadı.');
     await new Promise(r=>setTimeout(r,200));
    }
    if(!results)await app.db.execute(sql`UPDATE market_pos_commands SET status='failed',error='Remote request expired',completed_at=now() WHERE id=${id}::uuid AND customer_id=${customerId}::uuid AND status='pending'`);
   }else{
    notePortalRpc(customerId);
    const outcome=await runOnTill({customerId,deviceId:target.id,command:'core.batch',args:{calls,cloudExpiresAt:expiresAt},requestedBy:source?'branch:'+source.id:'owner-web',timeoutMs:Math.max(1000,Math.min(40000,timeoutMs))});
    if(outcome.ok)results=decode(outcome.result);
    else if(!outcome.timedOut)return failure(502,'BRANCH_COMMAND_FAILED',outcome.error||'Filial əməliyyatı tamamlamadı.');
   }
   if(!Array.isArray(results))return failure(504,'BRANCH_TIMEOUT','Filialdan vaxtında nəticə alınmadı. POS-un internet bağlantısını yoxlayın.');
   if(uncertain)await writeAudit(app,{actorCustomerId:customerId,action:auditAction,entityType:'device',entityId:target.id,ip:clientIp(req),meta:{sourceDeviceId:source?.id??null,targetDeviceId:target.id,requestId:body.requestId,methods:body.calls.filter((_,i)=>kinds[i]==='w').map(c=>c.method)}});
  }catch(error){
   req.log.error({err:error,branchRequestId:body.requestId},'Branch RPC could not confirm the result');
   return failure(503,'BRANCH_UNAVAILABLE','Filialla əlaqə zamanı xəta yarandı. Bir qədər sonra məlumatları yeniləyin.');
  }
  return {results,deviceId:target.id,requestId:body.requestId};
}
export async function cloudBranchRoutes(app:FastifyInstance){
 const authenticate=(req:any,reply:any)=>{const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const who=resolveTenantToken(token);if(!who)reply.code(401).send({error:'Sahibkar hesabına yenidən daxil olun'});return who;};
 app.get('/tenant/pos/branches',{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async(req,reply)=>{
  const who=authenticate(req,reply);if(!who)return;
  const query=z.object({sourceDeviceId:z.string().uuid()}).safeParse(req.query);if(!query.success)return reply.code(400).send({error:'Mənbə kassa seçilməyib'});
  const devices=await ownerBranchDevices(app,who.customerId);if(!devices.some(d=>d.id===query.data.sourceDeviceId))return reply.code(403).send({error:'Kassa bu sahibkara bağlı deyil və ya lisenziya aktiv deyil'});
  const objects=rows(await app.db.execute(sql`SELECT id,name FROM branches WHERE customer_id=${who.customerId}::uuid AND active=true ORDER BY name,id`));
  return {serverTime:new Date().toISOString(),onlineTimeoutMs:300000,objects,branches:devices.map(d=>({deviceId:d.id,branchId:d.branch_id,name:d.name,terminalName:d.register_name||d.hostname,product:d.product,version:d.app_version,online:branchOnline(d),supported:branchVersionSupported(d),updatedAt:d.updated_at,lastSeenAt:d.last_seen_at,local:d.id===query.data.sourceDeviceId,dailySalesMinor:Number(d.daily_sales_minor)||0}))};
 });
 app.post('/tenant/pos/branches/objects',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(req,reply)=>{
  const who=authenticate(req,reply);if(!who)return;
  const parsed=z.object({sourceDeviceId:z.string().uuid(),action:z.enum(['create','rename','delete','renameTill','archiveTill']),branchId:z.string().uuid().optional(),detachTills:z.boolean().optional(),deviceId:z.string().uuid().optional(),name:z.string().trim().min(2).max(120).optional()}).safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:'Filial əməliyyatı düzgün deyil'});
  const b=parsed.data,devices=await ownerBranchDevices(app,who.customerId);
  if(!devices.some(d=>d.id===b.sourceDeviceId))return reply.code(403).send({error:'Kassa bu sahibkara bağlı deyil'});
  if(['renameTill','archiveTill'].includes(b.action)&&!devices.some(d=>d.id===b.deviceId))return reply.code(403).send({error:'Kassa bu sahibkara aid deyil'});
  if(b.action==='archiveTill'&&(b.deviceId===b.sourceDeviceId||branchOnline(devices.find(d=>d.id===b.deviceId)!)))return reply.code(409).send({error:'Cari və ya onlayn POS-u silmək olmaz. İstifadə olunmayan kassada proqramı bağlayın və oflayn olmasını gözləyin.'});
  if(['create','rename','renameTill'].includes(b.action)&&!b.name)return reply.code(400).send({error:'Adı yazın'});
  let id=b.branchId;
  const result=await app.db.transaction(async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${who.customerId}))`);
   if(b.action==='archiveTill'){
    const closed=rows(await tx.execute(sql`UPDATE devices SET status='revoked',updated_at=now() WHERE id=${b.deviceId!}::uuid AND id<>${b.sourceDeviceId}::uuid AND (last_seen_at IS NULL OR last_seen_at<now()-interval '5 minutes') AND license_id IN(SELECT id FROM licenses WHERE customer_id=${who.customerId}::uuid) RETURNING id`));
    if(!closed.length)return {status:409,error:'Kassa yenidən onlayn olub. POS-u bağlayın və oflayn olmasını gözləyin.'};
   }else if(b.action==='renameTill'){
    await tx.execute(sql`UPDATE devices SET register_name=${b.name!},register_name_updated_at=now(),updated_at=now() WHERE id=${b.deviceId!}::uuid AND license_id IN(SELECT id FROM licenses WHERE customer_id=${who.customerId}::uuid)`);
   }else{
    if(b.action!=='create'){
     const found=rows(await tx.execute(sql`SELECT id FROM branches WHERE id=${id||null}::uuid AND customer_id=${who.customerId}::uuid AND active=true FOR UPDATE`));
     if(!found.length)return {status:404,error:'Filial tapılmadı'};
    }
    if(b.action==='delete'){
     // detachTills: the owner confirmed it; the tills keep working without a filial until reassigned.
     if(b.detachTills===true)await tx.execute(sql`UPDATE devices SET branch_id=NULL,updated_at=now() WHERE branch_id=${id!}::uuid AND license_id IN(SELECT id FROM licenses WHERE customer_id=${who.customerId}::uuid)`);
     const assigned=rows(await tx.execute(sql`SELECT id FROM devices WHERE branch_id=${id!}::uuid AND status<>'revoked' LIMIT 1`));
     if(assigned.length)return {status:409,error:'Filialə kassalar bağlıdır. Əvvəlcə kassaları başqa filialə keçirin. Satış tarixçəsi silinmir.'};
     await tx.execute(sql`UPDATE branches SET active=false,updated_at=now() WHERE id=${id!}::uuid AND customer_id=${who.customerId}::uuid`);
    }else{
     const duplicate=rows(await tx.execute(sql`SELECT id FROM branches WHERE customer_id=${who.customerId}::uuid AND active=true AND lower(trim(name))=lower(${b.name!}) AND id<>COALESCE(${id||null}::uuid,'00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`));
     if(duplicate.length)return {status:409,error:'Bu adda filial artıq var. Kassanı mövcud filialə bağlayın.'};
     if(b.action==='create'){id=randomUUID();await tx.execute(sql`INSERT INTO branches(id,customer_id,name,code) VALUES(${id}::uuid,${who.customerId}::uuid,${b.name!},${'BR-'+id.slice(0,8)})`);}
     else await tx.execute(sql`UPDATE branches SET name=${b.name!},updated_at=now() WHERE id=${id!}::uuid AND customer_id=${who.customerId}::uuid`);
    }
   }
   return {status:200};
  });
  if(result.status!==200)return reply.code(result.status).send({error:result.error});
  await writeAudit(app,{actorCustomerId:who.customerId,action:'owner.object.'+b.action,entityType:b.deviceId?'device':'branch',entityId:b.deviceId||id!,ip:clientIp(req),meta:{sourceDeviceId:b.sourceDeviceId,branchId:id,name:b.name,...(b.action==='delete'&&b.detachTills===true?{detachTills:true}:{})}});
  return {ok:true,id};
 });
 app.post('/tenant/pos/branches/location',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async(req,reply)=>{
  const who=authenticate(req,reply);if(!who)return;
  const parsed=z.object({sourceDeviceId:z.string().uuid(),deviceId:z.string().uuid(),branchId:z.string().uuid().optional(),name:z.string().trim().min(2).max(120).optional()}).refine(v=>Boolean(v.branchId||v.name)).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Mövcud filial seçin'});
  const b=parsed.data,devices=await ownerBranchDevices(app,who.customerId);
  if(!devices.some(d=>d.id===b.sourceDeviceId)||!devices.some(d=>d.id===b.deviceId))return reply.code(403).send({error:'Filial bu sahibkara aid deyil'});
  const assigned=await app.db.transaction(async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${who.customerId}))`);
   const existing=rows(await tx.execute(b.branchId
    ?sql`SELECT id,name FROM branches WHERE id=${b.branchId}::uuid AND customer_id=${who.customerId}::uuid AND active=true FOR UPDATE`
    :sql`SELECT id,name FROM branches WHERE customer_id=${who.customerId}::uuid AND lower(trim(name))=lower(${b.name!}) AND active=true FOR UPDATE`))[0];
   if(!existing)return null;
   await tx.execute(sql`UPDATE devices SET branch_id=${existing.id}::uuid,updated_at=now() WHERE id=${b.deviceId}::uuid AND license_id IN (SELECT id FROM licenses WHERE customer_id=${who.customerId}::uuid AND status='active')`);
   return {branchId:String(existing.id),name:String(existing.name)};
  });
  if(!assigned)return reply.code(404).send({error:'Filial tapılmadı. Yeni filiali yalnız Filiallar bölməsindən yaradın.'});
  await writeAudit(app,{actorCustomerId:who.customerId,action:'owner.branch.assign',entityType:'device',entityId:b.deviceId,ip:clientIp(req),meta:{sourceDeviceId:b.sourceDeviceId,...assigned}});
  return {ok:true,...assigned};
 });
 app.post('/tenant/pos/branches/rpc',{bodyLimit:2*1024*1024,config:{rateLimit:{max:240,timeWindow:'1 minute'}}},async(req,reply)=>{
  const who=authenticate(req,reply);if(!who)return;
  const parsed=Body.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Sorğu düzgün deyil'});
  const body=parsed.data,devices=await ownerBranchDevices(app,who.customerId),source=devices.find(d=>d.id===body.sourceDeviceId),target=devices.find(d=>d.id===body.deviceId);
  if(!source||!target)return reply.code(403).send({error:'Filial bu sahibkar hesabına aid deyil və ya aktiv deyil'});
  return branchRpc(app,req,reply,{customerId:who.customerId,source,target,body,auditAction:'owner.branch.rpc'});
 });
}
