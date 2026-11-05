// A new computer restores the account's cloud copy from the backup screen: real core, real preload, real screen,
// the till client's own import. Only the main-process wiring (cloudList/cloudFetch) is played here, as _psCloudFetch does it.
//   node scripts/qa-cloud-restore-1108.mjs
import {execFileSync,spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';import {createRequire} from 'node:module';import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),phase='after',out=process.env.QA_OUT||path.resolve(root,'../../qa-cloud-restore-1108');fs.mkdirSync(out,{recursive:true});
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
const fixture=pre+`\nuseAuthStore.setState({session:{userId:'usr-admin',role:'administrator',authenticated:true,permissions:['inventory.view','inventory.manage','catalog.manage','recipes.manage','settings.manage','cash.manage','cash.accounts','salary.manage','users.manage','order.create','order.send','payment.take','backup.manage']},ready:true});const qp=new URLSearchParams(location.search);function QA(){return psH(AdminBackupPage);}clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{path:qp.get('page')==='order'?'/order/:tableId':'*',element:psH(AppShell)}))));`;
const preload=`(()=>{const fakeElectron={contextBridge:{exposeInMainWorld:(k,v)=>{window[k]=v}},ipcRenderer:{invoke:(ch,req)=>ch==='pos:invoke'?window.coreCall(req.method,req.payload??{},req.options??{}):Promise.resolve({success:false,error:{code:'E_QA',message:'not in this test: '+ch}}),on(){},removeListener(){},removeAllListeners(){},send(){}},webFrame:{setZoomFactor(){},setVisualZoomLevelLimits(){}}};const require=n=>{if(n==='electron')return fakeElectron;throw Error('preload require '+n)};const exports={},module={exports};\n${fs.readFileSync(root+'/out/preload/index.js','utf8')}\n})();`;
const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/qa'){res.setHeader('content-type','text/html');return res.end(`<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script src="/preload.js"></script><script type="module" src="/assets/qa.js"></script></body></html>`)}if(u==='/preload.js'){res.setHeader('content-type','text/javascript');return res.end(preload)}if(u==='/assets/qa.js'){res.setHeader('content-type','text/javascript');return res.end(fixture)}const f=u==='/base.css'?root+'/packaged-renderer/assets/index-DFpMFaZu.css':u==='/system.css'?root+'/possistem-system.css':root+'/packaged-renderer'+u;if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('content-type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'application/octet-stream');return res.end(fs.readFileSync(f))}res.statusCode=404;res.end()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
let failNext='';
const open=async(query,hash)=>{const p=await b.newPage({viewport:{width:1536,height:816}});p.setDefaultTimeout(8000);p.errors=[];p.on('pageerror',e=>{p.errors.push(e.message);console.log('PAGEERROR',e.message.slice(0,300))});p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,300))});await p.exposeFunction('coreCall',async(m,x,o)=>{if(m==='backup.cloudList')return cloudList();if(m==='backup.cloudFetch')return cloudFetch(x);if(failNext&&m==='catalog.upsertProduct'&&x.id===failNext){failNext='';return {success:false,error:{message:'Sınaq: bir məhsul saxlanılmadı'}};}return core.call(m,x,o)});await p.goto(`http://127.0.0.1:${server.address().port}/qa?${query}#/${hash}`);await p.waitForTimeout(1200);return p};
const req=createRequire(import.meta.url),format=req(root+'/out/main/cloud-backup-format.cjs'),client=req(root+'/out/main/cloud-backup-client.cjs');
const customer='cust-qa';
// The shop on the old computer: a marker and a dish, packed as the till client packs it.
const oldDir=dir+'-old';fs.mkdirSync(oldDir+'/logs',{recursive:true});
{const c=spawn('wine',[coreExe,'--db',z(oldDir+'/pos.db'),'--log-dir',z(oldDir+'/logs'),'--protocol','1'],{stdio:['pipe','pipe','pipe'],env:{...process.env,WINEDEBUG:'-all'}});let out='';await new Promise(r=>{c.stdout.on('data',d=>{out+=d;if(out.includes('core.ready'))r()})});await new Promise(r=>{c.on('close',r);c.stdin.end()});}
{const d=new DatabaseSync(oldDir+'/pos.db');d.exec(`INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES('qa-marker','old-shop',1);INSERT INTO menu_categories(id,name_az,name_tr,name_en) VALUES('qa-cat','Pizza','Pizza','Pizza');INSERT INTO menu_items(id,sku,created_at,updated_at,category_id,name_az,name_tr,name_en,price_minor) VALUES('qa-dish','QA-1',1,1,'qa-cat','Marqarita','Marqarita','Marqarita',900);`);d.close();}
const bundle=dir+'-download.posbackup';fs.writeFileSync(bundle,await format.make(oldDir+'/pos.db',oldDir+'/catalog-assets',{customerId:customer,deviceId:'old-pc',appVersion:'1.10.7'}));
const cloudList=async()=>({success:true,data:[{id:'11111111-2222-3333-4444-555555555555',created_at:new Date().toISOString(),hostname:'KASSA-1',this_device:false,tables:{menu_items:1,orders:0,payments:0,users:1}}]});
const cloudFetch=async x=>{assert.equal(x.backupId,'11111111-2222-3333-4444-555555555555');fs.mkdirSync(dir+'/backups',{recursive:true});const dest=dir+'/backups/pos-cloud-'+Date.now()+'.db';
 await client.importBundle(bundle,dest,dir+'/catalog-assets',customer);return core.call('backup.import',{path:z(dest),note:'Buluddan yüklənib'});};
let stopped=false;
try{
 const p=await open('page=backup','admin/backup');
 await p.getByRole('button',{name:'Buluddan bərpa et'}).click();
 const group=p.getByRole('group',{name:'Serverdəki nüsxələr'});await group.waitFor();
 assert.match(await group.innerText(),/KASSA-1/);assert.match(await group.innerText(),/1 menyu malı · 0 sifariş/);
 await p.screenshot({path:out+'/list-1536.png'});
 await group.getByRole('button',{name:'Bu kompüterə bərpa et'}).click();
 const dialog=p.getByRole('dialog');await dialog.waitFor();
 await dialog.locator('input').last().fill('1234');await p.screenshot({path:out+'/dialog-1536.png'});
 await dialog.getByRole('button').filter({hasNotText:/İmtina|Ləğv|Bağla|Cancel/}).last().click();
 await dialog.waitFor({state:'detached'});
 await core.stop();stopped=true;
 const d=new DatabaseSync(dir+'/pos.db',{readOnly:true});
 assert.equal(d.prepare("SELECT value FROM app_settings WHERE key='qa-marker'").get().value,'old-shop','the old shop is on the new computer');
 assert.equal(d.prepare("SELECT name_az FROM menu_items WHERE id='qa-dish'").get().name_az,'Marqarita');
 assert.ok(d.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='backup.restore'").get().n>=1,'the restore is in the restored history');d.close();
 assert.ok(fs.readdirSync(dir+'/backups').some(n=>n.includes('prerestore')),'a safety copy of the new computer was taken first');
 assert.equal(fs.readdirSync(dir+'/backups').filter(n=>n.endsWith('.posbackup')).length,0);
 assert.equal(p.errors.length,0,p.errors.join('\n'));
 console.log('QA cloud restore 1108: ok');
}finally{await b.close();server.close();if(!stopped)await core.stop();}
