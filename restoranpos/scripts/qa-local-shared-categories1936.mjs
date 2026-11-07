// The real thing, no mock of window.pos: real core over stdio, real preload, real screens, real clicks.
//   node scripts/qa-real-1934.mjs              the whole flow through the UI, on the current bundle
//   node scripts/qa-real-1934.mjs before       data made through the core, order screen of live 1.9.33
import {execFileSync,spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),phase='after',out=path.resolve(root,'../../local-catalog1936');fs.mkdirSync(out,{recursive:true});
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
const ast=ts.createSourceFile('ui.js',source,99,true);for(const n of ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.getStart(ast)>source.indexOf('const container = document.getElementById(\"root\");'))){if(!pre.includes('function '+n.name.text+'('))pre+='\n'+n.getText(ast);}
pre=pre.replace('jsxRuntimeExports.jsx(PsGate, {})','psH(QA)');
const fixture=pre+`\nuseAuthStore.setState({session:{userId:'usr-admin',role:'administrator',authenticated:true,permissions:['inventory.view','inventory.manage','catalog.manage','recipes.manage','settings.manage','cash.manage','cash.accounts','salary.manage','users.manage','order.create','order.send','payment.take']},ready:true});const qp=new URLSearchParams(location.search);function QA(){return qp.get('page')==='order'?psH(PsOriginalOrderPage):qp.get('page')==='costing'?psH(OpsCosting):qp.get('page')==='expenses'?psH(OpsExpenses):qp.get('page')==='salary'?psH(OpsSalary):psH(PsUnifiedCatalog);}clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{path:qp.get('page')==='order'?'/order/:tableId':'*',element:psH(AppShell)}))));`;
const preload=`(()=>{const fakeElectron={contextBridge:{exposeInMainWorld:(k,v)=>{window[k]=v}},ipcRenderer:{invoke:(ch,req)=>ch==='pos:invoke'?window.coreCall(req.method,req.payload??{},req.options??{}):Promise.resolve({success:false,error:{code:'E_QA',message:'not in this test: '+ch}}),on(){},removeListener(){},removeAllListeners(){},send(){}},webFrame:{setZoomFactor(){},setVisualZoomLevelLimits(){}}};const require=n=>{if(n==='electron')return fakeElectron;throw Error('preload require '+n)};const exports={},module={exports};\n${fs.readFileSync(root+'/out/preload/index.js','utf8')}\n})();`;
const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/qa'){res.setHeader('content-type','text/html');return res.end(`<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script src="/preload.js"></script><script type="module" src="/assets/qa.js"></script></body></html>`)}if(u==='/preload.js'){res.setHeader('content-type','text/javascript');return res.end(preload)}if(u==='/assets/qa.js'){res.setHeader('content-type','text/javascript');return res.end(fixture)}const f=u==='/base.css'?root+'/packaged-renderer/assets/index-DFpMFaZu.css':u==='/system.css'?root+'/possistem-system.css':root+'/packaged-renderer'+u;if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('content-type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'application/octet-stream');return res.end(fs.readFileSync(f))}res.statusCode=404;res.end()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
let failNext='';
const open=async(query,hash)=>{const p=await b.newPage({viewport:{width:1536,height:816}});p.setDefaultTimeout(8000);p.errors=[];p.on('pageerror',e=>{p.errors.push(e.message);console.log('PAGEERROR',e.message.slice(0,300))});p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,300))});await p.exposeFunction('coreCall',(m,x,o)=>{if(failNext&&m==='catalog.upsertProduct'&&x.id===failNext){failNext='';return {success:false,error:{message:'Sınaq: bir məhsul saxlanılmadı'}};}return core.call(m,x,o)});await p.goto(`http://127.0.0.1:${server.address().port}/qa?${query}#/${hash}`);await p.waitForTimeout(1200);return p};
const addRow=(p,name)=>p.locator('.ps-catalog-cat',{hasText:name});

