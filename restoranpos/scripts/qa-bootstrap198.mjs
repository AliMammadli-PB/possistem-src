/** Real Electron, preload, IPC and Windows native core with an isolated DB. */
import {_electron} from '@playwright/test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,'../artifacts/dual-1.9.8-1.5.39');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant198-ui-'));
const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron'),args:['--no-sandbox','--disable-gpu','--user-data-dir='+path.join(temp,'user'),root],env:{...process.env,POS_CORE_PATH:path.join(root,'native/build/restaurant-pos-core'),POS_DB_PATH:path.join(temp,'pos.db'),POS_LOG_DIR:path.join(temp,'logs'),POS_E2E_BYPASS_LICENSE:'1',POS_SEED_DEMO_MENU:'0'}});
let page;const errors=[];
try{
 for(let i=0;i<300&&!page;i++){page=app.windows().find(p=>p.url().startsWith('app://local/')&&!p.url().includes('splash'));if(!page)await new Promise(r=>setTimeout(r,100));}
 assert.ok(page,'Main window opened');page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
 await page.waitForFunction(()=>window.pos?.auth);await page.locator('.ps-rest-staff').waitFor({timeout:60000});
 console.log('start',page.url(),(await page.locator('body').innerText()).slice(0,900));
 const users=await page.evaluate(()=>pos.auth.listUsers());assert.equal(users.success,true,JSON.stringify(users));assert.equal(users.data.users.length,1);assert.equal(users.data.users[0].role,'administrator');assert.ok(!JSON.stringify(users).includes('pin_hash'));
 await page.keyboard.type('1234');await page.getByText('Standart PIN təhlükəsiz deyil. Yeni 4 rəqəmli PIN daxil edin',{exact:true}).waitFor();
 await page.keyboard.type('8642');await page.getByText('Yeni PIN-i təkrar daxil edin',{exact:true}).waitFor();
 await page.keyboard.type('8642');await page.waitForFunction(()=>location.hash==='#/admin');
 console.log('Administrator landed on /admin');
 // Real invalid E2E tenant token exercises the network-unavailable branch
 // selection fallback without using any merchant account or live changes.
 const selection=page.frameLocator('iframe[title="Obyekt seçimi"]');
 await selection.locator('#continue').filter({hasText:'Yerli rejimdə davam et'}).click({timeout:30000});
 await page.locator('.ps-admin-hub').waitFor();await page.screenshot({path:path.join(out,'admin-first-login.png')});
 for(const tab of ['stock','goods','categories','stocktake','purchases','vendors','salary','expenses','documents','income']){
  await page.evaluate(tab=>location.hash='/operations?tab='+tab,tab);await page.locator('.ps-operations-page').waitFor();await page.waitForTimeout(500);
  const text=await page.locator('body').innerText();assert.ok(!text.includes('Unknown method:'),tab+': '+text.slice(-600));assert.ok(!text.includes('Cannot access'),tab+' TDZ');assert.deepEqual(errors,[],tab);
  console.log('PASS native operations',tab,text.slice(-100).replaceAll('\n',' '));
  if(tab==='stock')await page.screenshot({path:path.join(out,'warehouse-empty.png')});
 }
 await page.evaluate(()=>location.hash='/admin');await page.locator('.ps-admin-hub').waitFor();
 const session=await page.evaluate(()=>pos.auth.session());assert.equal(session.role,'administrator');
 await page.evaluate(()=>pos.auth.logout());await page.evaluate(()=>location.hash='/login');await page.waitForTimeout(600);
 await page.keyboard.type('1234');await page.getByText('Yanlış PIN',{exact:true}).waitFor();
 await page.keyboard.type('8642');await page.waitForFunction(()=>location.hash==='#/admin');
 console.log('PASS changed PIN persists; default PIN no longer signs in');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'electron-errors.json'),JSON.stringify(errors));
}catch(e){if(page){await page.screenshot({path:path.join(out,'electron-failure.png')}).catch(()=>{});console.error(page.url(),(await page.locator('body').innerText()).slice(-3500));}throw e;}
finally{await app.close();fs.cpSync(path.join(temp,'logs'),path.join(out,'electron-native-logs'),{recursive:true});fs.rmSync(temp,{recursive:true,force:true});}
