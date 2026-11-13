// 1.9.33 against the real shipped screens with a stateful mock of window.pos.
//   node scripts/qa-1933.mjs            all scenes on the current bundle, 390-width dialogs and 1366
//   node scripts/qa-1933.mjs before     only the cart scene, on the bundle at 280f90e (live 1.9.32)
import {execFileSync} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),phase=process.argv[2]||'after',out=path.join(os.tmpdir(),'qa1933-'+phase);fs.mkdirSync(out,{recursive:true});
const source=phase==='before'?execFileSync('git',['show','280f90e:restoranpos/index-DAmHwBc4.js'],{maxBuffer:30e6,encoding:'utf8'}):fs.readFileSync(root+'/index-DAmHwBc4.js','utf8');
const base=fs.readFileSync(root+'/scripts/qa-admin-real-pages.mjs','utf8').match(/const mock=`([\s\S]*?)`;\nconst fixture=/)[1];
const mock=base+`;
window.qa={...window.qa,added:[],saved:[],published:[],objects:[],categories:[]};
const dish=(id,categoryId,nameAz,priceMinor,extra={})=>({id,categoryId,nameAz,nameTr:nameAz,nameEn:nameAz,priceMinor,active:1,available:1,soldOut:0,image:'',...extra});
const CATS=[{id:'food',nameAz:'Yemək',parentId:null,itemCount:9,sortOrder:1},{id:'drinks',nameAz:'İçkilər',parentId:null,itemCount:3,sortOrder:2},{id:'strong',nameAz:'Spirtli',parentId:'drinks',itemCount:1,sortOrder:1},{id:'soft',nameAz:'Spirtsiz',parentId:'drinks',itemCount:2,sortOrder:2}];
const DISHES=[dish('a','food','Şorba',300),dish('b','food','Salat',400),dish('c','food','Çay',100),dish('d','food','Kabab',900,{image:'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E'}),
 ...[28,30,32].map((n,i)=>dish('p'+n,'food','Ali Lady Boy · '+n+' sm',1000+i*200)),...[250,500].map((n,i)=>dish('k'+n,'food','Lülə · '+n+' qr',800+i*700)),
 dish('out28','food','Bitmiş · 28 sm',500,{soldOut:1}),dish('out32','food','Bitmiş · 32 sm',600),
 dish('beer','strong','Pivə',500),dish('cola','soft','Kola',200),dish('tea','drinks','Çay stəkan',100)];
const order={id:'o1',orderNumber:'0012',status:'open',items:[],subtotalMinor:0,taxMinor:0,serviceMinor:0,totalMinor:0,paidMinor:0,grandTotalMinor:0,balanceMinor:0};
const total=()=>{order.totalMinor=order.subtotalMinor=order.grandTotalMinor=order.balanceMinor=order.items.reduce((t,i)=>t+i.lineTotalMinor,0)};
window.pos.orders=({get:async()=>ok(JSON.parse(JSON.stringify(order))),create:async()=>ok({id:'o1'}),ensureForTable:async()=>ok({orderId:'o1',order}),openForTable:async()=>ok({orderId:'o1',order}),listOpen:async()=>ok({orders:[]}),
 addItem:async p=>{qa.added.push(p.productId);if(qa.failNext){const message=qa.failNext;qa.failNext=null;return{success:false,error:{message,code:'E_TEST'}}}const d=DISHES.find(x=>x.id===p.productId);const line=order.items.find(i=>i.productId===p.productId);if(line){line.quantity+=1;line.lineTotalMinor+=d.priceMinor}else order.items.push({id:'line-'+p.productId,productId:p.productId,name:d.nameAz,quantity:1,unitPriceMinor:d.priceMinor,lineTotalMinor:d.priceMinor,status:'draft',modifiers:[]});total();return ok({})}});
window.pos.tables={};window.pos.tables.get=async()=>ok({id:'t1',label:'Masa 4',status:'free'});
window.pos.core={};window.pos.core.onEvent=()=>()=>{};
window.pos.inventory=window.pos.inventory||{};Object.assign(window.pos.inventory,{costing:async()=>ok({items:[]}),recipe:async id=>ok({menuItemId:id,lines:[],components:[{menuItemId:'cola',name:'Kola',qtyMilli:2000,priceMinor:200}],costMinor:0}),saveIngredient:async p=>{qa.saved.push(p);return ok({id:'new-good'})},ingredients:async()=>ok({ingredients:[]})});
window.pos.products=window.pos.products||{};Object.assign(window.pos.products,{categories:async()=>ok({categories:CATS}),list:async p=>ok({products:DISHES.filter(d=>!p?.categoryId||d.categoryId===p.categoryId)}),modifierGroups:async()=>ok({groups:[]})});
window.pos.catalogAdmin=window.pos.catalogAdmin||{};Object.assign(window.pos.catalogAdmin,{upsertProduct:async p=>{qa.saved.push(p);return ok({id:'menu-1',...p})},upsertCategory:async p=>{qa.categories.push(p);return ok({...p})}});
const ACCOUNTS=()=>(qa.bank?[{id:'bank',kind:'bank',name:'Bank',objectId:'',balanceMinor:0,todayCardMinor:700}]:[]);
window.pos.cashAccounts=({list:async()=>ok({objects:qa.objects,accounts:[{id:'till',kind:'till',name:'Kassa',terminalId:'t',objectId:'',balanceMinor:0,todayCashMinor:500,todayCardMinor:700},...ACCOUNTS()],terminals:[{id:'t',name:'Kassa 1',current:true}],currentTerminalId:'t',loose:[]}),saveObject:async p=>{const o={id:'obj-'+qa.objects.length,name:p.name,warehouseId:'w'};qa.objects=[...qa.objects,o];return ok(o)}});
window.pos.business=({cloudList:async()=>ok({objects:qa.cloud||[],devices:[]}),call:async(action,payload)=>{if(action==='catalog.publish'){qa.published.push(payload);return ok({id:'m'})}return ok(action==='context'?{manager:true}:{})}});
window.pos.erp={};window.pos.erp.call=async m=>ok(m==='goods.list'?{goods:[],totals:{}}:{categories:[]});
const qs=new URLSearchParams(location.search);qa.bank=qs.get('bank')==='1';qa.cloud=qs.get('cloud')==='1'?[{id:'g',name:'Gənclik filialı'}]:[];`;
let pre=source.slice(0,source.indexOf('const container = document.getElementById("root");'));const tail=source.slice(source.indexOf('function usePsCatalogRefresh('));if(!pre.includes('function usePsCatalogRefresh('))pre+='\n'+tail;
const fixture=pre+`\nuseAuthStore.setState({session:{permissions:['inventory.view','inventory.manage','catalog.manage','settings.manage','cash.manage','cash.accounts','users.manage','order.create']},ready:true});const qp=new URLSearchParams(location.search);function QA(){const c=qp.get('page');return c==='order'?psH(PsOriginalOrderPage):c==='kassa'?psH(OpsKassalar):c==='goods'?psH(OpsGoods):psH(PsUnifiedCatalog);}clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{path:qp.get('page')==='order'?'/order/:tableId':'*',element:psH(QA)}))));`;
const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/qa'){res.setHeader('content-type','text/html');return res.end(`<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script>${mock}</script><script type="module" src="/assets/qa.js"></script></body></html>`)}if(u==='/assets/qa.js'){res.setHeader('content-type','text/javascript');return res.end(fixture)}const f=u==='/base.css'?root+'/packaged-renderer/assets/index-DFpMFaZu.css':u==='/system.css'?root+'/possistem-system.css':root+'/packaged-renderer'+u;if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('content-type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'application/octet-stream');return res.end(fs.readFileSync(f))}res.statusCode=404;res.end()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const at=(query,hash)=>`http://127.0.0.1:${server.address().port}/qa?${query}#/${hash}`;
const open=async(width,query,hash)=>{const p=await b.newPage({viewport:{width,height:768}});p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));await p.goto(at(query,hash));await p.waitForTimeout(700);return p};
const cartHas=(p,name)=>p.locator('li',{hasText:name}).filter({has:p.locator('p.truncate')}).count();
const addPlain=async(p,name)=>{await p.getByRole('button',{name:new RegExp(name)}).first().click();await p.waitForTimeout(150)};
try{
 if(phase==='before'){
  // The reported symptom on live 1.9.32: every add reaches the order, the line is not on screen.
  const p=await open(1366,'page=order','order/t1');
  for(const n of ['Şorba','Salat','Çay','Kabab'])await addPlain(p,n);
  await p.getByRole('button',{name:/Ali Lady Boy/}).click();await p.getByRole('button',{name:/30 sm/}).click();await p.waitForTimeout(400);
  console.log('order holds',JSON.stringify(await p.evaluate(()=>qa.added)),'| 30 sm line on screen:',await cartHas(p,'30 sm'));
  await p.screenshot({path:out+'/cart-1366.png'});await p.close();
 }else{
  for(const width of [1366,768]){
   // Sizes: the cart follows the line that was added, past its 4-line page.
   let p=await open(width,'page=order','order/t1');
   assert.equal(await p.locator('.ps-sale-product img').count(),1,'only the dish with an uploaded photo shows one');
   for(const n of ['Şorba','Salat','Çay','Kabab'])await addPlain(p,n);
   for(const size of ['28 sm','30 sm','32 sm','30 sm']){
    await p.getByRole('button',{name:/Ali Lady Boy/}).click();await p.getByRole('button',{name:new RegExp(size)}).click();await p.waitForTimeout(250);
    assert.equal(await cartHas(p,size),1,size+' must be visible in the cart');
   }
   assert.deepEqual((await p.evaluate(()=>qa.added)).slice(4),['p28','p30','p32','p30']);
   // A failed add keeps the dialog open and says why.
   await p.evaluate(()=>{qa.failNext='Kassa açılmayıb'});
   await p.getByRole('button',{name:/Ali Lady Boy/}).click();await p.getByRole('button',{name:/28 sm/}).click();await p.getByRole('alert').filter({hasText:'Kassa açılmayıb'}).waitFor();
   await p.screenshot({path:out+'/size-error-'+width+'.png'});
   await p.getByRole('button',{name:/28 sm/}).click();await p.waitForTimeout(250);assert.equal(await p.getByRole('alert').filter({hasText:'Kassa açılmayıb'}).count(),0);
   // Other units and the sold-out label.
   await p.getByRole('button',{name:/Lülə/}).click();await p.getByRole('button',{name:/500 qr/}).waitFor();await p.keyboard.press('Escape');
   const close=p.getByRole('button',{name:/Bağla|Close|×/}).first();if(await p.getByRole('button',{name:/500 qr/}).count())await close.click();
   await p.getByRole('button',{name:/Bitmiş/}).click();const gone=p.getByRole('button',{name:/28 sm/});await gone.waitFor();assert.equal(await gone.isDisabled(),true);assert.match(await gone.innerText(),/Bitib/);
   await p.screenshot({path:out+'/sizes-'+width+'.png'});assert.deepEqual(p.errors,[]);await p.close();
   // Sub-categories: İçkilər shows tiles, not its children in the left list; back works.
   p=await open(width,'page=order','order/t1');
   assert.equal(await p.getByRole('button',{name:'Spirtli'}).count(),0,'a sub-category is not in the left list');
   await p.getByRole('button',{name:/İÇKİLƏR|İçkilər/i}).first().click();await p.waitForTimeout(300);
   await p.getByRole('button',{name:/Spirtli/}).click();await p.waitForTimeout(300);
   await p.getByRole('button',{name:/Pivə/}).waitFor();
   await p.screenshot({path:out+'/subcat-'+width+'.png'});
   await p.getByRole('button',{name:'← İçkilər'}).click();await p.getByRole('button',{name:/Spirtsiz/}).waitFor();assert.deepEqual(p.errors,[]);await p.close();
  }
  // Till card and objects.
  let p=await open(1366,'page=kassa&bank=1&cloud=1','');
  await p.getByText('Gənclik filialı').first().waitFor();
  const till=p.locator('.ps-kassa-till');assert.match(await till.innerText(),/nağd/);assert.doesNotMatch(await till.innerText(),/kart/);
  assert.match(await p.locator('.ps-kassa-bank').innerText(),/Bu gün kart/);
  await p.getByRole('button',{name:'+ Yeni kassa'}).click();
  assert.equal(await p.locator('select').filter({hasText:'Obyektsiz'}).inputValue(),'obj-0','a lone object is preselected');
  await p.screenshot({path:out+'/kassa-1366.png'});assert.deepEqual(p.errors,[]);await p.close();
  p=await open(1366,'page=kassa','');const lone=p.locator('.ps-kassa-till');await lone.waitFor();assert.match(await lone.innerText(),/kart/,'no bank: the card amount stays visible');await p.close();
  // Set menu.
  for(const width of [1366,390]){
   p=await open(width,'page=catalog','admin/catalog');
   await p.getByRole('button',{name:'+ Menyu yarat'}).click();
   await p.getByLabel('Menyunun adı').fill('Biznes lanç');await p.getByLabel('Menyunun qiyməti').fill('7.50');
   await p.getByLabel('Məhsul axtar').fill('Kola');await p.getByRole('button',{name:/Kola/}).last().click();
   await p.getByLabel('Məhsul axtar').fill('Şorba');await p.getByRole('button',{name:/Şorba/}).last().click();
   await p.getByLabel('Kola — say').fill('2');
   await p.getByText('Məhsullar ayrı-ayrı').waitFor();assert.match(await p.locator('.ps-set-menu-sum').innerText(),/7[.,]00/);
   await p.screenshot({path:out+'/menu-'+width+'.png'});
   const over=await p.evaluate(()=>{const d=document.querySelector('.ps-set-menu'),limit=d.getBoundingClientRect().right+1;return [...d.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>limit).map(e=>e.tagName+'.'+e.className+':'+Math.round(e.getBoundingClientRect().right-limit)).concat(d.scrollWidth>d.clientWidth+1?['scroll:'+d.scrollWidth+'/'+d.clientWidth]:[])});assert.deepEqual(over,[],'no overflow in the dialog at '+width);
   await p.getByRole('button',{name:'Yadda saxla'}).click();await p.waitForFunction(()=>qa.saved.length>0);
   const saved=await p.evaluate(()=>qa.saved[0]);
   assert.equal(saved.priceMinor,750);assert.equal(saved.categoryId,'cat-menus');assert.deepEqual(saved.components,[{menuItemId:'cola',qtyMilli:2000},{menuItemId:'a',qtyMilli:1000}]);
   assert.equal((await p.evaluate(()=>qa.categories))[0].nameAz,'Menyular');assert.deepEqual(p.errors,[]);await p.close();
  }
  // Labels on the catalog tabs.
  p=await open(1366,'page=catalog','admin/catalog');assert.equal(await p.locator('.ps-business-tabs').count(),0,'Kateqoriyalar opens on the menu; goods and warehouse categories live under İdarə → Menyu və anbar (1.10.24)');await p.close();
  // Goods reach the order screen.
  p=await open(1366,'page=goods','');
  await p.getByRole('button',{name:'+ Yeni mal'}).click();
  await p.getByLabel('Malın adı').fill('Cola Zero');
  await p.getByRole('button',{name:'Yadda saxla'}).click();await p.waitForTimeout(200);await p.getByLabel('Malın adı').waitFor();
  assert.equal((await p.evaluate(()=>qa.saved)).length,0,'no sale price, nothing saved');
  await p.getByLabel('Satış qiyməti (₼)').fill('2');await p.getByLabel('Satış kateqoriyası').selectOption('soft');
  await p.screenshot({path:out+'/good-1366.png'});
  await p.getByRole('button',{name:'Yadda saxla'}).click();await p.waitForFunction(()=>qa.published.length>0);
  assert.deepEqual((await p.evaluate(()=>qa.published))[0],{ingredientId:'new-good',categoryId:'soft'});
  await p.waitForTimeout(200);
  await p.getByRole('button',{name:'+ Yeni mal'}).click();await p.getByLabel('Malın adı').fill('Un');await p.getByLabel('Satışda göstər').uncheck();
  await p.getByRole('button',{name:'Yadda saxla'}).click();await p.waitForFunction(()=>qa.saved.length>1);await p.waitForTimeout(150);
  assert.equal((await p.evaluate(()=>qa.published)).length,1,'a raw material stays out of sale');assert.deepEqual(p.errors,[]);await p.close();
  console.log('PASS sizes reach and show in the cart, failed add explained, units, sold-out label, no stock photos, sub-category tiles and back, cash-only till card, portal object appears and is preselected, set menu dialog, goods publish, labels');
 }
}finally{await b.close();server.close();}
console.log('screens:',out);
