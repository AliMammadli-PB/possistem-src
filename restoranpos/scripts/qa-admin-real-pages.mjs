/** Render the shipped components against read-only, isolated IPC fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/admin-destinations');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'index-DAmHwBc4.js'),'utf8');
const mock=`const ok=data=>Promise.resolve({success:true,data});
window.qa={printerAssignments:[],profileWrites:[],testPrints:[],previewCalls:[],settingWrites:[],logoClears:0,logoApplies:0};
window.pos={
 settings:{getAll:()=>ok({settings:{'restaurant.name':'QA Restoran','restaurant.address':'Bakı','printer.qr':'0','printer.logoDataUrl':'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22100%22%20height=%2240%22%3E%3Ctext%20x=%228%22%20y=%2230%22%3EQA%3C/text%3E%3C/svg%3E'}}),set:(key,value)=>{qa.settingWrites.push({key,value});return ok({})}},
 updates:{status:()=>Promise.resolve({state:'idle'}),onStatus:()=>()=>{}},
 app:{info:()=>ok({version:'1.7.5'}),displayGet:()=>ok({prefs:{mode:'fullscreen',width:1366,height:768,zoomFactor:1},presets:[],screen:{width:1366,height:768}})},
 tenant:{status:()=>ok({authenticated:true,email:'qa@example.com',customerName:'QA hesabı'})},
 print:{printers:()=>ok({printers:[],receipt:'virtual',kitchen:'virtual',warehouse:'virtual',profile:{paperWidth:80,dpi:203,printableDots:0,charsPerLine:40}}),detect:()=>qa.failDetect?Promise.reject(new Error('QA USB disconnected')):ok({candidates:[{name:'QA USB printer',connection:'usb',label:'QA USB printer'}]}),enqueue:payload=>{qa.testPrints.push(payload);return ok({status:'completed',printer:payload.printer})},setPrinter:(role,target,patch)=>{if(qa.failAssign)return Promise.resolve({success:false,error:{message:'QA printer unavailable'}});qa.printerAssignments.push({role,target});if(patch)qa.profileWrites.push(patch);return ok({})},previewTest:payload=>{qa.previewCalls.push(payload);return ok({html:'<!doctype html><html><head><style>.paper{width:80mm;background:white}</style></head><body><div class="paper">QA çek</div></body></html>',paperWidth:payload.paperWidth,charsPerLine:payload.charsPerLine,printableDots:576,dpi:payload.dpi})}},
 receiptLogo:{apply:()=>{qa.logoApplies++;return ok({})},clear:()=>{qa.logoClears++;return ok({})}},
 license:{status:()=>ok({status:'active',features:{}})},
 products:{
  categories:()=>ok({categories:[{id:'qa-food',nameAz:'Yeməklər',nameTr:'Yemekler',nameEn:'Food',sortOrder:0}]}),
  list:()=>ok({products:[{id:'qa-product',categoryId:'qa-food',nameAz:'Pomidor salatı',nameTr:'Domates salatası',nameEn:'Tomato salad',priceMinor:1200,active:1,sortOrder:0}]}),
  modifierGroups:()=>ok({modifierGroups:[]})
 },
 inventory:{
  levels:()=>ok({levels:[{id:'qa-tomato',name:'Pomidor',sku:'QA-1',qtyMilli:10000,minQtyMilli:5000,costMinor:300,unit:'kg'}]}),
  warehouses:()=>ok({warehouses:[{id:'qa-warehouse',name:'Əsas anbar'}]}),
  valuation:()=>ok({totalMinor:3000}),movements:()=>ok({movements:[]})
 },
 reports:{period:()=>ok({sales:{grossMinor:0,netMinor:0,byMethod:[]},orders:{count:0,averageMinor:0},cashDrawer:{},byCategory:[],buckets:[]}),dashboard:()=>ok({openOrders:0,tables:{},kitchen:{},payments:{}}),topProducts:()=>ok({products:[]})}
};
window.pos=new Proxy(window.pos,{get(target,key){return new Proxy(target[key]??{}, {get(group,method){return group[method]??((..._args)=>ok({}));}})}});`;
const fixture=source.slice(0,source.indexOf('const container = document.getElementById("root");'))+`
useAuthStore.setState({session:{permissions:['settings.manage','backup.manage','users.manage','catalog.manage','tables.layout','inventory.view','suppliers.view','customers.view','reservations.view','delivery.view','schedule.view','reports.export','cash.manage','gifts.manage','reports.view','audit.view','payment.reconcile']},ready:true});
const qaRoot=clientExports.createRoot(document.getElementById('root'));
const qaPage=new URLSearchParams(location.search).get('page');
const qaComponents={catalog:AdminCatalogPage,operations:OperationsPage,settings:SettingsPage,
 dashboard:DashboardPage,staff:AdminStaffPage,tables:AdminTablesPage,gifts:AdminGiftsPage,
 cash:AdminCashPage,reports:AdminReportsPage,reconcile:ReconcilePage,audit:AuditPage,
 backup:AdminBackupPage,license:LicensePage,diagnostics:DiagnosticsPage};
const qaComponent=qaComponents[qaPage]||SettingsPage;
qaRoot.render(reactExports.createElement(HashRouter,null,reactExports.createElement(PsAdminFrame,null,reactExports.createElement(qaComponent))));`;
const server=http.createServer((req,res)=>{
 const url=req.url.split('?')[0];
 if(url==='/qa.html'){res.setHeader('content-type','text/html; charset=utf-8');res.end(`<html lang="az"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/index-DFpMFaZu.css"><link rel="stylesheet" href="/possistem-system.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script>${mock}</script><script type="module" src="/assets/qa-real.js"></script></body></html>`);return;}
 if(url==='/assets/qa-real.js'){res.setHeader('content-type','text/javascript');res.end(fixture);return;}
 const target=url==='/possistem-system.css'?path.join(root,'possistem-system.css'):url.startsWith('/assets/')?path.join(root,'packaged-renderer',url):null;
 if(!target||!fs.existsSync(target)){res.statusCode=404;res.end();return;}
 res.setHeader('content-type',target.endsWith('.css')?'text/css':target.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(target));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 for(const [width,height] of [[360,800],[768,1024],[1366,900]]){
  await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${server.address().port}/qa.html?width=${width}#/settings`);
  await page.locator('.ps-settings-page .category').first().waitFor({timeout:10000}).catch(async e=>{throw new Error(`${e.message}\nErrors: ${errors.join(' | ')}\nBody: ${(await page.locator('body').innerText()).slice(0,400)}`)});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`Real settings overflow at ${width}`);
  assert.equal(await page.locator('.ps-settings-page .topbar').count(),0);
  assert.equal(await page.locator('.ps-settings-page .sticky-save').count(),0);
  await page.screenshot({path:path.join(out,`real-settings-${width}.png`)});
  await page.getByRole('button',{name:/Printer/}).first().click();
  assert.ok(await page.getByRole('heading',{name:'Printer',exact:true}).count());
  await page.screenshot({path:path.join(out,`real-printer-${width}.png`)});
  assert.ok(await page.getByText('Virtual printer — kağız çap etmir').count());
  if(width===1366)await page.evaluate(()=>qa.failDetect=true);
  await page.getByRole('button',{name:'Printeri tap',exact:true}).first().click();
  if(width===1366){
   await page.getByText('QA USB disconnected').waitFor();
   await page.evaluate(()=>qa.failDetect=false);
   await page.getByRole('button',{name:'Yenidən axtar',exact:true}).click();
  }
  await page.getByRole('button',{name:/Bəli — bu Kassa printeridir/}).waitFor({timeout:5000}).catch(async e=>{throw Error(`${e.message}\n${(await page.locator('body').innerText()).slice(0,1800)}\n${errors.join(' | ')}`)});
  const smallPrinterButtons=await page.evaluate(()=>[...document.querySelectorAll('.ps-printer-section button:not(:disabled)')].filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&(b.width<48||b.height<48)}).map(el=>({text:el.textContent.trim(),size:Math.round(el.getBoundingClientRect().width)+'x'+Math.round(el.getBoundingClientRect().height),className:el.className,parent:el.parentElement?.className})));
  assert.deepEqual(smallPrinterButtons,[],`Printer touch targets at ${width}`);
  await page.screenshot({path:path.join(out,`real-printer-wizard-${width}.png`)});
  if(width===1366){
   await page.evaluate(()=>qa.failAssign=true);
   await page.getByRole('button',{name:/Bəli — bu Kassa printeridir/}).click();
   assert.ok(await page.getByRole('button',{name:/Bəli — bu Kassa printeridir/}).count(),'Assignment error must keep printer confirmation open');
   assert.equal(await page.evaluate(()=>qa.printerAssignments.length),0);
   await page.evaluate(()=>qa.failAssign=false);
  }
  await page.getByRole('button',{name:/Bəli — bu Kassa printeridir/}).click();
  assert.deepEqual(await page.evaluate(()=>qa.printerAssignments.at(-1)),{role:'receipt',target:'QA USB printer'});
  assert.ok((await page.evaluate(()=>qa.testPrints)).some(row=>row.printer==='QA USB printer'));
  await page.locator('.ps-settings-page .category').filter({hasText:'Çek'}).first().click();
  const receipt=page.locator('.ps-receipt-settings');
  await receipt.waitFor();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.ps-settings-page .category.active').innerText().then(s=>s.includes('Çek')),true);
  assert.equal(await page.getByRole('button',{name:'Çeki önizlə',exact:true}).count(),1,'One Settings preview action');
  assert.equal(await receipt.locator('.ps-receipt-asset').count(),2,'Logo and QR share one workbench');
  assert.equal(await receipt.locator('.ps-receipt-logo-preview img').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`Receipt panel overflow at ${width}`);
  await page.screenshot({path:path.join(out,`real-receipt-${width}.png`)});
  if(width===1366){
    await receipt.locator('details').first().locator('summary').click();
    await page.getByLabel('Restoran adı').fill('QA Yeni Restoran');
    await receipt.locator('details').last().locator('summary').click();
    await page.getByRole('combobox',{name:'Kağız ölçüsü'}).selectOption('58');
    await receipt.getByRole('checkbox',{name:'Çekdə QR göstər'}).check();
    await receipt.getByRole('textbox',{name:'QR linki'}).fill('https://example.com/xəritə?yer=Bakı');
    await page.getByRole('button',{name:'Çeki önizlə',exact:true}).click();
    assert.ok(await page.getByRole('dialog',{name:'Çek önizləməsi'}).count());
    const call=await page.evaluate(()=>qa.previewCalls.at(-1));
    assert.equal(call.paperWidth,58);
    assert.equal(call.qrUrl,'https://example.com/xəritə?yer=Bakı');
    assert.equal(call.brand.name,'QA Yeni Restoran');
    assert.ok(await page.getByText('Nümunə sifariş · çap görünüşü').count());
    await page.getByRole('button',{name:'200%',exact:true}).click();
    assert.equal(await page.frameLocator('iframe[title="Çap ediləcək çek"]').locator('.paper').evaluate(el=>getComputedStyle(el).zoom),'2');
    await page.screenshot({path:path.join(out,'real-receipt-preview-1366.png')});
    await page.getByRole('button',{name:'Bağla',exact:true}).click();
    await receipt.getByRole('button',{name:'Çek ayarlarını saxla'}).click();
    assert.equal((await page.evaluate(()=>qa.settingWrites.filter(x=>x.key==='receipt.qrUrl').at(-1))).value,'https://example.com/xəritə?yer=Bakı');
    assert.equal((await page.evaluate(()=>qa.profileWrites.at(-1)))['printer.paperWidth'],58);
    const black=await sharp({create:{width:100,height:40,channels:4,background:'#000000'}}).png().toBuffer();
    await receipt.locator('input[type=file]').setInputFiles({name:'black.png',mimeType:'image/png',buffer:black});
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>qa.logoApplies),0,'Solid black logo must be rejected');
    const transparent=await sharp(Buffer.from('<svg width="200" height="50" xmlns="http://www.w3.org/2000/svg"><text x="10" y="35" font-size="34">QA</text></svg>')).png().toBuffer();
    await receipt.locator('input[type=file]').setInputFiles({name:'transparent.png',mimeType:'image/png',buffer:transparent});
    await page.waitForFunction(()=>qa.logoApplies===1);
    await receipt.getByRole('button',{name:'Sil',exact:true}).click();
    assert.equal(await page.evaluate(()=>qa.logoClears),1);
  }
  await page.getByRole('button',{name:/Təhlükəli zona/}).first().click();
  assert.equal(await page.getByRole('button',{name:'Saxla',exact:true}).count(),0);
  if(width===1366){
   for(const section of await page.locator('.ps-settings-page .category').all()){
    await section.click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'Settings section overflow');
   }
  }
 }
 for(const [name,route,ready] of [
  ['catalog','/admin/catalog','.ps-catalog-row'],
  ['operations','/operations?tab=stock','.ps-stock-metrics']
 ]){
  for(const [width,height] of [[360,800],[768,1024],[1366,900]]){
   await page.setViewportSize({width,height});
   await page.goto(`http://127.0.0.1:${server.address().port}/qa.html?page=${name}&width=${width}#${route}`);
   await page.locator(ready).first().waitFor({timeout:10000}).catch(async e=>{throw new Error(`${name} ${width}: ${e.message}\nErrors: ${errors.join(' | ')}\nBody: ${(await page.locator('body').innerText()).slice(0,400)}`)});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`Real ${name} overflow at ${width}`);
   const smallButtons=await page.evaluate(()=>[...document.querySelectorAll('.ps-admin-content button:not(:disabled)')].filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&(b.width<44||b.height<44)}).map(el=>({label:el.getAttribute('aria-label')||el.textContent.trim().slice(0,32),size:Math.round(el.getBoundingClientRect().width)+'×'+Math.round(el.getBoundingClientRect().height)})));
   assert.deepEqual(smallButtons,[],`Real ${name} undersized buttons at ${width}`);
   await page.screenshot({path:path.join(out,`real-${name}-${width}.png`)});
   if(name==='operations'&&width===1366){
    for(const tab of await page.locator('.ps-ops-tabs button').all()){
     const label=(await tab.innerText()).trim();
     await tab.click();
     await page.waitForTimeout(80);
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`Operations ${label} overflow`);
     await page.screenshot({path:path.join(out,`real-operations-${label.replace(/[^a-z0-9]+/gi,'-')}.png`)});
    }
   }
  }
 }
 for(const [name,route] of [
  ['dashboard','/dashboard'],['staff','/admin/staff'],['tables','/admin/tables'],
  ['gifts','/admin/gifts'],['cash','/admin/cash'],['reports','/admin/reports'],
  ['reconcile','/reconcile'],['audit','/audit'],['backup','/admin/backup'],
  ['license','/settings/license'],['diagnostics','/diagnostics']
 ]){
  for(const [width,height] of [[360,800],[1366,900]]){
   await page.setViewportSize({width,height});
   await page.goto(`http://127.0.0.1:${server.address().port}/qa.html?page=${name}&width=${width}#${route}`);
   await page.locator('.ps-admin-content').waitFor({timeout:10000}).catch(async e=>{throw new Error(`${name} ${width}: ${e.message}\nErrors: ${errors.join(' | ')}\nBody: ${(await page.locator('body').innerText()).slice(0,400)}`)});
   await page.waitForTimeout(80);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`Real ${name} overflow at ${width}`);
   await page.screenshot({path:path.join(out,`real-${name}-${width}.png`)});
  }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS 14 shipped management components across 360/768/1366; section taps, no global save, no overflow or renderer errors');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
