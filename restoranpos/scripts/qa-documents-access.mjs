/** Render the shipped components against read-only, isolated IPC fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'../artifacts/admin-documents-switch/documents-ui');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'index-DAmHwBc4.js'),'utf8');
const mock=`const ok=data=>Promise.resolve({success:true,data});
const sale={id:'sale-test',number:'001',totalMinor:1500,closedAt:Date.now(),tableName:'Masa 1',objectId:'branch-1',objectName:'Bakı',items:[{id:'line',name:'Çay',quantity:1,lineTotalMinor:1500}],payments:[]};
const account={id:'till-1',name:'Kassa 1',kind:'till',objectId:'branch-1',balanceMinor:3000};
window.qa={saved:[],printed:[],get:[]};
window.pos={business:{call:(action,payload)=>{if(action==='context')return ok({branchName:'Bakı filialı',accountName:'Kassa 1',manager:true});if(action==='documents')return ok({documents:[{type:'customer',id:'pay-1',name:'Aysel',kind:'payment',amountMinor:1500,createdAt:Date.now(),accountId:'till-1'}]});if(action==='staff')return ok({staff:[{id:'usr-1',name:'Elvin',customerId:'staff-1',salaryMinor:50000,objectId:'branch-1',warehouses:['wh-1']}]});qa.saved.push({action,payload});return ok({});},branches:()=>ok({branches:[{deviceId:'peer-1',name:'Gəncə',updatedAt:new Date().toISOString(),accounts:[account],lines:[{id:'goods-1',name:'Çay',warehouseName:'Gəncə anbarı',qty:2500,unit:'kg'}]}]})},cashAccounts:{list:()=>ok({objects:[{id:'branch-1',name:'Bakı'}],accounts:[account],terminals:[]})},sales:{list:()=>ok({sales:[sale],refunds:[]}),get:id=>{qa.get.push(id);return ok(sale)}},orders:{get:()=>ok(sale)},delivery:{couriers:()=>ok({couriers:[]}),listRange:()=>ok({deliveries:[{id:'del-1',orderId:'sale-test',orderNumber:'001',createdAt:Date.now(),customerName:'Aysel',address:'Bakı 1',totalMinor:1500,money:'paid',objectId:'branch-1',objectName:'Bakı'}]})},inventory:{warehouses:()=>ok({warehouses:[{id:'wh-1',name:'Bakı anbarı'}]})},suppliers:{list:()=>ok({suppliers:[]})},guests:{list:()=>ok({customers:[]})},cash:{list:()=>ok({movements:[]})},erp:{call:()=>ok({goods:[],categories:[],totals:{},docs:[]})},users:{list:()=>ok({users:[]})},roles:{list:()=>ok({roles:[]})},settings:{getAll:()=>ok({settings:{}})},catalog:{categories:()=>ok({categories:[]}),products:()=>ok({products:[]}),modifierGroups:()=>ok({groups:[]})},print:{enqueue:payload=>{qa.printed.push(payload);return ok({});}},license:{status:()=>ok({})}};
window.pos.cashAccounts.saveObject=p=>{qa.saved.push(p);return ok({});};
window.pos=new Proxy(window.pos,{get(target,key){return new Proxy(target[key]??{}, {get(group,method){return group[method]??(()=>ok({}));}})}});`;
const fixture=source.slice(0,source.indexOf('const container = document.getElementById("root");'))+`
useAuthStore.setState({session:{role:'administrator',permissions:['reports.view','order.view','order.create','payment.refund','kds.operate','settings.manage','users.manage','catalog.manage','inventory.view','inventory.count','suppliers.view','suppliers.pay','customers.view','customers.credit','delivery.view','delivery.manage','cash.manage','cash.accounts','sales.view','sales.edit','salary.manage']},ready:true});
const params=new URLSearchParams(location.search);window.__psMarketMode=params.get('market')==='1';useAuthStore.setState({session:{...useAuthStore.getState().session,canPaymentDocuments:params.get('staff')!=='warehouse',permissions:params.has('perms')?params.get('perms').split(','):useAuthStore.getState().session.permissions}});const originalBusiness=window.pos.business.call;window.pos.business.call=(action,payload)=>{if(action==='documents')return Promise.resolve(qa.failDocuments?{success:false,error:{code:'E_FORBIDDEN',message:'Qaimə sınaq xətası'}}:{success:true,data:{documents:[{type:'customer',id:'payment-1',name:'Aysel',amountMinor:1200,createdAt:Date.now(),accountId:'till-1',partyId:'customer-1'}]}});return originalBusiness(action,payload);};function _psArea(){return true;}function PsGate(){return null;}
const qaRoot=clientExports.createRoot(document.getElementById('root'));
const qaPage=new URLSearchParams(location.search).get('page');
const qaComponents={operations:OperationsPage,hub:AdminHubPage,objects:OpsObjects,kassa:OpsKassalar,shell:AppShell,deliverybutton:()=>psH('div',{className:'ps-shell',style:{display:'flex',justifyContent:'space-between'}},psH('button',null,'Əsas zal'),jsxRuntimeExports.jsx(PsDeliveryStartButton,{})),documents:PsDocuments,staff:PsStaffScope,branches:PsBranchNetwork,delivery:OpsDelivery,sales:OpsSales,catalog:PsUnifiedCatalog,staffpage:AdminStaffPage,dashboard:PsDashboardSales,branch:PsBranchBanner};
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
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));const base='http://127.0.0.1:'+server.address().port+'/qa.html';
for(const market of [0,1]){for(const perms of ['cash.manage','customers.credit','suppliers.pay','salary.manage']){await page.goto(base+'?page=operations&market='+market+'&perms='+perms+'#/operations?tab=documents');await page.locator('.ps-business-documents').waitFor();const tab=page.getByRole('button',{name:'Ödəniş qaimələri',exact:true});assert.equal(await tab.getAttribute('aria-disabled'),null);}}
await page.goto(base+'?page=operations&market=1&staff=warehouse#/operations?tab=stock');assert.equal(await page.getByRole('button',{name:'Ödəniş qaimələri',exact:true}).getAttribute('aria-disabled'),'true');
await page.goto(base+'?page=operations&market=1#/operations?tab=documents');await page.locator('.ps-business-documents').waitFor();await page.evaluate(()=>qa.failDocuments=true);await page.getByRole('button',{name:'Düzəliş',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Bağla',exact:true}).click().catch(async()=>{await page.keyboard.press('Escape')});
// Remount the real component to exercise the initial failure and retry path.
await page.getByRole('button',{name:'Kassalar',exact:true}).click();await page.getByRole('button',{name:'Ödəniş qaimələri',exact:true}).click();await page.getByRole('alert').filter({hasText:'Qaimə sınaq xətası'}).waitFor();assert.equal(await page.getByText('Yüklənir…',{exact:true}).count(),0);await page.evaluate(()=>qa.failDocuments=false);await page.getByRole('button',{name:'Yenidən yoxla',exact:true}).click();await page.locator('.ps-business-documents tbody tr').first().waitFor();assert.equal(await page.getByRole('alert').count(),0);
assert.deepEqual(errors,[]);console.log('PASS real Restaurant/Market documents tabs for admin and each financial permission; warehouse remains restricted; explicit failure and retry recover without an endless spinner.');
}finally{await browser.close();server.close();}
