/** Isolated component integration checks using the shipped renderer and deterministic IPC fixtures. */
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const source=fs.readFileSync('index-DAmHwBc4.js','utf8');
const mock=`
window.qa={mode:'success',calls:[],levels:[{id:'qa-tomato',name:'Pomidor',sku:'QA-1',qtyMilli:10000,minQtyMilli:5000,costMinor:300,unit:'kg'}],guests:[]};
const ok=data=>Promise.resolve({success:true,data});
const save=(name,payload,apply)=>{qa.calls.push({name,payload});if(qa.mode==='reject')return Promise.reject(new Error('QA connection interrupted'));if(qa.mode==='failure')return ok(null).then(()=>({success:false,error:{message:'QA save rejected'}}));apply?.();return ok({id:'qa-new'});};
window.pos={inventory:{
 levels:()=>qa.readFail?Promise.reject(new Error('QA inventory unavailable')):ok({levels:qa.levels}), warehouses:()=>ok({warehouses:[{id:'qa-warehouse',name:'Əsas anbar'}]}), valuation:()=>ok({totalMinor:3000}),movements:()=>ok({movements:[]}),
 saveIngredient:p=>save('saveIngredient',p,()=>qa.levels.push({id:'qa-new',...p,qtyMilli:0})),
 adjust:p=>save('adjust',p,()=>{qa.levels[0].qtyMilli+=p.qtyDeltaMilli}),waste:p=>save('waste',p,()=>{qa.levels[0].qtyMilli-=p.qtyMilli})
},guests:{list:()=>ok({customers:qa.guests}),save:p=>save('saveGuest',p,()=>qa.guests.push({id:'qa-guest',...p})),charge:p=>save('charge',p),payDebt:p=>save('payDebt',p),redeemPoints:p=>save('redeemPoints',p)},settings:{set:()=>ok({})}};
`;
const fixture=source.slice(0,source.indexOf('const container = document.getElementById("root");'))+`
const qaRoot=clientExports.createRoot(document.getElementById('root'));
window.qaMount=(name)=>qaRoot.render(reactExports.createElement(HashRouter,null,reactExports.createElement('div',{className:'ps-admin-workspace'},reactExports.createElement('div',{className:'ps-operations-page'},reactExports.createElement(name==='guests'?OpsGuests:OpsStock)))));
window.qaMount('stock');
`;
const server=http.createServer((req,res)=>{
 const url=req.url.split('?')[0];
 if(url==='/qa.html'){res.setHeader('content-type','text/html');res.end(`<html lang="az"><head><link rel="stylesheet" href="/assets/index-DFpMFaZu.css"><link rel="stylesheet" href="/possistem-system.css"></head><body><div id="root"></div><script>${mock}</script><script type="module" src="/assets/admin-fixture.js"></script></body></html>`);return;}
 if(url==='/assets/admin-fixture.js'){res.setHeader('content-type','text/javascript');res.end(fixture);return;}
 const target=url==='/possistem-system.css'?path.resolve('possistem-system.css'):url.startsWith('/assets/')?path.resolve('packaged-renderer','.'+url):null;
 if(!target||!fs.existsSync(target)){res.statusCode=404;res.end();return;}
 res.setHeader('content-type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(target));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
 await page.goto(`http://127.0.0.1:${server.address().port}/qa.html`);
 await page.getByRole('button',{name:'+ Yeni məhsul',exact:true}).click();
 let dialog=page.getByRole('dialog');
 await dialog.getByLabel('Ad',{exact:true}).fill('Yeni məhsul QA');
 await dialog.getByLabel('Maya (₼)',{exact:true}).fill('2,50');
 await page.evaluate(()=>qa.mode='failure');
 await dialog.getByRole('button',{name:'Yadda saxla',exact:true}).click();
 assert.equal(await dialog.getByLabel('Ad',{exact:true}).inputValue(),'Yeni məhsul QA');
 await page.evaluate(()=>qa.mode='reject');
 await dialog.getByRole('button',{name:'Yadda saxla',exact:true}).click();
 await page.waitForTimeout(50);
 assert.equal(await dialog.getByRole('button',{name:'Yadda saxla',exact:true}).isEnabled(),true);
 await page.evaluate(()=>qa.mode='success');
 await dialog.getByRole('button',{name:'Yadda saxla',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>qa.calls.at(-1).payload.costMinor),250);
 await page.getByRole('button',{name:'Düzəliş',exact:true}).first().click();
 dialog=page.getByRole('dialog');await dialog.getByLabel('Fərq (+/-)',{exact:true}).fill('-2,5');
 await dialog.getByLabel('Səbəb',{exact:true}).fill('QA adjustment');
 await dialog.getByRole('button',{name:'Təsdiq et',exact:true}).click();await dialog.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>qa.levels[0].qtyMilli),7500);
 await page.getByRole('button',{name:'Zay',exact:true}).first().click();dialog=page.getByRole('dialog');
 const before=await page.evaluate(()=>qa.calls.length);
 await dialog.getByLabel('Silinən miqdar',{exact:true}).fill('100');
 await dialog.getByLabel('Səbəb',{exact:true}).fill('QA waste');
 await dialog.getByRole('button',{name:'Təsdiq et',exact:true}).click();
 assert.equal(await page.evaluate(()=>qa.calls.length),before);
 await dialog.getByLabel('Silinən miqdar',{exact:true}).fill('1');
 await dialog.getByRole('button',{name:'Təsdiq et',exact:true}).click();await dialog.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>qa.levels[0].qtyMilli),6500);
 await page.evaluate(()=>qaMount('guests'));
 await page.getByLabel('Yeni müştəri',{exact:true}).fill('QA guest');await page.getByLabel('Telefon',{exact:true}).fill('0500000000');
 await page.evaluate(()=>qa.mode='failure');await page.getByRole('button',{name:'Əlavə et',exact:true}).click();
 assert.equal(await page.getByLabel('Yeni müştəri',{exact:true}).inputValue(),'QA guest');
 await page.evaluate(()=>qa.mode='success');await page.getByRole('button',{name:'Əlavə et',exact:true}).click();
 await page.waitForTimeout(50);assert.equal(await page.getByLabel('Yeni müştəri',{exact:true}).inputValue(),'');
 await page.evaluate(()=>{qa.readFail=true;qaMount('stock')});
 await page.getByRole('alert').waitFor();
 assert.equal(await page.locator('.ps-stock-metrics').count(),0);
 await page.evaluate(()=>qa.readFail=false);
 await page.getByRole('button',{name:'Yenidən yoxla',exact:true}).click();
 await page.locator('.ps-stock-metrics').waitFor();
 assert.deepEqual(errors,[]);
 fs.writeFileSync('artifacts/admin-refresh/form-results.json',JSON.stringify({backend:'isolated deterministic IPC fixture',checks:['Rejected save retains form values','Transport failure restores submit','Successful create closes dialog and refreshes stock','Decimal comma converted to minor units','Signed stock adjustment','Excess waste blocked before IPC','Valid waste changes stock','Customer save failure retains values','Customer save success clears form','Inventory read failure shows retry instead of false zero totals'],errors},null,2));
 console.log('PASS: 10 isolated form integration checks; no production data writes.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
