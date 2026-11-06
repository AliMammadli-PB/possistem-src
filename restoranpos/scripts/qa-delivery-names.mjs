// Delivery names, the sidebar entry and order creation in Delivery. Real core and screen.
//   node scripts/qa-delivery-names.mjs
import {execFileSync,spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),phase='after',out=process.env.QA_OUT||path.resolve(root,'../../qa-delivery-names');fs.mkdirSync(out,{recursive:true});
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
const fixture=pre+`\nuseAuthStore.setState({session:{userId:'usr-admin',role:'administrator',authenticated:true,permissions:['inventory.view','inventory.manage','catalog.manage','recipes.manage','settings.manage','cash.manage','cash.accounts','salary.manage','users.manage','order.create','order.send','payment.take','delivery.view','delivery.manage','delivery.assign','tables.layout','order.view']},ready:true});const qp=new URLSearchParams(location.search);function QA(){const route=useLocation();return route.pathname==='/operations'?psH(OperationsPage):route.pathname.startsWith('/orders/')?psH('p',{'data-qa-created-order':true},route.pathname):psH(TablesPage);}clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{path:'*',element:psH(AppShell)}))));`;
const preload=`(()=>{const fakeElectron={contextBridge:{exposeInMainWorld:(k,v)=>{window[k]=v}},ipcRenderer:{invoke:(ch,req)=>ch==='pos:invoke'?window.coreCall(req.method,req.payload??{},req.options??{}):Promise.resolve({success:false,error:{code:'E_QA',message:'not in this test: '+ch}}),on(){},removeListener(){},removeAllListeners(){},send(){}},webFrame:{setZoomFactor(){},setVisualZoomLevelLimits(){}}};const require=n=>{if(n==='electron')return fakeElectron;throw Error('preload require '+n)};const exports={},module={exports};\n${fs.readFileSync(root+'/out/preload/index.js','utf8')}\n})();`;
const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/qa'){res.setHeader('content-type','text/html');return res.end(`<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script src="/preload.js"></script><script type="module" src="/assets/qa.js"></script></body></html>`)}if(u==='/preload.js'){res.setHeader('content-type','text/javascript');return res.end(preload)}if(u==='/assets/qa.js'){res.setHeader('content-type','text/javascript');return res.end(fixture)}const f=u==='/base.css'?root+'/packaged-renderer/assets/index-DFpMFaZu.css':u==='/system.css'?root+'/possistem-system.css':root+'/packaged-renderer'+u;if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('content-type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'application/octet-stream');return res.end(fs.readFileSync(f))}res.statusCode=404;res.end()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
let failNext='';
const open=async(query,hash)=>{const p=await b.newPage({viewport:{width:1536,height:816}});p.setDefaultTimeout(8000);p.errors=[];p.on('pageerror',e=>{p.errors.push(e.message);console.log('PAGEERROR',e.message.slice(0,300))});p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,300))});await p.exposeFunction('coreCall',(m,x,o)=>{if(failNext&&m==='catalog.upsertProduct'&&x.id===failNext){failNext='';return {success:false,error:{message:'Sınaq: bir məhsul saxlanılmadı'}};}return core.call(m,x,o)});await p.goto(`http://127.0.0.1:${server.address().port}/qa?${query}#/${hash}`);await p.waitForTimeout(1200);return p};
try{
 const a=must(await core.call('delivery.start',{customerName:'Aysel Məmmədova',phone:'0501112233',address:'Nizami 10'},key()));
 const b2=must(await core.call('delivery.start',{customerName:'',phone:'0502223344',address:'Füzuli 5'},key()));
 const p=await open('page=tables','tables');
 await p.getByRole('button',{name:'Çatdırılma',exact:true}).first().click().catch(()=>{});
 await p.waitForTimeout(800);
 await p.screenshot({path:out+'/'+(process.env.QA_TAG||'shot')+'-1536.png'});
 await p.setViewportSize({width:1000,height:760});await p.waitForTimeout(500);
 await p.screenshot({path:out+'/'+(process.env.QA_TAG||'shot')+'-1000.png'});
 const tiles=await p.locator('.table-tile__num').allTextContents();console.log('TILES',JSON.stringify(tiles));
 assert.equal(await p.locator('.ps-delivery-start,.ps-delivery-new').count(),0,'Floor has no delivery creation shortcut');
 const side=p.locator('.ps-touch-sidebar a[href="#/operations?tab=delivery"]');assert.equal(await side.count(),1,'Delivery has one main sidebar entry');
 assert.ok((await side.locator('img').getAttribute('src')).endsWith('delivery-sidebar-white.png'),'Sidebar uses the white PNG');
 assert.ok(await side.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0),'White icon loads successfully');
 globalThis.qaPage=p;globalThis.qaIds={a,b2};
 // Asserts: name on the tile, a nameless delivery and a hall table keep their number,
 // a correction in the delivery invoice renames the tile; IDs remain stable.
 assert.ok(tiles.includes('Aysel Məmmədova'),'customer name on delivery tile');
 assert.ok(tiles.includes('2'),'nameless delivery keeps its number');
 must(await core.call('business.call',{action:'delivery.update',id:b2.id,customerName:'Rəşad',phone:'0502223344',address:'Füzuli 5',note:''},key()));
 await p.reload();await p.waitForTimeout(1200);
 await p.getByRole('button',{name:'Çatdırılma',exact:true}).first().click();await p.waitForTimeout(600);
 assert.deepEqual((await p.locator('.table-tile__num').allTextContents()).sort(),['Aysel Məmmədova','Rəşad']);
 await p.getByRole('button',{name:'Zal',exact:true}).click();await p.waitForTimeout(600);
 assert.deepEqual(await p.locator('.table-tile__num').allTextContents(),['5'],'hall table keeps its number');
 // The delivery table's own label is untouched, so old sales on it read as before.
 const db2=new DatabaseSync(dir+'/pos.db');assert.equal(db2.prepare('SELECT label FROM restaurant_tables WHERE id=?').get(a.tableId).label,'Ç-1');db2.close();
 // The order screen title reads the same field from tables.get.
 assert.equal(must(await core.call('tables.get',{tableId:a.tableId})).deliveryName,'Aysel Məmmədova');
 await side.click();await p.getByRole('button',{name:'+ Yeni sifariş',exact:true}).waitFor();
 await p.getByRole('button',{name:'+ Yeni sifariş',exact:true}).click();
 const dialog=p.getByRole('dialog',{name:'Yeni çatdırılma sifarişi',exact:true});await dialog.waitFor();
 await dialog.getByLabel('Müştəri',{exact:true}).fill('QA Ağ ikon');
 await dialog.getByLabel('Ünvan',{exact:true}).fill('QA ünvanı 1');
 await dialog.getByRole('button',{name:'Sifarişi aç',exact:true}).click();
 await p.waitForURL('**#/orders/**');
 const createdTableId=new URL(p.url()).hash.split('/').at(-1);
 assert.equal(must(await core.call('tables.get',{tableId:createdTableId})).deliveryName,'QA Ağ ikon','Delivery page creates an actual delivery order');
 assert.equal(p.errors.length,0,p.errors.join('\n'));
 console.log('PASS real core: delivery names and IDs preserved; floor shortcut removed; one white sidebar icon; Delivery creates a new order');
}finally{await b.close();server.close();await core.stop();}
