/** Real Windows warehouse + till cores in isolated databases. */
import {spawn} from 'node:child_process';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(import.meta.url),{OpsEngine}=require('../electron/ops-engine.cjs'),work=await fs.mkdtemp(path.join(os.tmpdir(),'market-warehouse-'));let seq=0;const before=process.argv.includes('--before');
class Rpc{constructor(name,binary){this.state='ready';this.pending=new Map();this.ready=new Promise((resolve,reject)=>{this.child=spawn('wine',[binary,'--db',path.join(work,name+'.db'),'--log-dir',path.join(work,name+'-logs'),'--protocol','1'],{stdio:['pipe','pipe','pipe'],env:{...process.env,WINEDEBUG:'-all',POS_SEED_DEMO_MENU:'0'}});let buf='';this.child.stdout.on('data',b=>{buf+=b;let at;while((at=buf.indexOf('\n'))>=0){let raw=buf.slice(0,at);buf=buf.slice(at+1);let msg;try{msg=JSON.parse(raw)}catch{continue}if(msg.event==='core.ready')resolve();const p=this.pending.get(msg.requestId);if(p){clearTimeout(p.timer);this.pending.delete(msg.requestId);p.resolve(msg)}}});this.child.stderr.on('data',()=>{});this.child.on('error',reject);setTimeout(()=>reject(Error(name+' startup timeout')),30000).unref()})}async invoke(method,payload={},options={}){await this.ready;return new Promise((resolve,reject)=>{const requestId='bridge-'+(++seq),timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('Timeout '+method))},60000);this.pending.set(requestId,{resolve,timer});const o=typeof options==='object'?options:{};this.child.stdin.write(JSON.stringify({requestId,method,protocolVersion:1,timestamp:Date.now(),payload:o.idempotencyKey?{...payload,idempotencyKey:o.idempotencyKey}:payload,...(o.actor?{actor:o.actor}:{}),...(o.terminal?{terminal:o.terminal}:{})})+'\n')})}async stop(){const ended=new Promise(r=>this.child.once('exit',r));this.child.stdin.end();await ended}}
let market=new Rpc('market','/tmp/market1535-upgrade-old/market-pos-core.exe');let ops=new Rpc('ops','/tmp/market1535-upgrade-old/restaurant-pos-core.exe');const e=Object.create(OpsEngine.prototype);e.core=ops;e.market=market;e.admin=null;e.busy={};e.registers=new Map();let settings={legacyImported:true,links:{},fed:[]};e.settings=()=>settings;e.saveSettings=p=>(settings={...settings,...p});
const check=r=>{assert.equal(r.success,true,JSON.stringify(r.error));return r.data};
try{
 await Promise.all([market.ready,ops.ready]);
 const id=check(await e.invoke('ingredients.save',{name:'Nisyə məhsulu',barcode:'4760001000001',unit:'ədəd',costMinor:50,salePriceMinor:100})).id;settings.links={p1:id};
 check(await market.invoke('state.importLegacy',{role:'manager',snapshot:{schemaVersion:5,warehouses:[{id:'wh-sales',code:'ZAL',name:'Sales',active:true}],registers:[{id:'reg-1',code:'K1',name:'Kassa',status:'open',openingFloatMinor:0,operatorId:'qa',openedAt:Date.now()}],products:[{id:'p1',sku:'SKU1',barcode:'4760001000001',name:{az:'Nisyə məhsulu',ru:'QA',en:'QA'},category:'Digər',unit:'əd',priceMinor:100,costMinor:50,minStock:0,taxRate:18,supplier:'',warehouseStock:{'wh-sales':0},image:{kind:'url',url:''},active:true,createdAt:Date.now()}],settings:{storeName:'QA',legalName:'QA',taxId:'',phone:'',address:'',terminalName:'T1',defaultWarehouseId:'wh-sales',defaultRegisterId:'reg-1',syncUrl:''}}}));
 check(await e.invoke('inventory.adjust',{ingredientId:id,qtyDeltaMilli:10000,reason:'Opening',idempotencyKey:'opening'}));await e.flushCatalog();
 const customer=check(await e.invoke('customers.save',{name:'Nisyə partnyoru',creditAllowed:true,creditLimitMinor:5000})).id;await e.syncCustomers();
 let customers=check(await market.invoke('customer.list'));assert.equal(customers[0].id,customer);assert.equal(customers[0].creditLimitMinor,5000);
 const payment={method:'credit',amountMinor:300,cashMinor:100,cardMinor:0,creditMinor:200,tenderedMinor:100};
 const request={role:'manager',actorId:'qa',cashierId:'qa',registerId:'reg-1',customerId:customer,items:[{productId:'p1',qty:3}],payment,idempotencyKey:'credit-sale'};
 const sale=check(await market.invoke('sale.complete',request));check(await market.invoke('sale.complete',request));assert.equal(check(await market.invoke('customer.list'))[0].balanceMinor,200);
 await e.flushCatalog();await e.flushCatalog();await e.syncCustomers();assert.equal(check(await e.invoke('customers.get',{customerId:customer})).debtMinor,200,'Credit is written once into the shared partner');assert.equal(check(await market.invoke('customer.list'))[0].balanceMinor,200);

 const employee=check(await e.invoke('customers.save',{id:'mstaff-upgrade',_marketStaff:true,name:'Köhnə işçi',kind:'employee',salaryMinor:70000}));
 check(await e.invoke('customers.save',{id:'mstaff-login-only',_marketStaff:true,name:'Login only',kind:'employee',salaryMinor:0}));
 const supplier=check(await e.invoke('suppliers.save',{name:'Köhnə təchizatçı',phone:'0501234567',contact:'Əlaqə',note:'Köhnə qeyd'}));
 await Promise.all([market.stop(),ops.stop()]);
 market=new Rpc('market',path.join(root,'marketpos/native/build/market-pos-core.exe'));
 ops=new Rpc('ops',path.join(root,'restoranpos/native/build/restaurant-pos-core.exe'));
 await Promise.all([market.ready,ops.ready]);e.market=market;e.core=ops;e.admin=null;
 e.staffProfiles=()=>[{id:'upgrade',name:'Dəyişmiş giriş istifadəçisi',salaryMinor:999999,active:false}];
 await e.syncStaff();await e.flushCatalog();await e.syncCustomers();
 assert.equal(check(await market.invoke('customer.list'))[0].balanceMinor,200);
 assert.equal(check(await e.invoke('customers.get',{customerId:customer})).debtMinor,200);
 const person=check(await e.invoke('customers.get',{customerId:'mstaff-upgrade'}));assert.equal(person.name,'Köhnə işçi');assert.equal(person.salaryMinor,70000);
 const cards=check(await e.invoke('customers.list',{})).customers;assert.equal(cards.find(p=>p.id==='mstaff-upgrade').partnerOrigin,'partner','Existing payroll cards remain partners with salary and history intact');
 assert.equal(cards.find(p=>p.id==='mstaff-login-only').partnerOrigin,'market_login','Login-only legacy artifact is separated from real employees');
 const realEmployee=check(await e.invoke('customers.save',{name:'Manual employee',kind:'employee',salaryMinor:80000,partnerManaged:true}));assert.equal(check(await e.invoke('customers.list',{})).customers.find(p=>p.id===realEmployee.id).partnerOrigin,'partner');
 const rejected=await e.invoke('customers.save',{id:'mstaff-new-login',_marketStaff:true,name:'Must not exist',kind:'employee'});assert.equal(rejected.success,false);assert.ok(!check(await e.invoke('customers.list',{})).customers.some(p=>p.id==='mstaff-new-login'));
 const suppliers=check(await e.invoke('suppliers.list',{})).suppliers,old=suppliers.find(s=>s.id===supplier.id);assert.equal(old.phone,'0501234567');assert.equal(old.note,'Köhnə qeyd');assert.equal(old.contact,'Əlaqə');assert.equal(old.companyName,'');
 const history=check(await e.invoke('customers.ledger',{customerId:customer}));assert.ok(history.entries.length>0);
 const nativeHistory=check(await market.invoke('customer.history',{customerId:customer,role:'manager',actorId:'qa'}));assert.equal(nativeHistory.sales.length,1);assert.equal(nativeHistory.sales[0].totalMinor,300);
 console.log('PASS real 1.5.34 -> 1.5.36 upgrade: existing sale, stock link, customer debt, supplier contact/note and independent employee salary retained; new history schema migrated');

}finally{clearTimeout(e.catalogTimer);await Promise.all([market.stop(),ops.stop()]);await fs.rm(work,{recursive:true,force:true});}
