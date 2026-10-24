import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {requireCustomer} from '../plugins/customer-auth.js';
import {surfaceAccess} from './access.js';
import {areaAllowed} from '../lib/access-areas.js';
import {ownerBranchDevices,branchOnline,branchVersionSupported,branchRpc} from './cloud-branches.js';

const products=['restaurant','market','geyim','aptek','topdan'] as const;
const rows=(r:any):any[]=>Array.isArray(r)?r:r?.rows||[];
const number=(v:unknown)=>Number.isFinite(Number(v))?Math.max(0,Math.round(Number(v))):0;
export const portalDeviceProduct=(d:any)=>products.includes(d.licensed_product)?d.licensed_product:d.product;
export function marketInsight(row:any){
 const p=row.payload||{};
 return {updatedAt:row.updated_at,salesMinor:number(row.daily_sales_minor),count:number(row.transaction_count),cashMinor:p.cashMinor==null?null:number(p.cashMinor),cardMinor:p.cardMinor==null?null:number(p.cardMinor),openRegisters:number(row.open_registers),openTables:null,
  topProducts:(Array.isArray(p.topProducts)?p.topProducts:[]).slice(0,8).map((r:any)=>({name:String(r.name||'Məhsul'),quantity:Number(r.qty??r.quantity)||0,revenueMinor:number(r.revenueMinor)}))};
}
export const insightDeps={requireCustomer,surfaceAccess,devices:ownerBranchDevices,rpc:branchRpc};
export async function registerPortalInsights(app:FastifyInstance,deps=insightDeps){
 const allowed=async(req:any,reply:any)=>{
  const who=deps.requireCustomer(req,reply);if(!who)return null;
  const grants=await deps.surfaceAccess(app,who.id,'portal');
  if(grants!==null&&!grants.includes('home')){reply.code(403).send({error:'İdarə panelinə baxmaq icazəniz yoxdur'});return null;}
  return who;
 };
 app.get('/customer/insights',{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async(req,reply)=>{
  const who=await allowed(req,reply);if(!who)return;
  const parsed=z.object({product:z.enum(products),device:z.string().uuid().optional()}).safeParse(req.query);
  if(!parsed.success)return reply.code(400).send({error:'POS və filial seçimi düzgün deyil'});
  if(!areaAllowed(await deps.surfaceAccess(app,who.id,parsed.data.product==='restaurant'?'restaurant':'market'),'reports'))return reply.code(403).send({error:'Satış hesabatlarına baxmaq icazəniz yoxdur'});
  const all=await deps.devices(app,who.id),devices=all.filter(d=>portalDeviceProduct(d)===parsed.data.product);
  if(parsed.data.device&&!devices.some(d=>d.id===parsed.data.device))return reply.code(403).send({error:'Filial seçilmiş POS-a və ya bu sahibkara aid deyil'});
  // Return only the small report fields, never thousands of catalogue items.
  const market=rows(await app.db.execute(sql`SELECT m.device_id,m.updated_at,m.daily_sales_minor,m.transaction_count,m.open_registers,
   jsonb_build_object('cashMinor',m.payload->'cashMinor','cardMinor',m.payload->'cardMinor','topProducts',m.payload->'topProducts') AS payload
   FROM market_pos_snapshots m JOIN devices d ON d.id=m.device_id JOIN licenses l ON l.id=d.license_id
   WHERE m.customer_id=${who.id}::uuid AND l.customer_id=${who.id}::uuid AND d.status<>'revoked'`));
  const floor=rows(await app.db.execute(sql`SELECT device_id,updated_at,today_sales_minor,open_tables FROM owner_floor_snapshots WHERE customer_id=${who.id}::uuid`));
  const branches=devices.map(d=>{
   const m=market.find(r=>r.device_id===d.id),f=floor.find(r=>r.device_id===d.id);
   return {deviceId:d.id,branchId:d.branch_id,name:d.name,terminalName:d.register_name||d.hostname||'',product:portalDeviceProduct(d),online:branchOnline(d),supported:branchVersionSupported(d),version:d.app_version,lastSeenAt:d.last_seen_at,
    snapshot:d.product==='market'&&m?marketInsight(m):d.product==='restaurant'&&f?{updatedAt:f.updated_at,salesMinor:number(f.today_sales_minor),count:null,cashMinor:null,cardMinor:null,openTables:number(f.open_tables),topProducts:[]}:null};
  });
  reply.header('cache-control','no-store');
  return {product:parsed.data.product,serverTime:Date.now(),branches};
 });
 app.post('/customer/insights/live',{config:{rateLimit:{max:60,timeWindow:'1 minute'}}},async(req,reply)=>{
  const who=await allowed(req,reply);if(!who)return;
  const parsed=z.object({deviceId:z.string().uuid(),product:z.enum(products)}).safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:'Filial seçimi düzgün deyil'});
  const device=(await deps.devices(app,who.id)).find(d=>d.id===parsed.data.deviceId&&portalDeviceProduct(d)===parsed.data.product);
  if(!device)return reply.code(403).send({error:'Filial seçilmiş POS-a və ya bu sahibkara aid deyil'});
  if(device.product!=='restaurant')return reply.code(400).send({error:'Bu POS-un canlı hesabatı son göndərilən məlumatdan açılır'});
  // Fixed read-only calls: this endpoint cannot submit arbitrary till commands.
  return deps.rpc(app,req,reply,{customerId:who.id,source:device,target:device,body:{requestId:randomUUID(),calls:[{method:'reports.dashboard',payload:{}},{method:'reports.salesSummary',payload:{}},{method:'reports.topProducts',payload:{limit:8}}]},auditAction:'owner.insights.read'});
 });
}
