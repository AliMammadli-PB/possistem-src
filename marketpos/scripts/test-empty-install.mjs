/** Fresh, isolated databases only. Never opens an installed customer's storage. */
import {spawn} from 'node:child_process';import {createRequire} from 'node:module';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),{OpsEngine}=require('../electron/ops-engine.cjs'),work=await mkdtemp(path.join(os.tmpdir(),'market-empty-'));
let sequence=0;
class Rpc{constructor(name,binary){this.state='ready';this.pending=new Map();this.child=spawn('wine',[binary,'--db',path.join(work,name+'.db'),'--log-dir',work,'--protocol','1'],{env:{...process.env,WINEDEBUG:'-all',POS_SEED_DEMO_MENU:'0'},stdio:['pipe','pipe','pipe']});let buf='';this.child.stdout.on('data',chunk=>{buf+=chunk;let at;while((at=buf.indexOf('\n'))>=0){const raw=buf.slice(0,at);buf=buf.slice(at+1);let message;try{message=JSON.parse(raw);}catch{continue;}this.pending.get(message.requestId)?.(message);}});this.child.stderr.on('data',()=>{});}
 invoke(method,payload={},options={}){const requestId='empty-'+(++sequence);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('timeout '+method));},30000);this.pending.set(requestId,r=>{clearTimeout(timer);this.pending.delete(requestId);resolve(r);});const o=typeof options==='object'?options:{};this.child.stdin.write(JSON.stringify({requestId,method,payload,protocolVersion:1,timestamp:Date.now(),...(o.actor?{actor:o.actor}:{}),...(o.terminal?{terminal:o.terminal}:{})})+'\n');});}
 async stop(){if(this.child.exitCode!==null)return;const ended=new Promise(r=>this.child.once('exit',r));this.child.stdin.end();await ended;}}
const market=new Rpc('market',path.join(root,'marketpos/native/build/market-pos-core.exe')),ops=new Rpc('ops',path.join(root,'restoranpos/native/build/restaurant-pos-core.exe'));
const check=result=>{assert.equal(result.success,true,JSON.stringify(result.error));return result.data;};
const engine=Object.create(OpsEngine.prototype);let settings={};Object.assign(engine,{core:ops,market,admin:null,busy:{},registers:new Map(),settings:()=>settings,saveSettings:patch=>(settings={...settings,...patch})});
try{
 const state=check(await market.invoke('state.get'));
 for(const key of ['products','sales','registers','warehouses','purchaseOrders','heldCarts'])assert.deepEqual(state[key],[],key+' must start empty');
 for(const key of ['legalName','taxId','phone','address','storeName','defaultRegisterId'])assert.equal(state.settings[key],'',key+' has no fictitious merchant default');
 console.log('Fresh Market native business tables and merchant settings empty.');
 await engine.reconcile();
 const accounts=check(await engine.invoke('cashAccounts.list',{}));
 assert.deepEqual(accounts.accounts,[],'Reconciliation must not create a cash/bank account before setup');
 assert.deepEqual(check(await engine.invoke('goods.list',{})).goods,[]);
 const after=check(await market.invoke('state.get'));
 for(const key of ['products','sales','registers','purchaseOrders','heldCarts'])assert.deepEqual(after[key],[],key+' remains empty after warehouse reconciliation');
 // A real user-created product survives subsequent startup/reconciliation.
 const created=check(await engine.invoke('ingredients.save',{name:'Müştərinin malı',barcode:'4760000000001',unit:'ədəd',costMinor:100,salePriceMinor:150}));
 await engine.reconcile();assert.equal(check(await engine.invoke('goods.list',{})).goods.some(g=>g.id===created.id),true);
 assert.equal(check(await market.invoke('product.list',{activeOnly:true})).length,1);
 console.log('PASS clean native install + actual warehouse reconciliation stays empty; real user data is retained.');
}finally{clearTimeout(engine.catalogTimer);clearInterval(engine.timer);await Promise.allSettled([market.stop(),ops.stop()]);await rm(work,{recursive:true,force:true});}
