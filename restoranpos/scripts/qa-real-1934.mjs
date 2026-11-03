// The real thing, no mock of window.pos: real core over stdio, real preload, real screens, real clicks.
//   node scripts/qa-real-1934.mjs              the whole flow through the UI, on the current bundle
//   node scripts/qa-real-1934.mjs before       data made through the core, order screen of live 1.9.33
import {execFileSync,spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),phase=process.argv[2]||'after',out=path.join(os.tmpdir(),'qa-real-1934-'+phase);fs.mkdirSync(out,{recursive:true});
const coreExe=path.join(root,'native/build/restaurant-pos-core.exe'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'pos-real-')),z=p=>'Z:'+p.replaceAll('/','\\');
function start(){fs.mkdirSync(dir+'/logs',{recursive:true});const c=spawn('wine',[coreExe,'--db',z(dir+'/pos.db'),'--log-dir',z(dir+'/logs'),'--protocol','1'],{stdio:['pipe','pipe','pipe'],env:{...process.env,WINEDEBUG:'-all'}});let b='',ready;const waiting=new Map(),isReady=new Promise(r=>{ready=r});c.stderr.on('data',()=>{});c.stdout.on('data',d=>{b+=d;let i;while((i=b.indexOf('\n'))>=0){const l=b.slice(0,i).replace(/\r$/,'');b=b.slice(i+1);try{const m=JSON.parse(l);if(m.event==='core.ready')ready();if(m.requestId&&waiting.has(m.requestId)){waiting.get(m.requestId)(m);waiting.delete(m.requestId)}}catch{}}});
 return{ready:isReady,call:(method,payload={},options={})=>new Promise(r=>{const requestId=randomUUID();waiting.set(requestId,r);c.stdin.write(JSON.stringify({requestId,method,protocolVersion:1,timestamp:Date.now(),payload:options?.idempotencyKey?{...payload,idempotencyKey:options.idempotencyKey}:payload,actor:{userId:'usr-admin'}})+'\n')}),stop:()=>new Promise(r=>{c.on('close',r);c.stdin.end()})}}
