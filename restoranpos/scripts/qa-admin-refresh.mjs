import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser = await chromium.connectOverCDP(process.env.POS_QA_CDP || 'http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find(page => page.url().startsWith('app://local'));
const output = path.resolve('artifacts/admin-refresh');
fs.mkdirSync(output,{recursive:true});
const errors=[];const results=[];
page.on('pageerror',error=>errors.push(error.message));
const routes=['/admin','/operations?tab=stock','/operations?tab=suppliers','/operations?tab=vendors','/operations?tab=guests','/operations?tab=reservations','/operations?tab=delivery','/operations?tab=roster','/operations?tab=export','/settings','/admin/catalog','/admin/staff','/admin/tables','/admin/reports','/admin/cash','/admin/gifts','/admin/backup','/dashboard','/reconcile','/audit','/diagnostics','/settings/license','/support'];
async function navigate(route) { await page.evaluate(route=>location.hash=route,route);await page.waitForTimeout(350); }
try {
 for (const width of [1440,1024]) {
  await page.setViewportSize({width,height:900});
  for (const route of routes) {
   await navigate(route);
   const info = await page.locator('.ps-admin-workspace').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,text:e.innerText.slice(0,120)}));
   assert.ok(info.scroll<=info.width+1,`Page overflow: ${route} @ ${width}`);
   assert.ok(info.text.trim().length>10,`Empty page: ${route}`);
   const name=route.replaceAll('/','_').replace('?tab=','-');
   if(width===1440) await page.screenshot({path:path.join(output,`${name}-${width}.png`)});
   results.push({route,width,overflow:false});
  }
 }
 await navigate('/admin');
 const search=page.getByRole('searchbox',{name:'Bölmə axtar',exact:true});
 await search.fill('təchizat');assert.equal(await page.locator('.ps-hub-link').count(),2);
 await search.fill('zzzz-no-match');assert.equal(await page.locator('.ps-empty-state').count(),1);
 await page.getByRole('button',{name:'Axtarışı təmizlə'}).click();assert.equal(await page.locator('.ps-hub-link').count(),6);
 await navigate('/operations?tab=stock');
 await page.getByRole('button',{name:'+ Yeni məhsul',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.waitFor();
 await dialog.getByLabel('Ad',{exact:true}).fill('QA validation only — not saved');
 await dialog.getByLabel('Maya (₼)',{exact:true}).fill('-5');
 await dialog.getByRole('button',{name:'Yadda saxla',exact:true}).click();
 assert.equal(await dialog.count(),1);
 assert.equal(await dialog.getByLabel('Ad',{exact:true}).inputValue(),'QA validation only — not saved');
 await page.screenshot({path:path.join(output,'stock-dialog-1024.png')});
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('searchbox',{name:'Məhsul axtar',exact:true}).fill('no-product-zzzz');
 assert.equal(await page.locator('.ps-empty-state').count(),1);
 await page.getByRole('searchbox',{name:'Məhsul axtar',exact:true}).fill('');
 await page.locator('.ps-ops-tabs').getByRole('button',{name:'Təchizatçılar',exact:true}).click();
 assert.ok(page.url().includes('tab=vendors'));
 await navigate('/settings');
 for (const name of ['Restoran','Ekran və dil','Printer','Çek','Cihaz və sistem','Təhlükəli zona']) {
  await page.locator('.ps-settings-page .category').filter({hasText:name}).first().click();
  assert.equal(await page.locator('.ps-receipt-settings').count(),name==='Çek'?1:0);
  if(name==='Çek') await page.screenshot({path:path.join(output,'settings-receipt-1024.png')});
 }
 await page.setViewportSize({width:640,height:900});
 await navigate('/settings');
 await page.locator('.ps-settings-page .category').filter({hasText:'Çek'}).first().click();
 assert.equal(await page.locator('.ps-receipt-settings').count(),1);
 await page.screenshot({path:path.join(output,'settings-mobile.png')});
 for(const route of ['/tables','/kds']) {await navigate(route);assert.equal(await page.locator('.ps-admin-workspace').count(),0);}
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'qa-results.json'),JSON.stringify({results,checks:['Hub search and empty state','Inventory form validation preserves data','Dialog Escape close','Inventory empty search','Tabs update URL','Receipt settings in one panel','Mobile receipt navigation','Protected routes unstyled'],errors},null,2));
 console.log(`PASS ${results.length} route/viewport checks, 8 interaction groups, no renderer errors.`);
} finally {
 await page.setViewportSize({width:1920,height:1080});await navigate('/admin');await browser.close();
}
