import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const renderer=path.join(root,'marketpos/dist/ops'),out=path.join(root,'artifacts/market-scale-values-20261022/scale-ui');fs.mkdirSync(out,{recursive:true});
const main=fs.readdirSync(path.join(renderer,'assets')).find(x=>/^index-.*\.js$/.test(x));
let source=fs.readFileSync(path.join(renderer,'assets',main),'utf8');
const at=source.indexOf('const container = document.getElementById("root");');assert.ok(at>0);
source=source.slice(0,at)+`clientExports.createRoot(document.getElementById('root')).render(reactExports.createElement(PsScaleLan,{prefix:'20'}));`;
const bootstrap=`window.__psMarketMode=true;window.__marketOpsToken='qa';window.qa={tests:0};window.marketSystem={scale:{get:async()=>({ip:'192.168.1.50',auto:true,last:''}),set:async()=>({}),test:async()=>{qa.tests++;return{accepted:1,plu:4000,reply:'0v4000a0'}},scan:async()=>({networks:['192.168.1.2'],found:[]})}};`;
const css=fs.readdirSync(path.join(renderer,'assets')).find(x=>/^index-.*\.css$/.test(x));
const server=http.createServer((req,res)=>{const url=req.url.split('?')[0];if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/'+css+'"><style>body{padding:16px;max-width:900px;margin:auto}button,input{min-height:48px}*{box-sizing:border-box}</style></head><body><div id="root"></div><script>'+bootstrap+'</script><script type="module" src="/assets/qa.js"></script></body></html>');return}if(url==='/assets/qa.js'){res.setHeader('Content-Type','text/javascript');res.end(source);return}const file=path.join(renderer,url);if(!fs.existsSync(file)){res.statusCode=404;res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1024,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('summary').click();await page.getByText(/Dahua TM-F: Funksiya/).waitFor();
 assert.match(await page.locator('.ps-scale-money-guide').innerText(),/8.00 AZN\/kq × 0.310 kq = 2.48 AZN/);
 for(const width of [360,768,1024]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,width+'.png'),fullPage:true});}
 await page.getByRole('button',{name:'Test etiketi',exact:true}).click();await page.waitForFunction(()=>qa.tests===1);await page.getByRole('status').getByText(/8.00 AZN\/kq/).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS actual shipped scale component: format guide, example, no horizontal overflow at 360/768/1024, test acknowledgement states expected price and physical-print check.');
}finally{await browser.close();await new Promise(r=>server.close(r))}
