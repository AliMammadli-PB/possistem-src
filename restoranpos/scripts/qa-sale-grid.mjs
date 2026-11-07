// Actual sale screen with a large isolated catalogue. No customer database or payment posting.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import{fileURLToPath}from'node:url';import ts from'typescript';import{chromium}from'@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=root+'/artifacts/sale-grid';fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(root+'/index-DAmHwBc4.js','utf8'),base=fs.readFileSync(root+'/scripts/qa-admin-real-pages.mjs','utf8');
const mock=base.slice(base.indexOf('const mock=`')+12,base.indexOf('`;\nconst fixture='))+`
qa.added=[];qa.items=[];
qa.products=Array.from({length:137},(_,i)=>({id:'p-'+i,categoryId:'qa-food',nameAz:i===0?'Çox uzun adlı xüsusi pendirli tərəvəzli pizza böyük porsiya':i===1?'Pendirli dönər':'Məhsul '+String(i).padStart(3,'0'),priceMinor:i===2?99999999:500+i,sortOrder:i,image:i===1?'./assets/modules/table-status-free-v1.png':'',imageHidden:i===1?0:1,available:i!==3,active:1}));
window.pos.core={onEvent:()=>()=>{}};
window.pos.business={call:method=>ok(method==='sale.readiness'?{ready:true}:{branchName:'QA Restoran',accountName:'Kassa'})};
window.pos.tables={get:id=>ok({id,label:'QA Masa',areaId:'area-salon',seats:4,orderId:'qa-order'})};
window.pos.orders={get:()=>ok({id:'qa-order',tableId:'qa-table',status:'open',items:qa.items,orderNumber:'QA-1',totalMinor:500,paidMinor:0,subtotalMinor:500,taxMinor:0,serviceMinor:0}),addItem:(p,o)=>{qa.added.push({p,o});qa.items.push({id:'item-'+qa.items.length,productId:p.productId,productNameAz:qa.products.find(x=>x.id===p.productId)?.nameAz,quantity:1,priceMinor:500,totalMinor:500,status:'draft'});return ok({})}};
qa.nested=location.search.includes('nested');qa.empty=location.search.includes('empty');
qa.sizes=[{id:'pizza28',categoryId:'qa-child',nameAz:'Marqarit 28 cm',priceMinor:800,active:1},{id:'pizza30',categoryId:'qa-child',nameAz:'Marqarit 30 cm',priceMinor:1000,active:1}];
window.pos.products={categories:()=>ok({categories:[{id:'qa-food',nameAz:'Yeməklər',itemCount:137},...(qa.nested?[{id:'qa-child',parentId:'qa-food',nameAz:'Pizzalar',itemCount:2}]:[])]}),list:({categoryId})=>ok({products:qa.empty?[]:qa.nested?(categoryId==='qa-child'?qa.sizes:[]):qa.products}),modifierGroups:()=>ok({groups:[]})};
window.possistemQr={call:()=>ok({orders:[]})};
`;
const ast=ts.createSourceFile('renderer.js',source,99,true),boot=source.indexOf('const container = document.getElementById("root");');let pre=source.slice(0,boot);
for(const n of ast.statements.filter(n=>(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n))&&n.getStart(ast)>boot))pre+='\n'+n.getText(ast);
const fixture=pre+`\nuseAuthStore.setState({session:{userId:'qa-manager',role:'manager',permissions:['order.view','order.create','inventory.view','catalog.manage','tables.layout']},ready:true});clientExports.createRoot(document.getElementById('root')).render(psH(HashRouter,null,psH(Routes,null,psH(Route,{element:psH(AppShell)},psH(Route,{path:'/orders/:tableId',element:psH(OrderPage)})))));`;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://local').pathname;
 if(u==='/qa'){res.setHeader('content-type','text/html');return res.end('<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/index-DFpMFaZu.css"><link rel="stylesheet" href="/system.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script>'+mock+'</script><script type="module" src="/assets/qa-sale.js"></script></body></html>');}
 if(u==='/assets/qa-sale.js'){res.setHeader('content-type','text/javascript');return res.end(fixture);}
 if(u==='/system.css'){res.setHeader('content-type','text/css');return res.end(fs.readFileSync(root+'/possistem-system.css'));}
 const target=u.startsWith('/assets/modules/')?root+u:u.startsWith('/assets/')?root+'/packaged-renderer'+u:'';
 if(!target||!fs.existsSync(target)){res.statusCode=404;return res.end();}
 res.setHeader('content-type',u.endsWith('.css')?'text/css':u.endsWith('.js')?'text/javascript':u.endsWith('.png')?'image/png':'application/octet-stream');res.end(fs.readFileSync(target));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage(),errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
