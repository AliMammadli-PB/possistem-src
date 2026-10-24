/** Run as the PostgreSQL OS user on the control plane after building api-test.cjs.
 * All writes use a connection-local TEMP table cloned from the production schema.
 * No customer commands, devices, licences or balances are modified.
 */
'use strict';
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {randomUUID}=require('node:crypto');
const {deflateRawSync}=require('node:zlib');
const fs=require('node:fs');
const apiRequire=createRequire('/opt/possistem-pos-control/apps/api/package.json');
const databaseRequire=createRequire('/opt/possistem-pos-control/packages/database/package.json');
const Fastify=apiRequire('fastify'),{PgDialect}=apiRequire('drizzle-orm/pg-core');
const postgres=databaseRequire('postgres');
const {drizzle}=apiRequire('drizzle-orm/postgres-js');
const {cloudBranchRoutes}=require(process.argv[2]);
const db=postgres({host:'/var/run/postgresql',database:'possistem_pos_control',username:'postgres',max:1});
const orm=drizzle(db);
const owner='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',source='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222';
let delivered=0,mode='packed',clockAdvance=0;
const originalNow=Date.now;Date.now=()=>originalNow()+clockAdvance;
const devices=[source,target].map(id=>({id,branch_id:randomUUID(),name:id,product:'market',app_version:'1.5.24',last_seen_at:new Date()}));
globalThis.branchTest={grant:null,calls:[],audits:[]};
const dialect=new PgDialect(),app=Fastify(),errors=[];
app.addHook('onRequest',(req,_reply,done)=>{req.log.error=data=>errors.push(data.err.code==='23514'?'23514':data.err.stack);done();});
app.decorate('db',{execute:async q=>{
 const query=dialect.sqlToQuery(q);
 if(query.sql.includes('FROM devices d JOIN licenses')){assert.equal(query.params[0],owner);return devices;}
 if(query.sql.includes('SELECT status,result,error')){
  const command=(await db`SELECT id,status,payload FROM market_pos_commands WHERE id=${query.params[0]}::uuid`)[0];
  if(command?.status==='pending'&&(mode==='pending'||mode==='running')){
   if(mode==='running')await db`UPDATE market_pos_commands SET status='running' WHERE id=${command.id}::uuid`;
   clockAdvance=45000;
  }else if(command?.status==='pending'){
   delivered++;
   const results=command.payload.calls.map(c=>({success:true,data:{method:c.method},error:null}));
   const result=mode==='packed'?{z:deflateRawSync(Buffer.from(JSON.stringify(results))).toString('base64')}:mode==='plain'?{results}:mode==='corrupt'?{z:'invalid'}:{results:[]};
   await db`UPDATE market_pos_commands SET status=${mode==='failed'?'failed':mode==='cancelled'?'cancelled':'done'},result=${JSON.stringify(result)}::jsonb,error=${mode==='failed'?'Test command refused':null} WHERE id=${command.id}::uuid`;
  }
 }
 return orm.execute(q);
}});
awaitMain().catch(e=>{console.error(e);process.exitCode=1;});
async function awaitMain(){try{
 await db`CREATE TEMP TABLE market_pos_commands (LIKE public.market_pos_commands INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`;
 // Prove the precise old production defect, then apply the actual migration to the TEMP clone.
 await db`ALTER TABLE market_pos_commands DROP CONSTRAINT market_pos_commands_kind_check`;
 await db`ALTER TABLE market_pos_commands ADD CONSTRAINT market_pos_commands_kind_check CHECK(kind IN ('x_report','z_report'))`;
 await cloudBranchRoutes(app);
 const send=(body)=>app.inject({method:'POST',url:'/tenant/pos/branches/rpc',headers:{authorization:'Bearer owner-A'},payload:{sourceDeviceId:source,deviceId:target,...body}});
 const body=()=>({requestId:randomUUID(),calls:[{method:'goods.list'}]});
 let response=await send(body());assert.equal(response.statusCode,503,'Old schema reproduces the rejected core_batch insert');assert.equal(delivered,0);assert.equal(errors.at(-1),'23514');
 // Avoid BEGIN/COMMIT in the migration, as postgres.js reserves transaction connections separately.
 const migration=fs.readFileSync(process.argv[3],'utf8').replace(/^BEGIN;|^COMMIT;|^SET LOCAL[^;]+;/gm,'');
 await db.unsafe(migration);
 for(const kind of ['x_report','z_report','core_batch'])await db`INSERT INTO market_pos_commands(id,customer_id,device_id,kind,payload) VALUES(${randomUUID()}::uuid,${owner}::uuid,${target}::uuid,${kind},'{}'::jsonb)`;
 await assert.rejects(db`INSERT INTO market_pos_commands(id,customer_id,device_id,kind,payload) VALUES(${randomUUID()}::uuid,${owner}::uuid,${target}::uuid,'system.exec','{}'::jsonb)`,e=>e.code==='23514');
 for(const encoding of ['plain','packed']){
  mode=encoding;const request=body();response=await send(request);assert.equal(response.statusCode,200,response.body+' '+JSON.stringify(errors));assert.equal(response.json().results[0].success,true);
  const count=delivered;response=await send(request);assert.equal(response.statusCode,200,response.body+' '+JSON.stringify(errors));assert.equal(delivered,count,'Same request reads the existing result without re-execution');
  response=await send({...request,calls:[{method:'sales.list'}]});assert.equal(response.statusCode,409);assert.equal(delivered,count,'Request ID cannot be reused for different calls');
 }
 for(const state of ['corrupt','short','failed','cancelled']){
  mode=state;response=await send({...body(),calls:[{method:'inventory.adjust',payload:{ingredientId:'fixture',qtyDeltaMilli:1000}}]});
  assert.equal(response.statusCode,state==='failed'?502:state==='cancelled'?409:503,response.body);assert.equal(response.json().uncertain,true,'Unconfirmed writes keep their request identity');
 }
 for(const state of ['pending','running']){
  mode=state;const request={...body(),calls:[{method:'inventory.adjust',payload:{qtyDeltaMilli:1000}}]};response=await send(request);clockAdvance=0;
  assert.equal(response.statusCode,504,response.body);assert.equal(response.json().uncertain,true);
  const row=(await db`SELECT status FROM market_pos_commands WHERE id=${request.requestId}::uuid`)[0];assert.equal(row.status,state==='pending'?'failed':'running','Never cancel or requeue a mutation already running');
 }
 const foreignId=randomUUID();await db`INSERT INTO market_pos_commands(id,customer_id,device_id,kind,payload) VALUES(${foreignId}::uuid,${randomUUID()}::uuid,${target}::uuid,'core_batch','{}'::jsonb)`;
 response=await send({...body(),requestId:foreignId});assert.equal(response.statusCode,409,'A foreign owner request cannot be replayed');
 const count=delivered;
 devices[1].last_seen_at=new Date(Date.now()-100000);assert.equal((await send(body())).statusCode,409);devices[1].last_seen_at=new Date();
 devices[1].app_version='1.5.18';assert.equal((await send(body())).statusCode,409);devices[1].app_version='1.5.24';
 assert.equal((await send({...body(),deviceId:randomUUID()})).statusCode,403);assert.equal(delivered,count);
 console.log('PASS actual PostgreSQL CHECK regression and actual Market HTTP queue: migration, legacy commands, packed/plain replies, safe replay, conflicting/foreign request IDs, corrupt/short results, failed/cancelled commands, pending/running timeouts, offline/old/foreign tills. TEMP table only.');
}finally{Date.now=originalNow;await app.close();await db.end();}}
