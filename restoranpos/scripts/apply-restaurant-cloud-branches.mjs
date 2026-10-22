import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let main=fs.readFileSync(path.join(root,'index.js'),'utf8');const marker='/* POS_CLOUD_BRANCHES_v1 */';
function once(s,a,b){if(s.split(a).length!==2)throw Error('cloud branch anchor '+a.slice(0,90));return s.replace(a,b);}
if(!main.includes(marker)){
 main=once(main,'case"branches.list":{','case"branches.cloudAssign":return _psCloudBranchCall("assign",t);case"branches.cloudList":return _psCloudBranchCall("list",t);case"branches.cloudRpc":return _psCloudBranchCall("rpc",t);case"branches.list":{');
 main+=`\n${marker}
let _psCloudClient=null;
function _psCloudInit(){if(!_psCloudClient)_psCloudClient=require("./cloud-branches.cjs").createCloudBranches({credentials:async()=>{const tenant=ft(),device=await J();if(!tenant||!device||tenant.customerId!==device.customerId)throw Error("Sahibkar hesabı aktiv kassaya uyğun deyil");return{token:tenant.token,deviceId:device.deviceId,baseUrl:device.baseUrl};}});return _psCloudClient;}
async function _psCloudRefresh(){try{if(!ft()||!et)return;const data=await _psCloudInit().list(),device=await J(),own=data.branches?.find(b=>b.deviceId===device?.deviceId);if(!own)return;const current=await b("settings.getAll",{},8000);const name=own.branchId?own.name:"";if(current.data?.settings?.["branch.cloudName"]!==name){const actor=await _psPortalActor();if(actor)await et.invoke("settings.set",{key:"branch.cloudName",value:name},{actor:{userId:actor.id},timeoutMs:8000});}}catch{}}
setInterval(()=>void _psCloudRefresh(),30000).unref();
async function _psCloudBranchCall(action,payload){
 const auth=await b("business.call",{action:"context"},8000);if(!auth.success||!auth.data?.manager)return d("E_FORBIDDEN","Filialları yalnız müdir idarə edə bilər");
 if(!_psCloudClient)_psCloudClient=require("./cloud-branches.cjs").createCloudBranches({credentials:async()=>{const tenant=ft(),device=await J();if(!tenant||!device||tenant.customerId!==device.customerId)throw Error("Sahibkar hesabı aktiv kassaya uyğun deyil");return{token:tenant.token,deviceId:device.deviceId,baseUrl:device.baseUrl};}});
 try{return y(action==="list"?await _psCloudClient.list():action==="assign"?await _psCloudClient.assign(payload.deviceId,payload.name):await _psCloudClient.rpc(payload.deviceId,payload.calls));}catch(e){return d("E_BRANCH",String(e?.message||e));}
}\n`;
 // Extend the signed receiver's whitelist, while retaining the fixed existing portal methods.
 main=once(main,'const _PS_PORTAL_METHODS=new Set(', 'const _PS_PORTAL_METHODS=new Set(');
 const a=main.indexOf('const _PS_PORTAL_METHODS=new Set('),b=main.indexOf(');',a)+2;
 main=main.slice(0,b)+'\nfor(const method of Object.keys(require("./cloud-branches-methods.json")))_PS_PORTAL_METHODS.add(method);'+main.slice(b);
 main=once(main,'const scope={actor:{userId:actor.id},terminal:{id:"portal",name:"Sayt paneli"}};','const physical=args.cloudExpiresAt?_psTerminal():null;const scope={actor:{userId:actor.id},terminal:physical?{id:physical.id,name:(physical.name||"POS")+" · Filial idarəsi"}:{id:"portal",name:"Sayt paneli"}};');
 main=once(main,'async function _psPortalBatch(cmd,args){','async function _psPortalBatch(cmd,args){\n  if(args.cloudExpiresAt&&Date.now()>args.cloudExpiresAt)return{commandId:cmd.id,ok:false,error:"Filial sorğusunun vaxtı bitib",errorCode:"E_TIMEOUT"};');
 main=once(main,'    const spec=Cn[method];','    if(args.cloudExpiresAt && (!require("./cloud-branches.cjs").kind(c)||Date.now()>args.cloudExpiresAt)){results.push(deny("Filial əməliyyatına icazə yoxdur və ya vaxtı bitib"));continue;}\n    const spec=Cn[method];');
 fs.writeFileSync(path.join(root,'index.js'),main);
}
let preload=fs.readFileSync(path.join(root,'out/preload/index.js'),'utf8');if(!preload.includes('cloudList:')){preload=once(preload,'business: {call:','business: {cloudAssign:(deviceId,name)=>call("branches.cloudAssign",{deviceId,name}),cloudList:()=>call("branches.cloudList",{}),cloudRpc:(deviceId,calls)=>call("branches.cloudRpc",{deviceId,calls}),call:');fs.writeFileSync(path.join(root,'out/preload/index.js'),preload);}
let ui=fs.readFileSync(path.join(root,'index-DAmHwBc4.js'),'utf8');if(!ui.includes(marker)){
 ui=once(ui,'    ...opsLinks\n  ];','    {to:"/branches",label:psAdminText("Filiallar","Şubeler","Branches"),icon:Store,show:hasPermission("users.manage")||session?.role==="manager"||session?.role==="administrator"},\n    ...opsLinks\n  ];');
 ui=once(ui,'l.show = l.show && _psArea(l.to);','l.show = l.show && (l.to === \"/branches\" || _psArea(l.to));');
 // Route rendering goes through the existing permission gate in AppShell.
 ui=once(ui,'children: jsxRuntimeExports.jsx(PsGate, {})','children: location.pathname === "/branches" ? jsxRuntimeExports.jsx(PsCloudBranches,{}) : jsxRuntimeExports.jsx(PsGate, {})');
 ui=once(ui,'jsxRuntimeExports.jsx(Route, { path: "/tables",','jsxRuntimeExports.jsx(Route, { path: "/branches",element:jsxRuntimeExports.jsx(PsCloudBranches,{}) }),\n        jsxRuntimeExports.jsx(Route, { path: "/tables",');
 ui=once(ui,'const container = document.getElementById("root");',`${marker}\nfunction PsCloudBranches(){const {lang}=useI18n();const has=useAuthStore(s=>s.hasPermission),session=useAuthStore(s=>s.session);if(!has("users.manage")&&!(["manager","administrator"].includes(session?.role)))return psH("p",null,psAdminText("Buna icazəniz yoxdur","Buna izniniz yok","Access denied"));return psH("iframe",{title:psAdminText("Filialların idarəsi","Şube yönetimi","Branch management"),src:"./cloud-branches/hub.html?lang="+lang,style:{width:"100%",height:"100%",border:0},className:"ps-cloud-branches"});}\nconst container = document.getElementById("root");`);
 // Existing peer snapshots remain available; add an obvious management entrance.
 ui=once(ui,'h("h2",null,psBizText(lang,"Filialların anbarları və kassaları"','h("button",{type:"button",className:"ps-ops-button",onClick:()=>{location.hash="/branches";}},psBizText(lang,"Filialı uzaqdan idarə et","Şubeyi uzaktan yönet","Manage remote branch")),h("h2",null,psBizText(lang,"Filialların anbarları və kassaları"');
 fs.writeFileSync(path.join(root,'index-DAmHwBc4.js'),ui);
}
console.log('Restaurant cloud branch entry and receiver ready');
