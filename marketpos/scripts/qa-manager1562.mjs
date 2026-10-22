import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const preload=fs.readFileSync(new URL('../electron/preload.cjs',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.setContent('<html lang="az"><body><button id="start">Sil</button></body></html>');
 await page.evaluate(source=>{
  window.qa={writes:0,attempts:0};
  const fakeElectron={contextBridge:{exposeInMainWorld:(key,value)=>window[key]=value},ipcRenderer:{on(){},removeListener(){},invoke:async(channel,input)=>{
   if(channel==='market:invoke'){
    if(!input.managerPin)return {success:false,error:{code:'E_MANAGER_REQUIRED',message:'Müdir tələb olunur'}};
    qa.attempts++;
    if(!['8472950613','6842'].includes(input.managerPin))return {success:false,error:{code:'E_MANAGER_REQUIRED',message:'Müdir kodu yanlışdır'}};
    qa.writes++;return {success:true,data:{id:input.payload.id}};
   }
   return {success:true};
  }}};
  new Function('require',source)(()=>fakeElectron);
 },preload);
 await page.evaluate(()=>{window.pendingDelete=window.marketCore.invoke('ingredients.deactivate',{id:'p1',sessionToken:'staff'});});
 const dialog=page.getByRole('dialog'),pin=dialog.getByLabel('Müdir kodu',{exact:true});
 await dialog.waitFor();await pin.fill('123456789');await dialog.getByRole('button',{name:'Təsdiqlə',exact:true}).click();
 assert.equal(await page.evaluate(()=>qa.attempts),0,'A nine-digit code does not submit');
 await pin.fill('1111111111');await dialog.getByRole('button',{name:'Təsdiqlə',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'yanlışdır'}).waitFor();
 assert.equal(await page.evaluate(()=>qa.writes),0);
 await dialog.getByRole('button',{name:'Bağla',exact:true}).click();
 const cancelled=await page.evaluate(()=>pendingDelete);assert.equal(cancelled.error.code,'E_APPROVAL_CANCELLED');assert.equal(await page.evaluate(()=>qa.writes),0);
 await page.evaluate(()=>{const input={id:'p1',sessionToken:'staff'};window.deletePair=Promise.all([marketCore.invoke('ingredients.deactivate',input),marketCore.invoke('ingredients.deactivate',input)]);});
 await dialog.waitFor();assert.equal(await page.getByRole('dialog').count(),1);
 await pin.fill('8472950613');await dialog.getByRole('button',{name:'Təsdiqlə',exact:true}).click();
 const results=await page.evaluate(()=>deletePair);assert.ok(results.every(r=>r.success));assert.equal(await page.evaluate(()=>qa.writes),1,'Repeated touch shares one verified operation');
 assert.equal(await page.getByRole('dialog').count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(()=>{window.pendingManager=marketCore.invoke('ingredients.deactivate',{id:'p2',sessionToken:'staff'});});
 await dialog.waitFor();await pin.fill('6842');await dialog.getByRole('button',{name:'Təsdiqlə',exact:true}).click();assert.equal((await page.evaluate(()=>pendingManager)).success,true);
 console.log('PASS actual preload UI: invalid length blocked; 4-digit manager accepted, wrong superadmin rejected, close causes no write, 10-digit approval succeeds once on double touch, mobile width fits');
}finally{await browser.close();}
