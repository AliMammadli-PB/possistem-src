// Real shipped React components with isolated, read-only IPC responses. No customer data is used.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {chromium} from '@playwright/test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/management-refresh');fs.mkdirSync(out,{recursive:true});
const before=process.argv.includes('--before');
const source=before?execFileSync('git',['show','HEAD:restoranpos/index-DAmHwBc4.js'],{cwd:root,encoding:'utf8',maxBuffer:30e6}):fs.readFileSync(root+'/index-DAmHwBc4.js','utf8');
// Reuse the printer/account/inventory fixture already used to test these very forms.
const existing=fs.readFileSync(root+'/scripts/qa-admin-real-pages.mjs','utf8');
const mock=existing.slice(existing.indexOf('const mock=`')+12,existing.indexOf('`;\nconst fixture='))+`\n
qa.orders=[];qa.qrCalls=[];qa.decisions=[];qa.failQr=false;qa.holdNextInbox=false;
qa.updateState={state:'idle'};qa.updateNext={state:'not_available'};qa.updateListeners=new Set();qa.updateChecks=0;qa.updateInstalls=0;
qa.emitUpdate=state=>{qa.updateState=state;for(const fn of qa.updateListeners)fn(structuredClone(state))};
window.pos.updates={status:async()=>structuredClone(qa.updateState),onStatus:fn=>{qa.updateListeners.add(fn);return()=>qa.updateListeners.delete(fn)},check:async()=>{qa.updateChecks++;if(qa.updateReject)throw Error('QA update connection failed');if(qa.updateHold)return await new Promise(resolve=>{qa.resolveUpdate=resolve});return {success:true,data:structuredClone(qa.updateNext)}},install:async()=>{qa.updateInstalls++;return {success:true}}};
window.pos.app.info=async()=>({success:true,data:{version:'1.10.15'}});

window.pos.inventory.levels=async()=>({success:true,data:{levels:[{id:'qa-tomato',name:'Pomidor',sku:'QA-1',qtyMilli:10000,minQtyMilli:5000,costMinor:300,unit:'kg'},{id:'qa-doner',name:'QA Dönər',sku:'QA-2',qtyMilli:-16000,minQtyMilli:0,costMinor:200,salePriceMinor:500,unit:'ədəd'}]}});
window.possistemQr={call:async(method,payload)=>{
 qa.qrCalls.push(method);
 if(method==='qr.inbox'){
  if(qa.holdNextInbox){qa.holdNextInbox=false;const old=structuredClone(qa.orders);return new Promise(resolve=>{qa.releaseInbox=()=>resolve({success:true,data:{orders:old}});});}
  if(qa.failQr)return {success:false,error:{message:'QA connection failed'}};
  return {success:true,data:{orders:structuredClone(qa.orders)}};
 }
 if(method==='qr.decision'){qa.decisions.push(payload);qa.orders=qa.orders.map(o=>o.id===payload.id?{...o,status:payload.action==='accept'?'accepted':'rejected'}:o);return {success:true,data:{tableId:'qa-table'}};}
 return {success:true,data:{}};
}};
`;
assert.ok(mock.startsWith('const ok='),'Existing isolated fixture anchor');
const ast=ts.createSourceFile('renderer.js',source,99,true),rootAt=source.indexOf('const container = document.getElementById("root");');
let pre=source.slice(0,rootAt);
for(const node of ast.statements.filter(n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.getStart(ast)>rootAt))pre+='\n'+node.getText(ast);
const permissions=['settings.manage','backup.manage','users.manage','catalog.manage','tables.layout','inventory.view','inventory.count','inventory.manage','suppliers.view','customers.view','delivery.view','reports.export','cash.manage','gifts.manage','reports.view','audit.view','payment.reconcile','payment.refund','sales.view','salary.manage','order.create','order.view','kds.operate'];
const fixture=pre+`\nwindow.qaSetPermissions=(permissions,userId='qa-admin',role='manager')=>useAuthStore.setState({session:{userId,role,fullName:'QA Müdir',permissions},ready:true});qaSetPermissions(${JSON.stringify(permissions)});
function ManagementQA(){const l=useLocation();return l.pathname==='/settings'?psH(SettingsPage):l.pathname==='/operations'?psH(OperationsPage):l.pathname==='/admin'?psH(AdminHubPage):psH('div',{className:'qa-route'},l.pathname);}
clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{element:psH(AppShell)},psH(Route,{path:'*',element:psH(ManagementQA)})))));`;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://local').pathname;
 if(u==='/favicon.ico'){res.statusCode=204;return res.end();}
 if(u==='/qa'){res.setHeader('content-type','text/html');return res.end(`<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/index-DFpMFaZu.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script>${mock}</script><script type="module" src="/assets/qa-management.js"></script></body></html>`);}
 if(u==='/assets/qa-management.js'){res.setHeader('content-type','text/javascript');return res.end(fixture);}
 if(u==='/system.css'){res.setHeader('content-type','text/css');return res.end(before?execFileSync('git',['show','HEAD:restoranpos/possistem-system.css'],{cwd:root,maxBuffer:10e6}):fs.readFileSync(root+'/possistem-system.css'));}
 const target=u.startsWith('/assets/modules/')?root+u:u.startsWith('/assets/')?root+'/packaged-renderer'+u:'';
 if(!target||!fs.existsSync(target)){res.statusCode=404;return res.end();}
 res.setHeader('content-type',u.endsWith('.png')?'image/png':u.endsWith('.css')?'text/css':u.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(target));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1536,height:816}}),errors=[];
