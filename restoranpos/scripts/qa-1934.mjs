// 1.9.34 İnteqrasiyalar: the shared settings screen, with a mock of its one IPC call.
// The order screen and sub-categories are covered by qa-real-1934.mjs against the real core.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(os.tmpdir(),'qa1934');fs.mkdirSync(out,{recursive:true});
const bundle=fs.readFileSync(root+'/index-DAmHwBc4.js','utf8');
assert.ok(bundle.includes('{id:"sunmi",label:psAdminText("İnteqrasiyalar","Entegrasyonlar","Integrations")'),'the settings section is renamed');
assert.ok(!bundle.includes('label:"SUNMI"'),'no SUNMI section label left');
for(const file of ['integrations/sunmi/protocol.cjs','integrations/sunmi/service.cjs','integrations/sunmi/receipt.cjs','integrations/sunmi/electron.cjs','integrations/sunmi/journal.cjs','index.js']){
 const left=(fs.readFileSync(path.join(root,file),'utf8').match(/['"`][^'"`\n]*\bSUNMI\b(?!_)[^'"`\n]*['"`]/g)||[]);
 assert.deepEqual(left,[],'visible SUNMI text left in '+file);
}
assert.equal(fs.readFileSync(root+'/sunmi-renderer.js','utf8'),fs.readFileSync(root+'/integrations/sunmi/renderer.js','utf8'),'the shipped renderer is the source');
assert.equal(fs.readFileSync(root+'/../marketpos/public/sunmi-renderer.js','utf8'),fs.readFileSync(root+'/integrations/sunmi/renderer.js','utf8'),'Market keeps the same renderer');
const page=`<!doctype html><html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:sans-serif}</style></head><body><div data-sunmi-settings></div><script>window.sunmiApi={call:async({action})=>({ok:true,data:action==='get'?{config:{enabled:false,endpoint:'',username:'',hasPassword:false},jobs:[],canManage:true}:{}}),onStatus(){return()=>{}}}</script><script src="/r.js"></script></body></html>`;
const server=http.createServer((req,res)=>{if(req.url==='/r.js'){res.setHeader('content-type','text/javascript');return res.end(fs.readFileSync(root+'/sunmi-renderer.js'))}res.setHeader('content-type','text/html');res.end(page)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const b=await chromium.launch({executablePath:'/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
try{for(const width of [390,1366]){
 const p=await b.newPage({viewport:{width,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:${server.address().port}/`);await p.waitForTimeout(500);
 const read=await p.evaluate(()=>{const r=document.querySelector('[data-sunmi-settings]').shadowRoot;return{cards:[...r.querySelectorAll('[data-integration]')].map(c=>[c.dataset.integration,c.querySelector('i').textContent,c.querySelectorAll('input,select').length]),groups:[...r.querySelectorAll('h2.group')].map(h=>h.textContent),forms:r.querySelectorAll('form').length,text:r.textContent,overflow:document.documentElement.scrollWidth>innerWidth+1,order:[...r.children].filter(e=>e.tagName!=='STYLE').map(e=>e.tagName+(e.className?'.'+e.className.split(' ')[0]:''))}});
 assert.deepEqual(read.groups,['Vergi kassası (e-kassa)','Bonus']);
 assert.deepEqual(read.cards,[['Caspos (SUNMI)','İşləyir',0],['AzSmart','Sənəd gözləyir',0],['Omnitech','Sənəd gözləyir',0],['NBA Technologies','Sənəd gözləyir',0],['WizarPOS','Sənəd gözləyir',0],['Umico','Sənəd gözləyir',0]]);
 assert.equal(read.forms,1,'only Caspos takes settings');
 assert.deepEqual(read.order.slice(0,2),['H2.group','DIV.ints']);assert.deepEqual(read.order.slice(-2),['H2.group','DIV.ints']);
 assert.deepEqual([...read.text.replace(/\.[a-zA-Z-]+\{[^}]*\}/g,'').matchAll(/SUNMI/g)].length,2,'SUNMI only as the name of the Caspos device');
 assert.equal(read.overflow,false);assert.deepEqual(errors,[]);await p.screenshot({path:out+'/integrations-'+width+'.png',fullPage:true});await p.close();
}console.log('PASS section renamed, six systems in two groups, only Caspos takes settings, no stray SUNMI text, 390 and 1366 px');}finally{await b.close();server.close();}
console.log('screens:',out);
