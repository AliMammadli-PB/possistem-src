import test from 'node:test';import assert from 'node:assert/strict';import Fastify from 'fastify';import {PgDialect} from 'drizzle-orm/pg-core';import {centralAssistantRoutes} from './assistant-central.js';import {createHash,randomUUID} from 'node:crypto';
import {allKeysFor} from './pos-permissions.js';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOnlineConversation} from '../../../../../restoranpos/support/online.mjs';
const jsonb=(input:string)=>JSON.parse(input,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort((a,b)=>a.length-b.length||a.localeCompare(b)).map(k=>[k,v[k]])):v);
const dialect=new PgDialect();
function fixture(restaurant=false){const target={id:randomUUID(),name:'Fixture restaurant',product:'restaurant',app_version:'1.10.21',last_seen_at:new Date()};const sessions=new Map<string,any>(),reports:any[]=[];let revision=0,entries:any[]=[];const owner=randomUUID();
 const execute=async(q:any)=>{const {sql:s,params:p}=dialect.sqlToQuery(q);
  if(s.includes('DELETE FROM assistant_sessions'))return[];
  if(s.includes('INSERT INTO assistant_sessions')){const [id,customer_id,secret_hash,surface,device_id,actor_id,capabilities,state]=p;sessions.set(String(id),{id,customer_id,secret_hash,surface,device_id,actor_id,capabilities:JSON.parse(String(capabilities)),state:jsonb(String(state))});return[];}
  if(s.includes('FROM assistant_sessions')){const r=sessions.get(String(p[0]));return r&&r.secret_hash===p[1]?[r]:[];}
  if(s.includes('assistant_knowledge_state s'))return[{revision,entries}];
  if(s.includes('UPDATE assistant_sessions SET state')){const r=sessions.get(String(p[2]));r.state=jsonb(String(p[0]));return[];}
  if(s.includes('FROM devices d JOIN licenses'))return restaurant?[target]:[];
  if(s.includes('FROM customers WHERE id'))return[{active:true,name:'Test Restoran'}];
  if(s.includes('INSERT INTO support_assistant_reports')){const [key,customer,language,reason,comment,transcript]=p;const old=reports.findIndex(r=>r.key===key),row={key,customer,language,reason,comment,transcript:JSON.parse(String(transcript))};if(old>=0)reports[old]=row;else reports.push(row);return[];}
  throw Error('Unexpected test SQL '+s);
 };const db:any={execute,transaction:async(fn:any)=>fn(db)};const app=Fastify();app.decorate('db',db);app.decorateRequest('user',null);app.decorateRequest('customer',null);app.addHook('preHandler',async req=>{if(req.headers['x-fixture-owner'])req.customer={id:owner,email:'fixture@example.invalid',name:'Fixture',active:true};});
 return{app,sessions,reports,owner,target,setKnowledge:(e:any[])=>{entries=e;revision++;}};
}
test('real route contract: guest isolation, admin denial, same open session learns next request',async()=>{const f=fixture();await f.app.register(centralAssistantRoutes);
 try{const make=await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',payload:{protocol:1,surface:'site'}});assert.equal(make.statusCode,200);const session=make.json();assert.equal(session.secret.length,64);
 const req=(text:string,extra:any={})=>f.app.inject({method:'POST',url:'/customer/assistant/v1/message',payload:{sessionId:session.sessionId,secret:session.secret,requestId:randomUUID(),text},...extra});
 assert.equal((await req('salam')).statusCode,200);
 for(const alias of ['sea','seaa','SEA!']){const out=await req(alias);assert.equal(out.statusCode,200);assert.match(out.json().reply.body,/Salam! Buyurun/);}
 f.setKnowledge([{id:randomUUID(),language:'az',scope:'both',active:true,patterns:['necesen'],answer:'Yeni sayt cavabı'}]);assert.equal((await req('necesen')).json().reply.body,'Yeni sayt cavabı');
 assert.equal((await req('salam',{headers:{'x-fixture-owner':'other'}})).statusCode,404);
 const bad=await f.app.inject({method:'POST',url:'/customer/assistant/v1/message',payload:{sessionId:session.sessionId,secret:'wrong-secret'.repeat(5),requestId:randomUUID(),text:'salam'}});assert.equal(bad.statusCode,404);
 assert.equal((await f.app.inject('/support/assistant-knowledge')).statusCode,401);
 assert.equal((await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',payload:{protocol:1,surface:'restaurant'}})).statusCode,401);
 const doc=f.sessions.get(session.sessionId);assert.notEqual(doc.secret_hash,session.secret);assert.equal(doc.secret_hash,createHash('sha256').update(session.secret).digest('hex'));
 }finally{await f.app.close();}
});

// Always test the main-process source, plus the installed artefact when available.
const desktop=fileURLToPath(new URL('../../../../../restoranpos/',import.meta.url));
const desktopVersion=JSON.parse(readFileSync(path.join(desktop,'package.json'),'utf8')).version;
const archive=path.join(desktop,'release-'+desktopVersion,'win-unpacked/resources/app.asar');
for(const packaged of [false,true])test((packaged?'packaged '+desktopVersion:'main-process source')+' accepts the complete administrator permission catalogue',{skip:packaged&&!existsSync(archive)},async()=>{
 const f=fixture(true);await f.app.register(centralAssistantRoutes);const temp=mkdtempSync(path.join(tmpdir(),'assistant-packaged-contract-'));
 try{
  const require=createRequire(import.meta.url);
  const file=path.join(temp,'assistant-online.cjs');
  if(packaged){const asar=require(path.join(desktop,'node_modules/@electron/asar'));writeFileSync(file,asar.extractFile(archive,'out/main/assistant-online.cjs'));}
  else writeFileSync(file,readFileSync(path.join(desktop,'support/online-client.cjs')));
  const {createAssistantClient}=require(file),permissions=allKeysFor('restaurant');
  assert.ok(permissions.length>40,'Regression needs the full administrator role');
  const client=createAssistantClient({credentials:async()=>({customerId:f.owner,deviceId:f.target.id,actorId:'usr-admin',token:'fixture-main-tenant',baseUrl:'https://possistem.az/pos/api',permissions:[...permissions,'unknown.future.permission']}),fetchImpl:async(url:string,options:RequestInit)=>{
   const response=await f.app.inject({method:'POST',url:new URL(url).pathname.replace(/^\/pos\/api/,''),headers:{...options.headers,'x-fixture-owner':'fixture'} as Record<string,string>,payload:String(options.body)});
   return new Response(response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});
  }});
  const session=await client.request({action:'create',language:'az',tools:['catalogue','read']});
  const document=f.sessions.get(session.sessionId);assert.ok(document.state.permissions.includes('inventory.view'));
  assert.ok(document.state.permissions.length<=17);assert.ok(!document.state.permissions.includes('unknown.future.permission'));
  for(const text of ['sa','sea','seaa']){const response=await client.request({action:'message',sessionId:session.sessionId,secret:session.secret,requestId:randomUUID(),text});assert.match(response.reply.body,/Salam! Buyurun/);}
  console.log('Verified '+(packaged?'packaged':'source')+' client with '+permissions.length+' real administrator permissions.');
 }finally{await f.app.close();rmSync(temp,{recursive:true,force:true});}
});

test('native tool errors survive the real outcome schema; missing/ambiguous outcomes are rejected',async()=>{
 const f=fixture(true);await f.app.register(centralAssistantRoutes);
 try{
 const headers={'x-fixture-owner':'fixture',authorization:'Bearer fixture','x-pos-device':f.target.id,'x-pos-actor':'usr-admin'};
 const created=await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',headers,payload:{protocol:1,surface:'restaurant',deviceId:f.target.id,actorId:'usr-admin',permissions:['inventory.view','recipes.manage'],tools:['setupMenu']}});assert.equal(created.statusCode,200,created.body);
 const session=created.json(),requestId=randomUUID();
 const started=await f.app.inject({method:'POST',url:'/customer/assistant/v1/message',headers,payload:{...session,requestId,text:'yeni kalkulasiya mehsulu yarat mene'}});assert.equal(started.statusCode,200,started.body);const task=started.json().task;assert.equal(task.name,'setupMenu');
 const result=(outcome:any)=>f.app.inject({method:'POST',url:'/customer/assistant/v1/result',headers,payload:{...session,requestId,taskId:task.id,outcome}});
 for(const outcome of [{},{value:{},error:'bad'},{error:''}])assert.equal((await result(outcome)).statusCode,400);
 const failed=await result({error:'Menyu bağlantısı əlçatan deyil.'});assert.equal(failed.statusCode,200,failed.body);assert.match(failed.json().reply.body,/Menyu bağlantısı/);assert.doesNotMatch(failed.json().reply.body,/undefined|products/);
 }finally{await f.app.close();}
});
test('signed-in desktop reads native inventory without a second login; guest data remains protected',async()=>{
 const f=fixture(true);await f.app.register(centralAssistantRoutes);
 try{
 const headers={'x-fixture-owner':'fixture',authorization:'Bearer fixture','x-pos-device':f.target.id,'x-pos-actor':'usr-admin'};
 const make=await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',headers,payload:{protocol:1,surface:'restaurant',deviceId:f.target.id,actorId:'usr-admin',permissions:['inventory.view','order.view'],tools:['catalogue','overview','tables']}});assert.equal(make.statusCode,200,make.body);const session=make.json();
 const say=(text:string)=>f.app.inject({method:'POST',url:'/customer/assistant/v1/message',headers,payload:{...session,requestId:randomUUID(),text}});
 for(const text of ['nasilsin','nasılsınız','merhaba nasilsin']){const r=await say(text);assert.equal(r.statusCode,200,r.body);assert.match(r.json().reply.body,text.startsWith('merhaba')?/Salam!/:/yaxşıyam|well|хорошо/);assert.doesNotMatch(r.json().reply.body,/başa düşmədim/);}
 let out=(await say('anbarda mehsullarimin siyahisini ver')).json(),reads=0;
 while(out.task){assert.ok(['catalogue','overview'].includes(out.task.name));reads++;const value=out.task.name==='catalogue'?{products:[{id:'cola',name:'Cola',unit:'ədəd'}],warehouses:[{id:'w',name:'Əsas'}],homeWarehouseId:'w',version:1}:{warehouse:{id:'w',name:'Əsas'},products:[{id:'cola',name:'Cola',unit:'ədəd',qtyMilli:5000}],readAt:new Date().toISOString()};const r=await f.app.inject({method:'POST',url:'/customer/assistant/v1/result',headers,payload:{...session,requestId:out.requestId,taskId:out.task.id,outcome:{value}}});assert.equal(r.statusCode,200,r.body);out=r.json();}
 assert.equal(reads,2);assert.match(out.reply.body,/Cola: 5 ədəd/);assert.doesNotMatch(out.reply.body,/daxil olun/);
 const other=await say('menim satislarim');assert.equal(other.statusCode,200,other.body);assert.match(other.json().reply.body,/artıq daxil olmusunuz/);assert.equal(other.json().reply.reply.needLogin,false);
 const deleted=await say('butun masalarimi sil');assert.equal(deleted.statusCode,200);assert.equal(deleted.json().task,undefined);assert.match(deleted.json().reply.body,/silinməyib/);
 const guest=(await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',payload:{protocol:1,surface:'site'}})).json();const blocked=await f.app.inject({method:'POST',url:'/customer/assistant/v1/message',payload:{...guest,requestId:randomUUID(),text:'anbarda mehsullarimin siyahisini ver'}});assert.equal(blocked.statusCode,200);assert.match(blocked.json().reply.body,/daxil olun/);assert.doesNotMatch(blocked.json().reply.body,/Cola: 5/);
 }finally{await f.app.close();}
});

test('new desktop table actions survive route JSONB continuation; old and site capabilities stay gated',async()=>{
 const f=fixture(true);await f.app.register(centralAssistantRoutes);
 try{
  const headers={'x-fixture-owner':'fixture',authorization:'Bearer fixture','x-pos-device':f.target.id,'x-pos-actor':'usr-admin'};
  let writes=0;const rows:any[]=[{id:'table-qa',label:'Masa 1',areaId:'hall',seats:4,shape:'square',sortOrder:1,updatedAt:1,orderId:null}];
  const api={tables:{list:async()=>({success:true,data:{assistantLayoutVersion:1,areas:[{id:'hall',nameAz:'Zal'}],tables:structuredClone(rows)}}),assistantArchive:async(p:any)=>{assert.ok(p.idempotencyKey);assert.equal(p.assistantExpectedTables[0].updatedAt,2);writes++;rows.length=0;return{success:true,data:{archivedCount:1}};},assistantUpdate:async()=>{throw Error('Unexpected table update');}}};
  const transport=async(p:any)=>{const url=p.action==='create'?'sessions':p.action;const payload=p.action==='create'?{...p,surface:'restaurant',deviceId:f.target.id,actorId:'usr-admin'}:p;const r=await f.app.inject({method:'POST',url:'/customer/assistant/v1/'+url,headers,payload});assert.equal(r.statusCode,200,r.body);return{success:true,data:r.json()};};
  const chat=createOnlineConversation({api,has:(permission:string)=>permission==='tables.layout',transport});
  assert.match((await chat.send('masa 1 i sil')).body,/1 masa silinəcək/);assert.equal(writes,0);
  rows[0].updatedAt=2;assert.match((await chat.send('confirm')).body,/Yeni planı yoxlayın/);assert.equal(writes,0);
  assert.match((await chat.send('confirm')).body,/1 masa silindi/);await chat.send('confirm');assert.equal(writes,1);
  const site=await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',headers,payload:{protocol:1,surface:'site',tools:['tableLayout','tableApply','tableCreateArea']}});assert.equal(site.statusCode,200,site.body);
  const capabilities=f.sessions.get(site.json().sessionId).state.tools;for(const name of ['tableLayout','tableApply','tableCreateArea'])assert.ok(!capabilities.includes(name));
 }finally{await f.app.close();}
});

test('"Səhv cavab" from the till files a complaint for the admin with the marked answer; only the owner\'s own till may send it',async()=>{const f=fixture(true);await f.app.register(centralAssistantRoutes);
 try{const headers={authorization:'Bearer fixture','x-fixture-owner':'1','x-pos-device':f.target.id};const chatKey=randomUUID();
  const transcript=[{author:'me',body:'1. masa ne qeder isleyib'},{author:'helper',body:'Cəmi 9 masa',reported:true},{author:'me',body:'sağ ol'},{author:'helper',body:'Buyurun'}];
  const ok=await f.app.inject({method:'POST',url:'/customer/assistant/v1/report',headers,payload:{chatKey,language:'az',comment:'masanın pulunu soruşdum',transcript}});assert.equal(ok.statusCode,201);
  assert.equal(f.reports.length,1);assert.match(f.reports[0].reason,/səhv cavab/);assert.equal(f.reports[0].customer,f.owner);
  const bad=f.reports[0].transcript[1];assert.equal(bad.rating,'bad');assert.match(bad.body,/^👎 MÜŞTƏRİ BU CAVABI SƏHV ADLANDIRDI — «masanın pulunu soruşdum»\n\nCəmi 9 masa$/);assert.equal(f.reports[0].transcript[3].rating,undefined);
  await f.app.inject({method:'POST',url:'/customer/assistant/v1/report',headers,payload:{chatKey,transcript:[...transcript,{author:'helper',body:'Yenə səhv',reported:true}]}});assert.equal(f.reports.length,1,'one complaint per conversation, refreshed');
  assert.equal((await f.app.inject({method:'POST',url:'/customer/assistant/v1/report',headers,payload:{chatKey,transcript:[{author:'helper',body:'x'}]}})).statusCode,400);
  assert.equal((await f.app.inject({method:'POST',url:'/customer/assistant/v1/report',headers:{...headers,'x-pos-device':randomUUID()},payload:{chatKey,transcript}})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/customer/assistant/v1/report',payload:{chatKey,transcript}})).statusCode,401);
 }finally{await f.app.close();}});
test('an answer that did not understand files itself once per conversation, with every missed question marked',async()=>{const f=fixture();await f.app.register(centralAssistantRoutes);
 try{const session=(await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',payload:{protocol:1,surface:'site'}})).json();
  const say=(text:string)=>f.app.inject({method:'POST',url:'/customer/assistant/v1/message',payload:{sessionId:session.sessionId,secret:session.secret,requestId:randomUUID(),text}});
  const first=await say('qwzx plimbo');assert.equal(first.statusCode,200);assert.equal(f.reports.length,1);assert.match(f.reports[0].reason,/başa düşmədi/);
  await say('salam');await say('zorblat kvintex');assert.equal(f.reports.length,1);const marked=f.reports[0].transcript.filter((l:any)=>l.rating==='bad');assert.equal(marked.length,2);assert.match(f.reports[0].comment,/«qwzx plimbo».*«zorblat kvintex»/);
 }finally{await f.app.close();}});
