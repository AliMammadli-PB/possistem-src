import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import jsQR from 'jsqr';
import sharp from 'sharp';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/touch-receipt');fs.mkdirSync(out,{recursive:true});
const nativeDir=process.env.POS_RECEIPT_ARTIFACTS || '/tmp/pos-receipt-artifacts';
const raw=JSON.parse(fs.readFileSync(path.join(nativeDir,'native-qr.json'),'utf8'));
const rgba=new Uint8ClampedArray(raw.width*raw.height*4).fill(255);
for(let y=0;y<raw.height;y++)for(let x=0;x<raw.width;x++)if(raw.bits[y*raw.stride+(x>>3)]&(128>>(x&7))){const at=(y*raw.width+x)*4;rgba[at]=rgba[at+1]=rgba[at+2]=0;}
assert.equal(jsQR(rgba,raw.width,raw.height)?.data,raw.payload,'Native printed QR must decode to the full URL');
const helpers=fs.readFileSync(path.join(root,'scripts/admin-ui/components.jsx'),'utf8');
const receipt=fs.readFileSync(path.join(root,'scripts/admin-ui/receipt-controls.jsx'),'utf8');
const bundle=await build({stdin:{resolveDir:root,loader:'jsx',contents:`
import * as reactExports from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Link,useLocation} from 'react-router-dom';import {LayoutGrid,Users,Utensils,Package,Settings,Calendar,Wallet,Truck,Gift,Clipboard,Shield,Key,Store,Archive,ChartColumn} from 'lucide-react';
const React=reactExports;
const useI18n=()=>({t:{nav:{admin:'İdarəetmə'}}});useI18n.getState=()=>({lang:'az'});
${helpers}\n${receipt}
const labels=['İdarə paneli','Kataloq','İşçilər','İş qrafiki','Masa idarəsi','Hədiyyələr','Anbar','Təchizat','Təchizatçılar','Müştərilər','Rezervasiya','Çatdırılma','Kassa','Hesabatlar','Uyğunlaşdırma','Audit','Parametrlər','Ehtiyat nüsxə','Lisenziya','Diaqnostika'];
const paths=['/dashboard','/admin/catalog','/admin/staff','/operations?tab=roster','/admin/tables','/admin/gifts','/operations?tab=stock','/operations?tab=suppliers','/operations?tab=vendors','/operations?tab=guests','/operations?tab=reservations','/operations?tab=delivery','/admin/cash','/admin/reports','/reconcile','/audit','/settings','/admin/backup','/settings/license','/diagnostics'];
const icons=[ChartColumn,Utensils,Users,Clipboard,LayoutGrid,Gift,Package,Store,Store,Users,Calendar,Truck,Wallet,ChartColumn,Wallet,Clipboard,Settings,Archive,Key,Shield];
function Harness(){const [page,setPage]=reactExports.useState('hub'),[paperWidth,setPaperWidth]=reactExports.useState(80),[dpi,setDpi]=reactExports.useState(203),[printableDots,setPrintableDots]=reactExports.useState(0),[cols,setCharsPerLine]=reactExports.useState(40),[html,setHtml]=reactExports.useState('');
return <><nav className="test-nav"><button onClick={()=>setPage('hub')}>İdarəetmə</button><button onClick={()=>setPage('printer')}>Printer</button></nav><main className="ps-admin-workspace" data-page={page==='hub'?'/admin':'/settings'}><div className="ps-admin-content">{page==='hub'?<PsAdminHub links={paths.map((to,i)=>({to,label:labels[i],icon:icons[i]}))}/>:<div className="ps-admin-hub"><h1>Printer və çek</h1><PsPrintGeometry {...{paperWidth,setPaperWidth,dpi,setDpi,printableDots,setPrintableDots,setCharsPerLine,fontWidthPx:14}}/><output>{paperWidth} mm · {cols} sütun</output><button className="preview-open" onClick={async()=>setHtml(await (await fetch('/receipt')).text())}>Çek önizləməsi</button>{html&&<PsReceiptDialog html={html} meta={paperWidth+' mm'} onClose={()=>setHtml('')}/>}</div>}</div></main></>}
createRoot(document.getElementById('root')).render(<BrowserRouter><Harness/></BrowserRouter>);`},bundle:true,write:false,format:'iife',target:'chrome120'});
const server=http.createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
 else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(root,'possistem-system.css')));}
 else if(req.url==='/receipt'){res.end(fs.readFileSync(path.join(nativeDir,'receipt-80.000000.html')));}
 else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><style>html,body,#root{margin:0;width:100%;min-height:100%;font-family:Arial,sans-serif;background:#f6f7f9}.ps-admin-workspace{height:auto!important;min-height:calc(100vh - 56px)}.test-nav{display:flex;padding:8px 16px;gap:12px;background:white}.test-nav button,.preview-open{min-height:48px;padding:12px 20px;font-size:16px;border:1px solid #ccd6e5;background:white;border-radius:10px}output{display:block;margin:24px 0}.ps-admin-content{overflow:visible!important}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const sizes=[[360,800],[768,1024],[1024,768],[1366,768],[1920,1080],[3840,2160]];const results=[];
 for(const [width,height] of sizes){await page.setViewportSize({width,height});await page.locator('.ps-hub-link').first().waitFor({timeout:10000}).catch(async e=>{throw new Error(`${e.message}\nPage errors: ${errors.join(' | ')}\nBody: ${(await page.locator('body').innerText()).slice(0,500)}`)});
   const state=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.ps-hub-link')].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e.querySelector('strong')).fontSize)}))}));
   assert.ok(state.scroll<=state.width+1,`Overflow at ${width}: ${JSON.stringify(state)}`);assert.equal(state.cards.length,6);
   assert.ok(state.cards.every(c=>c.h>=48&&c.w>=48&&c.font>=18));
   await page.locator('.ps-admin-workspace').screenshot({path:path.join(out,`admin-${width}.png`)});results.push({width,height,overflow:false,cards:6});
 }
 await page.setViewportSize({width:1024,height:768});
 for(const zoom of [.8,1.25,1.5]){await page.evaluate(z=>document.documentElement.style.zoom=z,zoom);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));}
 await page.setViewportSize({width:360,height:800});await page.evaluate(()=>document.documentElement.style.zoom=1.5);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 await page.evaluate(()=>document.documentElement.style.zoom=1);await page.setViewportSize({width:1024,height:768});
 await page.locator('.ps-hub-link').first().click();assert.equal(new URL(page.url()).pathname,'/dashboard');await page.goBack();
 const search=page.getByRole('searchbox');await search.fill('təchizat');assert.equal(await page.locator('.ps-hub-link').count(),2);
 await search.fill('nothing-found');await page.locator('.ps-empty-state').waitFor();await page.locator('.ps-hub-search button').click();assert.equal(await page.locator('.ps-hub-link').count(),6);
 await page.getByRole('button',{name:/Anbar və təchizat/}).click();assert.equal(await page.locator('.ps-hub-link').count(),3);
 await page.getByRole('button',{name:/Gündəlik idarəetmə/}).click();assert.equal(await page.locator('.ps-hub-link').count(),6);
 await page.getByRole('button',{name:'Printer',exact:true}).click();await page.getByLabel('Kağız ölçüsü',{exact:true}).selectOption('69.5');assert.match(await page.locator('output').textContent(),/69.5 mm/);
 await page.getByLabel('Kağız ölçüsü',{exact:true}).selectOption('custom');await page.getByLabel('Xüsusi ölçü (mm)',{exact:true}).fill('63.7');assert.match(await page.locator('output').textContent(),/63.7 mm/);
 await page.locator('.preview-open').click();await page.getByRole('dialog').waitFor();
 const qrCode=page.frameLocator('iframe[title="Çap ediləcək çek"]').locator('.qr .code');
 await qrCode.waitFor();
 assert.equal(await page.frameLocator('iframe[title="Çap ediləcək çek"]').locator('.qr .box').count(),0,'Readable preview must not use a QR placeholder');
 const qrPng=await qrCode.screenshot({path:path.join(out,'qr-preview.png')});
 const {data:qrPixels,info:qrInfo}=await sharp(qrPng).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 assert.equal(jsQR(new Uint8ClampedArray(qrPixels),qrInfo.width,qrInfo.height)?.data,'https://possistem.az','Visible preview QR must decode to the configured link');
 await page.screenshot({path:path.join(out,'receipt-preview.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.locator('.preview-open').evaluate(e=>document.activeElement===e),true);
 await page.setViewportSize({width:360,height:800});await page.locator('.preview-open').click();await page.getByRole('dialog').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'receipt-mobile.png'),fullPage:true});await page.getByRole('button',{name:'Bağla',exact:true}).click();
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify({results,qr:'Printed bitmap and visible preview QR decoded independently; complete URL retained',interactions:['card navigation','search','empty state','clear','preset','custom decimal','dialog Escape','focus restoration','mobile close'],errors},null,2));console.log('PASS touch layouts, zoom, navigation, search, geometry, dialog, printed and visible QR decode');
}finally{await browser.close();await new Promise(r=>server.close(r));}
