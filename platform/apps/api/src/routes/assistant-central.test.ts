import test from 'node:test';import assert from 'node:assert/strict';import Fastify from 'fastify';import {PgDialect} from 'drizzle-orm/pg-core';import {centralAssistantRoutes} from './assistant-central.js';import {createHash,randomUUID} from 'node:crypto';
const dialect=new PgDialect();
function fixture(){const sessions=new Map<string,any>();let revision=0,entries:any[]=[];const owner=randomUUID();
 const execute=async(q:any)=>{const {sql:s,params:p}=dialect.sqlToQuery(q);
  if(s.includes('DELETE FROM assistant_sessions'))return[];
  if(s.includes('INSERT INTO assistant_sessions')){const [id,customer_id,secret_hash,surface,device_id,actor_id,capabilities,state]=p;sessions.set(String(id),{id,customer_id,secret_hash,surface,device_id,actor_id,capabilities:JSON.parse(String(capabilities)),state:JSON.parse(String(state))});return[];}
  if(s.includes('FROM assistant_sessions')){const r=sessions.get(String(p[0]));return r&&r.secret_hash===p[1]?[r]:[];}
  if(s.includes('assistant_knowledge_state s'))return[{revision,entries}];
  if(s.includes('UPDATE assistant_sessions SET state')){const r=sessions.get(String(p[2]));r.state=JSON.parse(String(p[0]));return[];}
  if(s.includes('FROM devices d JOIN licenses'))return[];
  throw Error('Unexpected test SQL '+s);
 };const db:any={execute,transaction:async(fn:any)=>fn(db)};const app=Fastify();app.decorate('db',db);app.decorateRequest('user',null);app.decorateRequest('customer',null);app.addHook('preHandler',async req=>{if(req.headers['x-fixture-owner'])req.customer={id:owner,email:'fixture@example.invalid',name:'Fixture',active:true};});
 return{app,sessions,owner,setKnowledge:(e:any[])=>{entries=e;revision++;}};
}
test('real route contract: guest isolation, admin denial, same open session learns next request',async()=>{const f=fixture();await f.app.register(centralAssistantRoutes);
 try{const make=await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',payload:{protocol:1,surface:'site'}});assert.equal(make.statusCode,200);const session=make.json();assert.equal(session.secret.length,64);
 const req=(text:string,extra:any={})=>f.app.inject({method:'POST',url:'/customer/assistant/v1/message',payload:{sessionId:session.sessionId,secret:session.secret,requestId:randomUUID(),text},...extra});
 assert.equal((await req('salam')).statusCode,200);
 f.setKnowledge([{id:randomUUID(),language:'az',scope:'both',active:true,patterns:['necesen'],answer:'Yeni sayt cavabı'}]);assert.equal((await req('necesen')).json().reply.body,'Yeni sayt cavabı');
 assert.equal((await req('salam',{headers:{'x-fixture-owner':'other'}})).statusCode,404);
 const bad=await f.app.inject({method:'POST',url:'/customer/assistant/v1/message',payload:{sessionId:session.sessionId,secret:'wrong-secret'.repeat(5),requestId:randomUUID(),text:'salam'}});assert.equal(bad.statusCode,404);
 assert.equal((await f.app.inject('/support/assistant-knowledge')).statusCode,401);
 assert.equal((await f.app.inject({method:'POST',url:'/customer/assistant/v1/sessions',payload:{protocol:1,surface:'restaurant'}})).statusCode,401);
 const doc=f.sessions.get(session.sessionId);assert.notEqual(doc.secret_hash,session.secret);assert.equal(doc.secret_hash,createHash('sha256').update(session.secret).digest('hex'));
 }finally{await f.app.close();}
});
