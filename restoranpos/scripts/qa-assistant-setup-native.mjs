// Existing NEWEST core, isolated DB. No compile, deployment, customer mutation or sale.
import vm from'node:vm';import {spawn}from'node:child_process';import fs from'node:fs';import os from'node:os';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';import{createOnlineConversation}from'../support/online.mjs';import{advance,newDocument}from'../../platform/apps/api/src/lib/assistant/central-engine.mjs';
const dir=fs.mkdtempSync(os.tmpdir()+'/possistem-setup-qa-');fs.mkdirSync(dir+'/logs');const z=p=>'Z:'+p.replaceAll('/','\\');const child=spawn('./native/build/restaurant-pos-core',['--db',z(dir+'/qa.db'),'--log-dir',z(dir+'/logs'),'--protocol','1'],{stdio:['pipe','pipe','ignore']});
let buffer='',resolveReady,rejectReady;const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j});const waiting=new Map();const startTimer=setTimeout(()=>rejectReady(Error('Core ready timeout')),45000);
child.stdout.on('data',d=>{buffer+=d;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const r=JSON.parse(line);if(r.event==='core.ready'){clearTimeout(startTimer);resolveReady()}const pending=waiting.get(r.requestId);if(pending){clearTimeout(pending.timer);waiting.delete(r.requestId);pending.resolve(r)}}catch{}}});child.on('exit',code=>{rejectReady(Error('Core exit '+code));for(const w of waiting.values()){clearTimeout(w.timer);w.reject(Error('Core exited'))}});
const call=(method,payload={},options={})=>new Promise((resolve,reject)=>{const requestId=randomUUID(),timer=setTimeout(()=>{waiting.delete(requestId);reject(Error(method+' timeout'))},20000);waiting.set(requestId,{resolve,reject,timer});child.stdin.write(JSON.stringify({requestId,method,protocolVersion:1,timestamp:Date.now(),actor:{userId:'usr-admin'},idempotencyKey:options.idempotencyKey||randomUUID(),payload})+'\n')});
const data=async(method,payload={})=>{const r=await call(method,payload);assert.equal(r.success,true,JSON.stringify(r.error));return r.data};
try{
 await ready;
 let api;
 vm.runInNewContext(fs.readFileSync('./out/preload/index.js','utf8'),{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(key,value)=>{if(key==='pos')api=value;}},ipcRenderer:{invoke:(channel,input)=>{assert.equal(channel,'pos:invoke');return call(input.method,input.payload,input.options);},on(){},removeListener(){},send(){}}};},console,setTimeout,clearTimeout});
 assert.ok(api.products?.list,'Acceptance must exercise the real preload, not an invented api.catalog');
 const jsonb=value=>JSON.parse(JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort((a,b)=>a.length-b.length||a.localeCompare(b)).map(k=>[k,v[k]])):v));

 let document;const transport=async p=>{if(p.action==='create'){document=newDocument({surface:'restaurant',tools:p.tools,permissions:p.permissions});return{success:true,data:{sessionId:randomUUID(),secret:'qa-session-secret'}};}const event=p.action==='message'?{type:'message',requestId:p.requestId,text:p.text}:{type:'result',requestId:p.requestId,taskId:p.taskId,outcome:p.outcome};const out=await advance(jsonb(document),event,{revision:1,help:async()=>({id:'unknown',body:'Hansı işi görək?'})});document=jsonb(out.document);return{success:true,data:out.result};};let chat=createOnlineConversation({api,has:()=>true,transport});const send=async input=>{const r=await chat.send(input);console.log(input+' -> '+r.body.slice(0,140));return r};
 const named=await send('anbarda kalkulasiya yarat adi lahmacun olsun');assert.match(named.body,/lahmacun/);assert.doesNotMatch(named.body,/“anbarda”/);
 await send('kalkulasiya yarat');await send('yeni mehsul yarat');await send('setup:raw');await send('QA Lahmacun');await send('ədəd');
 assert.equal((await data('ingredients.list')).ingredients.filter(p=>p.name==='QA Lahmacun').length,0);
 const createdMaterial=await send('Təsdiq et');assert.match(createdMaterial.body,/QA Lahmacun yaradıldı/);assert.match(createdMaterial.body,/hansı menyu/);assert.doesNotMatch(createdMaterial.body,/undefined|Cannot read/);
 await send('Təsdiq et');assert.equal((await data('ingredients.list')).ingredients.filter(p=>p.name==='QA Lahmacun').length,1);await send('cancel');
 await send('yeni mehsul yarat');await send('setup:raw');await send('QA Un');await send('setup:unit:kg');await send('confirm');
 let goods=(await data('ingredients.list')).ingredients;const flour=goods.find(p=>p.name==='QA Un');assert.ok(flour);assert.equal(flour.unit,'kg');
 await data('catalog.upsertCategory',{nameAz:'QA Yeməklər'});
 const categories=(await data('catalog.categories')).categories;assert.ok(categories.length);
 await send('yeni mehsul yarat');await send('setup:menu');await send('QA Pizza');await send('setup:category:'+categories[0].id);await send('12,50');await send('confirm');
 const menu=(await data('catalog.products')).products;const pizza=menu.find(p=>p.nameAz==='QA Pizza');assert.ok(pizza);assert.equal(pizza.priceMinor,1250);
 const generic=await send('yeni kalkulasiya mehsulu yarat mene');assert.match(generic.body,/hansı menyu/);assert.doesNotMatch(generic.body,/yeni.*tapmadım/);await send('cancel');
 await send('QA Pizza üçün kalkulyasiya yarat');await send('QA Un');await send('250 qram');await send('setup:review');document.revision=0;const refreshedRecipe=await send('confirm');assert.match(refreshedRecipe.body,/yenidən yoxlayın/);const saved=await send('confirm');assert.match(saved.body,/Kalkulyasiya saxlanıldı/);
 const recipe=await data('recipes.get',{menuItemId:pizza.id});assert.deepEqual(recipe.lines.map(l=>[l.ingredientId,l.qtyMilli]),[[flour.id,250]]);assert.equal(recipe.components.length,0);
 const wh=(await data('warehouses.list')).warehouses[0];const levels=(await data('inventory.levels',{warehouseId:wh.id})).levels;assert.equal(levels.find(p=>p.id===flour.id).qtyMilli,0);
 await send('confirm');assert.equal((await data('catalog.products')).products.filter(p=>p.nameAz==='QA Pizza').length,1);
 const capability=(await data('ingredients.list')).assistantToolsVersion;
 if(process.env.REQUIRE_PROTECTED_ASSISTANT==='1')assert.equal(capability,1,'Release must enable protected assistant writes');
 if(capability>=1){
  await send('QA Un 20 kq artir');await send('QA faktiki sayım');const applied=await send('confirm');assert.match(applied.body,/saxlanıldı/);await send('confirm');
  let fresh=(await data('inventory.levels',{warehouseId:wh.id})).levels;assert.equal(fresh.find(p=>p.id===flour.id).qtyMilli,20000);
  await send('QA Un 5 kq artir');await send('QA sayım');await data('inventory.adjust',{ingredientId:flour.id,warehouseId:wh.id,qtyDeltaMilli:1000,reason:'External isolated QA change'});const conflict=await send('confirm');assert.match(conflict.body,/dəyiş|yenidən|expected/i);fresh=(await data('inventory.levels',{warehouseId:wh.id})).levels;assert.equal(fresh.find(p=>p.id===flour.id).qtyMilli,21000);
  await send('QA Un qiymətini 3,25 et');await send('confirm');goods=(await data('ingredients.list')).ingredients;assert.equal(goods.find(p=>p.id===flour.id).salePriceMinor,325);assert.equal(goods.find(p=>p.id===flour.id).unit,'kg');
 }
 await data('tables.upsertArea',{nameAz:'QA Zal'});
 const floor=await data('tables.list');const area=floor.areas.find(a=>a.nameAz==='QA Zal');assert.ok(area);
 await send('zal adinda masa yarat mene');await send('setup:area:'+area.id);await send('4');
 assert.equal((await data('tables.list')).tables.filter(t=>t.label==='zal').length,0);
 assert.match((await send('confirm')).body,/zal yaradıldı/);await send('confirm');
 assert.equal((await data('tables.list')).tables.filter(t=>t.label==='zal'&&t.areaId===area.id).length,1);
 const printerBefore=await data('print.jobs',{limit:10});const printerPreview=await send('printeri test et');assert.match(printerPreview.body,/sınaq çeki|qoşulmuş printer|Qoşulmuş printer/);assert.doesNotMatch(printerPreview.body,/Kataloqdakı printerlər/);await send('cancel');const printerAfter=await data('print.jobs',{limit:10});assert.deepEqual(printerAfter.jobs,printerBefore.jobs,'A printer request without approval must not create a job');
 const inventoryList=await send('anbarda mehsullarimin siyahisini ver');assert.match(inventoryList.body,/QA Un/);assert.doesNotMatch(inventoryList.body,/daxil olun/);
 chat=createOnlineConversation({api,has:()=>true,transport}); // Separate acceptance scenario; production sessions are limited to 50 turns.
 const layout=await data('tables.list');assert.equal(layout.assistantLayoutVersion,1);assert.equal(typeof api.tables.assistantArchive,'function');assert.equal(typeof api.tables.assistantUpdate,'function');
 const target=layout.tables.find(t=>t.label==='zal'&&t.areaId===area.id);assert.ok(target);
 await send('masa zal adini VIP et');assert.equal((await data('tables.list')).tables.find(t=>t.id===target.id).label,'zal');
 assert.match((await send('confirm')).body,/dəyişdirildi/);assert.equal((await data('tables.list')).tables.find(t=>t.id===target.id).label,'VIP');
 await send('masa vip 6 neferlik et');await send('confirm');assert.equal((await data('tables.list')).tables.find(t=>t.id===target.id).seats,6);
 await send('yeni zal yarat');await send('QA Bağ');await send('confirm');const garden=(await data('tables.list')).areas.find(a=>a.nameAz==='QA Bağ');assert.ok(garden);
 await send('masa VIP i basqa zala kecir');let pick=await send('tableops:pick:'+target.id);assert.ok(pick.choices.some(c=>c.value==='tableops:area:'+garden.id));await send('tableops:area:'+garden.id);await send('confirm');assert.equal((await data('tables.list')).tables.find(t=>t.id===target.id).areaId,garden.id);
 const allBefore=(await data('tables.list')).tables;const physical=allBefore.filter(t=>t.areaId!=='area-delivery');assert.ok(physical.length>0);assert.ok(physical.every(t=>!t.orderId));
 assert.match((await send('ne qeder masa qalib')).body,new RegExp('Cəmi '+physical.length+' masa'));
 const preview=await send('butun bos masalari sil');assert.match(preview.body,/masa silinəcək/);assert.equal((await data('tables.list')).tables.length,allBefore.length);
 assert.match((await send('confirm')).body,/silindi/);assert.equal((await data('tables.list')).tables.filter(t=>t.areaId!=='area-delivery').length,0);await send('confirm');assert.equal((await data('tables.list')).tables.filter(t=>t.areaId!=='area-delivery').length,0);
 console.log('PASS: real assembled preload + central transport + native core: raw/menu/recipe creation, stock/price corrections, guarded table rename/seats/move, area creation, accurate table count and atomic bulk archive after confirmation. JSONB replay, stale balance and duplicate confirmations checked. Customer data unchanged. Disposable DB: '+dir+'/qa.db');
}finally{clearTimeout(startTimer);child.stdin.end();child.kill()}
