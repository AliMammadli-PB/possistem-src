import test from 'node:test';import assert from 'node:assert/strict';import Fastify from 'fastify';import {PgDialect} from 'drizzle-orm/pg-core';import {centralAssistantRoutes} from './assistant-central.js';import {createHash,randomUUID} from 'node:crypto';
import {allKeysFor} from './pos-permissions.js';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const jsonb=(input:string)=>JSON.parse(input,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort((a,b)=>a.length-b.length||a.localeCompare(b)).map(k=>[k,v[k]])):v);
const dialect=new PgDialect();
function fixture(restaurant=false){const target={id:randomUUID(),name:'Fixture restaurant',product:'restaurant',app_version:'1.10.21',last_seen_at:new Date()};const sessions=new Map<string,any>();let revision=0,entries:any[]=[];const owner=randomUUID();
 const execute=async(q:any)=>{const {sql:s,params:p}=dialect.sqlToQuery(q);
  if(s.includes('DELETE FROM assistant_sessions'))return[];
  if(s.includes('INSERT INTO assistant_sessions')){const [id,customer_id,secret_hash,surface,device_id,actor_id,capabilities,state]=p;sessions.set(String(id),{id,customer_id,secret_hash,surface,device_id,actor_id,capabilities:JSON.parse(String(capabilities)),state:jsonb(String(state))});return[];}
  if(s.includes('FROM assistant_sessions')){const r=sessions.get(String(p[0]));return r&&r.secret_hash===p[1]?[r]:[];}
  if(s.includes('assistant_knowledge_state s'))return[{revision,entries}];
  if(s.includes('UPDATE assistant_sessions SET state')){const r=sessions.get(String(p[2]));r.state=jsonb(String(p[0]));return[];}
  if(s.includes('FROM devices d JOIN licenses'))return restaurant?[target]:[];
  if(s.includes('SELECT active FROM customers'))return[{active:true}];
  throw Error('Unexpected test SQL '+s);
 };const db:any={execute,transaction:async(fn:any)=>fn(db)};const app=Fastify();app.decorate('db',db);app.decorateRequest('user',null);app.decorateRequest('customer',null);app.addHook('preHandler',async req=>{if(req.headers['x-fixture-owner'])req.customer={id:owner,email:'fixture@example.invalid',name:'Fixture',active:true};});
 return{app,sessions,owner,target,setKnowledge:(e:any[])=>{entries=e;revision++;}};
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
  assert.ok(document.state.permissions.length<=9);assert.ok(!document.state.permissions.includes('unknown.future.permission'));
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
