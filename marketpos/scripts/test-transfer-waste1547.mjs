/** 1.5.47 on two real warehouse cores: transfer goods matched by Azerbaijani name, revoke before/after receipt and overtaking its dispatch, Zay documents. */
import {spawn} from 'node:child_process';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),work=await fs.mkdtemp(path.join(os.tmpdir(),'transfer1547-'));let seq=0;
class Rpc{constructor(name,binary){this.pending=new Map();this.ready=new Promise((resolve,reject)=>{this.child=spawn('wine',[binary,'--db',path.join(work,name+'.db'),'--log-dir',path.join(work,name+'-logs'),'--protocol','1'],{stdio:['pipe','pipe','pipe'],env:{...process.env,WINEDEBUG:'-all',POS_SEED_DEMO_MENU:'0'}});let buf='';this.child.stdout.on('data',b=>{buf+=b;let at;while((at=buf.indexOf('\n'))>=0){const raw=buf.slice(0,at);buf=buf.slice(at+1);let msg;try{msg=JSON.parse(raw)}catch{continue}if(msg.event==='core.ready')resolve();const p=this.pending.get(msg.requestId);if(p){this.pending.delete(msg.requestId);p(msg)}}});this.child.on('error',reject);setTimeout(()=>reject(Error(name+' startup timeout')),30000).unref()})}
 async call(action,payload={},key){await this.ready;return new Promise(resolve=>{const requestId='r'+(++seq);this.pending.set(requestId,resolve);this.child.stdin.write(JSON.stringify({requestId,method:'business.call',protocolVersion:1,timestamp:Date.now(),payload:{action,...payload,...(key?{idempotencyKey:key}:{})},actor:{userId:'usr-admin'},terminal:{id:'t',name:'T'}})+'\n')})}
 async m(method,payload={}){await this.ready;return new Promise(resolve=>{const requestId='r'+(++seq);this.pending.set(requestId,resolve);this.child.stdin.write(JSON.stringify({requestId,method,protocolVersion:1,timestamp:Date.now(),payload,actor:{userId:'usr-admin'},terminal:{id:'t',name:'T'}})+'\n')})}
 stop(){this.child.kill()}}
