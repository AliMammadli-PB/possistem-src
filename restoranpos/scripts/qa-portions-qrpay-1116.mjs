


// Half portion (product editor + sale screen) and Parametrlər → QR ödəniş on the real UI and core.
//   node scripts/qa-portions-qrpay-1116.mjs <out-dir>
import {execFileSync,spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),phase='after',out=path.resolve(process.argv[2]||root+'/../../local-portions-1116');fs.mkdirSync(out,{recursive:true});
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
const fixture=pre+`\nuseAuthStore.setState({session:{userId:'usr-admin',role:'administrator',authenticated:true,permissions:['inventory.view','inventory.manage','catalog.manage','recipes.manage','settings.manage','cash.manage','cash.accounts','tables.layout','salary.manage','users.manage','order.create','order.send','payment.take']},ready:true});const qp=new URLSearchParams(location.search);function QA(){return qp.get('page')==='order'?psH(PsOriginalOrderPage):qp.get('page')==='costing'?psH(OpsCosting):qp.get('page')==='expenses'?psH(OpsExpenses):qp.get('page')==='salary'?psH(OpsSalary):qp.get('page')==='tables'?psH(AdminTablesPage):qp.get('page')==='qrpay'?psH(PsQrPaySettings):psH(PsUnifiedCatalog);}clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{path:qp.get('page')==='order'?'/order/:tableId':'*',element:psH(AppShell)}))));`;
const preload=`(()=>{const fakeElectron={contextBridge:{exposeInMainWorld:(k,v)=>{window[k]=v}},ipcRenderer:{invoke:(ch,req)=>ch==='pos:invoke'?window.coreCall(req.method,req.payload??{},req.options??{}):Promise.resolve({success:false,error:{code:'E_QA',message:'not in this test: '+ch}}),on(){},removeListener(){},removeAllListeners(){},send(){}},webFrame:{setZoomFactor(){},setVisualZoomLevelLimits(){}}};const require=n=>{if(n==='electron')return fakeElectron;throw Error('preload require '+n)};const exports={},module={exports};\n${fs.readFileSync(root+'/out/preload/index.js','utf8')}\n})();`;
const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/qa'){res.setHeader('content-type','text/html');return res.end(`<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script src="/preload.js"></script><script type="module" src="/assets/qa.js"></script></body></html>`)}if(u==='/preload.js'){res.setHeader('content-type','text/javascript');return res.end(preload)}if(u==='/assets/qa.js'){res.setHeader('content-type','text/javascript');return res.end(fixture)}const f=u==='/base.css'?root+'/packaged-renderer/assets/index-DFpMFaZu.css':u==='/system.css'?root+'/possistem-system.css':root+'/packaged-renderer'+u;if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.setHeader('content-type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'application/octet-stream');return res.end(fs.readFileSync(f))}res.statusCode=404;res.end()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
let failNext='';const qrCalls=[];let merchant=null;const qrPay=(m,x)=>{qrCalls.push([m,x]);if(m==='qr.payments.merchant')return{success:true,data:{globallyEnabled:true,merchant,ready:{available:!!merchant?.active,reason:merchant?null:'Parametrlər → QR ödəniş bölməsində restoranın Epoint açarlarını daxil edin.'}}};if(m==='qr.payments.saveMerchant'){merchant={publicKey:x.publicKey,active:x.active,verified:true,callbackUrl:'https://possistem.az/pos/api/billing/table/epoint/callback/m-1'};return{success:true,data:{id:'m-1',callbackUrl:merchant.callbackUrl}}}return{success:false,error:{message:'qa'}}};
const open=async(query,hash)=>{const p=await b.newPage({viewport:{width:1536,height:816}});p.setDefaultTimeout(8000);p.errors=[];p.on('pageerror',e=>{p.errors.push(e.message);console.log('PAGEERROR',e.message.slice(0,300))});p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,300))});await p.exposeFunction('coreCall',(m,x,o)=>{if(m.startsWith('qr.payments.'))return qrPay(m,x);if(failNext&&m==='catalog.upsertProduct'&&x.id===failNext){failNext='';return {success:false,error:{message:'Sınaq: bir məhsul saxlanılmadı'}};}return core.call(m,x,o)});await p.goto(`http://127.0.0.1:${server.address().port}/qa?${query}#/${hash}`);await p.waitForTimeout(1200);return p};
try{
 // 1. Product editor: give the first dish a half-portion price.
 const cat=must(await core.call('catalog.upsertCategory',{nameAz:'Yeməklər',nameTr:'Yemekler',nameEn:'Food',sortOrder:1},key()));const catId=cat.id??cat.category?.id;
 const made=must(await core.call('catalog.upsertProduct',{nameAz:'Dolma',nameTr:'Dolma',nameEn:'Dolma',priceMinor:600,categoryId:catId,station:'kitchen',course:'main',active:true,sortOrder:1},key()));
 const target={id:made.id??made.product?.id,nameAz:'Dolma',priceMinor:600};console.log('dish',target.nameAz,target.priceMinor);
 const p=await open('page=catalog','admin/catalog');await p.waitForTimeout(800);
 await p.getByText(target.nameAz,{exact:true}).first().click();await p.waitForTimeout(800);
 await p.screenshot({path:`${out}/catalog-click.png`});
 const half=p.getByLabel('Yarım porsiya qiyməti');
 if(!(await half.count())){const edit=p.getByRole('button',{name:/Redaktə|Düzəliş|redaktə/}).first();await edit.click();await p.waitForTimeout(800);}
 await half.fill('3.50');await p.screenshot({path:`${out}/editor-half-1536.png`});
 await p.getByRole('button',{name:/^(Yadda saxla|Saxla)$/}).first().click();await p.waitForTimeout(1200);
 const groups=must(await core.call('catalog.modifierGroups',{productId:target.id})).groups;
 const g=groups.find(x=>x.id==='portion:'+target.id);assert.ok(g,'portion group saved from the editor');
 assert.equal(target.priceMinor+g.modifiers[0].priceDeltaMinor,350);console.log('PASS editor saved half portion 3.50');
 // 2. Sale screen: the dish offers 1 porsiya / Yarım porsiya.
 const o=await open('page=order','order/tbl-qa');await o.waitForTimeout(1500);
 await o.getByText(target.nameAz,{exact:true}).first().click();await o.waitForTimeout(800);
 await o.screenshot({path:`${out}/order-portion-1536.png`});
 await o.getByRole('button',{name:/Yarım porsiya/}).click();await o.getByRole('button',{name:/Təsdiq|Confirm|Əlavə/}).last().click();await o.waitForTimeout(1200);
 const orders=must(await core.call('orders.list',{})).orders??[];const order=orders.find(x=>x.tableId==='tbl-qa');assert.ok(order,'order opened');
 const full=must(await core.call('orders.get',{orderId:order.id}));const line=full.items.find(x=>x.productId===target.id);
 assert.ok(line,'line added');assert.equal(line.modifiers?.[0]?.name??line.modifiers?.[0]?.nameSnapshot,'Yarım porsiya');assert.equal(line.lineTotalMinor,350);
 await o.screenshot({path:`${out}/order-after-1536.png`});console.log('PASS sale screen added half portion',line.lineTotalMinor);
 // 3. Parametrlər → QR ödəniş.
 for(const [w,hgt] of [[1536,816],[768,1024],[390,844]]){const q=await open('page=qrpay','settings');await q.setViewportSize({width:w,height:hgt});await q.waitForTimeout(500);
  if(w===1536){await q.getByRole('textbox',{name:'Public key'}).fill('i000000123');await q.getByLabel('Private key').fill('test-private-key');await q.getByRole('button',{name:'Saxla'}).click();await q.waitForTimeout(800);
   const save=qrCalls.find(c=>c[0]==='qr.payments.saveMerchant');assert.deepEqual(save[1],{publicKey:'i000000123',privateKey:'test-private-key',active:true});
   assert.equal(await q.getByLabel('Private key').inputValue(),'');assert.ok(await q.getByText('İşləyir').count());assert.ok(await q.getByText('callback/m-1').count());}
  const over=await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(over,false,'no horizontal scroll at '+w);
  await q.screenshot({path:`${out}/qrpay-${w}.png`,fullPage:true});assert.deepEqual(q.errors,[]);}
 console.log('PASS QR pay settings saved, status İşləyir, no overflow');
 assert.deepEqual(p.errors,[]);assert.deepEqual(o.errors,[]);
}finally{await b.close();server.close();await core.stop();fs.rmSync(dir,{recursive:true,force:true});}
console.log('screens:',out);
