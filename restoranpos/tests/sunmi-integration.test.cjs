'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {SunmiClient,serialize,documentUuid,OPERATIONS}=require('../integrations/sunmi/protocol.cjs');
const {buildReceipt,allocate,quantityType,barcodeType}=require('../integrations/sunmi/receipt.cjs');
const {createSunmiService}=require('../integrations/sunmi/service.cjs');
const info={cashregister_factory_number:'REAL-FIXTURE-DEVICE',qr_code_url:'https://monitoring.e-kassa.gov.az/#/index?doc=',object_name:'Sınaq'};
const base={endpoint:'127.0.0.1:5544',username:'fixture-user',password:'fixture-password'};
const snapshot=(id='sale:one')=>({id,kind:'sale',totalMinor:248,serviceMinor:0,cashierName:'Əli',createdAt:2000,items:[{lineId:'one',name:'Çörək',productId:'p1',barcode:'2000000000015',unit:'ədəd',quantityMilli:1000,lineTotalMinor:248,purchasePriceMinor:80}],payment:{cashMinor:248}});
function fixture({call,rows=[snapshot()],finish}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'possistem-sunmi-test-'));let activeRoot=root;const sent=[],completed=[];
 const source={pending:async since=>rows.filter(x=>x.createdAt>=since&&!completed.includes(x.id)),finish:async(id,status,result)=>{if(finish)await finish(id,status,result);if(status==='success')completed.push(id);}};
 const service=()=>createSunmiService({getRoot:()=>activeRoot,secretBox:{available:()=>true,encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()},source,clock:()=>1000,clientFactory:()=>({call:async(op,data={})=>{sent.push({op,data:structuredClone(data)});if(call){const custom=await call(op,data);if(custom)return custom;}if(op==='getInfo')return {data:info};if(op==='getShiftStatus')return {data:{shift_open:true}};if(op==='toLogin')return {loggedIn:true};return {data:{document_id:'FISCAL-'+data.documentUUID,totalSum:data.items?.reduce((n,x)=>n+x.sum,0)||0}};}})});
 return {root,sent,completed,service,setRoot:r=>{activeRoot=r;},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
async function enable(s){await s.save({...base,vatType:1});await s.connect();await s.save({enabled:true,printLocalCopy:false});}
test('PDF enums, UTF-8 and decimal numeric tokens use the documented values',async()=>{
 assert.equal(quantityType('ədəd'),0);assert.equal(quantityType('kg'),1);assert.equal(barcodeType('2000000000015'),2);assert.equal(barcodeType('1234567890123'),0);
 const payload=buildReceipt(snapshot(),{vatType:1,deviceId:'SUNMI'});const encoded=serialize(payload.data);assert.match(encoded,/"quantity":1\.000/);assert.match(encoded,/"sum":2\.48/);assert.match(encoded,/"purchasePrice":0\.80/);assert.match(encoded,/Çörək/);assert.equal(OPERATIONS.length,21);
 let request;const client=new SunmiClient(base,{transport:async(u,b)=>{request=JSON.parse(b);return {code:'0',data:{document_id:'r',totalSum:2.48}};}});await client.call('sale',payload.data);assert.equal(request.operation,'sale');assert.equal(request.username,base.username);assert.equal(request.data.items[0].salePrice,2.48);
});
test('rounding preserves every qəpik across large totals, discounts and weighted quantities',()=>{
 for(let n=1;n<100;n++)assert.equal(allocate(123456789,[n,77,9]).reduce((a,b)=>a+b,0),123456789);
 const doc=snapshot();doc.totalMinor=1700;doc.payment={cashMinor:700,cardMinor:1000,rrn:'123456789012'};doc.serviceMinor=100;doc.items=[{...doc.items[0],quantityMilli:310,lineTotalMinor:248},{...doc.items[0],lineId:'second',quantityMilli:2000,lineTotalMinor:400}];const out=buildReceipt(doc,{vatType:1,deviceId:'a'});assert.equal(Math.round(out.data.items.reduce((n,x)=>n+x.sum,0)*100),1700);assert.equal(out.data.items[0].quantity,.31);assert.equal(out.data.items.at(-1).codeType,3);
});
test('invalid payment totals, trade-margin costs and fabricated refund quantities are refused',()=>{
 const doc=snapshot();assert.throws(()=>buildReceipt({...doc,payment:{cashMinor:1}},{vatType:1,deviceId:'a'}));delete doc.items[0].purchasePriceMinor;assert.throws(()=>buildReceipt(doc,{vatType:2,deviceId:'a'}));assert.throws(()=>buildReceipt({...doc,kind:'refund',parentId:'sale:missing'},{vatType:1,deviceId:'a'}));
});
test('disabled enrollment never sends historical or new fiscal receipts',async()=>{
 const f=fixture();try{const s=f.service();assert.equal((await s.process()).enabled,false);assert.equal(f.sent.length,0);await s.save({...base,vatType:1});await assert.rejects(()=>s.save({enabled:true}));}finally{f.cleanup();}
});
test('concurrent clicks create a single fiscal document and never expose credentials',async()=>{
 const f=fixture();try{const s=f.service();await enable(s);await Promise.all(Array.from({length:15},()=>s.process()));assert.equal(f.sent.filter(x=>x.op==='sale').length,1);assert.equal(s.history()[0].state,'done');assert.ok(s.history()[0].result.qrData.endsWith(s.history()[0].result.fiscalReceiptId));assert.ok(!JSON.stringify(s.get()).includes(base.password));assert.ok(!JSON.stringify(s.history()).includes(base.password));assert.ok(!fs.readFileSync(path.join(f.root,'sunmi/config.json'),'utf8').includes(base.password));}finally{f.cleanup();}
});
test('a failed local acknowledgement cannot turn fiscal success into a second receipt',async()=>{
 let once=true;const f=fixture({finish:async()=>{if(once){once=false;throw Error('database temporarily unavailable');}}});try{const s=f.service();await enable(s);await assert.rejects(()=>s.process());assert.equal(s.history()[0].state,'done');await f.service().process();assert.equal(f.sent.filter(x=>x.op==='sale').length,1);assert.deepEqual(f.completed,['sale:one']);}finally{f.cleanup();}
});
test('unknown network outcome survives restart with identical UUID and frozen payload',async()=>{
 let count=0;const {SunmiError}=require('../integrations/sunmi/protocol.cjs');const f=fixture({call:async op=>{if(op==='sale'&&++count===1)throw new SunmiError('SUNMI_NETWORK','response lost',{uncertain:true,retryable:true});}});try{let s=f.service();await enable(s);assert.equal((await s.process()).results[0].state,'unknown');s=f.service();await s.process();const calls=f.sent.filter(x=>x.op==='sale');assert.equal(calls.length,2);assert.deepEqual(calls[0].data,calls[1].data);assert.equal(s.history()[0].state,'done');}finally{f.cleanup();}
});
test('device identity changes and credential lock errors never send a sale',async()=>{
 let changed=false;const f=fixture({call:async op=>op==='getInfo'&&changed?{data:{...info,cashregister_factory_number:'OTHER'}}:null});try{const s=f.service();await enable(s);changed=true;await assert.rejects(()=>s.process(),e=>e.code==='SUNMI_DEVICE');assert.equal(f.sent.filter(x=>x.op==='sale').length,0);}finally{f.cleanup();}
 const c=new SunmiClient(base,{transport:async()=>({code:405,message:'pin locked'})});await assert.rejects(()=>c.call('toLogin'),e=>e.code==='SUNMI_405'&&!e.retryable);
});
test('same command key is idempotent, changed body rejected and UUID-less unknown outcome needs review',async()=>{
 const f=fixture();try{const s=f.service();await enable(s);await s.command('deposit',{sum:1,currency:'AZN'},'fixed-command-1');await s.command('deposit',{sum:1,currency:'AZN'},'fixed-command-1');assert.equal(f.sent.filter(x=>x.op==='deposit').length,1);await assert.rejects(()=>s.command('deposit',{sum:2},'fixed-command-1'));}finally{f.cleanup();}
});
test('a tenant switch during the device response never writes its journal to the other tenant',async()=>{
 let switchRoot;const f=fixture({call:async op=>{if(op==='sale')switchRoot();}});try{const other=path.join(f.root,'other');switchRoot=()=>f.setRoot(other);const s=f.service();await enable(s);await s.process();assert.ok(fs.existsSync(path.join(f.root,'sunmi/journal.json')));assert.ok(!fs.existsSync(path.join(other,'sunmi/journal.json')));}finally{f.cleanup();}
});
test('real HTTP transport handles a committed receipt with a lost response without changing identity',async()=>{
 const docs=new Map(),requests=[];let drop=true;const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{requests.push(body);const p=JSON.parse(body);const id=p.data.documentUUID;const exists=docs.has(id);if(!exists)docs.set(id,{document_id:'actual-device-fixture-id',totalSum:2.48});if(drop){drop=false;req.socket.destroy();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({code:exists?'1':'0',data:docs.get(id)}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const c=new SunmiClient({...base,endpoint:'127.0.0.1:'+server.address().port});const data=buildReceipt(snapshot(),{vatType:1,deviceId:'device'}).data;await assert.rejects(()=>c.call('sale',data),e=>e.uncertain);const result=await c.call('sale',data);assert.equal(result.duplicate,true);assert.equal(docs.size,1);assert.equal(requests[0],requests[1]);}finally{await new Promise(r=>server.close(r));}
});

test('per-product tax overrides do not confuse VAT-free with zero-rate VAT',()=>{const d=snapshot();const result=buildReceipt(d,{vatType:1,deviceId:'device',vatOverrides:{[d.items[0].barcode]:3}});assert.equal(result.data.items[0].vatType,3);});
test('drawer failure never undoes an issued fiscal document and a retry does not open it twice',async()=>{const{SunmiError}=require('../integrations/sunmi/protocol.cjs');const f=fixture({call:async op=>{if(op==='openCashbox')throw new SunmiError('SUNMI_999','drawer unavailable');}});try{const s=f.service();await enable(s);await s.save({enabled:true,openCashDrawer:true});await s.process();await s.process();assert.equal(s.history()[0].state,'done');assert.ok(s.history()[0].drawerWarning);assert.equal(f.sent.filter(x=>x.op==='openCashbox').length,1);assert.equal(f.sent.filter(x=>x.op==='sale').length,1);}finally{f.cleanup();}});
test('cashier and untrusted frames cannot configure a device or bypass local sale documents',async()=>{const{registerSunmi}=require('../integrations/sunmi/electron.cjs');const handlers=new Map();let role='cashier',stop;const f=fixture();try{registerSunmi({ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},app:{once:(_,fn)=>stop=fn},safeStorage:{isEncryptionAvailable:()=>true},assertTrusted:event=>{if(!event.trusted)throw Error('untrusted');},actor:()=>({id:'u1',role}),invoke:async()=>({success:true,data:[]}),getDbPath:()=>path.join(f.root,'pos.db')});const call=handlers.get('possistem:sunmi');await assert.rejects(()=>call({trusted:false},{action:'get'}));await assert.rejects(()=>call({trusted:true},{action:'save',data:base}));role='manager';assert.equal((await call({trusted:true},{action:'command',operation:'sale'})).error.code,'SUNMI_ACTION');}finally{stop?.();f.cleanup();}});

test('a failed native settings save cannot enable automatic fiscalization',async()=>{const f=fixture();try{const {createSunmiService}=require('../integrations/sunmi/service.cjs');let reject=false;const s=createSunmiService({getRoot:()=>f.root,secretBox:{available:()=>true,encrypt:x=>x,decrypt:x=>x},source:{},beforeSave:async()=>{if(reject)throw Error('database write failed');}});await s.save({...base,vatType:1});reject=true;await assert.rejects(()=>s.save({printLocalCopy:true}));assert.equal(s.get().printLocalCopy,false);assert.equal(s.get().enabled,false);}finally{f.cleanup();}});
test('cumulative refund limits survive a full recent-history window and reject duplicate parent rows',async()=>{
 const rows=[snapshot()],f=fixture({rows});try{const s=f.service();await enable(s);await s.process();
 const refund=(id,quantity,total)=>({...snapshot(id),kind:'refund',parentId:'sale:one',items:[{...snapshot().items[0],quantityMilli:quantity,lineTotalMinor:total}],totalMinor:total,payment:{cashMinor:total}});
 rows.push(refund('refund:first',600,149));await s.process();assert.equal(s.documentStatus('refund:first').state,'done');
 for(let i=0;i<105;i++)rows.push(snapshot('sale:later'+i));await s.process();assert.ok(!s.history().some(j=>j.id==='refund:first'));
 rows.push(refund('refund:too-much',500,124));await f.service().process();assert.equal(s.documentStatus('refund:too-much').error.code,'SUNMI_REFUND_LIMIT');
 const dup=refund('refund:duplicates',250,100);dup.items.push({...dup.items[0]});rows.push(dup);await s.process();assert.equal(s.documentStatus(dup.id).error.code,'SUNMI_REFUND_LIMIT');
 assert.equal(f.sent.filter(x=>x.op==='moneyBack').length,1);
 }finally{f.cleanup();}
});

test('every documented operation encodes its envelope without leaking a login token',async()=>{
 const receipt=buildReceipt(snapshot(),{vatType:1,deviceId:'dev'}).data;
 const bodies=[];const client=new SunmiClient(base,{transport:async(_url,body)=>{bodies.push(JSON.parse(body));return {code:0,data:{document_id:'fiscal-fixture',totalSum:2.48,access_token:'never-expose-token'}};}});
 const uuid=documentUuid('commands');
 const payloads={
  openShift:{sum:0,cashierName:'Əli'},closeShift:{documentUUID:uuid,cashierName:'Əli'},deposit:{documentUUID:uuid,sum:1,currency:'AZN'},withDraw:{documentUUID:uuid,sum:1,currency:'AZN'},
  sale:receipt,credit:{...receipt,parentDocumentId:'real-parent',paymentNumber:'1',residue:0,creditContract:'contract'},prepayment:{documentUUID:uuid,sum:2.48,vatType:1,cashPayment:2.48,currency:'AZN'},prepaymentProducts:{...receipt},moneyBack:{...receipt,parentDocumentId:'real-parent',moneyBackType:0,isManual:false},
  correction:{documentUUID:uuid,firstOperationAtUtc:'2026-10-20T10:00:00Z',lastOperationAtUtc:'2026-10-20T11:00:00Z',cashierName:'Əli'},rollBack:{documentUUID:uuid,parentDocumentId:'real-parent',cashierName:'Əli',currency:'AZN'},getPeriodicZReport:{startDate:'20.10.2026 00:00:00',endDate:'21.10.2026 23:59:59'}
 };
 for(const operation of OPERATIONS){const result=await client.call(operation,payloads[operation]||{});if(operation==='toLogin')assert.deepEqual(result,{loggedIn:true});}
 assert.equal(bodies.length,21);for(const body of bodies){assert.equal(body.username,base.username);assert.equal(body.password,base.password);}for(const op of ['openShift','correction','rollBack']){const request=bodies.find(x=>x.operation===op);assert.equal(request.cashierName,'Əli');assert.ok(!request.data.cashierName);}assert.equal(bodies.find(x=>x.operation==='rollBack').currency,'AZN');
});
test('a UUID-less command with a lost response is not automatically repeated',async()=>{const {SunmiError}=require('../integrations/sunmi/protocol.cjs');const f=fixture({call:async op=>{if(op==='openShift')throw new SunmiError('SUNMI_NETWORK','lost response',{uncertain:true});}});try{const s=f.service();await enable(s);await assert.rejects(()=>s.command('openShift',{sum:0},'open-shift-unique'));await assert.rejects(()=>s.command('openShift',{sum:0},'open-shift-unique'),e=>e.code==='SUNMI_REVIEW');assert.equal(f.sent.filter(x=>x.op==='openShift').length,1);}finally{f.cleanup();}});
test('closed shifts leave local receipts pending until the fiscal shift is opened',async()=>{let opened=false;const f=fixture({call:async op=>op==='getShiftStatus'?{data:{shift_open:opened}}:null});try{const s=f.service();await enable(s);await assert.rejects(()=>s.process(),e=>e.code==='SUNMI_503');assert.equal(f.sent.filter(x=>x.op==='sale').length,0);assert.deepEqual(f.completed,[]);opened=true;await s.process();assert.equal(f.sent.filter(x=>x.op==='sale').length,1);}finally{f.cleanup();}});
