/** Real Windows warehouse + till cores in isolated databases. */
import {spawn} from 'node:child_process';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(import.meta.url),{OpsEngine}=require('../electron/ops-engine.cjs'),work=await fs.mkdtemp(path.join(os.tmpdir(),'market-warehouse-'));let seq=0;
class Rpc{constructor(name,binary){this.state='ready';this.pending=new Map();this.ready=new Promise((resolve,reject)=>{this.child=spawn('wine',[binary,'--db',path.join(work,name+'.db'),'--log-dir',path.join(work,name+'-logs'),'--protocol','1'],{stdio:['pipe','pipe','pipe'],env:{...process.env,WINEDEBUG:'-all',POS_SEED_DEMO_MENU:'0'}});let buf='';this.child.stdout.on('data',b=>{buf+=b;let at;while((at=buf.indexOf('\n'))>=0){let raw=buf.slice(0,at);buf=buf.slice(at+1);let msg;try{msg=JSON.parse(raw)}catch{continue}if(msg.event==='core.ready')resolve();const p=this.pending.get(msg.requestId);if(p){clearTimeout(p.timer);this.pending.delete(msg.requestId);p.resolve(msg)}}});this.child.stderr.on('data',()=>{});this.child.on('error',reject);setTimeout(()=>reject(Error(name+' startup timeout')),30000).unref()})}async invoke(method,payload={},options={}){await this.ready;return new Promise((resolve,reject)=>{const requestId='bridge-'+(++seq),timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('Timeout '+method))},60000);this.pending.set(requestId,{resolve,timer});const o=typeof options==='object'?options:{};this.child.stdin.write(JSON.stringify({requestId,method,protocolVersion:1,timestamp:Date.now(),payload:o.idempotencyKey?{...payload,idempotencyKey:o.idempotencyKey}:payload,...(o.actor?{actor:o.actor}:{}),...(o.terminal?{terminal:o.terminal}:{})})+'\n')})}async stop(){const ended=new Promise(r=>this.child.once('exit',r));this.child.stdin.end();await ended}}

