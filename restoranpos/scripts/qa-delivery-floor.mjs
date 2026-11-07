// Real renderer, synthetic long customer text, isolated IPC: never touches a customer database.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {chromium} from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=root+'/artifacts/delivery-floor';fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(root+'/index-DAmHwBc4.js','utf8');
const existing=fs.readFileSync(root+'/scripts/qa-admin-real-pages.mjs','utf8');
const mock=existing.slice(existing.indexOf('const mock=`')+12,existing.indexOf('`;\nconst fixture='))+`
qa.settlements=[];qa.newDeliveries=[];
qa.deliveries=Array.from({length:4},(_,i)=>({id:'delivery-'+i,tableId:'delivery-table',orderId:'order-delivery-table',orderNumber:'A-20261106-00'+i,createdAt:Date.now(),customerName:i===0?'A'.repeat(180):'QA Müştəri '+i,phone:'1234567890'.repeat(i===0?8:1),address:i===0?'unbrokenaddress'.repeat(18):'Bakı, QA küçəsi',courierId:'qa-courier',courierName:'QA Kuryer',objectName:'QA Restoran',money:'unpaid',status:'delivered',totalMinor:950,dueMinor:950}));
qa.tables=Array.from({length:6},(_,i)=>({id:'table-'+i,label:String(i+1),areaId:'area-salon',seats:4,status:i<2?'occupied':'available',orderId:i<2?'order-table-'+i:null,totalMinor:i===0?1200:2400,billPrinted:i===1}));
qa.tables.push({id:'delivery-table',label:'Çatdırılma',deliveryName:'QA Çatdırılma',areaId:'area-delivery',status:'occupied',orderId:'order-delivery-table',seats:1});
window.pos.core={onEvent:()=>()=>{}};window.pos.business={call:method=>ok(method==='sale.readiness'?{ready:true}:{branchName:'QA Restoran',accountName:'Kassa'})};
window.pos.tables={list:()=>ok({areas:[{id:'area-salon',nameAz:'Zal'},{id:'area-cabinet',nameAz:'Kabinet'},{id:'area-delivery',nameAz:'Çatdırılma'}],tables:qa.tables}),get:id=>ok(qa.tables.find(t=>t.id===id))};
window.pos.orders={get:id=>ok({id,tableId:id.replace('order-',''),orderNumber:'QA-1',status:'open',items:[],guestCount:2,totalMinor:1200,paidMinor:0,subtotalMinor:1200,taxMinor:0,serviceMinor:0})};
window.pos.cashAccounts={list:()=>ok({accounts:[{id:'qa-till',name:'QA Kassa',kind:'till',terminalId:'qa-terminal',balanceMinor:0}],currentTerminalId:'qa-terminal'})};
window.pos.delivery={listRange:()=>ok({deliveries:qa.deliveries,objects:[]}),couriers:()=>ok({couriers:[{id:'qa-courier',name:'QA Kuryer',active:1}]}),settle:(payload,options)=>{qa.settlements.push({payload,options});qa.deliveries=qa.deliveries.map(row=>payload.deliveryIds.includes(row.id)?{...row,money:'paid',dueMinor:0}:row);return ok({})}};
window.pos.delivery.start=async payload=>{qa.newDeliveries.push(payload);if(qa.holdDelivery)await new Promise(resolve=>qa.releaseDelivery=resolve);return {success:true,data:{tableId:'delivery-table'}}};
window.possistemQr={call:()=>ok({orders:[]})};
`;
const ast=ts.createSourceFile('renderer.js',source,99,true),rootAt=source.indexOf('const container = document.getElementById("root");');
let actionDefinition;
const findActions=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='actionsFor')actionDefinition=node.initializer;ts.forEachChild(node,findActions);};findActions(ast);
assert.ok(actionDefinition,'Actual floor action definition exists');
const actionsFor=new Function('t','useFloorPlan','PS_DELIVERY_AREA','return '+actionDefinition.getText(ast))({tables:{}},true,'area-delivery');
assert.deepEqual(actionsFor({areaId:'area-delivery',orderId:'qa'}).map(action=>action.id),['open']);
assert.ok(actionsFor({areaId:'area-salon',orderId:'qa'}).some(action=>action.id==='payment'));
assert.ok(actionsFor({areaId:'area-salon',orderId:'qa'}).some(action=>action.id==='relocate'));
let pre=source.slice(0,rootAt);
for(const node of ast.statements.filter(n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.getStart(ast)>rootAt))pre+='\n'+node.getText(ast);
const permissions=['settings.manage','users.manage','catalog.manage','tables.layout','order.transfer','order.create','order.view','payment.take','inventory.view','cash.manage','delivery.view','delivery.assign','delivery.manage'];
const fixture=pre+`\nuseAuthStore.setState({session:{userId:'qa-manager',role:'manager',permissions:${JSON.stringify(permissions)}},ready:true});
window.qaDeliveryAccess=enabled=>useAuthStore.setState({session:{userId:'qa-manager',role:'manager',permissions:${JSON.stringify(permissions)}.filter(key=>enabled||key!=='delivery.manage')}});
clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{element:psH(AppShell)},psH(Route,{path:'/tables',element:psH(TablesPage)}),psH(Route,{path:'/orders/:tableId',element:psH(OrderPage)}),psH(Route,{path:'*',element:psH(OperationsPage)})))));`;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://local').pathname;
 if(u==='/qa'){res.setHeader('content-type','text/html');return res.end('<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/index-DFpMFaZu.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script>'+mock+'</script><script type="module" src="/assets/qa-delivery.js"></script></body></html>');}
 if(u==='/assets/qa-delivery.js'){res.setHeader('content-type','text/javascript');return res.end(fixture);}
 if(u==='/system.css'){res.setHeader('content-type','text/css');return res.end(fs.readFileSync(root+'/possistem-system.css'));}
 const target=u.startsWith('/assets/modules/')?root+u:u.startsWith('/assets/')?root+'/packaged-renderer'+u:'';
 if(!target||!fs.existsSync(target)){res.statusCode=404;return res.end();}
 res.setHeader('content-type',u.endsWith('.png')?'image/png':u.endsWith('.css')?'text/css':u.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(target));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
