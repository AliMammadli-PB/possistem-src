/** Isolated UI regression: shipped Market components + embedded restaurant renderer. No live data/printers. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,'../artifacts/market-1.5.3/ui');fs.mkdirSync(out,{recursive:true});
const oldQA=fs.readFileSync(path.resolve(root,'../restoranpos/scripts/qa-admin-real-pages.mjs'),'utf8');
const mock=oldQA.slice(oldQA.indexOf('const mock=`')+12,oldQA.indexOf('`;\nconst fixture='));
await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SettingsPage} from './src/SettingsPage';import {SalePage} from './src/App';import {createDemoState as createInitialState} from './src/data.demo';import './src/styles.css';
${mock}
const qa=window.qa;qa.sales=0;qa.prints=0;qa.refreshes=0;qa.messages=[];qa.calls=[];
window.marketOps={status:async()=>({host:true,state:'ready',available:true}),invoke:async({method,payload:p})=>{
qa.calls.push({method,payload:p});if(method==='__session')return {success:true,data:{userId:'u-manager',code:'9001',fullName:'QA',role:'administrator',shiftId:null,loginAt:Date.now(),permissions:['settings.manage','print.manage','inventory.view','inventory.manage','catalog.manage','suppliers.view','customers.view']}};
if(method==='permissions.list')return {success:true,data:{groups:{admin:['settings.manage','catalog.manage','inventory.view']}}};
const [g,m]=method.split('.');if(method==='print.setPrinter')return window.pos.print.setPrinter(p.target,p.printerName,p.settings);
if(method==='settings.set')return window.pos.settings.set(p.key,p.value);
if(method==='goods.list')return {success:true,data:{goods:[{id:'g1',name:'Süd',sku:'SUD',unit:'əd',priceMinor:220,active:1}],total:1}};
if(method==='objects.list')return {success:true,data:{objects:[{id:'obj1',name:'Mağaza'}]}};
if(method==='goods.categories')return {success:true,data:{categories:[]}};
return window.pos[g][m](p);
}};
window.marketSystem={display:{get:async()=>({prefs:{mode:'fullscreen',width:1366,height:768,zoomFactor:1},presets:[{id:'full',label:'Tam ekran',mode:'fullscreen',width:1366,height:768}]}),set:async(_t,p)=>p},activation:{status:async()=>null},update:{status:async()=>({state:'idle'}),onChanged:()=>()=>{}},app:{info:async()=>({version:'1.5.3'})},hardware:{health:async()=>({printer:{status:'ready'},terminal:{mode:'manual'},drawer:{status:'ready'},fiscal:{status:'ready'}})},printer:{health:async()=>({status:'ready'}),list:async()=>[],receipt:async()=>{qa.prints++;await new Promise(r=>setTimeout(r,120));return {ok:true}}},fiscal:{processPending:async()=>({})}};
window.marketCore={invoke:async(method,p)=>{if(method==='sale.complete'){qa.sales++;await new Promise(r=>setTimeout(r,180));if(qa.failSale){qa.failSale=false;return {success:false,error:{code:'TEST',message:'QA refused'}}}return {success:true,data:{id:'qa-sale-'+qa.sales,receiptNo:'M-QA-'+qa.sales,totalMinor:100}}}if(method==='sale.receipt')return {success:true,data:{saleId:p.saleId,receiptNo:'M-QA-'+qa.sales}};return {success:true,data:{}}}};
const session={id:'u-manager',name:'QA',role:'manager',sessionToken:'qa-session'};
function Harness(){const [state,setState]=useState(()=>{const s=createInitialState();s.products=s.products.slice(0,3);s.products[0]={...s.products[0],priceMinor:100};s.settings.kitchenStations='[]';return s});const [cart,setCart]=useState([{productId:state.products[0].id,qty:1}]);const [page,setPage]=useState('settings');
return <><nav className="qa-nav"><button onClick={()=>setPage('settings')}>QA Settings</button><button onClick={()=>{setCart([{productId:state.products[0].id,qty:1}]);setPage('sale')}}>QA Sale</button></nav><main className="page-area" style={{height:'calc(100dvh - 58px)'}}>{page==='settings'?<SettingsPage state={state} session={session} lang="az" coreReady notify={m=>qa.messages.push(m)} onSettings={async settings=>{if(qa.failSave)throw Error('QA save failed');setState(s=>({...s,settings}));qa.saved=settings}}/>:<SalePage state={state} setState={setState} session={session} lang="az" cart={cart} setCart={setCart} cloudConnected={false} coreReady={new URLSearchParams(location.search).get('offline')!=='1'} notify={m=>qa.messages.push(m)} onRefresh={async()=>{qa.refreshes++;if(qa.failRefresh)throw Error('QA refresh failed');return state}} audit={fn=>{qa.sales++;setState(fn)}}/>}</main></>}
createRoot(document.getElementById('root')).render(<Harness/>);
`},bundle:true,outfile:path.join(out,'harness.js'),format:'iife',jsx:'automatic',loader:{'.woff2':'file','.woff':'file','.png':'file','.jpg':'file'},logLevel:'silent'});
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png'};
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');let file=url.pathname.startsWith('/ops/')?path.join(root,'dist',url.pathname):path.join(out,url.pathname);if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"><style>body{margin:0}.qa-nav{height:58px;display:flex;gap:12px;padding:4px 16px;background:white}.qa-nav button{min-height:48px;padding:8px 16px}#root{height:100vh}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>');return}if(!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;res.end();return}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));const results=[];
try{
 await page.goto(base);await page.locator('.settings-rail').waitFor();
 for(const [width,height] of [[360,800],[768,1024],[1024,768],[1366,768],[1920,1080],[3840,2160]]){
  await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Settings overflow '+width);
  for(const index of [0,5,6,7,8,9]){await page.locator('.settings-rail button').nth(index).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Section overflow '+width+' '+index)}
  await page.locator('.settings-rail button').first().click();await page.screenshot({path:path.join(out,'settings-'+width+'.png')});results.push({width,height,overflow:false});
 }
 await page.setViewportSize({width:1366,height:900});await page.locator('.settings-rail button').nth(2).click();const printer=page.frameLocator('iframe[title="Printer seçimi"]');await printer.locator('.ps-printer-section').waitFor({timeout:20000});
 assert.equal(await printer.locator('.ps-receipt-settings').count(),0,'Printer destination contains no second receipt editor');
 await printer.locator('.ps-printer-section input').first().fill('Kassa');await printer.getByRole('button',{name:'Axtar',exact:true}).click();await printer.getByRole('button',{name:/OK — bu Kassa printeridir/}).waitFor();await printer.getByRole('button',{name:/OK — bu Kassa printeridir/}).click();await printer.getByRole('button',{name:'Kassa',exact:true}).click();await printer.getByRole('button',{name:'Yadda saxla',exact:true}).click();assert.deepEqual(await page.evaluate(()=>qa.printerAssignments.at(-1)),{role:'receipt',target:'QA USB printer'});
 for(const [width,height] of [[360,800],[768,1024],[1024,768],[1366,900]]){await page.setViewportSize({width,height});assert.ok(await printer.locator('html').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Embedded printer overflow '+width);await page.screenshot({path:path.join(out,'printer-'+width+'.png')});}
 await page.screenshot({path:path.join(out,'printer.png')});
 await page.locator('.settings-rail button').filter({hasText:'Çek dizaynı'}).click();const receipt=page.frameLocator('iframe[title="Çek dizaynı və önizləmə"]');await receipt.locator('.ps-receipt-settings').waitFor();assert.equal(await receipt.locator('.ps-printer-section').count(),0,'Receipt destination contains no printer wizard');assert.equal(await receipt.getByRole('button',{name:'Çeki önizlə',exact:true}).count(),1);
 for(const [width,height] of [[360,800],[768,1024],[1024,768],[1366,900]]){await page.setViewportSize({width,height});assert.ok(await receipt.locator('html').evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Embedded receipt overflow '+width);await page.screenshot({path:path.join(out,'receipt-'+width+'.png')});}
 await receipt.getByRole('checkbox',{name:'Çekdə QR göstər'}).check();await receipt.getByRole('textbox',{name:'QR linki'}).fill('https://possistem.az/xəritə?yer=Bakı');await receipt.getByRole('button',{name:'Çeki önizlə',exact:true}).click();await receipt.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>qa.previewCalls.at(-1).qrUrl),'https://possistem.az/xəritə?yer=Bakı');await page.screenshot({path:path.join(out,'receipt-preview.png')});await receipt.getByRole('button',{name:'Bağla',exact:true}).click();await receipt.getByRole('button',{name:'Çek ayarlarını saxla'}).click();assert.ok((await page.evaluate(()=>qa.settingWrites)).some(x=>x.key==='receipt.qrUrl'));
 await page.locator('.settings-rail button').nth(1).click();await page.frameLocator('iframe[title="Əməliyyatlar"]').locator('.ps-operations-page').waitFor({timeout:20000});assert.equal(await page.frameLocator('iframe[title="Əməliyyatlar"]').locator('.ps-ops-tabs button').count(),2,'Catalog has goods and categories');await page.screenshot({path:path.join(out,'catalog.png')});
 for(const offline of [false,true]){
  await page.goto(base+(offline?'?offline=1':''));await page.getByRole('button',{name:'QA Sale',exact:true}).click();await page.locator('.checkout-actions .pay').click();await page.locator('.payment-complete').waitFor();await page.locator('.payment-complete').evaluate(el=>{for(let i=0;i<5;i++)el.click()});await page.waitForTimeout(650);
  assert.equal(await page.evaluate(()=>qa.sales),1,'Five clicks produce one sale (offline='+offline+')');assert.equal(await page.evaluate(()=>qa.prints),offline?0:1);assert.equal(await page.locator('.payment-complete').count(),0);assert.equal(await page.locator('.checkout-actions .pay').isDisabled(),true);
 }
 await page.goto(base);await page.evaluate(()=>qa.failRefresh=true);await page.getByRole('button',{name:'QA Sale',exact:true}).click();await page.locator('.checkout-actions .pay').click();await page.locator('.payment-complete').click();await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>qa.sales),1);assert.equal(await page.locator('.checkout-actions .pay').isDisabled(),true,'Refresh failure never leaves a paid cart');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({layouts:results,checks:['printer discovery and assignment','separate printer/receipt destinations','one preview','QR draft payload and save','catalog opens','five rapid taps -> one sale/print','offline tap lock','paid cart clears on refresh failure'],errors},null,2));console.log('PASS Market 1.5.3 actual UI: touch layouts, embedded printer/receipt/catalog, payment rapid taps and refresh failure');
}catch(error){await page.screenshot({path:path.join(out,'failure.png')});console.error('Errors:',errors);console.error('Frames:',await Promise.all(page.frames().map(async f=>({url:f.url(),body:(await f.locator('body').innerText().catch(()=>'' )).slice(0,3500)}))));console.error('Calls:',await page.evaluate(()=>qa.calls.slice(-20)));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
