/** Render the shipped components against read-only, isolated IPC fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'../artifacts/restaurant-1.9.1/ui');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'index-DAmHwBc4.js'),'utf8');
const mock=`const ok=data=>Promise.resolve({success:true,data});
const sale={id:'sale-test',number:'001',totalMinor:1500,closedAt:Date.now(),tableName:'Masa 1',objectId:'branch-1',objectName:'Bakı',items:[{id:'line',name:'Çay',quantity:1,lineTotalMinor:1500}],payments:[]};
const account={id:'till-1',name:'Kassa 1',kind:'till',objectId:'branch-1',balanceMinor:3000};
window.qa={saved:[],printed:[],get:[]};
window.pos={business:{call:(action,payload)=>{if(action==='context')return ok({branchName:'Bakı filialı',accountName:'Kassa 1',manager:true});if(action==='documents')return ok({documents:[{type:'customer',id:'pay-1',name:'Aysel',kind:'payment',amountMinor:1500,createdAt:Date.now(),accountId:'till-1'}]});if(action==='staff')return ok({staff:[{id:'usr-1',name:'Elvin',customerId:'staff-1',salaryMinor:50000,objectId:'branch-1',warehouses:['wh-1']}]});qa.saved.push({action,payload});return ok({});},branches:()=>ok({branches:[{deviceId:'peer-1',name:'Gəncə',updatedAt:new Date().toISOString(),accounts:[account],lines:[{id:'goods-1',name:'Çay',warehouseName:'Gəncə anbarı',qty:2500,unit:'kg'}]}]})},cashAccounts:{list:()=>ok({objects:[{id:'branch-1',name:'Bakı'}],accounts:[account],terminals:[]})},sales:{list:()=>ok({sales:[sale],refunds:[]}),get:id=>{qa.get.push(id);return ok(sale)}},orders:{get:()=>ok(sale)},delivery:{couriers:()=>ok({couriers:[]}),listRange:()=>ok({deliveries:[{id:'del-1',orderId:'sale-test',orderNumber:'001',createdAt:Date.now(),customerName:'Aysel',address:'Bakı 1',totalMinor:1500,money:'paid',objectId:'branch-1',objectName:'Bakı'}]})},inventory:{warehouses:()=>ok({warehouses:[{id:'wh-1',name:'Bakı anbarı'}]})},suppliers:{list:()=>ok({suppliers:[]})},guests:{list:()=>ok({customers:[]})},cash:{list:()=>ok({movements:[]})},erp:{call:()=>ok({goods:[],categories:[],totals:{},docs:[]})},users:{list:()=>ok({users:[]})},roles:{list:()=>ok({roles:[]})},settings:{getAll:()=>ok({settings:{}})},catalog:{categories:()=>ok({categories:[]}),products:()=>ok({products:[]}),modifierGroups:()=>ok({groups:[]})},print:{enqueue:payload=>{qa.printed.push(payload);return ok({});}},license:{status:()=>ok({})}};
window.pos=new Proxy(window.pos,{get(target,key){return new Proxy(target[key]??{}, {get(group,method){return group[method]??(()=>ok({}));}})}});`;
const fixture=source.slice(0,source.indexOf('const container = document.getElementById("root");'))+`
useAuthStore.setState({session:{permissions:['order.view','order.create','payment.refund','kds.operate','settings.manage','users.manage','catalog.manage','inventory.view','inventory.count','suppliers.view','suppliers.pay','customers.view','customers.credit','delivery.view','delivery.manage','cash.manage','cash.accounts','sales.view','sales.edit','salary.manage']},ready:true});
function _psArea(){return true;}function PsGate(){return null;}
const qaRoot=clientExports.createRoot(document.getElementById('root'));
const qaPage=new URLSearchParams(location.search).get('page');
const qaComponents={shell:AppShell,deliverybutton:()=>psH('div',{className:'ps-shell',style:{display:'flex',justifyContent:'space-between'}},psH('button',null,'Əsas zal'),jsxRuntimeExports.jsx(PsDeliveryStartButton,{})),documents:PsDocuments,staff:PsStaffScope,branches:PsBranchNetwork,delivery:OpsDelivery,sales:OpsSales,catalog:PsUnifiedCatalog,staffpage:AdminStaffPage,dashboard:PsDashboardSales,branch:PsBranchBanner};
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
 const page=await browser.newPage({hasTouch:true});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
 const address=`http://127.0.0.1:${server.address().port}/qa.html`;
 for(const [width,height] of [[360,800],[768,1024],[1024,768],[1366,900],[1920,1080],[3840,2160]]){
  await page.setViewportSize({width,height});await page.goto(`${address}?page=shell#/tables`);await page.waitForTimeout(500);await page.locator('.ps-touch-sidebar').waitFor({timeout:3000});
  const buttons=page.locator('.ps-touch-sidebar .ps-nav');assert.ok(await buttons.count()>0);
  for(let i=0;i<await buttons.count();i++){const box=await buttons.nth(i).boundingBox();assert.ok(box.height>=72&&box.width>=72,'Touch target '+width);assert.equal(await buttons.nth(i).locator('.ps-touch-nav-label').isVisible(),true);}
  assert.equal(await page.locator('.ps-touch-nav-icon').first().evaluate(el=>el.complete&&el.naturalWidth>0),true,'PNG icon loaded');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Shell overflow '+width);await page.screenshot({path:path.join(out,'touch-shell-'+width+'.png')});
  await page.goto(`${address}?page=deliverybutton#/tables`);await page.getByRole('button',{name:'Çatdırılma',exact:true}).waitFor();await page.getByRole('button',{name:'Çatdırılma',exact:true}).click();await page.getByRole('dialog').waitFor();assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'touch-delivery-'+width+'.png')});
 }
 console.log('PASS touch sidebar PNG icons, visible labels, 72px targets and delivery dialog at 360 / 768 / 1024 / 1366 / 1920 / 3840 px');
}finally{await browser.close();server.close();}
