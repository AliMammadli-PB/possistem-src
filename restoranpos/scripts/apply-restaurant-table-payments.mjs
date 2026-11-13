import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function once(s,a,b){if(s.split(a).length!==2)throw Error('Table QR payment anchor changed: '+a.slice(0,90));return s.replace(a,b);}
let main=fs.readFileSync(root+'/index.js','utf8');const marker='/* TABLE_QR_PAYMENT_MAIN_V1 */';
if(!main.includes(marker)){
 const methods=['ready','open','stop','status'];main=once(main,'Cn={','Cn={'+methods.map(m=>'"qr.payments.'+m+'":{auth:!0,perm:"payment.take",timeout:6e4,idempotent:!1},').join(''));
 const helper=marker+'\nlet _psTableQrInstance;\nfunction _psTableQr(){return _psTableQrInstance??=require("./table-payments.cjs")({invoke:(m,p,o)=>et.invoke(m,p,o),identity:J,owner:ft,isTerminal:()=>Boolean(globalThis.__psLanRoute),admin:_psPortalActor});}\n';
 main=once(main,'async function Is(e,t){',helper+'async function Is(e,t){if(e.startsWith("qr.payments."))return _psTableQr().handle(e,t);');
 main=once(main,'case"core.batch":return _psPortalBatch(e,t);','case"qr.payment":return _psTableQr().run(e,t);case"core.batch":return _psPortalBatch(e,t);');fs.writeFileSync(root+'/index.js',main);
}
let preload=fs.readFileSync(root+'/out/preload/index.js','utf8');if(!preload.includes(marker)){preload+='\n'+marker+'\nelectron.contextBridge.exposeInMainWorld("possistemTablePay",{call:(method,payload)=>["qr.payments.ready","qr.payments.open","qr.payments.stop","qr.payments.status"].includes(method)?electron.ipcRenderer.invoke(IPC.invoke,{method,payload:payload||{},options:{timeoutMs:60000}}):Promise.resolve({success:false,error:{message:"Not allowed"}})});\n';fs.writeFileSync(root+'/out/preload/index.js',preload);}
fs.mkdirSync(root+'/out/main',{recursive:true});fs.copyFileSync(root+'/qr-payments/runtime.cjs',root+'/out/main/table-payments.cjs');
const uiMarker='/* TABLE_QR_PAYMENT_UI_V1 */',boundary='/* END_TABLE_QR_PAYMENT_UI */';let ui=fs.readFileSync(root+'/index-DAmHwBc4.js','utf8'),component=fs.readFileSync(root+'/qr-payments/components.js','utf8')+'\n'+boundary+'\n';
if(ui.includes(uiMarker)){const a=ui.indexOf(uiMarker),b=ui.indexOf(boundary,a);if(b<0)throw Error('QR payment UI boundary missing');ui=ui.slice(0,a)+component+ui.slice(b+boundary.length);}else{
 ui=once(ui,'function PaymentPage() {',component+'\nfunction PaymentPage() {');
 ui=once(ui,'return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-payment-workspace flex h-full flex-col overflow-auto", children: [','return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-payment-workspace flex h-full flex-col overflow-auto", children: [\n    order.tableId && useAuthStore.getState().hasPermission("payment.take") && jsxRuntimeExports.jsx(PsTableQrPayment,{orderId:order.id,onUpdated:()=>void refresh()}),');
}
if(!ui.includes('/* QR_REFUND_UI_GUARD_V1 */')){
 const a=ui.indexOf('function PaymentPage() {'),b=ui.indexOf('function settingsSections(',a),part=ui.slice(a,b);
 const old='p.status === "approved" ? /* @__PURE__ */ jsxRuntimeExports.jsx(';
 const next=once(part,old,'/* QR_REFUND_UI_GUARD_V1 */ p.status === "approved" && !p.qrPaymentId ? /* @__PURE__ */ jsxRuntimeExports.jsx(');
 ui=ui.slice(0,a)+next+ui.slice(b);
}fs.writeFileSync(root+'/index-DAmHwBc4.js',ui);
let css=fs.readFileSync(root+'/possistem-system.css','utf8');const cm='/* TABLE_QR_PAYMENT_CSS */',ce='/* END_TABLE_QR_PAYMENT_CSS */';if(css.includes(cm)){const a=css.indexOf(cm),b=css.indexOf(ce,a);if(b<0)throw Error('QR payment CSS boundary missing');css=css.slice(0,a)+css.slice(b+ce.length);}css+='\n'+cm+'\n'+fs.readFileSync(root+'/qr-payments/style.css','utf8')+'\n'+ce;fs.writeFileSync(root+'/possistem-system.css',css);
console.log('Table QR payments: private signed main bridge, payment page and QR display');
