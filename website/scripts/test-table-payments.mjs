import {chromium} from 'playwright-core';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const out=path.resolve(new URL('../../platform/artifacts/table-payments',import.meta.url).pathname);fs.mkdirSync(out,{recursive:true});
const token='11111111-2222-4333-8444-555555555555.'+'A'.repeat(43),url='http://127.0.0.1:4187/qr/hesab/'+token+'/',errors=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/home/panda/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const bill=()=>({snapshot:{orderNumber:'0084',tableLabel:'Masa 12',totalMinor:3850,paidMinor:0,lines:[{id:'pizza',name:'Marqarita pizza · 28 sm',quantityMilli:2000,amountMinor:3000},{id:'cola',name:'Kola · 330 ml',quantityMilli:1000,amountMinor:350},{id:'salad',name:'Sezar salatı',quantityMilli:1000,amountMinor:500}]},state:'open',expiresAt:new Date(Date.now()+30*60e3).toISOString(),expired:false,paidMinor:0,pendingMinor:0,remainingMinor:3850,availableMinor:3850,available:true,holds:[]});
let checked=0;
try{
 for(const size of[{width:360,height:800},{width:390,height:844},{width:768,height:1024},{width:1366,height:735}]){
  const page=await browser.newPage({viewport:size}),state=bill();let posted=[],quote=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/pos/api/billing/table/**',async route=>{
   const u=new URL(route.request().url()),body=route.request().postData()?route.request().postDataJSON():null;
   if(u.pathname.endsWith('/quote')){quote=body.mode==='all'?3850:body.mode==='equal'?Math.floor(3850/body.parts)+(body.part<3850%body.parts?1:0):(body.items||[]).reduce((n,i)=>n+state.snapshot.lines.find(l=>l.id===i.lineId).amountMinor*i.quantityMilli/state.snapshot.lines.find(l=>l.id===i.lineId).quantityMilli,0);return route.fulfill({json:quote>0?{amountMinor:Math.round(quote)}:{error:'Ödəyəcəyiniz yeməkləri seçin.'},status:quote>0?200:409});}
   if(u.pathname.endsWith('/checkout')){posted.push(body);return route.fulfill({json:{id:'aaaaaaaa-2222-4333-8444-555555555555',status:'unknown',amountMinor:quote,error:'Bankın nəticəsi araşdırılır. Təkrar ödəniş etməyin.'}});}
   if(u.pathname.includes('/payments/'))return route.fulfill({json:{id:'aaaaaaaa-2222-4333-8444-555555555555',status:'unknown',amountMinor:quote}});
   return route.fulfill({json:state});
  });
  await page.goto(url);await page.getByRole('heading',{name:'Hesabınızı ödəyin'}).waitFor();await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflows '+size.width);
  await page.screenshot({path:out+'/table-pay-'+size.width+'.png',fullPage:true});
  await page.getByRole('radio',{name:/Bərabər böl/}).check();await page.getByLabel('Neçə nəfərsiniz?').selectOption('3');await page.waitForTimeout(450);assert.match(await page.locator('.table-pay-action').innerText(),/12[,.]84/);
  await page.getByRole('radio',{name:/Seçdiyim yeməkləri ödə/}).check();await page.getByLabel('Marqarita pizza · 28 sm miqdarı').fill('1');await page.waitForTimeout(450);assert.equal(await page.getByRole('button',{name:'Kartla ödə'}).isEnabled(),true);
  await page.getByRole('button',{name:'Kartla ödə'}).click();await page.getByText('Bank nəticəsi yoxlanılır. Yenidən ödəniş etməyin.').waitFor();assert.equal(posted.length,1);assert.equal(posted[0].expectedAmountMinor,1500);assert.equal(posted[0].selection.items[0].quantityMilli,1000);assert.equal(await page.locator('.table-pay-primary').isDisabled(),true);
  await page.reload();await page.getByText('Bank nəticəsi yoxlanılır. Yenidən ödəniş etməyin.').waitFor();assert.equal(posted.length,1,'reload created a new checkout');
  await page.screenshot({path:out+'/table-pay-pending-'+size.width+'.png',fullPage:true});await page.close();checked++;
 }
 assert.deepEqual(errors,[]);console.log('PASS QR payment: '+checked+' viewports, no overflow, equal and item selection, exact consent amount, pending lock, reload recovery; Chromium '+browser.version());
}finally{await browser.close();}
