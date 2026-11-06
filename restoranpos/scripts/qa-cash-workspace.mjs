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
const out=path.join(root,'artifacts/cash-workspace');fs.mkdirSync(out,{recursive:true});
const before=process.argv.includes('--before');
const source=before?execFileSync('git',['show','HEAD:restoranpos/index-DAmHwBc4.js'],{cwd:root,encoding:'utf8',maxBuffer:30e6}):fs.readFileSync(root+'/index-DAmHwBc4.js','utf8');
// Reuse the printer/account/inventory fixture already used to test these very forms.
const existing=fs.readFileSync(root+'/scripts/qa-admin-real-pages.mjs','utf8');
const mock=existing.slice(existing.indexOf('const mock=`')+12,existing.indexOf('`;\nconst fixture='))+`\n
qa.cashCalls=[];qa.activityCalls=[];qa.holdTransfer=false;qa.failTransfer=false;
qa.cashData={objects:[{id:'qa-branch',name:'QA Restoran'}],terminals:[{id:'qa-pc',name:'QA PC',current:true}],currentTerminalId:'qa-pc',unassigned:[],accounts:[
{id:'qa-till',name:'QA Kassa',kind:'till',objectId:'qa-branch',objectName:'QA Restoran',terminalId:'qa-pc',balanceMinor:5530,todayCashMinor:17260,todayCardMinor:1200,totalCashMinor:90000,totalCardMinor:20000},
{id:'qa-bank',name:'QA Bank',kind:'bank',objectId:'qa-branch',objectName:'QA Restoran',balanceMinor:3890,todayCashMinor:0,todayCardMinor:1200,totalCashMinor:0,totalCardMinor:20000},
{id:'qa-safe',name:'QA Xəzinə',kind:'treasury',objectId:'qa-branch',objectName:'QA Restoran',balanceMinor:27000,todayInMinor:5000,todayOutMinor:1000,totalInMinor:50000}
]};
window.pos.cashAccounts={list:()=>ok(structuredClone(qa.cashData)),transfer:async(payload,options)=>{qa.cashCalls.push({payload,options});if(qa.holdTransfer)await new Promise(resolve=>qa.releaseTransfer=resolve);if(qa.failTransfer)return {success:false,error:{message:'QA transfer failed'}};return {success:true,data:{ok:true}}},save:()=>ok({id:'qa-till'}),deactivate:()=>ok({})};
window.pos.erp={call:async(method,payload)=>{if(method!=='cashAccounts.moves')return {success:true,data:{}};qa.activityCalls.push(payload);if(qa.failActivity)throw Error('QA history connection failed');return {success:true,data:{includesSales:true,openingMinor:1000,inMinor:6000,outMinor:1470,closingMinor:5530,moves:[{id:'sale',kind:'sale',amountMinor:6000,note:'Satış · QA-123',actorName:'QA Kassir',createdAt:Date.now()},{id:'expense',kind:'expense',amountMinor:-1470,note:'QA Maaş',actorName:'QA Müdir',createdAt:Date.now()}]}}}};
`;
assert.ok(mock.startsWith('const ok='),'Existing isolated fixture anchor');
const ast=ts.createSourceFile('renderer.js',source,99,true),rootAt=source.indexOf('const container = document.getElementById("root");');
let pre=source.slice(0,rootAt);
for(const node of ast.statements.filter(n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.getStart(ast)>rootAt))pre+='\n'+node.getText(ast);
const permissions=['settings.manage','backup.manage','users.manage','catalog.manage','tables.layout','inventory.view','inventory.count','inventory.manage','suppliers.view','customers.view','delivery.view','reports.export','cash.manage','cash.accounts','gifts.manage','reports.view','audit.view','payment.reconcile','payment.refund','sales.view','salary.manage','order.create','order.view','kds.operate'];
const fixture=pre+`\nwindow.qaSetPermissions=(permissions,userId='qa-admin',role='manager')=>useAuthStore.setState({session:{userId,role,fullName:'QA Müdir',permissions},ready:true});qaSetPermissions(${JSON.stringify(permissions)});
function ManagementQA(){const l=useLocation();return l.pathname==='/admin/cash'?psH(AdminCashPage):l.pathname==='/settings'?psH(SettingsPage):l.pathname==='/operations'?psH(OperationsPage):l.pathname==='/admin'?psH(AdminHubPage):psH('div',{className:'qa-route'},l.pathname);}
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
 await open('/admin?group=finance');
 assert.equal(await page.locator('.pm-module[href="#/admin/cash"]').count(),0,'No duplicate manual cash entry');
 assert.equal(await page.locator('.pm-module[href="#/operations?tab=kassa"]').count(),1,'Finance opens named accounts');
 await open('/admin/cash');await page.locator('.pm-cash-grid').waitFor();assert.ok(page.url().includes('tab=kassa'),'Legacy route redirects');
 const card=()=>page.getByRole('article',{name:'QA Kassa',exact:true});
 await card().getByRole('button',{name:'QA Kassa — Transfer aç',exact:true}).click();
 const dialog=()=>page.getByRole('dialog',{name:'Kassalar arası transfer'});
 await dialog().waitFor();assert.equal(await page.evaluate(()=>qa.cashCalls.length),0,'Card does not move money');
 assert.match(await dialog().locator('.pm-cash-transfer-summary').innerText(),/55.30/);
 assert.match(await dialog().locator('.pm-cash-transfer-summary').innerText(),/184.60/);
 await dialog().getByRole('combobox',{name:'Haraya',exact:true}).selectOption('qa-safe');
 await dialog().getByRole('button',{name:'Hamısını köçür',exact:true}).click();
 assert.equal(await dialog().getByRole('textbox',{name:'Məbləğ (₼)',exact:true}).inputValue(),'55.30','All uses balance, not turnover');
 await dialog().getByRole('textbox',{name:'Məbləğ (₼)',exact:true}).fill('55.31');
 assert.equal(await dialog().getByRole('button',{name:'Transfer et',exact:true}).isDisabled(),true,'Cannot overdraw');
 await dialog().getByRole('button',{name:'Hamısını köçür',exact:true}).click();
 await page.evaluate(()=>{qa.holdTransfer=true;qa.failTransfer=true});
 await dialog().getByRole('button',{name:'Transfer et',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.waitForFunction(()=>!!qa.releaseTransfer);assert.equal(await page.evaluate(()=>qa.cashCalls.length),1,'Repeated click creates one request');
 assert.equal(await dialog().getByRole('button',{name:'Köçürülür…',exact:true}).isDisabled(),true);
 await page.evaluate(()=>{qa.holdTransfer=false;qa.releaseTransfer()});
 await dialog().getByRole('alert').filter({hasText:'QA transfer failed'}).waitFor();
 await page.evaluate(()=>qa.failTransfer=false);
 await dialog().getByRole('button',{name:'Transfer et',exact:true}).click();await dialog().waitFor({state:'hidden'});
 const calls=await page.evaluate(()=>qa.cashCalls);assert.equal(calls.length,2);assert.equal(calls[0].payload.amountMinor,5530);assert.equal(calls[0].options.idempotencyKey,calls[1].options.idempotencyKey,'Retry reuses native intent key');
 await card().locator('summary[aria-label="QA Kassa — Əlavə əməliyyatlar"]').click();
 await card().getByRole('button',{name:'Redaktə et',exact:true}).click();await page.getByRole('dialog',{name:'Kassanı redaktə et'}).waitFor();
 await page.getByRole('dialog',{name:'Kassanı redaktə et'}).getByRole('button',{name:'İmtina',exact:true}).click();
 await card().locator('summary[aria-label="QA Kassa — Əlavə əməliyyatlar"]').click();await page.keyboard.press('Escape');assert.equal(await card().locator('details').getAttribute('open'),null);
 await card().locator('summary[aria-label="QA Kassa — Əlavə əməliyyatlar"]').click();
 await card().getByRole('button',{name:'Pul hərəkətləri',exact:true}).click();await page.locator('.pm-cash-activity-summary').waitFor();
 assert.equal(await page.evaluate(()=>qa.activityCalls.at(-1).includeSales),true);
 assert.match(await page.locator('.pm-cash-activity').innerText(),/Satış ödənişi/);
 const summary=await page.locator('.pm-cash-activity-summary').innerText();
 await page.getByPlaceholder('Axtar: qeyd, növ və ya əməkdaş').fill('Maaş');assert.equal(await page.locator('.pm-cash-activity tbody tr').count(),1);assert.equal(await page.locator('.pm-cash-activity-summary').innerText(),summary);
 await page.getByPlaceholder('Axtar: qeyd, növ və ya əməkdaş').fill('');
 for(const [width,height]of [[1536,816],[1366,735],[768,1024],[390,844]]){
  await page.setViewportSize({width,height});await page.screenshot({path:path.join(out,'cash-'+width+'.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page width '+width);
  await card().getByRole('button',{name:'Transfer',exact:false}).first().click();await dialog().waitFor();
  for(const el of await dialog().locator('input,select,button').all()){if(!await el.isVisible())continue;const box=await el.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'Dialog controls fit '+width);}
  await page.screenshot({path:path.join(out,'transfer-'+width+'.png')});await dialog().getByRole('button',{name:'İmtina',exact:true}).click();
 }
 await page.setViewportSize({width:1536,height:816});
 await page.evaluate(()=>qaSetPermissions(['cash.manage']));await page.waitForTimeout(150);
 assert.equal(await card().getByRole('button',{name:/Transfer/}).count(),0,'Read-only role cannot transfer');
 await card().locator('summary[aria-label="QA Kassa — Əlavə əməliyyatlar"]').click();
 assert.equal(await card().getByRole('button',{name:'Redaktə et',exact:true}).count(),0);assert.equal(await card().getByRole('button',{name:'Sil',exact:true}).count(),0);
 await open('/admin?group=finance');await page.evaluate(()=>qaSetPermissions([]));await page.waitForTimeout(150);assert.equal(await page.locator('.pm-module[href="#/operations?tab=kassa"]').count(),0,'Cash permission removed from hub');
 assert.deepEqual(errors,[]);console.log('Cash workspace passed: canonical routes, cards, transfer-all, overdraft, duplicate clicks, retry identity, menu, unified ledger, permissions, 4 viewports. Browser '+browser.version());
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
