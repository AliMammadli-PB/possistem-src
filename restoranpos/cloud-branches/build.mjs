import {Script} from 'node:vm';
import {patchRetainedBranchPages} from './retained-pages.mjs';
import {patchGoodsEditing} from '../market-ops/goods-editing.mjs';
import {patchWaste1547} from '../market-ops/waste1547.mjs';
import {patchMarketWorkflows} from '../market-ops/workflows.mjs';
import {patchMarket1535} from '../market-ops/workflows1535.mjs';
import {patchMarket1536} from '../market-ops/workflows1536.mjs';
import {patchDocumentRights} from '../market-ops/document-rights.mjs';
import {patchRegisterLinking} from '../market-ops/register-linking.mjs';
import {patchWarehousePerformance} from '../market-ops/warehouse-performance.mjs';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const out=path.resolve(process.argv[2]);
fs.mkdirSync(out,{recursive:true});for(const file of ['hub.html','hub.css','hub.js','selection.html','selection.js','presence.js'])fs.copyFileSync(path.join(root,'cloud-branches',file),path.join(out,file));
const remote=path.join(out,'remote');fs.mkdirSync(remote,{recursive:true});
for(const file of fs.readdirSync(path.join(root,'out/renderer'))){if(file==='cloud-branches')continue;fs.cpSync(path.join(root,'out/renderer',file),path.join(remote,file),{recursive:true});}
for(const file of fs.readdirSync(path.join(remote,'assets')).filter(f=>/^index-.*\.js$/.test(f))){const target=path.join(remote,'assets',file);let source=patchWarehousePerformance(fs.readFileSync(target,'utf8'));source=patchRetainedBranchPages(patchRegisterLinking(source));fs.writeFileSync(target,source);}
let bridge=fs.readFileSync(path.join(root,'market-ops/bridge.template.js'),'utf8');
bridge=bridge.replace('const params = new URLSearchParams(location.search);','');
bridge=bridge.replace('window.__psMarketMode = true;','const params = new URLSearchParams(location.search);\nwindow.__psMarketMode = params.get("product") === "market";');
if((bridge.match(/const params = new URLSearchParams\(location.search\);/g)||[]).length!==1)throw Error('Cloud bridge query parameters must be declared exactly once');

const a=bridge.indexOf('async function call('),b=bridge.indexOf('\nlet session = null;',a);
const methods=JSON.parse(fs.readFileSync(path.join(root,'../marketpos/electron/cloud-branches-methods.json'),'utf8'));
const readActions=['context','documents','document.get','staff','branch.summary','transfer.list','transfer.get'];
bridge=bridge.slice(0,a)+fs.readFileSync(path.join(root,'cloud-branches/transport.js'),'utf8')+`
const branchTransport=createBranchTransport({rpc:calls=>host.cloudBranches.rpc(params.get('device'),calls),fail,
 kind:({method,payload})=>method==='business.call'?(${JSON.stringify(readActions)}.includes(payload?.action)?'r':'w'):(${JSON.stringify(methods)}[method]||'w'),
 changed:()=>window.dispatchEvent(new Event('ps:branch-data'))});
window.__psBranchCache=branchTransport;
function call(method,payload,options){return branchTransport.call(method,payload,options);}
`+bridge.slice(b);
bridge=bridge.replace("if (!location.hash.startsWith('#/operations') && !location.hash.startsWith('#/settings'))", "if (!location.hash.startsWith('#/operations'))");
bridge=bridge.replace("document.documentElement.classList.add('ps-market-ops');","document.documentElement.classList.add('ps-market-ops');\nwindow.__psCloudBranchMode=true;\ndocument.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='.ps-ops-tabs,.ps-admin-breadcrumb,.ps-operations-page>header{display:none!important}.ps-operations-page{padding:16px!important}';document.head.appendChild(style);});");
bridge=bridge.replaceAll('__APP_VERSION__',JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version).replace('/*PRELOAD*/',()=>fs.readFileSync(path.join(root,'out/preload/index.js'),'utf8'));
new Script(bridge,{filename:'cloud-bridge.js'});
fs.writeFileSync(path.join(remote,'cloud-bridge.js'),bridge);
const index=path.join(remote,'index.html');let html=fs.readFileSync(index,'utf8');html=html.replace(/(<script type="module"[^>]*src="\.\/assets\/index-[^"]+\.js"><\/script>)/,'<script type="module" src="./cloud-bridge.js"></script>\n$1');fs.writeFileSync(index,html);
console.log('Cloud branch hub and remote screens staged:',out);

// Market's remote screens must contain the same product, partner and document fixes as its local screens.
const marketRemote=path.join(out,'remote-market');fs.cpSync(remote,marketRemote,{recursive:true});
for(const file of fs.readdirSync(path.join(marketRemote,'assets')).filter(f=>/^index-.*\.js$/.test(f))){
 const original=fs.readFileSync(path.join(root,'out/renderer/assets',file),'utf8');
 let patched=patchWaste1547(patchMarket1536(patchDocumentRights(patchMarket1535(patchMarketWorkflows(patchRegisterLinking(patchWarehousePerformance(patchGoodsEditing(original))))))));
 const salesStart=patched.indexOf('function OpsSales('),salesEnd=patched.indexOf('\nfunction ',salesStart+1);
 if(salesStart<0||salesEnd<0)throw Error('Remote Market sales component missing');
 const sales=patched.slice(salesStart,salesEnd).replaceAll('"Bütün ofisiantlar"','psMarketWords("Bütün istifadəçilər","Все пользователи","All users")').replaceAll('"Axtar: № / masa / partnyor"','psMarketWords("Qaimə, müştəri və ya istifadəçi axtar…","Документ, клиент или пользователь…","Search document, customer or user…")');
 patched=patched.slice(0,salesStart)+sales+patched.slice(salesEnd)+'\n// POS_MARKET_BRANCH_LAYOUT_1537\n';
 fs.writeFileSync(path.join(marketRemote,'assets',file),patchRetainedBranchPages(patched));
}
