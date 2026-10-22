/** Actual shared native renderer + actual Market hardware IPC; isolated DB and captured transport. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const {registerHardwareIpc}=require('../electron/hardware-ipc.cjs');
const {receiptDocument}=require('../electron/ops-engine.cjs');
const {buildReceiptEscPos,buildTestPage,buildStationTicketEscPos,buildXzReportEscPos}=require('../electron/hardware/printer.js');
const work=await mkdtemp(path.join(os.tmpdir(),'cash-drawer1540-'));
const child=spawn('wine',[path.join(root,'restoranpos/native/build/restaurant-pos-core.exe'),'--db',path.join(work,'ops.db'),'--log-dir',work,'--protocol','1'],{env:{...process.env,WINEDEBUG:'-all',POS_SEED_DEMO_MENU:'0'},stdio:['pipe','pipe','pipe']});
let serial=0,buf='';const pending=new Map();
child.stdout.on('data',chunk=>{buf+=chunk;let at;while((at=buf.indexOf('\n'))>=0){let result;try{result=JSON.parse(buf.slice(0,at));}catch{}buf=buf.slice(at+1);if(result)pending.get(result.requestId)?.(result);}});child.stderr.on('data',()=>{});
function rpc(method,payload={}){const requestId='drawer-'+(++serial);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('timeout '+method));},20000);pending.set(requestId,r=>{clearTimeout(timer);pending.delete(requestId);if(r.success)resolve(r.data);else reject(Error(JSON.stringify(r.error)));});child.stdin.write(JSON.stringify({requestId,method,payload,protocolVersion:1,timestamp:Date.now(),actor:{userId:'usr-admin'}})+'\n');});}
const pulse=Buffer.from([0x1b,0x70,0,0x19,0xfa]),cut=Buffer.from([0x1d,0x56,0]);
function count(bytes){let n=0,at=0;while((at=bytes.indexOf(pulse,at))>=0){n++;at+=pulse.length;}return n;}
const receipt={saleId:'isolated-sale',receiptNo:'TEST-1',storeName:'Test shop',createdAt:Date.now(),registerId:'test-register',cashierId:'test-cashier',totalMinor:1000,tenderedMinor:1000,paymentMethod:'cash',items:[{name:'Test item',qty:1,unitPriceMinor:1000,lineTotalMinor:1000}]};
const captures=[];let failNext=false,layoutFailure=false;
const opsEngine={core:{state:'ready'},invoke:async(method,payload)=>({success:true,data:await rpc(method,payload)}),registerName:async()=> 'Test till',renderReceipt:async r=>{if(layoutFailure)throw Error('isolated layout failure');const data=await rpc('receipt.renderExternal',{document:receiptDocument(r),deliver:false});return {bytes:Buffer.from(data.bytes,'base64')};}};
const handlers=new Map();const provider=registerHardwareIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},app:{isPackaged:true,getPath:()=>work},coreSupervisor:{invoke:async(method,payload)=>{if(method==='printer.list')return {success:true,data:{current:'tcp:127.0.0.1:9100'}};if(method==='printer.send'){if(failNext){failNext=false;return {success:false,error:{code:'E_PRINTER_SEND',message:'offline'}};}captures.push({bytes:Buffer.from(payload.bytes),target:payload.target});return {success:true,data:{bytes:payload.bytes.length,target:payload.target}};}throw Error('unexpected transport '+method);}},assertTrusted:()=>{},requireSession:token=>{assert.equal(token,'test-session');return {id:'test-cashier',role:'cashier'};},requireCorePermission:async()=>{},verifyManagerPin:async()=>false,opsEngine,staffName:()=> 'Cashier'});
const print=r=>handlers.get('market:printer:receipt')({}, {sessionToken:'test-session',receipt:r});
try {
 for(const mode of ['text','raster']){
  await rpc('settings.set',{key:'printer.renderMode',value:mode});
  const rendered=await opsEngine.renderReceipt(receipt);assert.equal(count(rendered.bytes),1);assert.ok(rendered.bytes.lastIndexOf(pulse)>rendered.bytes.lastIndexOf(cut));
 }
 await Promise.all(Array.from({length:8},()=>print(receipt)));
 assert.equal(captures.length,1,'concurrent checkout printing coalesces');assert.equal(count(captures[0].bytes),1);assert.equal(captures[0].target,'tcp:127.0.0.1:9100');
 await rpc('settings.set',{key:'printer.openCashDrawer',value:'0'});
 assert.equal(count((await opsEngine.renderReceipt(receipt)).bytes),0,'explicit disable is honored');
 await rpc('settings.set',{key:'printer.openCashDrawer',value:'1'});
 assert.equal(count((await opsEngine.renderReceipt({...receipt,isReprint:true})).bytes),0,'native reprints never open drawer');
 layoutFailure=true;await rpc('settings.set',{key:'printer.openCashDrawer',value:'0'});await print({...receipt,saleId:'disabled-fallback',receiptNo:'TEST-OFF'});assert.equal(count(captures.pop().bytes),0);await rpc('settings.set',{key:'printer.openCashDrawer',value:'1'});await print({...receipt,saleId:'fallback-sale',receiptNo:'TEST-2'});assert.equal(count(captures[1].bytes),1,'plain fallback also opens drawer');
 failNext=true;await assert.rejects(print({...receipt,saleId:'offline-sale',receiptNo:'TEST-3'}),/offline/);assert.equal(captures.length,2,'no separate drawer command after failed printer send');
 await print({...receipt,saleId:'offline-sale',receiptNo:'TEST-3'});assert.equal(captures.length,3);assert.equal(count(captures[2].bytes),1);
 for(const bytes of [buildTestPage(),buildStationTicketEscPos({items:[]}),buildXzReportEscPos({}),buildReceiptEscPos(receipt,{openCashDrawer:false}),buildReceiptEscPos({...receipt,isReprint:true})])assert.equal(count(bytes),0,'non-receipts/reprints do not open drawer');
 for(const method of ['cash','card','mixed'])assert.equal(count(buildReceiptEscPos({...receipt,paymentMethod:method})),1);
 console.log('PASS actual native text/raster receipt bytes, configured disable, real Market IPC and exact till target, 8-click coalescing, plain fallback, failed-send/retry, no duplicate pulse, no pulse on test/kitchen/report/reprint; all payment methods. Physical hardware was not attached.');
} finally {child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));await rm(work,{recursive:true,force:true});}
