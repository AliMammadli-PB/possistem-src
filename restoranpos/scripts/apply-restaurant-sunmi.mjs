#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('SUNMI integration anchor missing or repeated: '+a.slice(0,70));return s.replace(a,b);};
const marker='/* POSSISTEM_SUNMI_v1 */';
const mainFile=path.join(root,'index.js');let main=fs.readFileSync(mainFile,'utf8');
if(!main.includes(marker)){
 main=marker+'\n'+replace(main,'"use strict";','"use strict";let _psSunmi;');
 main=replace(main,'A=new Wn,Qs(A),ur(A)',`A=new Wn,Object.assign(Cn,{"sunmi.pending":{auth:true,perm:"payment.take",timeout:8000,idempotent:false},"sunmi.finish":{auth:true,perm:"payment.take",timeout:8000,idempotent:true}}),_psSunmi=require("./sunmi/electron.cjs").registerSunmi({ipcMain:c.ipcMain,app:c.app,safeStorage:c.safeStorage,assertTrusted:event=>{if(!U(event))throw Error("Untrusted IPC sender")},actor:()=>{const user=ce();if(!user?.userId)throw Error("Giriş tələb olunur");return user},invoke:(method,payload)=>A.invoke(method,payload,{timeoutMs:8000}),getDbPath:()=>Me(),setLocalCopy:async(suppress,cfg)=>{for(const [key,value]of [["sunmi.suppressLocalReceipt",suppress?"1":"0"],["sunmi.activatedAt",String(cfg.activatedAt||0)]]){const result=await A.invoke("settings.set",{key,value});if(!result.success)throw Error(result.error?.message||"SUNMI ayarı saxlanmadı")}}}),Qs(A),ur(A)`);
 main=replace(main,'C=await e.invoke(s,r??{},{idempotencyKey:P,timeoutMs:l});if(',`C=await e.invoke(s,r??{},{idempotencyKey:P,timeoutMs:l});if(C.success&&["payments.createCash","payments.createCard","payments.createMixed","payments.refund","orders.close"].includes(s))void _psSunmi?.process().catch(()=>{});if(`);
 main=replace(main,'if(s==="__app.info")return y(dr());','if(s.startsWith("sunmi."))return d("E_FORBIDDEN","Internal fiscal operation");if(s==="__app.info")return y(dr());');
 fs.writeFileSync(mainFile,main);
}
const rendererFile=path.join(root,'index-DAmHwBc4.js');let renderer=fs.readFileSync(rendererFile,'utf8');
if(!renderer.includes(marker)){
 renderer=marker+'\n'+renderer;
 renderer=replace(renderer,'function settingsSections(t) {\n  return [',`function settingsSections(t) {\n  return [\n    {id:"sunmi",label:"SUNMI",hint:psAdminText("Fiskal kassa","Mali kasa","Fiscal register"),icon:ReceiptText,tone:"blue"},`);
 const needle='className: "ps-settings-stack pane active", children: [';
 renderer=replace(renderer,needle,needle+'\n      settingsSection === "sunmi" && jsxRuntimeExports.jsx("div", {"data-sunmi-settings":""}),');
 fs.writeFileSync(rendererFile,renderer);
}
const preload=path.join(root,'out/preload/index.js');let pre=fs.readFileSync(preload,'utf8');
if(!pre.includes(marker)){pre+='\n'+marker+'\nelectron.contextBridge.exposeInMainWorld("sunmiApi",{call:input=>electron.ipcRenderer.invoke("possistem:sunmi",input),onStatus:handler=>{const listener=(_event,value)=>handler(value);electron.ipcRenderer.on("possistem:sunmi-status",listener);return()=>electron.ipcRenderer.removeListener("possistem:sunmi-status",listener)}});\n';fs.writeFileSync(preload,pre);}
let preloadSource=fs.readFileSync(preload,'utf8');
if(!preloadSource.includes('POSSISTEM_SUNMI_PRELOAD_v1')){
  preloadSource=replace(preloadSource,'    const result = await electron.ipcRenderer.invoke(IPC.invoke, { method, payload, options });',"    if(['payments.createCard','payments.createMixed'].includes(method))payload=await _sunmiPreparePayment(payload||{});\n    if(method==='payments.refund')payload=await _sunmiPrepareRefund(payload||{});\n    const result = await electron.ipcRenderer.invoke(IPC.invoke, { method, payload, options });");
  preloadSource+='\n'+fs.readFileSync(path.join(root,'integrations/sunmi/preload-fragment.js'),'utf8');fs.writeFileSync(preload,preloadSource);
}
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');if(!html.includes('sunmi-renderer.js')){html=html.replace('</head>','  <script defer src="./sunmi-renderer.js"></script>\n  </head>');fs.writeFileSync(path.join(root,'index.html'),html);}
fs.copyFileSync(path.join(root,'integrations/sunmi/renderer.js'),path.join(root,'sunmi-renderer.js'));
console.log('[SUNMI] restaurant settings, main and preload wired');