const open=async route=>{await page.goto('http://127.0.0.1:'+server.address().port+'/qa#'+route);await page.waitForTimeout(400);};
const fits=async selector=>{
 const result=await page.locator(selector).evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent?.slice(0,60),left:r.left,right:r.right,client:el.clientWidth,scroll:el.scrollWidth}}));
 for(const r of result){assert.ok(r.left>=-1&&r.right<=page.viewportSize().width+1,JSON.stringify(r));assert.ok(r.scroll<=r.client+2,'Content overflow: '+JSON.stringify(r));}
};
try {
 for(const [width,height]of[[1536,816],[1366,735],[768,1024],[390,844]]){
   await page.setViewportSize({width,height});await open('/operations?tab=delivery');
   await page.locator('.pm-delivery-table').first().waitFor();
   await fits('.pm-delivery-table,.pm-delivery-table button');
   await page.screenshot({path:out+'/delivery-'+width+'.png'});
   await page.getByRole('button',{name:'Hesablaş',exact:true}).click();
   await page.locator('dialog[open]').waitFor();await fits('dialog[open],dialog[open] .ps-dialog-top,dialog[open] .ps-dialog-body,dialog[open] button,.pm-courier-settlement');
   const collect=await page.getByRole('button',{name:'Ödənişi al',exact:true}).boundingBox();assert.ok(collect&&collect.y>=0&&collect.y+collect.height<=height,'Collect action visible without scrolling the whole dialog');
   assert.equal(await page.evaluate(()=>qa.settlements.length),0,'Opening dialog does not receive payment');
   await page.screenshot({path:out+'/settlement-'+width+'.png'});
   await page.getByRole('button',{name:'İmtina',exact:true}).click();
   await open('/tables');await page.locator('.table-tile').first().waitFor();
   await fits('.pm-floor,.pm-floor-header,.table-tile');
   const floorAlignment=async()=>{
     const start=await page.locator('.ps-touch-sidebar nav>a').first().boundingBox(),header=await page.locator('.pm-floor-header').boundingBox();
     assert.ok(Math.abs(start.y-(header.y+header.height))<=1,'First sidebar card and white work area start together: '+JSON.stringify({nav:start.y,surface:header.y+header.height}));
   };
   await floorAlignment();
   assert.equal(await page.locator('.pm-floor').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
   await page.screenshot({path:out+'/tables-'+width+'.png'});
   assert.equal(await page.locator('.pm-floor-intro h1').textContent(),'Masalar');
   await page.locator('.ps-touch-sidebar').hover();await page.waitForTimeout(250);await fits('.pm-floor-header,.table-tile');
   await floorAlignment();
   if(width>=768){
     const rail=await page.locator('.ps-touch-sidebar').boundingBox(),heading=await page.locator('.pm-floor-intro h1').boundingBox();
     assert.ok(heading.x>=rail.x+rail.width,'Expanded navigation cannot cover the page title');
   }
   await page.screenshot({path:out+'/tables-expanded-'+width+'.png'});await page.mouse.move(width-20,height-20);
   if(width>=768){
     await page.locator('.ps-touch-sidebar nav>a').first().focus();await page.keyboard.press('Tab');await page.waitForTimeout(250);
     const rail=await page.locator('.ps-touch-sidebar').boundingBox(),heading=await page.locator('.pm-floor-intro h1').boundingBox();assert.ok(heading.x>=rail.x+rail.width,'Keyboard-expanded navigation cannot cover the title');
     await floorAlignment();
     await page.evaluate(()=>document.activeElement?.blur());
   }
   assert.equal(await page.locator('.pm-tables>.ps-business-branch').count(),0,'No redundant object banner on the floor');
   assert.equal(await page.locator('.pm-floor-count').count(),0,'No redundant table count');
   await page.waitForFunction(()=>[...document.querySelectorAll('.pm-floor-legend img')].every(image=>image.complete&&image.naturalWidth>0));
   await page.locator('.pm-floor-tabs').getByRole('button',{name:'Çatdırılma',exact:true}).click();await page.getByRole('button',{name:'Yeni çatdırılma',exact:true}).waitFor();
   assert.equal(await page.locator('.pm-floor-intro h1').textContent(),'Çatdırılma');await page.waitForTimeout(250);
   await fits('.pm-floor-header,.pm-floor-tabs button');await floorAlignment();
   await page.screenshot({path:out+'/floor-delivery-'+width+'.png'});
   await page.getByRole('button',{name:'Yeni çatdırılma',exact:true}).click();await page.getByRole('dialog',{name:'Yeni çatdırılma sifarişi',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>qa.newDeliveries.length),0,'Opening + only shows a form');await page.getByRole('button',{name:'İmtina',exact:true}).click();
   await page.locator('.pm-floor-tabs').getByRole('button',{name:'Zal',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Yeni çatdırılma',exact:true}).count(),0,'+ only belongs to the delivery area');
 }
 await page.setViewportSize({width:1536,height:816});await open('/tables');await page.locator('.pm-floor-tabs').getByRole('button',{name:'Çatdırılma',exact:true}).click();
 await page.evaluate(()=>qaDeliveryAccess(false));assert.equal(await page.getByRole('button',{name:'Yeni çatdırılma',exact:true}).count(),0,'Permission revocation hides +');await page.evaluate(()=>qaDeliveryAccess(true));
 await page.getByRole('button',{name:'Yeni çatdırılma',exact:true}).click();await page.getByRole('button',{name:'Sifarişi aç',exact:true}).click();assert.equal(await page.evaluate(()=>qa.newDeliveries.length),0,'Address validation before creating a delivery');
 await page.getByLabel('Müştəri',{exact:true}).fill('QA Aysel');await page.getByLabel('Telefon',{exact:true}).fill('0500000000');await page.getByLabel('Ünvan',{exact:true}).fill('QA küçəsi 12');
 await page.evaluate(()=>qa.holdDelivery=true);await page.getByRole('button',{name:'Sifarişi aç',exact:true}).evaluate(button=>{button.click();button.click()});await page.waitForFunction(()=>qa.newDeliveries.length===1);assert.equal(await page.getByRole('button',{name:'İmtina',exact:true}).isDisabled(),true);await page.evaluate(()=>{qa.holdDelivery=false;qa.releaseDelivery()});await page.waitForURL(/orders\/delivery-table/);
 assert.deepEqual(await page.evaluate(()=>qa.newDeliveries),[{customerName:'QA Aysel',phone:'0500000000',address:'QA küçəsi 12',note:''}]);
 await page.setViewportSize({width:1536,height:816});await open('/orders/delivery-table');
 await page.getByRole('button',{name:/Kuryerə ver/}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Ödəniş',exact:true}).count(),0,'No generic delivery payment');
 await page.getByRole('button',{name:/Kuryerə ver/}).click();await page.locator('dialog[open]').waitFor();
 assert.ok(await page.getByText('QA Kuryer',{exact:false}).count(),'Courier dispatch remains available');
 await page.keyboard.press('Escape');
 await open('/orders/table-0');assert.ok(await page.getByRole('button',{name:'Ödəniş',exact:true}).count(),'Dining-room payment remains available');
 await open('/operations?tab=delivery');await page.getByRole('button',{name:'Hesablaş',exact:true}).click();
 await page.locator('.pm-courier-settlement select').selectOption('qa-till');
 await page.getByRole('button',{name:'Ödənişi al',exact:true}).click();
 await page.waitForFunction(()=>qa.settlements.length===1&&!document.querySelector('dialog[open]'));
 const calls=await page.evaluate(()=>qa.settlements);assert.deepEqual(calls[0].payload,{deliveryIds:['delivery-0','delivery-1','delivery-2','delivery-3'],accountId:'qa-till'});assert.ok(calls[0].options.idempotencyKey);
 assert.equal(await page.getByRole('button',{name:'Hesablaş',exact:true}).count(),0,'Settled debt disappears after reload');
 assert.deepEqual(errors,[],'No renderer exceptions');
 console.log('PASS: delivery/settlement/floor 4 sizes, long text, isolated collection, delivery-only payment guard. Chromium '+browser.version());
} catch(error){await page.screenshot({path:out+'/failure.png'});console.log('BODY',await page.locator('body').innerText());throw error;} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