const must=r=>{assert.equal(r.success,true,JSON.stringify(r.error));return r.data};
let core=start();await core.ready;await core.stop();
const db=new DatabaseSync(dir+'/pos.db');db.exec(`INSERT OR IGNORE INTO restaurant_areas(id,name_az,name_tr,name_en,sort_order,active) VALUES('a','Zal','Zal','Zal',1,1);INSERT OR IGNORE INTO restaurant_tables(id,area_id,label,seats,pos_x,pos_y,sort_order,updated_at) VALUES('tbl-qa','a','5',4,0,0,1,0)`);db.close();
core=start();await core.ready;
const key=()=>({idempotencyKey:randomUUID()});
const terminal=must(await core.call('cashAccounts.list',{})).currentTerminalId;
must(await core.call('cashAccounts.save',{name:'Kassa',kind:'till',terminalId:terminal,objectId:''},key()));
must(await core.call('business.call',{action:'sale.open'},key()));
const source=phase==='before'?execFileSync('git',['show','00ee954:restoranpos/index-DAmHwBc4.js'],{maxBuffer:30e6,encoding:'utf8'}):fs.readFileSync(root+'/index-DAmHwBc4.js','utf8');
let pre=source.slice(0,source.indexOf('const container = document.getElementById("root");'));const tail=source.slice(source.indexOf('function usePsCatalogRefresh('));if(!pre.includes('function usePsCatalogRefresh('))pre+='\n'+tail;
const fixture=pre+`\nuseAuthStore.setState({session:{userId:'usr-admin',role:'administrator',authenticated:true,permissions:['inventory.view','inventory.manage','catalog.manage','settings.manage','cash.manage','cash.accounts','users.manage','order.create','order.send','payment.take']},ready:true});const qp=new URLSearchParams(location.search);function QA(){return qp.get('page')==='order'?psH(PsOriginalOrderPage):psH(PsUnifiedCatalog);}clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{path:qp.get('page')==='order'?'/order/:tableId':'*',element:psH(QA)}))));`;
const preload=`(()=>{const fakeElectron={contextBridge:{exposeInMainWorld:(k,v)=>{window[k]=v}},ipcRenderer:{invoke:(ch,req)=>ch==='pos:invoke'?window.coreCall(req.method,req.payload??{},req.options??{}):Promise.resolve({success:false,error:{code:'E_QA',message:'not in this test: '+ch}}),on(){},removeListener(){},removeAllListeners(){},send(){}},webFrame:{setZoomFactor(){},setVisualZoomLevelLimits(){}}};const require=n=>{if(n==='electron')return fakeElectron;throw Error('preload require '+n)};const exports={},module={exports};\n${fs.readFileSync(root+'/out/preload/index.js','utf8')}\n})();`;
const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/qa'){res.setHeader('content-type','text/html');return res.end(`<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script src="/preload.js"></script><script type="module" src="/assets/qa.js"></script></body></html>`)}if(u==='/preload.js'){res.setHeader('content-type','text/javascript');return res.end(preload)}if(u==='/assets/qa.js'){res.setHeader('content-type','text/javascript');return res.end(fixture)}const f=u==='/base.css'?root+'/packaged-renderer/assets/index-DFpMFaZu.css':u==='/system.css'?root+'/possistem-system.css':root+'/packaged-renderer'+u;if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('content-type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'application/octet-stream');return res.end(fs.readFileSync(f))}res.statusCode=404;res.end()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const open=async(query,hash)=>{const p=await b.newPage({viewport:{width:1366,height:800}});p.errors=[];p.on('pageerror',e=>{p.errors.push(e.message);console.log('PAGEERROR',e.message.slice(0,300))});p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,300))});await p.exposeFunction('coreCall',(m,x,o)=>core.call(m,x,o));await p.goto(`http://127.0.0.1:${server.address().port}/qa?${query}#/${hash}`);await p.waitForTimeout(1200);return p};
const addRow=(p,name)=>p.locator('.ps-catalog-cat',{hasText:name});
try{
 if(phase==='before'){
  const drinks=must(await core.call('catalog.upsertCategory',{nameAz:'İçkilər',sortOrder:1},key())).id,soft=must(await core.call('catalog.upsertCategory',{nameAz:'Spirtsiz',parentId:drinks},key())).id;
  must(await core.call('catalog.upsertProduct',{categoryId:soft,nameAz:'Kola',priceMinor:200,active:true},key()));
  const p=await open('page=order','order/tbl-qa');await p.getByRole('button',{name:/İçkilər/}).first().click();await p.waitForTimeout(600);
  console.log('live 1.9.33, İçkilər emptied into a sub-category: tiles on screen =',await p.locator('.ps-subcat-tile').count());await p.screenshot({path:out+'/order.png'});await p.close();
 }else{
  // Catalog, through the real screens: a category, two sub-categories, a dish that lands in one of them.
  let p=await open('page=catalog','admin/catalog');
  const name=p.locator('.ps-catalog-search').first();
  await name.fill('İçkilər');await p.getByRole('button',{name:'+',exact:true}).first().click();await addRow(p,'İçkilər').waitFor();
  await addRow(p,'İçkilər').locator('.ps-kebab').click();await p.getByRole('button',{name:'+ Alt kateqoriya'}).click();await p.getByText('İçkilər içində alt kateqoriya').waitFor();
  assert.equal(await name.evaluate(e=>e===document.activeElement),true,'the name field takes focus');
  await p.screenshot({path:out+'/sub-create.png'});
  await name.fill('Spirtli');await p.getByRole('button',{name:'+',exact:true}).first().click();await addRow(p,'Spirtli').waitFor();
  assert.equal(await p.getByText('İçkilər içində alt kateqoriya').count(),0,'the parent is cleared after saving');
  await addRow(p,'İçkilər').first().locator('.ps-kebab').click();await p.getByRole('button',{name:'+ Alt kateqoriya'}).click();
  await name.fill('Spirtsiz');await p.getByRole('button',{name:'+',exact:true}).first().click();await addRow(p,'Spirtsiz').waitFor();
  assert.equal(await addRow(p,'Spirtsiz').evaluate(e=>e.classList.contains('is-sub')),true,'indented under its parent');
  // A top-level category made right after is not a child.
  await name.fill('Yemək');await p.getByRole('button',{name:'+',exact:true}).first().click();await addRow(p,'Yemək').waitFor();
  const cats=must(await core.call('catalog.categories',{})).categories;
  const id=n=>cats.find(c=>c.nameAz===n).id;assert.equal(cats.find(c=>c.nameAz==='Spirtli').parentId,id('İçkilər'));assert.equal(cats.find(c=>c.nameAz==='Yemək').parentId,null);
  await addRow(p,'İçkilər').first().click();await p.waitForTimeout(300);
  await p.locator('.ps-catalog-new-btn').first().click();
  const panel=p.locator('.ps-catalog-editor-panel');await panel.locator('input').first().fill('Kola');await panel.locator('input[placeholder="0.00"]').first().fill('2');
  const top=panel.getByLabel('Kateqoriya',{exact:true}),sub=panel.getByLabel('Alt kateqoriya',{exact:true});
  assert.deepEqual((await top.locator('option').allInnerTexts()).map(s=>s.trim()),['İçkilər','Yemək'],'only top-level in the first field');
  assert.deepEqual((await sub.locator('option').allInnerTexts()).map(s=>s.trim()),['Birbaşa İçkilər içində','Spirtli','Spirtsiz']);
  assert.equal(await panel.getByLabel('Menyuda yayımla').isChecked(),true,'a new dish is for sale by default');await sub.selectOption({label:'Spirtsiz'});await p.screenshot({path:out+'/dish-editor.png'});
  await panel.locator('button.ps-catalog-new-btn').last().click();await p.waitForTimeout(600);
  const kola=must(await core.call('catalog.products',{categoryId:id('Spirtsiz')})).products;assert.equal(kola.length,1,'Kola landed in Spirtsiz');assert.deepEqual(p.errors,[]);await p.close();
  must(await core.call('catalog.upsertProduct',{categoryId:id('Spirtli'),nameAz:'Pivə',priceMinor:500,active:true},key()));
  // A table: İçkilər has no products of its own, which is what hid the tiles on 1.9.33.
  assert.equal(must(await core.call('catalog.products',{categoryId:id('İçkilər')})).products.length,0);
  p=await open('page=order','order/tbl-qa');
  assert.equal(await p.locator('.ps-sale-categories button',{hasText:'Spirtli'}).count(),0,'sub-categories stay out of the left list');
  await p.locator('.ps-sale-categories button',{hasText:'İçkilər'}).click();await p.waitForTimeout(500);
  assert.deepEqual((await p.locator('.ps-subcat-name').allInnerTexts()),['Spirtli','Spirtsiz']);await p.screenshot({path:out+'/order-tiles.png'});
  await p.getByRole('button',{name:/Spirtsiz/}).click();await p.getByRole('button',{name:/Kola/}).click();await p.waitForTimeout(600);
  assert.ok(await p.locator('li',{hasText:'Kola'}).count(),'Kola reached the cart');
  const order=must(await core.call('tables.get',{tableId:'tbl-qa'}));assert.ok(order.orderId);assert.equal(must(await core.call('orders.get',{orderId:order.orderId})).items[0].name,'Kola');
  await p.getByRole('button',{name:'← İçkilər'}).click();await p.getByRole('button',{name:/Spirtli/}).click();await p.getByRole('button',{name:/Pivə/}).waitFor();
  // A sub-category with nothing in it still leads back.
  must(await core.call('catalog.upsertCategory',{nameAz:'Qazlı',parentId:id('İçkilər')},key()));await p.reload();await p.waitForTimeout(1200);
  await p.locator('.ps-sale-categories button',{hasText:'İçkilər'}).click();await p.getByRole('button',{name:/Qazlı/}).click();await p.getByRole('button',{name:'← İçkilər'}).waitFor();
  await p.screenshot({path:out+'/order-empty-sub.png'});assert.deepEqual(p.errors,[]);await p.close();
  console.log('PASS real core and screens: sub-categories made in the catalog, dish placed through two fields, İçkilər with no own products opens, cart gets the dish, empty sub-category leads back');
 }
}finally{await b.close();server.close();await core.stop();fs.rmSync(dir,{recursive:true,force:true});}
console.log('screens:',out);
