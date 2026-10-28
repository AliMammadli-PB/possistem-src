import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),marker='/* POSSISTEM_QR_ORDERS_1 */';
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('QR anchor missing or repeated: '+a.slice(0,100));return s.replace(a,b);};
let main=fs.readFileSync(path.join(root,'index.js'),'utf8');
if(!main.includes(marker)){
 main=once(main,'Cn={','Cn={"qr.config":{auth:!0,perm:"settings.manage",timeout:3e4,idempotent:!1},"qr.inbox":{auth:!0,perm:"order.create",timeout:2e4,idempotent:!1},"qr.decision":{auth:!0,perm:"order.create",timeout:6e4,idempotent:!1},"qr.catalog":{auth:!0,perm:"settings.manage",timeout:15e3,idempotent:!1},"qr.access":{auth:!0,perm:"order.create",timeout:8e3,idempotent:!1},"qr.accept":{auth:!0,perm:"order.create",timeout:15e3,idempotent:!0},');
 main=once(main,'async function Is(e,t){',`${marker}\nlet _psQrOrders;\nfunction _psQrHandle(method,payload){if(!_psQrOrders)_psQrOrders=require('./qr-orders.cjs')({native:b,identity:J,owner:ft,isTerminal:()=>Boolean(globalThis.__psLanRoute)});return _psQrOrders(method,payload);}\nasync function Is(e,t){if(["qr.config","qr.inbox","qr.decision"].includes(e))return _psQrHandle(e,t);`);
 fs.writeFileSync(path.join(root,'index.js'),main);
}
const preloadFile=path.join(root,'out/preload/index.js');let preload=fs.readFileSync(preloadFile,'utf8');
if(!preload.includes(marker)){preload+=`\n${marker}\nelectron.contextBridge.exposeInMainWorld("possistemQr",{call:(method,payload)=>["qr.config","qr.inbox","qr.decision"].includes(method)?electron.ipcRenderer.invoke(IPC.invoke,{method,payload:payload||{},options:{timeoutMs:60000}}):Promise.resolve({success:false,error:{message:"Not allowed"}})});\n`;fs.writeFileSync(preloadFile,preload);}
fs.mkdirSync(path.join(root,'out/main'),{recursive:true});fs.copyFileSync(path.join(root,'qr-orders/runtime.cjs'),path.join(root,'out/main/qr-orders.cjs'));
let renderer=fs.readFileSync(path.join(root,'index-DAmHwBc4.js'),'utf8');
if(renderer.includes(marker)){const start=renderer.indexOf(marker),end=renderer.indexOf('function settingsSections(t) {',start);if(end<0)throw Error('QR component boundary missing');renderer=renderer.slice(0,start)+fs.readFileSync(path.join(root,'qr-orders/components.js'),'utf8')+'\n'+renderer.slice(end);fs.writeFileSync(path.join(root,'index-DAmHwBc4.js'),renderer);}
if(!renderer.includes(marker)){
 const components=fs.readFileSync(path.join(root,'qr-orders/components.js'),'utf8');
 renderer=once(renderer,'function settingsSections(t) {',components+'\nfunction settingsSections(t) {');
 renderer=once(renderer,'function settingsSections(t) {\n  return [','function settingsSections(t) {\n  return [\n    ...(!window.__psMarketMode?[{id:"qr-orders",label:psAdminText("QR sifariş","QR sipariş","QR orders"),hint:psAdminText("Menyu və masa kodları","Menü ve masa kodları","Menu and table codes"),icon:ReceiptText,tone:"blue"}]:[]),');
 renderer=once(renderer,'"data-section": settingsSection, className: "ps-settings-stack pane active", children: [','"data-section": settingsSection, className: "ps-settings-stack pane active", children: [\n      settingsSection === "qr-orders" && jsxRuntimeExports.jsx(PsQrSettings, {}),');
 renderer=once(renderer,'jsxRuntimeExports.jsx(CoreBanner, {}),','jsxRuntimeExports.jsx(CoreBanner, {}),\n    jsxRuntimeExports.jsx(PsQrInbox, {}),');
 fs.writeFileSync(path.join(root,'index-DAmHwBc4.js'),renderer);
}
let css=fs.readFileSync(path.join(root,'possistem-system.css'),'utf8');const cssEnd='/* END_POSSISTEM_QR_ORDERS */';if(css.includes(marker)){const start=css.indexOf(marker),end=css.indexOf(cssEnd,start);css=css.slice(0,start)+css.slice(end<0?css.length:end+cssEnd.length);}css=css.trimEnd();css+='\n'+marker+'\n'+fs.readFileSync(path.join(root,'qr-orders/style.css'),'utf8')+'\n'+cssEnd+'\n';fs.writeFileSync(path.join(root,'possistem-system.css'),css);
console.log('Restaurant QR settings, inbox and atomic acceptance ready');
