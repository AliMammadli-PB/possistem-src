import {randomUUID,randomBytes,createHash} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {sql} from 'drizzle-orm';
import {z} from 'zod/v3';
import {parseBody,clientIp} from '../lib/validate.js';
import {requireSuperadmin,currentUser} from '../plugins/auth.js';
import {resolveTenantToken} from './tenant.js';
import {ownerBranchDevices,branchOnline,branchRpc} from './cloud-branches.js';
import {writeAudit} from '../lib/audit.js';
import {assistantReply} from './assistant.js';
import {Billing} from '../lib/billing/service.js';
import {advance,newDocument,trainingReply,TOOLS} from '../lib/assistant/central-engine.mjs';
import {createTools} from '../lib/assistant/runtime/local-tools.mjs';
const rows=(r:any):any[]=>Array.isArray(r)?r:r?.rows||[];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const uuid=z.string().uuid(),Lang=z.enum(['az','en','ru','tr']);
const Entry=z.object({id:uuid,title:z.string().trim().min(1).max(120),language:Lang,patterns:z.array(z.string().trim().min(2).max(200)).min(1).max(30),answer:z.string().trim().min(1).max(4000),scope:z.enum(['site','restaurant','both']),active:z.boolean().default(true)});
const Entries=z.array(Entry).max(300).refine(items=>new Set(items.map(e=>e.id)).size===items.length,'Təlim ID-ləri təkrar ola bilməz.');
const SessionKey={sessionId:uuid,secret:z.string().min(32).max(128)};
const supported=['inventory.view','inventory.manage','inventory.adjust','catalog.manage','reports.view','cash.accounts','order.view','recipes.manage'];
async function published(db:any){const [r]=rows(await db.execute(sql`SELECT coalesce(s.published_revision,0)::integer AS revision,coalesce(r.entries,'[]'::jsonb) AS entries FROM assistant_knowledge_state s LEFT JOIN assistant_knowledge_revisions r ON r.id=s.published_revision WHERE s.id=1`));return r||{revision:0,entries:[]};}
export async function centralAssistantRoutes(app:FastifyInstance){
 app.addHook('onSend',async(_req,reply,payload)=>{reply.header('Cache-Control','private, no-store');return payload;});
 const identity=(req:any)=>req.customer?.id||resolveTenantToken(String(req.headers.authorization||'').replace(/^Bearer\s+/i,''))?.customerId||null;
 const options={preHandler:async(req:any,reply:any)=>{const origin=req.headers.origin;if(origin&&origin!=='https://possistem.az'&&process.env.NODE_ENV==='production')return reply.code(403).send({error:'Origin not allowed'});},bodyLimit:1500000,config:{rateLimit:{max:120,timeWindow:'1 minute'}}};
 app.post('/customer/assistant/v1/sessions',options,async(req,reply)=>{
  // Main sends the full native role catalogue (65+ keys), not just assistant tools.
  // Keep a bounded transport list; only supported assistant keys are retained below.
  const body=parseBody(z.object({protocol:z.literal(1),surface:z.enum(['site','restaurant']),language:Lang.default('az'),deviceId:uuid.optional(),actorId:z.string().max(100).default(''),permissions:z.array(z.string().min(1).max(80)).max(1024).default([]),tools:z.array(z.string().max(60)).max(30).default([])}),req.body,reply);if(!body)return;
  const customerId=identity(req);if(body.surface==='restaurant'&&(!customerId||!req.headers.authorization))return reply.code(401).send({error:'Hesaba yenidən daxil olun.'});
  if(body.surface==='restaurant'){const [owner]=rows(await app.db.execute(sql`SELECT active FROM customers WHERE id=${customerId}::uuid`));if(!owner?.active)return reply.code(401).send({error:'Hesab aktiv deyil.'});}
  const devices=customerId?(await ownerBranchDevices(app,customerId)).filter(d=>d.product==='restaurant'):[];
  const target=body.deviceId?devices.find(d=>d.id===body.deviceId):devices.length===1?devices[0]:null;
  if(body.deviceId&&!target)return reply.code(403).send({error:'Kassa bu hesaba aid deyil.'});
  if(body.surface==='restaurant'&&!target)return reply.code(409).send({error:'Aktiv Restoran POS kassası tapılmadı.'});
  const permissions=body.surface==='restaurant'?[...new Set(body.permissions)].filter(p=>supported.includes(p)):target?supported:[];
  const tools=body.surface==='restaurant'?body.tools.filter(t=>TOOLS.includes(t)):target?TOOLS.filter(t=>t!=='openPayment'):[];
  const doc=newDocument({surface:body.surface,language:body.language,permissions,tools});
  await app.db.execute(sql`DELETE FROM assistant_sessions WHERE id IN (SELECT id FROM assistant_sessions WHERE expires_at<now() ORDER BY expires_at LIMIT 200)`);
  const id=randomUUID(),secret=randomBytes(32).toString('hex');
  await app.db.execute(sql`INSERT INTO assistant_sessions(id,customer_id,secret_hash,surface,device_id,actor_id,capabilities,state) VALUES(${id}::uuid,${customerId}::uuid,${hash(secret)},${body.surface},${target?.id??null}::uuid,${body.actorId},${JSON.stringify({permissions,tools})}::jsonb,${JSON.stringify(doc)}::jsonb)`);
  return{protocol:1,sessionId:id,secret,devices:body.surface==='site'?devices.map(d=>({id:d.id,name:d.name})):[]};
 });
 const run=async(req:any,reply:any,type:'message'|'result')=>{
  const schema=type==='message'?z.object({...SessionKey,requestId:uuid,text:z.string().trim().min(1).max(1000)}):z.object({...SessionKey,requestId:uuid,taskId:uuid,outcome:z.union([z.object({value:z.unknown()}),z.object({error:z.string().max(1000)})])});
  const body:any=parseBody<any,any>(schema,req.body,reply);if(!body)return;
  try{return await app.db.transaction(async tx=>{
   const [session]=rows(await tx.execute(sql`SELECT * FROM assistant_sessions WHERE id=${body.sessionId}::uuid AND secret_hash=${hash(body.secret)} AND expires_at>now() FOR UPDATE`));
   if(!session||session.customer_id!==identity(req)||session.surface==='restaurant'&&(req.headers['x-pos-device']!==session.device_id||req.headers['x-pos-actor']!==session.actor_id))return reply.code(404).send({error:'Söhbət tapılmadı. Yenidən başlayın.'});
   if(session.surface==='restaurant'){const [owner]=rows(await tx.execute(sql`SELECT active FROM customers WHERE id=${session.customer_id}::uuid`));if(!owner?.active)return reply.code(401).send({error:'Hesab aktiv deyil.'});}
   const devices=session.customer_id?await ownerBranchDevices(app,session.customer_id):[];
   const target=devices.find(d=>d.id===session.device_id);
   if(session.device_id&&!target)return reply.code(403).send({error:'Kassaya giriş dayandırılıb.'});
   const knowledge=await published(tx);let doc=session.state;
   if(type==='message'&&body.text.startsWith('#device:')&&session.surface==='site'){
    const chosen=devices.find(d=>d.id===body.text.slice(8)&&d.product==='restaurant');if(!chosen)return reply.code(403).send({error:'Kassa tapılmadı.'});
    doc=newDocument({surface:'site',language:doc.language,permissions:supported,tools:TOOLS.filter(t=>t!=='openPayment')});
    await tx.execute(sql`UPDATE assistant_sessions SET device_id=${chosen.id}::uuid,state=${JSON.stringify(doc)}::jsonb WHERE id=${session.id}::uuid`);
    return{protocol:1,reply:{body:`${chosen.name} seçildi. Nə etmək istəyirsiniz?`,choices:[]}};
   }
   const event=type==='message'?{type,requestId:body.requestId,text:body.text}:{type,requestId:body.requestId,taskId:body.taskId,outcome:body.outcome};
   if(session.surface==='site'&&type==='result')return reply.code(403).send({error:'Sayt üçün yerli nəticə qəbul edilmir.'});
   // Facts never pass through a second account/command engine on the desktop.
   const help=async(text:string)=>{
    const fallback=await assistantReply(app,text,doc.language==='tr'?'en':doc.language,null);
    const r=fallback.reply;return{...r,body:r.text};
   };
   let output=await advance(doc,event,{...knowledge,help});
   if(session.surface==='site'){
    for(let n=0;output.result.task&&n<24;n++){
     const task=output.result.task;
     if(!target||!branchOnline(target))throw Error('Kassa onlayn deyil. Heç bir yeni dəyişiklik göndərilmədi.');
     const api=portalApi(app,req,target,session.customer_id,task.id);
     const tools:any=createTools(api,()=>true,{});tools.subscription=async()=>{const data=await new Billing(app.db).listSubscriptions(session.customer_id);return{subscription:data.subscriptions.find(s=>s.product==='restaurant')||null,paymentsAvailable:data.paymentsAvailable,paymentUrl:'/pos/app/abunelik'};};let outcome;
     try{outcome={value:await tools[task.name](...task.args)};}catch(e:any){outcome={error:e.message||'Kassa cavab vermədi.'};}
     output=await advance(output.document,{type:'result',requestId:body.requestId,taskId:task.id,outcome},{...knowledge,help});
    }
    if(!target&&devices.length>1&&output.result.reply)output.result.reply.choices=devices.filter(d=>d.product==='restaurant').map(d=>({label:d.name,value:'#device:'+d.id}));
   }
   if(Buffer.byteLength(JSON.stringify(output.document))>1200000)throw Error('Söhbət çox uzundur. Yeni söhbət başladın.');
   await tx.execute(sql`UPDATE assistant_sessions SET state=${JSON.stringify(output.document)}::jsonb,revision=${knowledge.revision},updated_at=now() WHERE id=${session.id}::uuid`);
   reply.header('Cache-Control','no-store');return output.result;
  });}catch(e:any){req.log.warn({err:e,sessionId:body.sessionId},'central_assistant_failed');return reply.code(409).send({error:e.message==='REVISION_CHANGED'?'Təlim yenilənib. Dəyişikliyi yenidən planlaşdırın.':e.message||'Söhbət davam etdirilə bilmədi.'});}
 };
 app.post('/customer/assistant/v1/message',options,(req,reply)=>run(req,reply,'message'));
 app.post('/customer/assistant/v1/result',options,(req,reply)=>run(req,reply,'result'));
 app.get('/support/assistant-knowledge',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;const [state]=rows(await app.db.execute(sql`SELECT * FROM assistant_knowledge_state WHERE id=1`));return{state,revisions:rows(await app.db.execute(sql`SELECT r.id,r.created_at,r.restored_from,u.email AS author FROM assistant_knowledge_revisions r LEFT JOIN users u ON u.id=r.created_by ORDER BY r.id DESC LIMIT 50`))};});
 app.put('/support/assistant-knowledge',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;const body=parseBody(z.object({entries:Entries,version:z.number().int().positive()}),req.body,reply);if(!body)return;
  const result=rows(await app.db.execute(sql`UPDATE assistant_knowledge_state SET draft=${JSON.stringify(body.entries)}::jsonb,draft_version=draft_version+1,updated_by=${currentUser(req).id}::uuid,updated_at=now() WHERE id=1 AND draft_version=${body.version} RETURNING draft_version`));if(!result.length)return reply.code(409).send({error:'Qaralama dəyişib. Yeniləyib təkrar baxın.'});await writeAudit(app,{actorUserId:currentUser(req).id,action:'assistant.training.draft',entityType:'assistant_knowledge',entityId:'1',ip:clientIp(req)});return{ok:true,version:result[0].draft_version};
 });
 app.post('/support/assistant-knowledge/publish',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;const body=parseBody(z.object({version:z.number().int().positive(),restoreRevision:z.number().int().positive().optional()}),req.body,reply);if(!body)return;
  const output=await app.db.transaction(async tx=>{const [state]=rows(await tx.execute(sql`SELECT * FROM assistant_knowledge_state WHERE id=1 FOR UPDATE`));if(state.draft_version!==body.version)return null;
   const restored=body.restoreRevision?rows(await tx.execute(sql`SELECT entries FROM assistant_knowledge_revisions WHERE id=${body.restoreRevision}`))[0]:null;if(body.restoreRevision&&!restored)return null;
   const entries=Entries.parse(restored?.entries||state.draft);
   const [revision]=rows(await tx.execute(sql`INSERT INTO assistant_knowledge_revisions(entries,created_by,restored_from) VALUES(${JSON.stringify(entries)}::jsonb,${currentUser(req).id}::uuid,${body.restoreRevision??null}) RETURNING id`));
   await tx.execute(sql`UPDATE assistant_knowledge_state SET published_revision=${revision.id},draft=${JSON.stringify(entries)}::jsonb,draft_version=draft_version+1,updated_by=${currentUser(req).id}::uuid,updated_at=now() WHERE id=1`);return revision.id;
  });if(!output)return reply.code(409).send({error:'Qaralama və ya versiya dəyişib. Yeniləyin.'});await writeAudit(app,{actorUserId:currentUser(req).id,action:'assistant.training.publish',entityType:'assistant_knowledge_revision',entityId:String(output),ip:clientIp(req)});return{revision:Number(output)};
 });
 app.post('/support/assistant-knowledge/preview',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;const body=parseBody(z.object({entries:Entries,text:z.string().min(1).max(1000),language:Lang,surface:z.enum(['site','restaurant'])}),req.body,reply);if(!body)return;
  const match=trainingReply(body.entries,body.text,body.language,body.surface);if(match)return{reply:match,simulation:true};const out=await assistantReply(app,body.text,body.language==='tr'?'en':body.language,null);return{reply:{...out.reply,body:out.reply.text},simulation:true};
 });
 app.post<{Params:{id:string}}>('/support/assistant-reports/:id/training-draft',async(req,reply)=>{if(!requireSuperadmin(req,reply))return;if(!uuid.safeParse(req.params.id).success)return reply.code(404).send({error:'Tapılmadı.'});const [r]=rows(await app.db.execute(sql`SELECT transcript,language FROM support_assistant_reports WHERE id=${req.params.id}::uuid`));if(!r)return reply.code(404).send({error:'Tapılmadı.'});const transcript=Array.isArray(r.transcript)?r.transcript:[];const bad=transcript.findIndex((m:any)=>m.author==='helper'&&(m.rating==='bad'||String(m.topic||'').includes('pis cavab')||String(m.body||'').startsWith('👎')));const question=[...(bad>=0?transcript.slice(0,bad):transcript)].reverse().find((m:any)=>m.author==='me')?.body||'';return{entry:{id:randomUUID(),title:question.slice(0,100),language:r.language,patterns:[question.slice(0,200)],answer:'',scope:'both',active:true}};});
}
// Reuse the owner portal's existing permission, online, audit and command-expiry gate.
function portalApi(app:FastifyInstance,req:any,target:any,customerId:string,taskId:string){
 let index=0;
 const call=async(method:string,payload:any={})=>{let status=200,failed:any;const reply:any={code(n:number){status=n;return this},send(v:any){failed=v;return v;}};
  // A stable task-derived request ID supports native idempotency after retries.
  const bytes=hash(taskId+':'+index++).slice(0,32);const id=`${bytes.slice(0,8)}-${bytes.slice(8,12)}-4${bytes.slice(13,16)}-a${bytes.slice(17,20)}-${bytes.slice(20)}`;
  const result:any=await branchRpc(app,req,reply,{customerId,source:null,target,body:{requestId:id,calls:[{method,payload,idempotencyKey:taskId}]},auditAction:'assistant.tool',timeoutMs:15000});
  if(status>=400)throw Error(failed?.error||'Kassadan nəticə alınmadı.');return result.results[0];};
 return{inventory:{ingredients:(q:string)=>call('ingredients.list',{q}),warehouses:()=>call('warehouses.list'),levels:(warehouseId:string)=>call('inventory.levels',{warehouseId}),adjust:(p:any)=>call('inventory.adjust',p),saveIngredient:(p:any)=>call('ingredients.save',p),recipe:(menuItemId:string)=>call('recipes.get',{menuItemId}),saveRecipe:(menuItemId:string,lines:any[],components:any[])=>call('recipes.save',{menuItemId,lines,components})},catalog:{list:(p:any)=>call('catalog.products',p),categories:()=>call('catalog.categories')},catalogAdmin:{upsertProduct:(p:any)=>call('catalog.upsertProduct',p)},reports:{period:(p:any)=>call('reports.period',p)},cashAccounts:{list:()=>call('cashAccounts.list')},tables:{list:()=>call('tables.list')},orders:{get:(orderId:string)=>call('orders.get',{orderId})}};
}