const ok=r=>{assert.equal(r.success,true,JSON.stringify(r.error));return r.data};let k=0;const key=()=>'k'+(++k);
const exe=path.join(root,'restoranpos/native/build/restaurant-pos-core.exe'),A=new Rpc('a',exe),B=new Rpc('b',exe),SD='11111111-1111-4111-8111-111111111111',TD='22222222-2222-4222-8222-222222222222';
// The cloud relay, by hand: one side's outbox events into the other's transfer.sync.
async function relay(from,to,fromDev,toDev,only){const ev=ok(await from.call('transfer.outbox')).events.filter(e=>!only||only(e));for(const e of ev){const r=await to.call('transfer.sync',{event:e.payload,cloudSourceDeviceId:fromDev,cloudTargetDeviceId:toDev},e.id);ok(r);ok(await from.call('transfer.ack',{eventId:e.id}))}return ev.length}
const level=async(core,good,wh)=>((ok(await core.call('stock.snapshot')).levels.find(l=>l.ingredientId===good&&l.warehouseId===wh)||{}).qtyMilli||0);
const doc=async(core,id)=>ok(await core.call('transfer.get',{id}));
async function send(good,qty,wA,wB){const d=ok(await A.call('transfer.save',{fromWarehouseId:wA,toWarehouseId:wB,fromDeviceId:SD,toDeviceId:TD,fromName:'Gənclik',toName:'Nərimanov',revision:0,lines:[{ingredientId:good,qtyMilli:qty}]},key()));return ok(await A.call('transfer.dispatch',{id:d.id},key()))}
try{await Promise.all([A.ready,B.ready]);
 const wA=ok(await A.call('stock.snapshot')).warehouses[0].id,wB=ok(await B.call('stock.snapshot')).warehouses[0].id;
 // 1. No barcode, different capitals: the recipient's own card takes the goods.
 const ga=ok(await A.m('ingredients.save',{name:'ŞƏKƏR tozu',unit:'kg',costMinor:150,salePriceMinor:250}));ok(await A.m('inventory.adjust',{ingredientId:ga.id,qtyDeltaMilli:10000,reason:'Açılış',idempotencyKey:key()}));
 const gb=ok(await B.m('ingredients.save',{name:'şəkər  Tozu',unit:'kg',costMinor:150,salePriceMinor:250}));ok(await B.m('inventory.adjust',{ingredientId:gb.id,qtyDeltaMilli:1000,reason:'Açılış',idempotencyKey:key()}));
 const d1=await send(ga.id,2000,wA,wB);await relay(A,B,SD,TD);const r1=await doc(B,d1.id);assert.equal(r1.lines[0].ingredientId,gb.id,'matched the recipient card by folded name');
 ok(await B.call('transfer.receive',{id:d1.id,lines:r1.lines.map(l=>({id:l.id,acceptedMilli:l.qtyMilli,rejectedMilli:0}))},key()));assert.equal(await level(B,gb.id,wB),3000,'received quantity lands on the existing good');
 await relay(B,A,TD,SD);assert.equal((await doc(A,d1.id)).status,'received');assert.equal(await level(A,ga.id,wA),8000);
 // 2. Revoke before the recipient confirms: back on the sender's shelf, recipient copy cancelled.
 const d2=await send(ga.id,1000,wA,wB);await relay(A,B,SD,TD);assert.equal(await level(A,ga.id,wA),7000);
 const rv=ok(await A.call('transfer.revoke',{id:d2.id},key()));assert.equal(rv.status,'revoke_pending');assert.equal(await level(A,ga.id,wA),8000,'goods back at once');
 await relay(A,B,SD,TD);assert.equal((await doc(B,d2.id)).status,'cancelled');await relay(B,A,TD,SD);assert.equal((await doc(A,d2.id)).status,'cancelled');assert.equal(await level(A,ga.id,wA),8000);assert.equal(await level(B,gb.id,wB),3000);
 // 3. Revoke after the recipient already received: its receipt stands, the goods leave the sender again.
 const d3=await send(ga.id,1000,wA,wB);await relay(A,B,SD,TD);const r3=await doc(B,d3.id);ok(await B.call('transfer.receive',{id:d3.id,lines:r3.lines.map(l=>({id:l.id,acceptedMilli:l.qtyMilli,rejectedMilli:0}))},key()));
 ok(await A.call('transfer.revoke',{id:d3.id},key()));assert.equal(await level(A,ga.id,wA),8000);await relay(A,B,SD,TD);assert.equal((await doc(B,d3.id)).status,'received');
 await relay(B,A,TD,SD);const a3=await doc(A,d3.id);assert.equal(a3.status,'received');assert.equal(await level(A,ga.id,wA),7000,'retaken once');assert.equal(await level(B,gb.id,wB),4000);
 // 4. A revoke that overtakes its dispatch: the late dispatch is dropped.
 const d4=await send(ga.id,500,wA,wB);ok(await A.call('transfer.revoke',{id:d4.id},key()));assert.equal(await level(A,ga.id,wA),7000);
 await relay(A,B,SD,TD,e=>e.payload.kind==='revoke');await relay(A,B,SD,TD);const gone=await B.call('transfer.get',{id:d4.id});assert.equal(gone.success,false,'recipient never shows the revoked dispatch');
 await relay(B,A,TD,SD);assert.equal((await doc(A,d4.id)).status,'cancelled');assert.equal(await level(B,gb.id,wB),4000);
 // 5. Zay documents.
 const z=ok(await A.call('waste.save',{warehouseId:wA,lines:[{ingredientId:ga.id,qtyMilli:2000}],note:'Xarab olub'},key()));assert.match(z.number,/^Z-00001$/);assert.equal(z.totalMinor,300);assert.equal(await level(A,ga.id,wA),5000);
 const z2=ok(await A.call('waste.save',{id:z.id,lines:[{ingredientId:ga.id,qtyMilli:1000}],note:'Xarab olub (düzəliş)'},key()));assert.equal(z2.number,'Z-00001');assert.equal(await level(A,ga.id,wA),6000,'edit counts only the new lines');
 const list=ok(await A.call('waste.list',{})).documents;assert.equal(list.length,1);assert.equal(list[0].lineCount,1);
 let loss=ok(await A.m('reports.stockLoss',{}));assert.equal(loss.rows.filter(r=>r.kind==='waste').reduce((s,r)=>s+r.valueMinor,0),150,'loss report reads the live lines');
 ok(await A.call('waste.delete',{id:z.id},key()));assert.equal(await level(A,ga.id,wA),7000);assert.equal(ok(await A.call('waste.get',{id:z.id})).status,'cancelled');
 loss=ok(await A.m('reports.stockLoss',{}));assert.equal(loss.rows.filter(r=>r.kind==='waste').length,0,'a cancelled Zay is no loss');
 const short=await A.call('waste.save',{warehouseId:wA,lines:[{ingredientId:ga.id,qtyMilli:99000}],note:'x'},key());assert.equal(short.success,false);
 console.log('PASS 1.5.47 real cores: folded-name transfer match, revoke before/after receipt, revoke overtaking dispatch, Zay save/edit/delete and loss report');
}finally{A.stop();B.stop();await fs.rm(work,{recursive:true,force:true})}