const {createLabelService,drawLabel,validEan13}=require('../electron/label-printer.cjs');
const {chromium}=await import('@playwright/test');const net=await import('node:net');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),page=await browser.newPage();
const market=new Rpc('market',path.join(root,'marketpos/native/build/market-pos-core.exe')),ops=new Rpc('ops',path.join(root,'restoranpos/native/build/restaurant-pos-core.exe'));
const e=Object.create(OpsEngine.prototype);e.core=ops;e.market=market;e.admin=null;e.busy={};e.registers=new Map();let settings={legacyImported:true,links:{},fed:[]};e.settings=()=>settings;e.saveSettings=p=>(settings={...settings,...p});
const check=r=>{assert.equal(r.success,true,JSON.stringify(r.error));return r.data};let packets=[];
const tcp=net.createServer(socket=>{const chunks=[];socket.on('data',b=>chunks.push(b));socket.on('end',()=>packets.push(Buffer.concat(chunks)))});await new Promise(r=>tcp.listen(0,'127.0.0.1',r));
try{
 await Promise.all([market.ready,ops.ready]);
 check(await market.invoke('state.importLegacy',{role:'manager',snapshot:{schemaVersion:5,products:[],warehouses:[{id:'wh-sales',code:'ZAL',name:'Sales',active:true}],registers:[{id:'reg-1',code:'K1',name:'Kassa',status:'open',openingFloatMinor:0,operatorId:'qa',openedAt:Date.now()}],settings:{storeName:'QA',terminalName:'QA',defaultWarehouseId:'wh-sales',defaultRegisterId:'reg-1',syncUrl:''}}}));
 check(await market.invoke('printer.setTarget',{target:'win:ReceiptQA',role:'manager',actorId:'qa'}));
 const id=check(await e.invoke('ingredients.save',{name:'Barkodsuz məhsul',unit:'ədəd',costMinor:123,salePriceMinor:1750,minQtyMilli:2000,stockDeltaMilli:5000,idempotencyKey:'label-good'})).id;
 await e.flushCatalog();const productId='ops-'+id;
 const before=check(await e.invoke('goods.list',{})).goods.find(g=>g.id===id);assert.equal(before.barcode,'');
 const service=createLabelService({app:{getPath:()=>work},coreSupervisor:market,opsEngine:e,render:d=>page.evaluate(`(${drawLabel.toString()})(${JSON.stringify(d)})`)});
 const generated=await Promise.all(Array.from({length:5},()=>service.generate(productId,{name:'QA'})));
 const barcode=generated[0].barcode;assert.match(barcode,/^[0-9]{13}$/);assert.equal(validEan13(barcode),true);assert.ok(generated.every(p=>p.barcode===barcode));
 const after=check(await e.invoke('goods.list',{})).goods.find(g=>g.id===id);
 for(const k of ['name','costMinor','salePriceMinor','qtyMilli','minQtyMilli','sku'])assert.equal(after[k],before[k],k+' preserved');
 const resolved=check(await market.invoke('barcode.resolve',{barcode}));assert.ok(JSON.stringify(resolved).includes(productId),'generated label resolves to the same good at the till');
 const repeat=await service.generate(productId,{name:'QA'});assert.equal(repeat.barcode,barcode);
 const denied=await market.invoke('auth.checkPermission',{permission:'EDIT_PRODUCT',role:'cashier',actorId:'cashier'});assert.equal(denied.data?.allowed,false);
 const profile={...service.read(),target:'tcp:127.0.0.1:'+tcp.address().port};service.save(profile);
 const preview=await service.preview(productId,profile,'az');assert.ok(preview.image.startsWith('data:image/png'));assert.equal(preview.barcode,barcode);
 await fs.writeFile(path.join(work,'generated.png'),Buffer.from(preview.image.split(',')[1],'base64'));assert.equal(require('node:child_process').execFileSync('zbarimg',['--quiet','--raw',path.join(work,'generated.png')],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(),barcode,'independent decoder reads native-generated 13 digits exactly');
 await Promise.all(Array.from({length:5},()=>service.print(productId,profile,3,'native-label-job','az')));
 for(let n=0;n<100&&!packets.length;n++)await new Promise(r=>setTimeout(r,20));assert.equal(packets.length,1);assert.ok(packets[0].toString('latin1').endsWith('PRINT 1,3\r\n'));
 assert.equal(check(await market.invoke('printer.list',{})).current,'win:ReceiptQA','label setup and printing leave receipt printer unchanged');

 const manual='2001234567893';assert.ok(validEan13(manual));
 const changed=await service.generate(productId,{name:'QA'},{barcode:manual,replaceExisting:true,previousBarcode:barcode});assert.equal(changed.barcode,manual);assert.equal(changed.stock,5);assert.equal(changed.priceMinor,1750);
 assert.equal((await service.generate(productId,{name:'QA'},{barcode:manual,replaceExisting:true,previousBarcode:barcode})).barcode,manual,'manual retry is stable');
 await assert.rejects(()=>service.generate(productId,{name:'QA'},{barcode:'2001234567890',replaceExisting:true,previousBarcode:manual}),/E_LABEL_EAN13/);
 const legacyId=check(await e.invoke('ingredients.save',{name:'Legacy label',unit:'ədəd',barcode:'MP12345678',salePriceMinor:350,costMinor:100})).id;await e.flushCatalog();
 assert.equal((await service.generate('ops-'+legacyId,{name:'QA'})).barcode,'MP12345678','existing codes are not silently replaced');
 const converted=await Promise.all(Array.from({length:5},()=>service.generate('ops-'+legacyId,{name:'QA'},{replaceExisting:true,previousBarcode:'MP12345678'})));
 assert.ok(converted.every(p=>p.barcode===converted[0].barcode));assert.ok(validEan13(converted[0].barcode));
 await assert.rejects(()=>service.generate('ops-'+legacyId,{name:'QA'},{barcode:manual,replaceExisting:true,previousBarcode:converted[0].barcode}),/E_LABEL_DUPLICATE/);
 assert.equal((await service.generate('ops-'+legacyId,{name:'QA'})).barcode,converted[0].barcode,'duplicate barcode rejection preserves the old code');
 await e.invoke('ingredients.deactivate',{ingredientId:id});await e.flushCatalog();await assert.rejects(()=>service.preview(productId,profile,'az'),/E_LABEL_PRODUCT/);
 const archived=await e.invoke('ingredients.save',{id,generateBarcodeOnly:true});assert.equal(archived.success,false,'archived good cannot acquire a new barcode');
 console.log('PASS real native cores: five simultaneous barcode requests save one persistent EAN-13 code, independently decoded; manual replacement, legacy conversion and collision rejection pass; scanner resolves correct product; name, stock, prices and threshold preserved; unauthorized editing refused; one native TCP job / three labels; receipt target unchanged; archived goods blocked.');
}finally{clearTimeout(e.catalogTimer);clearInterval(e.timer);await Promise.allSettled([market.stop(),ops.stop()]);await browser.close();await new Promise(r=>tcp.close(r));await fs.rm(work,{recursive:true,force:true})}