try{
 const parent=must(await core.call('catalog.upsertCategory',{nameAz:'İçkilər',sortOrder:1},key())).id;
 const source=must(await core.call('catalog.upsertCategory',{nameAz:'Yeməklər',sortOrder:2},key())).id;
 const product=async(name,price)=>must(await core.call('catalog.upsertProduct',{categoryId:source,nameAz:name,priceMinor:price,barcode:'B-'+randomUUID(),active:true},key())).id;
 const kola=await product('Kola',220),fanta=await product('Fanta',240),su=await product('Su',100);
 const sizes=[];for(const size of[28,30,32])sizes.push(await product('Marqarita · '+size+' sm',size*100));
 // Real stored metadata, recipes and stock linkage are compared after UI moves.
 const snapshot=async id=>{const p=must(await core.call('catalog.product',{productId:id,includeDrafts:true}));delete p.categoryId;delete p.updatedAt;return p};
 const fixtureDb=new DatabaseSync(dir+'/pos.db');
 const stockIds=fixtureDb.prepare('SELECT menu_id,ingredient_id FROM catalog_goods_links').all().filter(r=>[kola,fanta,su,...sizes].includes(r.menu_id));
 for(const link of stockIds)fixtureDb.prepare("INSERT INTO stock_levels(ingredient_id,warehouse_id,qty_milli,updated_at) VALUES(?,'wh-main',7500,1) ON CONFLICT(ingredient_id,warehouse_id) DO UPDATE SET qty_milli=7500").run(link.ingredient_id);
 const stockBefore=stockIds.map(r=>fixtureDb.prepare("SELECT qty_milli FROM stock_levels WHERE ingredient_id=? AND warehouse_id='wh-main'").get(r.ingredient_id));
 const recipesBefore=stockIds.map(r=>fixtureDb.prepare('SELECT ingredient_id,qty_milli FROM menu_item_ingredients WHERE menu_item_id=? ORDER BY ingredient_id').all(r.menu_id));
 fixtureDb.close();
 const snapshots=new Map();for(const id of[kola,fanta,su,...sizes])snapshots.set(id,await snapshot(id));
 const p=await open('page=catalog','admin/catalog');
 assert.equal(await p.locator('.ps-workspace-nav').count(),0,'Duplicate top workspace tabs removed');
 const row=name=>p.locator('.ps-catalog-cat').filter({has:p.locator('.ps-catalog-cat-main',{hasText:name})});
 // Create a sub-category and move two already existing products, with one failed save.
 await row('İçkilər').locator('.ps-catalog-cat-main').click();
 await row('İçkilər').locator('button.ps-kebab').click();await p.getByRole('button',{name:'+ Alt kateqoriya',exact:true}).click();
 let d=p.getByRole('dialog',{name:'Alt kateqoriya yarat'});await d.waitFor();
 await d.getByLabel('Alt kateqoriyanın adı',{exact:true}).fill('Spirtsiz');
 await d.getByRole('checkbox',{name:'Kola',exact:true}).check();await d.getByRole('checkbox',{name:'Fanta',exact:true}).check();
 failNext=fanta;await d.getByRole('button',{name:'Yarat və seçilənləri əlavə et'}).click();await d.getByRole('alert').waitFor();
 const cats=must(await core.call('catalog.categories',{})).categories,child=cats.find(c=>c.nameAz==='Spirtsiz');assert.ok(child&&child.parentId===parent);
 assert.equal(must(await core.call('catalog.product',{productId:kola})).categoryId,child.id);
 assert.equal(must(await core.call('catalog.product',{productId:fanta})).categoryId,source);
 await d.getByRole('button',{name:'Yarat və seçilənləri əlavə et'}).click();await d.waitFor({state:'detached'});
 assert.equal(must(await core.call('catalog.categories',{})).categories.filter(c=>c.nameAz==='Spirtsiz').length,1,'Retry does not duplicate sub-category');
 assert.equal(must(await core.call('catalog.product',{productId:fanta})).categoryId,child.id);
 // Add another prepared product to the selected existing sub-category.
 await p.getByRole('button',{name:'+ Hazır məhsul əlavə et',exact:true}).click();d=p.getByRole('dialog');await d.waitFor();
 await d.getByRole('searchbox',{name:'Hazır məhsul axtar'}).fill('Su');await d.getByRole('checkbox',{name:'Su',exact:true}).check();await d.getByRole('button',{name:'Seçilənləri əlavə et (1)'}).click();await d.waitFor({state:'detached'});
 assert.equal(must(await core.call('catalog.product',{productId:su})).categoryId,child.id);
 // A selected size keeps the native family move rule, with original individual prices.
 await p.getByRole('button',{name:'+ Hazır məhsul əlavə et',exact:true}).click();d=p.getByRole('dialog');await d.waitFor();await d.getByRole('checkbox',{name:'Marqarita · 28 sm',exact:true}).check();await d.getByRole('button',{name:'Seçilənləri əlavə et (1)'}).click();await d.waitFor({state:'detached'});
 for(const id of sizes)assert.equal(must(await core.call('catalog.product',{productId:id})).categoryId,child.id);
 for(const[id,before]of snapshots)assert.deepEqual(await snapshot(id),before,'Price, metadata and identity preserved: '+id);
 const verifyDb=new DatabaseSync(dir+'/pos.db');
 assert.deepEqual(stockIds.map(r=>verifyDb.prepare("SELECT qty_milli FROM stock_levels WHERE ingredient_id=? AND warehouse_id='wh-main'").get(r.ingredient_id)),stockBefore,'Existing stock is preserved');
 assert.deepEqual(stockIds.map(r=>verifyDb.prepare('SELECT ingredient_id,qty_milli FROM menu_item_ingredients WHERE menu_item_id=? ORDER BY ingredient_id').all(r.menu_id)),recipesBefore,'Recipes preserved');verifyDb.close();
 // Both native screens now expose the same categories and linked finished goods.
 const stockCats=must(await core.call('categories.list',{})).categories;
 const mirrorParent=stockCats.find(c=>c.name==='İçkilər'&&!c.parentId),mirrorChild=stockCats.find(c=>c.name==='Spirtsiz'&&c.parentId===mirrorParent?.id);
 assert.ok(mirrorParent&&mirrorChild);const stockGoods=must(await core.call('goods.list',{categoryId:mirrorChild.id})).goods;assert.ok(stockGoods.some(g=>g.name==='Kola'));assert.ok(stockGoods.some(g=>g.name==='Fanta'));
 // Warehouse rename and creation are reflected in menu categories without duplicating the linked rows.
 must(await core.call('categories.save',{id:mirrorChild.id,name:'Soyuq içkilər',parentId:mirrorParent.id}));assert.equal(must(await core.call('catalog.categories',{})).categories.find(c=>c.id===child.id).nameAz,'Soyuq içkilər');
 must(await core.call('catalog.upsertCategory',{id:child.id,nameAz:'Spirtsiz',parentId:parent},key()));
 const stockNew=must(await core.call('categories.save',{name:'Anbarda yaradıldı',parentId:''})).id;assert.ok(must(await core.call('catalog.categories',{})).categories.some(c=>c.nameAz==='Anbarda yaradıldı'));
 must(await core.call('categories.delete',{categoryId:stockNew}));
 await p.getByRole('button',{name:'Anbar kateqoriyaları',exact:true}).click();await p.locator('.ps-cat-name b',{hasText:'Spirtsiz'}).waitFor();assert.ok(await p.locator('.ps-cat-name b',{hasText:'İçkilər'}).count());await p.screenshot({path:out+'/stock-categories-1536.png'});await p.getByRole('button',{name:'Kateqoriyalar',exact:true}).click();await p.getByRole('button',{name:'+ Hazır məhsul əlavə et',exact:true}).waitFor();
  await p.screenshot({path:out+'/catalog-1536.png'});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 for(const[width,height]of[[1536,816],[1366,735],[768,1024],[390,844]]){
  await p.setViewportSize({width,height});await p.getByRole('button',{name:'+ Hazır məhsul əlavə et',exact:true}).click();d=p.getByRole('dialog');await d.waitFor();const box=await d.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=height+1,'Dialog stays in viewport '+width);await d.getByText('Məhsullar yüklənir…',{exact:true}).waitFor({state:'detached'});assert.ok(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'No horizontal scrolling in picker');await p.screenshot({path:out+'/picker-'+width+'.png'});await d.getByRole('button',{name:'Ləğv et',exact:true}).click();await d.waitFor({state:'detached'});
 }
 assert.deepEqual(p.errors,[]);await p.close();
 for(let n=1;n<=13;n++)must(await core.call('catalog.upsertProduct',{categoryId:child.id,nameAz:'Test məhsulu '+String(n).padStart(2,'0')+' — uzun məhsul adı',priceMinor:100+n,active:true},key()));
 must(await core.call('catalog.upsertProduct',{categoryId:child.id,nameAz:'zz Son məhsul',priceMinor:900,active:true},key()));
 for(let n=1;n<=18;n++)must(await core.call('catalog.upsertCategory',{nameAz:'Əlavə kateqoriya '+n,sortOrder:10+n},key()));
 const longCategory=must(await core.call('catalog.upsertCategory',{nameAz:'Çox uzun kateqoriya adı — isti yeməklər və xüsusi sifarişlər',sortOrder:100},key())).id;
 // The real sale screen at the user's display size: compact categories and selling a moved dish.
 const orderPage=await open('page=order','order/tbl-qa');await orderPage.locator('.ps-sale-categories button',{hasText:'İçkilər'}).click();await orderPage.getByRole('button',{name:/Spirtsiz/}).click();await orderPage.getByRole('button',{name:/Kola/}).click();await orderPage.waitForTimeout(400);
 assert.ok(await orderPage.locator('li',{hasText:'Kola'}).count());
 const catsOnScreen=orderPage.locator('.ps-sale-categories>button');assert.equal(await catsOnScreen.count(),21,'All top categories are present, not seven');const a0=await catsOnScreen.nth(0).boundingBox(),a1=await catsOnScreen.nth(1).boundingBox();assert.ok(a1.y>a0.y&&Math.abs(a0.x-a1.x)<1,'Categories remain in the left rail');for(const button of await catsOnScreen.all()){const r=await button.boundingBox();assert.ok(r.height>=40&&r.height<160,'Compact, content-sized category');}const rail=await orderPage.locator('.ps-sale-columns>aside').first().boundingBox();const productsGrid=await orderPage.locator('.ps-sale-products').boundingBox();assert.ok(rail.width<=180&&productsGrid.x>=rail.x+rail.width-1,'Narrow category rail is left of products');assert.equal(await orderPage.locator('.ps-sale-columns>aside').first().getByRole('button',{name:'Aşağı',exact:true}).count(),0,'Category paging removed');
 assert.equal(await orderPage.locator('.ps-workspace-nav').count(),0);assert.ok(await orderPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));console.log('SALE SIZES',await orderPage.evaluate(()=>({width:innerWidth,grid:getComputedStyle(document.querySelector('.ps-sale-columns')).gridTemplateColumns,media:matchMedia('(min-width:1051px) and (max-width:1599px)').matches})));await orderPage.screenshot({path:out+'/sale-1536.png'});assert.deepEqual(orderPage.errors,[]);
 while(!await orderPage.getByRole('button',{name:/zz Son məhsul/}).count()){const next=orderPage.locator('.ps-sale-columns>section').getByRole('button',{name:'Aşağı',exact:true});assert.equal(await next.isDisabled(),false,'Last product stays reachable');await next.click();}await orderPage.getByRole('button',{name:/zz Son məhsul/}).click();await orderPage.locator('li',{hasText:'zz Son məhsul'}).waitFor();
 const longButton=orderPage.locator('.ps-sale-categories>button',{hasText:'Çox uzun kateqoriya adı'});await longButton.scrollIntoViewIfNeeded();assert.ok((await longButton.boundingBox()).height>40,'Long names expand naturally');await longButton.click();assert.equal(await longButton.getAttribute('aria-pressed'),'true');assert.ok(await orderPage.locator('.ps-sale-categories').evaluate(e=>e.scrollHeight>e.clientHeight&&e.scrollTop>0),'Every category remains reachable by scrolling');
 await orderPage.setViewportSize({width:1366,height:735});assert.ok(await orderPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await orderPage.screenshot({path:out+'/sale-1366.png'});await orderPage.close();
 console.log('PASS real core/preload/UI: existing single/multiple products, sub-category creation, partial failure/retry, no duplicate category, size family and metadata preservation, actual sale; 1536×816; all categories in a compact left rail without paging; both category stores and finished goods agree.');
 const pizzas=must(await core.call('catalog.upsertCategory',{nameAz:'Pizzalar'},key())).id;
 const pizza=async(name,priceMinor)=>must(await core.call('catalog.upsertProduct',{categoryId:pizzas,nameAz:name,priceMinor,active:true},key())).id;
 const pizza28=await pizza('Marqarit pizza 28 cm',800),pizza32=await pizza('Pizza 32',1200);
 const catalogPage=await open('page=catalog','admin/catalog');
 await catalogPage.locator('.ps-catalog-cat-main',{hasText:'Pizzalar'}).click();
 for(const name of ['Marqarit pizza 28 cm','Pizza 32'])await catalogPage.locator('.ps-catalog-row',{hasText:name}).getByRole('checkbox').check();
 await catalogPage.getByRole('button',{name:'Ölçüləri birləşdir'}).click();
 d=catalogPage.getByRole('dialog',{name:'Ölçüləri birləşdir'});
 await d.getByLabel('Satışda görünən ad').fill('Marqarit pizza');
 await d.getByLabel('Pizza 32 · ölçü (sm)',{exact:true}).fill('28');
 await d.getByRole('button',{name:'Birləşdir',exact:true}).click();
 await d.getByRole('alert').waitFor();
 await d.getByLabel('Pizza 32 · ölçü (sm)',{exact:true}).fill('32');
 await d.getByRole('button',{name:'Birləşdir',exact:true}).click();
 await d.waitFor({state:'detached'});
 for(const [id,size,price]of[[pizza28,28,800],[pizza32,32,1200]]){
   const item=must(await core.call('catalog.product',{productId:id}));
   assert.equal(item.nameAz,'Marqarit pizza · '+size+' sm');
   assert.equal(item.priceMinor,price);
 }
 await catalogPage.getByRole('button',{name:'Mallar və xammal',exact:true}).click();
 await catalogPage.getByRole('button',{name:'+ Yeni mal',exact:true}).click();
 d=catalogPage.getByRole('dialog',{name:'Yeni mal'});
 await d.getByLabel('Malın adı').fill('Un');
 assert.equal(await d.getByLabel('Satış qiyməti (₼)').count(),0);
 assert.equal(await d.getByLabel('Satışda göstər').isChecked(),false);
 await d.getByRole('button',{name:'Yadda saxla',exact:true}).click();
 await d.waitFor({state:'detached'});
 assert.ok(must(await core.call('goods.list',{})).goods.some(g=>g.name==='Un'));
 await catalogPage.getByRole('button',{name:'Kateqoriyalar',exact:true}).click();
 await catalogPage.getByRole('button',{name:'Anbardan əlavə et',exact:true}).click();
 d=catalogPage.getByRole('dialog',{name:'Menyuya mal əlavə et'});
 await d.getByRole('searchbox',{name:'Anbar malı'}).fill('Un');
 await d.getByRole('button',{name:/^Un/}).click();
 await d.getByLabel('Menyu kateqoriyası',{exact:true}).selectOption(pizzas);
 await d.getByLabel('Satış qiyməti (₼)').fill('2,50');
 await d.getByRole('button',{name:'Menyuya əlavə et',exact:true}).click();
 await d.waitFor({state:'detached'});
 const flour=must(await core.call('goods.list',{})).goods.find(g=>g.name==='Un');
 assert.equal(flour.basePriceMinor,250);
 assert.equal(must(await core.call('catalog.product',{productId:flour.menuItemId})).categoryId,pizzas);
 assert.deepEqual(catalogPage.errors,[]);
 await catalogPage.close();
 const pizzaPage=await open('page=order','order/tbl-qa');
 await pizzaPage.locator('.ps-sale-categories button',{hasText:'Pizzalar'}).click();
 for(const size of [28,32]){
   await pizzaPage.getByRole('button',{name:/Marqarit pizza.*Ölçü seçin/}).click();
   await pizzaPage.getByRole('dialog').getByRole('button',{name:new RegExp(size+' sm')}).click();
   await pizzaPage.locator('li',{hasText:'Marqarit pizza · '+size+' sm'}).waitFor();
 }
 assert.deepEqual(pizzaPage.errors,[]);
 await pizzaPage.close();
 const nested=await product('İç-içə resept sınağı',1200);
 const costingPage=await open('page=costing','admin/inventory');
 const recipesView=costingPage.getByRole('button',{name:'Reseptlər',exact:true});
 const reportView=costingPage.getByRole('button',{name:'Maya və qazanc',exact:true});
 assert.equal(await recipesView.getAttribute('aria-pressed'),'true');
 assert.equal(await costingPage.getByText('Menyu mayası',{exact:true}).count(),0);
 await costingPage.getByRole('searchbox',{name:'Yemək axtar'}).fill('Marqarit pizza');
 await costingPage.getByRole('row',{name:/Marqarit pizza · 28 sm/}).waitFor();
 await costingPage.screenshot({path:out+'/costing-recipes-1102.png'});
 await reportView.click();
 await costingPage.getByText('Menyu mayası',{exact:true}).waitFor();
 await costingPage.getByRole('button',{name:'Bu həftə',exact:true}).click();
 assert.equal(await costingPage.getByRole('button',{name:'Bu həftə',exact:true}).getAttribute('aria-pressed'),'true');
 await costingPage.screenshot({path:out+'/costing-report-1102.png'});
 await recipesView.click();
 assert.equal(await costingPage.getByRole('searchbox',{name:'Yemək axtar'}).inputValue(),'Marqarit pizza');
 await costingPage.getByRole('row',{name:/Marqarit pizza · 28 sm/}).getByRole('button',{name:/Resept/}).click();
 d=costingPage.getByRole('dialog',{name:/Resept.*28 sm/});
 await d.getByRole('button',{name:'+ Yeni xammal'}).click();
 await d.getByPlaceholder('Ad (məs. Pomidor)').fill('Pizza unu');
 await d.getByLabel('Miqdar',{exact:true}).fill('200');
 assert.equal(await d.getByLabel(/Alış:.*istəyə bağlı/).count(),0);
 await d.getByRole('button',{name:'Maya qiymətlərini göstər'}).click();
 assert.equal(await d.getByLabel(/Alış:.*istəyə bağlı/).inputValue(),'');
 await d.getByRole('button',{name:'Maya qiymətlərini gizlət'}).click();
 await d.getByRole('button',{name:'Saxla',exact:true}).click();
 await d.waitFor({state:'detached'});
 const recipe=must(await core.call('recipes.get',{menuItemId:pizza28}));
 assert.ok(recipe.lines.some(line=>line.qtyMilli===200));
 assert.ok(recipe.linkedIngredientId);
 must(await core.call('recipes.save',{menuItemId:nested,lines:[{ingredientId:recipe.linkedIngredientId,qtyMilli:1000}]},key()));
 const byCard=must(await core.call('recipes.get',{menuItemId:nested}));
 assert.equal(byCard.lines.length,0,'a prepared dish saved through its stock card is a recipe part');
 assert.equal(byCard.components[0].menuItemId,pizza28);
 await costingPage.getByRole('checkbox',{name:'Yalnız reseptsiz'}).check();
 assert.equal(await costingPage.getByRole('row',{name:/Marqarit pizza · 28 sm/}).count(),0);
 await costingPage.getByRole('checkbox',{name:'Yalnız reseptsiz'}).uncheck();
 await costingPage.getByRole('searchbox',{name:'Yemək axtar'}).fill('İç-içə resept');
 await costingPage.getByRole('row',{name:/İç-içə resept/}).getByRole('button',{name:/Resept/}).click();
 d=costingPage.getByRole('dialog',{name:/Resept.*İç-içə/});
 const search=d.getByRole('searchbox',{name:'Tərkib axtar'});
 const save=d.getByRole('button',{name:'Saxla',exact:true});
 for(const [width,height] of [[1536,816],[1000,650],[390,844]]) {
  await costingPage.setViewportSize({width,height});
  await search.fill('');
  const before=await d.boundingBox(),button=await save.boundingBox();
  for(const query of ['Pizza unu','nəticə-yoxdur-1103']) {
   await search.fill(query);
   const after=await d.boundingBox(),buttonAfter=await save.boundingBox();
   assert.ok(Math.abs(before.width-after.width)<1);
   assert.ok(Math.abs(button.y-buttonAfter.y)<1);
   const fills=await d.locator('.ps-recipe').evaluate(n=>{const a=n.getBoundingClientRect(),b=n.parentElement.getBoundingClientRect(),c=n.querySelector('.ps-recipe-search').getBoundingClientRect(),padding=parseFloat(getComputedStyle(n.parentElement).paddingLeft);return Math.abs(a.left-b.left-padding)<1&&Math.abs(c.width-a.width)<1;});
   assert.ok(fills,'the recipe keeps its full width and left edge at any result count: '+query+' '+width);
  }
 }
 await d.getByRole('button',{name:'Marqarit pizza · 28 sm reseptini sil'}).click();
 await search.fill('Marqarit pizza');
 await d.getByRole('button',{name:/Marqarit pizza · 28 sm/}).click();
 await d.getByLabel('Marqarit pizza · 28 sm porsiya sayı').fill('2');
 await save.click();
 await d.waitFor({state:'detached'});
 const nestedRecipe=must(await core.call('recipes.get',{menuItemId:nested}));
 assert.equal(nestedRecipe.lines.length,0);
 assert.equal(nestedRecipe.components.length,1);
 assert.equal(nestedRecipe.components[0].menuItemId,pizza28);
 assert.equal(nestedRecipe.components[0].qtyMilli,2000);
 console.log('PASS 1.10.4 UI: a prepared dish picked from the stock list is a recipe part; stable search at 1536, 1000 and 390 px.');
 const month=new Date().toISOString().slice(0,7);
 const accountId=must(await core.call('cashAccounts.list',{})).accounts.find(x=>x.kind==='till').id;
 const worker=must(await core.call('customers.save',{name:'QA İşçi',kind:'employee',salaryMinor:100000},key())).id;
 must(await core.call('salary.pay',{customerId:worker,month,kind:'advance',amountMinor:2000,accountId,note:''},key()));
 must(await core.call('cash.movement',{kind:'expense',amountMinor:500,reason:'Bazarlıq',note:'QA xərc',accountId},key()));
 const expensesPage=await open('page=expenses','admin/inventory');
 const expenseRow=expensesPage.getByRole('row',{name:/QA xərc/});
 await expenseRow.waitFor();
 assert.equal(await expensesPage.getByRole('row',{name:/QA İşçi/}).count(),0,'an advance is not listed under Xərclər');
 assert.equal(await expensesPage.getByRole('button',{name:'Maaş',exact:true}).count(),0);
 await expenseRow.getByRole('button',{name:'Ləğv et'}).click();
 const voidDialog=expensesPage.getByRole('dialog',{name:'Qaiməni ləğv et'});
 const confirm=voidDialog.getByRole('button',{name:'Ləğvi təsdiqlə'});
 assert.equal(await confirm.isDisabled(),true,'a reason comes first');
 await voidDialog.getByLabel('Ləğv səbəbi').fill('QA səhv yazılıb');
 await confirm.click();
 await voidDialog.waitFor({state:'detached'});
 await expenseRow.waitFor({state:'detached'});
 const staffPage=await open('page=salary','admin/inventory');
 const salaryRow=staffPage.getByRole('row',{name:/^Maaş .*QA İşçi/});
 await salaryRow.waitFor();
 await salaryRow.getByRole('button',{name:'Bax',exact:true}).click();
 const detail=staffPage.getByRole('dialog',{name:'Qaimə'});
 await detail.getByText('QA İşçi · avans').first().waitFor().catch(()=>{});
 assert.ok((await detail.innerText()).includes('Məbləğ'),'the view dialog has its content');
 assert.deepEqual([...expensesPage.errors,...staffPage.errors],[]);
 const cashLeft=must(await core.call('cashAccounts.list',{})).accounts.find(x=>x.id===accountId);
 console.log('PASS 1.10.5 UI: cancel and view dialogs have content, an advance is only under İşçilər. Till balance',cashLeft.balanceMinor);
 await costingPage.setViewportSize({width:1000,height:650});
 assert.ok(await costingPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(costingPage.errors,[]);
 await costingPage.close();
 console.log('PASS 1.10.0 UI: merge existing pizzas; select 28/32 sm in sale; save flour without sale price.');
}finally{await b.close();server.close();await core.stop();fs.rmSync(dir,{recursive:true,force:true});}
console.log('screens:',out);
