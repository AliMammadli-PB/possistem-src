import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('object login anchor '+a.slice(0,90));return s.replace(a,b);};
let main=fs.readFileSync(path.join(root,'index.js'),'utf8');
// Only same-origin application frames are allowed; remote pages remain blocked.
for(const directive of ['frame-src','child-src','frame-ancestors'])main=main.replace('"'+directive+'"'+':["\'none\'"]','"'+directive+'"'+':["\'self\'"]');
if(!main.includes('async function _psCloudSelection()')){
 main=once(main,'case"branches.cloudObject":','case"branches.cloudSelection":return _psCloudSelection();case"branches.cloudObject":');
 main+=`\nasync function _psCloudSelection(){const auth=await b("business.call",{action:"context"},8000);if(!auth.success)return auth;try{return y(await require("./object-selection.cjs").selection({manager:auth.data?.manager,list:()=>_psCloudInit().list(),localContext:()=>({name:auth.data?.branchName||""})}));}catch(e){return d("E_BRANCH",String(e?.message||e));}}\n`;
 main=once(main,'try{return y(action==="manage"?', 'try{if(action==="assign"){const result=await _psCloudClient.assign(payload.deviceId,payload.name);await _psCloudRefresh();return y(result);}return y(action==="manage"?');
}
fs.writeFileSync(path.join(root,'index.js'),main);
const pf=path.join(root,'out/preload/index.js');let p=fs.readFileSync(pf,'utf8');if(!p.includes('cloudSelection:'))p=once(p,'business: {','business: {cloudSelection:()=>call("branches.cloudSelection",{}),');fs.writeFileSync(pf,p);
const file=path.join(root,'index-DAmHwBc4.js');let s=fs.readFileSync(file,'utf8');
if(!s.includes('function PsObjectLoginBoundary(')){
 const a=s.indexOf('function RequireAuth()'),b=s.indexOf('function RequirePermission',a);if(a<0||b<0)throw Error('RequireAuth section');
 const part=once(s.slice(a,b),'jsxRuntimeExports.jsx(Outlet, {});','jsxRuntimeExports.jsx(PsObjectLoginBoundary, {children:jsxRuntimeExports.jsx(Outlet,{})});');s=s.slice(0,a)+part+s.slice(b);
 s=once(s,'const container = document.getElementById("root");',`function PsObjectLoginBoundary({children}){const session=useAuthStore(x=>x.session),{lang}=useI18n();const key=String(session?.userId||session?.id||"")+":"+String(session?.loginAt||"");const [confirmed,setConfirmed]=reactExports.useState(null);const ref=reactExports.useRef(null);reactExports.useEffect(()=>{const receive=async event=>{if(event.source!==ref.current?.contentWindow||event.origin!==location.origin)return;if(event.data?.type==="pos:object:selected")setConfirmed(key);else if(event.data?.type==="pos:object:logout"){try{await window.pos.auth.logout();useAuthStore.getState().setSession(null);}catch(e){toast(String(e?.message||e),"danger");}}};window.addEventListener("message",receive);return()=>window.removeEventListener("message",receive);},[key]);if(window.__psCloudBranchMode||psMarketMode()||!window.pos?.business?.cloudSelection||confirmed===key)return children;return psH("iframe",{ref,title:psAdminText("Obyekt seçimi","İşletme seçimi","Choose location"),src:"./cloud-branches/selection.html?lang="+encodeURIComponent(lang),style:{width:"100%",height:"100dvh",border:0,display:"block"}});}\nconst container = document.getElementById("root");`);
}
const a=s.indexOf('function OpsKassalar()'),b=s.indexOf('const PS_PARTNER_TYPES',a);if(a<0||b<0)throw Error('Kassalar section');let part=s.slice(a,b);
part=part.replace('      canManage ? h("button", { type: "button", className: "ps-link-btn", onClick: () => setObjForm({ name: "" }) }, "+ Obyekt") : null,','');
part=part.replace('    objForm ? jsxRuntimeExports.jsx(PsAdminDialog,','    objForm?.id ? jsxRuntimeExports.jsx(PsAdminDialog,');
s=s.slice(0,a)+part+s.slice(b);fs.writeFileSync(file,s);console.log('Same-origin Objects frames, login selection and existing-only till assignment ready');
