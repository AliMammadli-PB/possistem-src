const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {build}=require('esbuild'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'release/ops-ui1567.js');
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{OpsFrame}from'./src/OpsFrame';createRoot(document.getElementById('root')).render(<div className="operations-workspace"><OpsFrame session={{sessionToken:'test',role:'manager'}} notify={s=>window.notice=s}/><iframe className="ops-frame" hidden title="hidden remote"></iframe></div>);`,resolveDir:root,loader:'tsx'},bundle:true,outfile:out,jsx:'automatic',loader:{'.png':'dataurl','.jpg':'dataurl','.woff2':'dataurl'}});
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();
 await page.route('**/*',route=>route.fulfill({body:'<!doctype html><p>Warehouse ready</p>',contentType:'text/html'}));
 await page.setContent('<div id="root"></div>');await page.addStyleTag({content:fs.readFileSync(path.join(root,'src/styles.css'),'utf8')});
 await page.evaluate(()=>{window.marketOps={status:async()=>({host:true,state:'crashed',available:true,startError:'Test startup failure'}),sync:async()=>{window.retries=(window.retries||0)+1;window.marketOps.status=async()=>({host:true,state:'ready',available:true});return{success:true}}};});
 await page.addScriptTag({path:out});
 for(const width of [768,1024,1536]){await page.setViewportSize({width,height:735});await page.getByRole('heading',{name:'Anbar sistemi açılır…'}).waitFor();assert(await page.getByText('Test startup failure').isVisible());assert.equal(await page.locator('iframe[hidden]').evaluate(el=>getComputedStyle(el).display),'none');await page.screenshot({path:path.join(root,`release/ops-recovery-${width}.png`)});}
 await page.getByRole('button',{name:'Anbara yenidən qoşul'}).click();await page.locator('iframe[title="Əməliyyatlar"]').waitFor();assert.equal(await page.evaluate(()=>window.retries),1);
 console.log('PASS Chromium 768/1024/1536: visible recovery heading/error, hidden frame excluded, click retries and opens warehouse');
 }finally{await browser.close();fs.rmSync(out,{force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