const open=async(query='')=>{await page.goto('about:blank');await page.goto('http://127.0.0.1:'+server.address().port+'/qa'+query+'#/orders/qa-table');await page.locator('.pm-sale-fit').waitFor();await page.waitForTimeout(350);};
const inspect=async()=>page.locator('.pm-sale-fit').evaluate(grid=>{
 const r=grid.getBoundingClientRect(),buttons=[...grid.children],s=getComputedStyle(grid);
 return{width:innerWidth,height:innerHeight,columns:+grid.dataset.columns,rows:+grid.dataset.rows,capacity:+grid.dataset.pageCapacity,visible:buttons.length,gridWidth:grid.clientWidth,gridHeight:grid.clientHeight,overflowY:grid.scrollHeight>grid.clientHeight+2,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,cards:buttons.map(b=>{const v=b.getBoundingClientRect();return{x:v.x,y:v.y,w:v.width,h:v.height,right:v.right,bottom:v.bottom,text:b.textContent}}),bounds:{x:r.x,y:r.y,right:r.right,bottom:r.bottom}};
});
try{
 for(const [width,height]of[[360,800],[390,844],[600,800],[601,800],[768,1024],[1024,768],[1366,735],[1536,816],[1920,1080],[2560,1440],[640,480],[768,408]]){
  await page.setViewportSize({width,height});await open();const r=await inspect();
  assert.equal(r.visible,Math.min(137,r.capacity));assert.equal(r.pageOverflow,false,'No page overflow '+width);assert.equal(r.overflowY,false,'Only full visible rows '+width);
  for(const card of r.cards){assert.ok(card.w>=Math.min(140,r.gridWidth-6)-1&&card.h>=99,'Readable cards '+JSON.stringify(card));assert.ok(card.right<=r.bounds.right+1&&card.bottom<=r.bounds.bottom+1,'Cards inside their area '+width);}
  for(const button of await page.locator('.ps-sale-header button').all()){const b=await button.boundingBox();assert.ok(b.x>=-1&&b.x+b.width<=width+1,'Header actions fit '+width);}
  assert.equal(await page.locator('.ps-sale-product span.tabular-nums').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1)),false,'Prices never clip');
  const cols=Math.floor((r.gridWidth-4-12+8)/(140+8));assert.ok(r.columns>=Math.max(1,cols),'No arbitrary column cap');
  results.push({...r,cards:undefined});await page.screenshot({path:out+'/sale-'+width+'x'+height+'.png'});
 }
 await page.setViewportSize({width:1536,height:816});await open();let r=await inspect();assert.ok(r.capacity>12,'Desktop exceeds old 12-product limit');
 const next=page.locator('.pm-sale-catalog').getByRole('button',{name:'Aşağı',exact:true}),seen=new Set();
 while(true){for(const title of await page.locator('.ps-sale-product').evaluateAll(ns=>ns.map(n=>n.title))){assert.equal(seen.has(title),false,'No duplicated products across pages');seen.add(title);}if(await next.isDisabled())break;await next.click();}
 assert.equal(seen.size,137,'Every product remains reachable');
 await page.locator('.pm-sale-catalog').getByRole('button',{name:'Yuxarı',exact:true}).click();const anchor=await page.locator('.ps-sale-product').first().getAttribute('title');
 await page.setViewportSize({width:1366,height:735});await page.waitForTimeout(350);assert.ok(await page.locator('.ps-sale-product').evaluateAll((ns,a)=>ns.some(n=>n.title===a),anchor),'Resize preserves the previously visible page anchor');
 await open();assert.equal(await page.locator('.ps-sale-product').nth(3).isDisabled(),true);await page.locator('.ps-sale-product').nth(4).click();await page.waitForFunction(()=>qa.added.length===1);assert.equal(await page.evaluate(()=>qa.added[0].p.productId),'p-4');
 await page.locator('.ps-sale-product').first().focus();assert.equal(await page.locator('.ps-sale-product').first().evaluate(n=>n===document.activeElement),true,'Keyboard focus works');
 await open('?nested=1');await page.getByRole('button',{name:'Pizzalar 2 məhsul',exact:true}).click();await page.getByRole('button',{name:/Marqarit · Ölçü seçin/}).click();await page.getByRole('button',{name:/30 sm/}).click();await page.waitForFunction(()=>qa.added.length===1);assert.equal(await page.evaluate(()=>qa.added[0].p.productId),'pizza30','Size picker sends the exact recipe product ID');await page.getByRole('button',{name:'← Yeməklər',exact:true}).click();await page.getByRole('button',{name:'Pizzalar 2 məhsul',exact:true}).waitFor();
 await page.goto('http://127.0.0.1:'+server.address().port+'/qa?empty=1#/orders/qa-table');await page.waitForTimeout(350);assert.equal(await page.locator('.ps-sale-product').count(),0,'Empty category does not retain previous cards');
 await page.addInitScript(()=>{window.ResizeObserver=undefined});await open();await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(350);assert.ok((await inspect()).capacity>12,'Window resize fallback without ResizeObserver');
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/results.json',JSON.stringify({browser:browser.version(),results},null,2));console.log('PASS sale grid: 12 sizes, 137 products reachable, resize anchor, long text, prices, sold out, real add-item handler, keyboard, no observer fallback. Chromium '+browser.version());console.log(JSON.stringify(results.map(({width,height,columns,rows,capacity})=>({width,height,columns,rows,capacity}))));
}catch(e){await page.screenshot({path:out+'/failure.png'});console.log((await page.locator('body').innerText()).slice(0,2500));throw e;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
