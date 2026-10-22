'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {kind}=require('../electron/cloud-branches.cjs'),{OpsEngine}=require('../electron/ops-engine.cjs');
const create=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../restoranpos/cloud-branches/transport.js'),'utf8')+';createBranchTransport',{setTimeout,clearTimeout,Date,JSON,Map,Promise});
(async()=>{
 let time=0,count=0,writes=0,value=1,events=0,release;
 const goods=Array.from({length:4229},(_,i)=>({id:'g'+i,name:'Məhsul '+i,qtyMilli:1000}));
 const fail=(code,message)=>({success:false,error:{code,message}});
 const t=create({kind,fail,now:()=>time,changed:()=>events++,rpc:async calls=>{count+=calls.length;return {results:calls.map(c=>{if(c.method==='inventory.adjust'){writes++;value++;return {success:true,data:{}};}return {success:true,data:{value,goods}};})}}});
 let [a,b]=await Promise.all([t.call('goods.list'),t.call('goods.list')]);assert.equal(count,1);a.data.goods[0].name='altered';assert.equal(b.data.goods[0].name,'Məhsul 0');
 for(let i=0;i<12;i++)assert.equal((await t.call('goods.list')).data.value,1);assert.equal(count,1,'Repeated visits reuse the 4229 product read');
 await t.call('inventory.adjust',{qty:1},{idempotencyKey:'same'});assert.equal(writes,1);assert.equal((await t.call('goods.list')).data.value,2);assert.equal(events,1);
 time=60001;await t.call('goods.list');assert.equal(count,4,'Expired snapshot refreshes');t.refresh();await t.call('goods.list');assert.equal(count,5);
 const other=create({kind,fail,rpc:async()=>({results:[{success:true,data:{value:900}}]})});assert.equal((await other.call('goods.list')).data.value,900,'Separate branch has separate cache');
 let attempts=0;const failure=create({kind,fail,rpc:async()=>{attempts++;throw Error('Offline')}});assert.equal((await failure.call('goods.list')).success,false);await failure.call('goods.list');assert.equal(attempts,2,'Errors are not cached');
 // A read begun before a write cannot repopulate a cleared cache after the write.
 let lateCount=0,lateValue=1;
 const late=create({kind,fail,rpc:async calls=>{lateCount++;if(calls[0].method==='goods.list'&&lateCount===1)return await new Promise(r=>release=r);if(calls[0].method==='inventory.adjust')lateValue=2;return {results:calls.map(()=>({success:true,data:{value:lateValue}}))};}});
 const first=late.call('goods.list');await new Promise(r=>setTimeout(r,35));await late.call('inventory.adjust',{});release({results:[{success:true,data:{value:1}}]});assert.equal((await first).data.value,2,'Late pre-write responses never overwrite the refreshed UI');assert.equal((await late.call('goods.list')).data.value,2);
 // Permission polling is always authoritative and excludes the changing login timestamp.
 let stamp=0,perm='inventory.view',sessionEvents=0;
 const session=create({kind,fail,changed:()=>sessionEvents++,rpc:async()=>({results:[{success:true,data:{userId:'u',permissions:[perm],loginAt:++stamp}}]})});await session.call('__session');await session.call('__session');assert.equal(stamp,2);assert.equal(sessionEvents,0);perm='none';await session.call('__session');assert.equal(sessionEvents,1);
 // No full reconciliation on each read or __session. Dirty/error/stale state still waits.
 const engine=Object.create(OpsEngine.prototype);let flushes=0;
 Object.assign(engine,{isHost:()=>true,catalogSyncedAt:Date.now(),invoke:async()=>({success:true,data:{}}),session:async()=>({success:true,data:{}}),flushCatalog:async()=>{flushes++;engine.catalogSyncedAt=Date.now();engine.catalogTimer=null;engine.catalogError=null;},scheduleCatalog:()=>{},flushTransfers:async()=>{}});
 const run=calls=>engine.remoteBatch({calls,expiresAt:Date.now()+30000});await run([{method:'__session'}]);await run([{method:'goods.list'}]);await run([{method:'warehouses.list'}]);assert.equal(flushes,0);
 engine.catalogTimer=1;await run([{method:'goods.list'}]);assert.equal(flushes,1);engine.catalogSyncedAt=0;await run([{method:'goods.list'}]);assert.equal(flushes,2);engine.catalogError='failed';await run([{method:'goods.list'}]);assert.equal(flushes,3);
 console.log('PASS scoped 4229-product cache, deduplication, mutation/expiry/manual invalidation, errors, late replies, session permissions, dirty catalog barriers');
})().catch(e=>{console.error(e);process.exitCode=1;});
