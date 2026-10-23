import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import assert from 'node:assert/strict';import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),api=path.join(root,'../possistem-control-sync/apps/api');const require=createRequire(path.join(api,'package.json'));const Fastify=require('fastify'),{PgDialect}=require('drizzle-orm/pg-core');
const out=path.join(root,'../artifacts/cloud-branches/api-test.cjs');
const mocks={
 './tenant.js':`export const resolveTenantToken=t=>t==='owner-A'?{customerId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}:null;`,
 './access.js':`export const surfaceAccess=async()=>globalThis.branchTest.grant;`,
 '../lib/bot/queue.js':`export const notePortalRpc=()=>{};export const runOnTill=async input=>{globalThis.branchTest.calls.push(input);return {ok:true,result:{results:input.args.calls.map(c=>({success:true,data:{branch:input.deviceId,method:c.method},error:null}))}};};`,
 '../lib/audit.js':`export const writeAudit=async(_app,row)=>globalThis.branchTest.audits.push(row);`,
 '../lib/validate.js':`export const clientIp=()=> '127.0.0.1';`,
};
await build({entryPoints:[path.join(root,'control-plane/api/cloud-branches.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',nodePaths:[path.join(api,'node_modules')],plugins:[{name:'test-ports',setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'stub'}:args.path==='../lib/access-areas.js'?{path:path.join(api,'src/lib/access-areas.ts')}:null);b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
const {cloudBranchRoutes,branchVersionSupported,branchCallKind}=createRequire(import.meta.url)(out);
const source='11111111-1111-4111-8111-111111111111',target='22222222-2222-4222-8222-222222222222',foreign='33333333-3333-4333-8333-333333333333';
globalThis.branchTest={grant:null,calls:[],audits:[]};let devices=[{id:source,branch_id:'aaaaaaaa-1111-4111-8111-111111111111',name:'Gənclik',product:'restaurant',app_version:'1.9.2',last_seen_at:new Date()},{id:target,branch_id:'aaaaaaaa-2222-4222-8222-222222222222',name:'Nərimanov',product:'restaurant',app_version:'1.9.2',last_seen_at:new Date()}];
const commands=new Map();const names=new Map();const dialect=new PgDialect();const tx={execute:async q=>{
 const {sql,params}=dialect.sqlToQuery(q);
 if((sql.includes('SELECT id FROM branches')||sql.includes('SELECT id,name FROM branches'))){
  if(sql.includes('WHERE id='))return {rows:[...names.values()].includes(params[0])?[{id:params[0],name:[...names].find(([,id])=>id===params[0])?.[0]}]:[]};
  const id=names.get(params[1]);return {rows:id&&(!sql.includes('id<>COALESCE')||id!==params[2])?[{id,name:params[1]}]:[]};
 }
 if(sql.includes("SET status='revoked'"))return {rows:devices.filter(d=>d.id===params[0]&&d.id!==params[1]&&Date.now()-new Date(d.last_seen_at).getTime()>90000)};
 if(sql.includes('SELECT id FROM devices WHERE branch_id='))return {rows:devices.filter(d=>d.branch_id===params[0])};
 if(sql.includes('INSERT INTO branches'))names.set(params[2],params[0]);
 if(sql.includes('UPDATE branches SET name=')){for(const [name,id] of names)if(id===params[1]){names.delete(name);names.set(params[0],id);break;}}
 if(sql.includes('UPDATE branches SET active=false'))for(const [name,id] of names)if(id===params[0])names.delete(name);
 return {rows:[]};
}};const app=Fastify();app.setErrorHandler((e,_req,reply)=>{console.error(e);reply.code(500).send({error:e.message})});app.decorate('db',{transaction:async fn=>fn(tx),execute:async q=>{const query=new PgDialect().sqlToQuery(q);if(query.sql.includes('market_pos_commands')){const [id,owner,device,payload]=query.params;assert.equal(owner,'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');assert.equal(device,target);if(query.sql.includes('INSERT INTO')){if(!commands.has(id))commands.set(id,{kind:'core_batch',payload:JSON.parse(payload)});return {rows:[]};}const saved=commands.get(id);if(query.sql.includes('SELECT kind,payload'))return {rows:saved?[saved]:[]};if(query.sql.includes('SELECT status,result,error'))return {rows:[{status:'done',result:{results:saved.payload.calls.map(c=>({success:true,data:{method:c.method}}))}}]};throw Error('Unexpected command SQL');}assert.match(query.sql,/(?:l\.)?customer_id\s*=\s*\$1::uuid/);if(query.sql.includes('SELECT id,name FROM branches'))return {rows:[...names].map(([name,id])=>({id,name}))};assert.equal(query.params[0],'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');return {rows:devices};}});await cloudBranchRoutes(app);
const body={sourceDeviceId:source,deviceId:target,requestId:'44444444-4444-4444-8444-444444444444',calls:[{method:'goods.list',payload:{}}]};
const send=(data=body,token='owner-A')=>app.inject({method:'POST',url:'/tenant/pos/branches/rpc',headers:{authorization:'Bearer '+token},payload:data});
try{
 assert.equal((await send(body,'bad')).statusCode,401);
 const assign=(id,name)=>app.inject({method:'POST',url:'/tenant/pos/branches/location',headers:{authorization:'Bearer owner-A'},payload:{sourceDeviceId:source,deviceId:id,name}});assert.equal((await assign(foreign,'Xarici')).statusCode,403);assert.equal((await assign(target,'Not created')).statusCode,404,'Assignment must never create an object');names.set('Nərimanov','aaaaaaaa-2222-4222-8222-222222222222');const assigned=await assign(target,'Nərimanov');assert.equal(assigned.statusCode,200,assigned.body);const same=await assign(source,'Nərimanov');assert.equal(same.json().branchId,assigned.json().branchId);const byId=await app.inject({method:'POST',url:'/tenant/pos/branches/location',headers:{authorization:'Bearer owner-A'},payload:{sourceDeviceId:source,deviceId:target,branchId:assigned.json().branchId}});assert.equal(byId.statusCode,200,byId.body);const badId=await app.inject({method:'POST',url:'/tenant/pos/branches/location',headers:{authorization:'Bearer owner-A'},payload:{sourceDeviceId:source,deviceId:target,branchId:foreign}});assert.equal(badId.statusCode,404);
 assert.equal((await send({...body,deviceId:foreign})).statusCode,403);assert.equal(branchTest.calls.length,0,'Foreign target is never queued');
 assert.equal((await send({...body,sourceDeviceId:foreign})).statusCode,403);
 devices[1].last_seen_at=new Date(Date.now()-100000);assert.equal((await send()).statusCode,409);assert.equal(branchTest.calls.length,0,'Offline target never receives delayed writes');devices[1].last_seen_at=new Date();
 devices[1].app_version='1.9.1';assert.equal((await send()).statusCode,409);devices[1].app_version='1.9.2';
 assert.equal((await send({...body,calls:[{method:'backup.restore'}]})).statusCode,403);
 assert.equal((await send({...body,calls:[{method:'settings.set',payload:{key:'license.key',value:'bad'}}]})).statusCode,403);
 branchTest.grant=['reports'];assert.equal((await send()).statusCode,403,'Reports-only grant cannot read or mutate stock');branchTest.grant=null;
 const result=await send();assert.equal(result.statusCode,200,result.body);assert.equal(result.json().results[0].data.branch,target);assert.equal(branchTest.calls.at(-1).deviceId,target);
 const assignedBranch=devices[1].branch_id;devices[1].branch_id=null;assert.equal((await send({...body,calls:[{method:'inventory.adjust',payload:{}}]})).statusCode,409);devices[1].branch_id=assignedBranch;
 const write=await send({...body,calls:[{method:'inventory.adjust',payload:{ingredientId:'g',qtyDeltaMilli:1000}}]});assert.equal(write.statusCode,200);assert.equal(branchTest.calls.at(-1).args.calls[0].idempotencyKey,body.requestId+':0');assert.equal(branchTest.audits.at(-1).meta.targetDeviceId,target);assert.equal(branchTest.audits.at(-1).meta.sourceDeviceId,source);
 const list=await app.inject({method:'GET',url:'/tenant/pos/branches?sourceDeviceId='+source,headers:{authorization:'Bearer owner-A'}});assert.equal(list.statusCode,200);assert.equal(list.json().branches.length,2);assert.equal(list.json().branches[0].local,true);
 assert.equal(branchVersionSupported({product:'market',app_version:'1.5.18'}),false);assert.equal(branchVersionSupported({product:'market',app_version:'1.5.19'}),true);assert.equal(branchCallKind({method:'business.call',payload:{action:'branch.summary'}}),'r');assert.equal(branchCallKind({method:'business.call',payload:{action:'unknown'}}),null);
 const transfer={...body,requestId:'55555555-5555-4555-8555-555555555555',calls:[{method:'business.call',payload:{action:'transfer.sync',cloudSourceDeviceId:foreign,cloudTargetDeviceId:foreign,event:{eventId:'event-1',kind:'dispatch',document:{}}}}]};
 devices.forEach(d=>{d.product='market';d.app_version='1.5.29';});devices[1].app_version='1.5.28';assert.equal((await send(transfer)).statusCode,409,'Both transfer peers require1.5.29');assert.equal(commands.size,0);
 devices[1].app_version='1.5.29';const acceptedTransfer=await send(transfer);assert.equal(acceptedTransfer.statusCode,200,acceptedTransfer.body);const queued=commands.get(transfer.requestId).payload.calls[0];assert.equal(queued.payload.cloudSourceDeviceId,source);assert.equal(queued.payload.cloudTargetDeviceId,target);assert.equal((await send(transfer)).statusCode,200);assert.equal(commands.size,1,'Repeated transfer request is queued once');assert.equal((await send({...transfer,calls:[{method:'business.call',payload:{action:'transfer.outbox'}}]})).statusCode,403,'Internal outbox is never remotely callable');
 devices.forEach(d=>{d.product='restaurant';d.app_version='1.9.2';});
 const manage=(operation,token='owner-A')=>app.inject({method:'POST',url:'/tenant/pos/branches/objects',headers:{authorization:'Bearer '+token},payload:{sourceDeviceId:source,...operation}});
 assert.equal((await manage({action:'create',name:'New location'},'bad')).statusCode,401);
 assert.equal((await manage({action:'create',name:'New location',sourceDeviceId:foreign})).statusCode,403);
 const created=await manage({action:'create',name:'New location'});assert.equal(created.statusCode,200,created.body);const objectId=created.json().id;
 assert.equal((await manage({action:'create',name:'New location'})).statusCode,409,'Duplicate object does not silently merge');
 assert.equal((await manage({action:'rename',branchId:foreign,name:'Foreign rename'})).statusCode,404);
 const renamed=await manage({action:'rename',branchId:objectId,name:'Renamed location'});assert.equal(renamed.statusCode,200,renamed.body);assert.equal(names.get('Renamed location'),objectId);
 devices[1].branch_id=objectId;assert.equal((await manage({action:'delete',branchId:objectId})).statusCode,409,'Assigned tills must be moved before object deletion');devices[1].branch_id=assignedBranch;
 assert.equal((await manage({action:'delete',branchId:objectId})).statusCode,200);assert.equal(names.has('Renamed location'),false);
 assert.equal((await manage({action:'renameTill',deviceId:foreign,name:'Foreign till'})).statusCode,403);
 assert.equal((await manage({action:'renameTill',deviceId:target,name:'New till label'})).statusCode,200);
 assert.equal(branchTest.audits.at(-1).action,'owner.object.renameTill');
 assert.equal((await manage({action:'archiveTill',deviceId:foreign})).statusCode,403);
 assert.equal((await manage({action:'archiveTill',deviceId:source})).statusCode,409,'The source POS cannot revoke itself');
 assert.equal((await manage({action:'archiveTill',deviceId:target})).statusCode,409,'An online till cannot be removed');
 devices[1].last_seen_at=new Date(Date.now()-120000);assert.equal((await manage({action:'archiveTill',deviceId:target})).statusCode,200);assert.equal(branchTest.audits.at(-1).action,'owner.object.archiveTill');
 console.log('PASS branch HTTP handlers: owner/source/target isolation, revoked-device exclusion by ownership query, offline/old-version refusal, area permissions, allowlist, target routing, write idempotency, object create/edit/delete, linked-till deletion guards and audit.');
}finally{await app.close();}