await page.clock.install();
page.setDefaultTimeout(8000);
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()));
page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url());});
const open=async route=>{await page.goto('http://127.0.0.1:'+server.address().port+'/qa#'+route);await page.waitForTimeout(700);assert.deepEqual(errors,[],'Browser exceptions on '+route);};
const screenshot=name=>page.screenshot({path:path.join(out,(before?'before-':'')+name+'.png')});
try{
 if(before){for(const [name,route]of[['hub','/admin'],['settings','/settings'],['stock','/operations?tab=stock']]){await open(route);await screenshot(name);}console.log('Before screenshots captured');}
 else{
   await open('/admin');
   assert.deepEqual(await page.locator('.ps-touch-sidebar nav>a').evaluateAll(links=>links.map(a=>a.textContent)),['Masalar','Mətbəx','Çatdırılma','İdarə'],'Main sidebar order');
   assert.equal(await page.locator('.ps-qr-inbox-toggle').count(),0,'No empty QR entry');
   const selectedMain=()=>page.locator('.ps-touch-sidebar nav>a.ps-nav-on').allTextContents();
   assert.deepEqual(await selectedMain(),['İdarə'],'Only management selected at admin');
   await page.locator('.ps-touch-sidebar nav>a',{hasText:'Çatdırılma'}).click();
   await page.locator('.pm-operations[data-module="delivery"]').waitFor();
   assert.deepEqual(await selectedMain(),['Çatdırılma'],'Delivery does not also select management');
   await page.locator('.ps-touch-sidebar nav>a',{hasText:'İdarə'}).click();
   await page.locator('.pm-module').first().waitFor();
   assert.deepEqual(await selectedMain(),['İdarə'],'Returning to management clears delivery selection');
   await page.mouse.move(900,300);await page.clock.fastForward(400);
   await page.locator('.pm-module').first().waitFor();
   await screenshot('hub-1536');
   for(const name of ['Maliyyə','Heyət və xidmət','Parametrlər']){
     await page.locator('.pm-rail-link',{hasText:name}).click();
     await page.waitForFunction(()=>[...document.querySelectorAll('.pm-image')].every(image=>image.complete&&image.naturalWidth>0));
     assert.ok(await page.locator('.pm-module').count(),'Every group has destinations');
     await screenshot('group-'+(name==='Maliyyə'?'finance':name==='Parametrlər'?'settings':'people')+'-1536');
   }
   assert.equal(await page.locator('.pm-module[href="#/settings"] strong').textContent(),'Restoran','No Settings card nested inside Settings');
   await page.locator('.pm-module[href="#/settings?section=system"]').click();
   await page.locator('.ps-settings-stack[data-section="system"]').waitFor();
   assert.equal(await page.locator('.pm-update-panel').count(),0,'Updates separated from system service');
   await open('/admin?group=settings');
   await page.locator('.pm-module[href="#/settings?section=updates"]').click();
   await page.locator('.ps-settings-stack[data-section="updates"]').waitFor();
   assert.equal(await page.locator('.pm-settings-picker h1').textContent(),'Yeniləmə');
   await page.waitForFunction(()=>document.querySelector('.pm-settings-picker img')?.naturalWidth>0);
   await page.getByRole('button',{name:'Yeniləməni yoxla',exact:true}).click();
   await page.locator('[data-update-state="not_available"]').waitFor();assert.equal(await page.evaluate(()=>qa.updateChecks),1);
   await page.evaluate(()=>{qa.updateReject=true});
   await page.getByRole('button',{name:'Yeniləməni yoxla',exact:true}).click();
   await page.getByRole('status').filter({hasText:'QA update connection failed'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Yeniləməni yoxla',exact:true}).isDisabled(),false,'Failed IPC does not leave the button busy');
   await page.evaluate(()=>{qa.updateReject=false;qa.updateHold=true});
   await page.getByRole('button',{name:'Yeniləməni yoxla',exact:true}).click();
   await page.waitForFunction(()=>typeof qa.resolveUpdate==='function');
   assert.equal(await page.getByRole('button',{name:'Yeniləmə yoxlanılır…',exact:true}).isDisabled(),true);
   await page.evaluate(()=>{qa.updateHold=false;qa.resolveUpdate({success:true,data:{state:'available',version:'1.10.16'}})});
   await page.locator('[data-update-state="available"]').waitFor();
   await page.evaluate(()=>qa.emitUpdate({state:'downloading',version:'1.10.16',percent:42}));
   await page.locator('[data-update-state="downloading"]').waitFor();
   assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'42');
   assert.match(await page.locator('[data-update-state="downloading"]').textContent(),/42/);
   assert.equal(await page.getByRole('button',{name:'Yenidən başlat və quraşdır',exact:true}).count(),0,'No installation during download');
   await page.evaluate(()=>qa.emitUpdate({state:'downloaded',version:'1.10.16'}));
   await page.getByRole('button',{name:'Yenidən başlat və quraşdır',exact:true}).click();assert.equal(await page.evaluate(()=>qa.updateInstalls),1);
   await screenshot('updates-ready-1536');
   await page.evaluate(()=>location.hash='/admin?group=settings');
   await page.getByRole('searchbox',{name:'Bölmə axtar'}).waitFor();
   await page.getByRole('button',{name:/Yeniləmə endirilib/}).click();
   await page.locator('.ps-settings-stack[data-section="updates"]').waitFor();assert.ok(page.url().includes('section=updates'),'Ready banner opens the update destination');
   await page.evaluate(()=>qa.emitUpdate({state:'disabled',message:'QA: Setup ilə qurulmuş proqram tələb olunur'}));
   await page.getByRole('status').filter({hasText:'QA: Setup'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Yeniləməni yoxla',exact:true}).isDisabled(),true,'Development-mode limitation is explicit');
   await open('/admin?group=settings');
   await page.getByRole('searchbox',{name:'Bölmə axtar'}).fill('yenileme');
   assert.equal(await page.locator('.pm-module[href="#/settings?section=updates"]').count(),1,'Updates searchable without Azerbaijani diacritics');
   await page.getByRole('searchbox').fill('');
   await page.getByRole('searchbox',{name:'Bölmə axtar'}).fill('kalkulyasiya');
   assert.equal(await page.locator('.pm-module').count(),1,'Calculation is directly searchable');
   await page.getByRole('searchbox').fill('zzyyzz');assert.equal(await page.locator('.pm-module').count(),0);await page.getByRole('status').waitFor();
   await page.getByRole('searchbox').fill('');
   await page.getByRole('searchbox').fill('printer');
   await page.locator('.pm-module[href="#/settings?section=printer"]').waitFor();
   await page.getByRole('searchbox').fill('');
   await page.locator('.pm-rail-link',{hasText:'Ticarət'}).click();
   await page.locator('.pm-module').filter({hasText:'Ticarət'}).waitFor();
   assert.equal(await page.locator('.pm-module').filter({hasText:'Ticarət'}).count(),1,'One shared trade entry');
   await screenshot('trade-hub-1536');
   await page.locator('.pm-rail-link',{hasText:'Parametrlər'}).click();
   await page.locator('.pm-module[href="#/settings"]').click();
   await page.locator('.pm-settings-picker select').waitFor();
   assert.equal(await page.locator('.category-bar').count(),0,'Second settings rail removed');
   await screenshot('settings-1536');
   await page.getByLabel('Parametr bölməsi',{exact:true}).selectOption('printer');
   await page.locator('.ps-settings-stack[data-section="printer"]').waitFor();
   assert.ok(page.url().includes('section=printer'));
   await screenshot('printer-1536');
   await page.getByLabel('Printerin adı',{exact:true}).fill('Kassa');
   await page.getByRole('button',{name:'Axtar',exact:true}).click();
   await page.getByRole('button',{name:'OK — bu Kassa printeridir',exact:true}).click();
   await page.locator('.ps-printer-section').getByRole('checkbox',{name:'Kassa',exact:true}).check();
   await page.locator('.ps-printer-section').getByRole('button',{name:'Yadda saxla',exact:true}).click();
   assert.ok(await page.evaluate(()=>qa.settingWrites.some(row=>row.key==='kitchen.stations'&&JSON.parse(row.value).some(station=>station.name==='Kassa'&&station.roles.includes('receipt')))),'Existing printer assignment still saves');
   await page.getByLabel('Parametr bölməsi',{exact:true}).selectOption('screen');
   await screenshot('screen-1536');
   await open('/settings?section=receipt');assert.equal(await page.getByLabel('Parametr bölməsi',{exact:true}).inputValue(),'receipt','Settings deep link');
   await open('/operations?tab=stock');await page.locator('.ps-stock-metric').first().waitFor();
   await page.getByText(/Mənfi qalıq:/).waitFor();
   assert.deepEqual(await selectedMain(),['İdarə'],'Stock remains within management');
   assert.equal(await page.locator('.ps-ops-tabs').count(),0,'Seventeen-tab strip removed');
   assert.equal(await page.locator('.ps-workspace-nav').count(),0,'Global duplicate navigation stays removed');
   await screenshot('stock-1536');
   assert.equal(await page.locator('.pm-jump,.pm-context-nav').count(),0,'Old jump selector and top tabs removed');
   const rail=await page.locator('.pm-operation-rail').boundingBox();assert.equal(Math.round(rail.width),168);
   await page.goto('http://127.0.0.1:'+server.address().port+'/qa#/operations?tab=sales');
   await page.getByRole('heading',{name:'Ticarət',exact:true}).waitFor();
   assert.equal(await page.locator('.pm-operation-rail nav button').count(),2,'Only purchases/sales in trade');
   await page.locator('.pm-operation-rail').getByRole('button',{name:'Alışlar',exact:true}).click();
   assert.ok(page.url().includes('tab=purchases'),'Purchase route preserved');
   await screenshot('trade-1536');
   await page.locator('.pm-operation-rail').getByRole('button',{name:'Satışlar',exact:true}).click();
   assert.ok(page.url().includes('tab=sales'),'Sale route preserved');
   await open('/admin');
   await page.evaluate(()=>qaSetPermissions(['settings.manage']));
   assert.equal(await page.locator('.pm-module[aria-disabled=true]').count(),0,'Locked cards are absent');
   assert.equal(await page.locator('.pm-rail-link',{hasText:'Menyu və anbar'}).count(),0,'Empty group is hidden');
   assert.equal(await page.locator('.pm-module',{hasText:'Obyektlər'}).count(),0,'Manager role alone cannot expose locations');
   await page.getByRole('searchbox').fill('kalkulyasiya');assert.equal(await page.locator('.pm-module').count(),0,'Search cannot reveal a hidden section');
   await page.getByRole('searchbox').fill('');
   await page.evaluate(()=>qaSetPermissions([]));assert.equal(await page.locator('.pm-module,.pm-rail-link').count(),0,'No rights gives no module icons');
   await page.evaluate(()=>qaSetPermissions(['order.create','delivery.view']));
   assert.deepEqual(await page.locator('.ps-touch-sidebar nav>a').evaluateAll(links=>links.map(a=>a.textContent)),['Masalar','Çatdırılma'],'Limited cashier/manager sidebar');
   await page.evaluate(permissions=>qaSetPermissions(permissions),permissions);
   await page.waitForFunction(()=>document.querySelectorAll('.pm-module').length>0);
   await page.evaluate(()=>{window.__psAccess=['tables','admin','settings'];window.dispatchEvent(new Event('ps:access'));});
   await page.waitForFunction(()=>![...document.querySelectorAll('.ps-touch-sidebar nav>a')].some(a=>a.textContent==='Çatdırılma'));
   assert.equal(await page.locator('.ps-touch-sidebar nav>a',{hasText:'Çatdırılma'}).count(),0,'Disabled delivery module is hidden');
   assert.equal(await page.locator('.pm-module',{hasText:'Anbar'}).count(),0,'Disabled stock module hides linked goods too');
   await page.evaluate(()=>{delete window.__psAccess;window.dispatchEvent(new Event('ps:access'));});
   // Polling the real QR inbox UI; no cloud calls or customer records.
   const qrRow=(id,status)=>({id,status,tableId:'qa-table',tableLabel:'Masa '+id,createdAt:'2026-11-06T10:00:00Z',subtotalMinor:700,lines:[{name:'QA yemək',qty:1,lineTotalMinor:700}]});
   const poll=async()=>{await page.clock.fastForward(8100);await page.waitForTimeout(50);};
   await page.evaluate(rows=>{qa.orders=rows;},[qrRow('1','pending')]);await poll();
   await page.getByRole('button',{name:'QR sifarişlər · 1',exact:true}).waitFor();
   await page.evaluate(rows=>{qa.orders=rows;},[qrRow('1','pending'),qrRow('2','accepting'),qrRow('3','accepted')]);await poll();
   await page.getByRole('button',{name:'QR sifarişlər · 2',exact:true}).waitFor();
   await page.locator('.ps-touch-sidebar').hover();await page.waitForTimeout(250);await screenshot('sidebar-qr-1536');await page.mouse.move(900,300);
   await page.evaluate(()=>{qa.failQr=true;});await poll();assert.equal(await page.getByRole('button',{name:'QR sifarişlər · 2',exact:true}).count(),1,'Connection failure retains confirmed count');
   await page.evaluate(()=>{qa.failQr=false;});
   await page.getByRole('button',{name:'QR sifarişlər · 2',exact:true}).click();
   const inbox=page.getByRole('dialog',{name:'QR sifarişlər',exact:true});await inbox.waitFor();
   await inbox.getByPlaceholder('İmtina səbəbi').fill('QA sınağı');
   await inbox.getByRole('button',{name:'İmtina et',exact:true}).click();
   await page.getByRole('button',{name:'QR sifarişlər · 1',exact:true}).waitFor();
   await page.evaluate(()=>{qa.orders=qa.orders.map(o=>({...o,status:'accepted'}));});await poll();
   assert.equal(await page.locator('.ps-qr-inbox-toggle').count(),0,'Last completed order hides QR entry');assert.equal(await inbox.count(),1,'Open inbox remains open');
   await inbox.getByRole('button',{name:'Bağla',exact:true}).click();
   assert.ok(await page.evaluate(()=>document.activeElement?.isConnected),'Focus retained when QR trigger disappears');
   await page.evaluate(rows=>{qa.orders=rows;},[qrRow('4','pending')]);await poll();
   await page.getByRole('button',{name:'QR sifarişlər · 1',exact:true}).click();
   await page.getByRole('button',{name:'Qəbul et və hesabı aç',exact:true}).click();
   await page.waitForURL('**#/orders/qa-table');assert.equal(await page.locator('.ps-qr-inbox-toggle').count(),0,'Accepted order hides entry');
   await page.evaluate(rows=>{qa.orders=rows;qa.holdNextInbox=true;},[qrRow('old','pending')]);await poll();
   await page.waitForFunction(()=>!!qa.releaseInbox);
   await page.evaluate(permissions=>{qa.orders=[];qaSetPermissions(permissions,'qa-other');},permissions);
   await page.waitForTimeout(50);await page.evaluate(()=>qa.releaseInbox());await page.waitForTimeout(50);
   assert.equal(await page.locator('.ps-qr-inbox-toggle').count(),0,'Old account response cannot repopulate QR orders');
   await page.evaluate(rows=>{qa.orders=rows;},[qrRow('5','pending')]);await poll();await page.locator('.ps-qr-inbox-toggle').click();
   await page.evaluate(()=>qaSetPermissions(['settings.manage']));await page.waitForTimeout(50);
   assert.equal(await page.locator('.ps-qr-inbox-toggle,.ps-qr-inbox').count(),0,'Permission removal clears open QR UI');
   const calls=await page.evaluate(()=>qa.qrCalls.length);await poll();assert.equal(await page.evaluate(()=>qa.qrCalls.length),calls,'No inbox polling without permission');
   await page.evaluate(permissions=>{qa.orders=[];qaSetPermissions(permissions);},permissions);
   const layouts=[];
   for(const [width,height]of[[1536,816],[1366,735],[768,1024],[390,844]]){
     await page.setViewportSize({width,height});
     for(const [name,route]of[['hub','/admin'],['settings','/settings?section=printer'],['stock','/operations?tab=stock'],['updates','/settings?section=updates']]){
       await open(route);
       const state=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,images:[...document.querySelectorAll('.pm-image')].every(image=>image.complete&&image.naturalWidth>0)}));
       assert.ok(state.scroll<=state.viewport+1,`${name} ${width} overflow ${JSON.stringify(state)}`);
       assert.ok(state.images,`${name} images load at ${width}`);
       if(name==='updates'){
         const panel=await page.locator('.pm-update-panel').boundingBox(),check=await page.getByRole('button',{name:'Yeniləməni yoxla',exact:true}).boundingBox();
         assert.ok(panel&&check&&panel.x>=0&&panel.x+panel.width<=width+1&&check.x+check.width<=width+1,`Update controls fit at ${width}`);
       }
       layouts.push({name,width,height,...state});
       if(width===390||width===768)await screenshot(name+'-'+width);
       if(name==='stock'&&width<=900){
         await page.getByRole('button',{name:'Bölmələr',exact:true}).click();
         const drawer=page.getByRole('dialog',{name:'Bölmələr',exact:true});await drawer.waitFor();
         await screenshot('sections-'+width);
         await drawer.getByRole('button',{name:'Mallar',exact:true}).click();
         await page.waitForURL('**tab=goods');assert.equal(await drawer.count(),0,'Picking section closes drawer');
         await page.getByRole('button',{name:'Bölmələr',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await drawer.count(),0,'Escape closes drawer');
       }
     }
   }
   assert.deepEqual(errors,[],'No browser exceptions');
   fs.writeFileSync(out+'/results.json',JSON.stringify({browser:await browser.version(),layouts,errors,printerAssignment:true,legacyTradeRoutes:true,hiddenNavigation:true,qrTransitions:true,drawer:true,updateControls:true},null,2));
   console.log('PASS: update check/failure/progress/install/banner and explicit settings destinations; real AppShell delivery order; hidden permissions and modules; QR 0→1→2→0, reject/accept, network failure, stale account, revoked rights; drawer, routes and printer save; 16 layouts; '+await browser.version());
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
