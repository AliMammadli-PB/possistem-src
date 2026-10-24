import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('billing anchor '+a.slice(0,100));return s.replace(a,b);};
const marker='/* POSSISTEM_BILLING_1911 */';
const mainFile=path.join(root,'index.js');let s=fs.readFileSync(mainFile,'utf8');
if(!s.includes(marker)){
 s=once(s,'async function Is(e,t){switch(e){',`async function Is(e,t){if(e==="billing.status")return _psBillingStatus();if(e==="billing.open"||e==="tenant.openPaymentUrl")return _psBillingOpen();switch(e){`);
 s=once(s,'"tenant.status":{auth:!1,perm:null,timeout:15e3,idempotent:!1}', '"billing.status":{auth:!1,perm:null,timeout:15e3,idempotent:!1},"billing.open":{auth:!1,perm:null,timeout:15e3,idempotent:!1},"tenant.status":{auth:!1,perm:null,timeout:15e3,idempotent:!1}');
 s=once(s,'paymentUrl:i.paymentUrl,licenses:i.licenses??[]','paymentUrl:i.paymentUrl,billingOnly:!!i.billingOnly,billing:i.billing||null,licenses:i.licenses??[]');
 s=once(s,'paymentUrl:n.paymentUrl,licenses:n.licenses','paymentUrl:n.paymentUrl,billingOnly:!!n.billingOnly,billing:n.billing||null,licenses:n.licenses');
 s=once(s,'{email:e,password:t,client:"pos",hwid:r}','{email:e,password:t,client:"pos",hwid:r,product:"restaurant"}');
 s=once(s,'if(!(u.payload.expiresAt>p))return;','if(e.signedLicense.payload?.features?.billingManaged!==true&&!(u.payload.expiresAt>p)||e.signedLicense.payload?.features?.billingManaged===true&&u.payload.expiresAt===p&&t.features?.billingManaged===true)return;');
 // Main-process policy also protects calls from portal commands. Raw status is
 // queried directly to avoid recursion; the core independently gates sales.
 s=once(s,'async function b(e,t={},n=8e3){return et?', 'async function b(e,t={},n=8e3){if(await _psBillingDenied(e,t))return d("E_LICENSE_EXPIRED","Abunəlik müddəti bitib. Yeni əməliyyat üçün ödəniş edin.");return et?');
 s=once(s,'async function N(e,t={},n=8e3){return Oe?', 'async function N(e,t={},n=8e3){if(await _psBillingDenied(e,t))return d("E_LICENSE_EXPIRED","Abunəlik müddəti bitib. Yeni əməliyyat üçün ödəniş edin.");return Oe?');
 const runtime=`${marker}
async function _psBillingDenied(method,payload){
 if(require('./billing-policy.cjs').readOnly(method,payload))return false;
 const raw=Oe||et;if(!raw)return false;const result=await raw.invoke('license.status',{}, {timeoutMs:8000});
 if(!result?.success)return true;const l=result.data;
 return l?.features?.billingManaged===true&&(l.status!=='active'||Number(l.expiresAt)<=Date.now());
}
async function _psBillingStatus(){const owner=ft();if(!owner?.token)return d('E_UNAUTHORIZED','Hesaba daxil olun');const response=await de(te(null),'/billing/desktop/status',{product:'restaurant'},owner.token);return response.ok?y(response.data):d('E_INTERNAL',response.error||'Ödəniş məlumatı alınmadı');}
async function _psBillingOpen(){const owner=ft();if(!owner?.token)return d('E_UNAUTHORIZED','Hesaba yenidən daxil olun');const response=await de(te(null),'/billing/desktop/handoff',{product:'restaurant'},owner.token);if(!response.ok)return d('E_INTERNAL',response.error||'Ödəniş açıla bilmədi');try{await c.shell.openExternal(require('./billing-policy.cjs').paymentUrl(response.data.url));return y({opened:true})}catch(error){return d('E_INTERNAL',String(error.message||error))}}
`;
 s=once(s,'async function Is(e,t){',runtime+'\nasync function Is(e,t){');
 fs.writeFileSync(mainFile,s);
}
const rendererFile=path.join(root,'index-DAmHwBc4.js');let r=fs.readFileSync(rendererFile,'utf8');
if(!r.includes(marker)){
 r=once(r,'function licenceSatisfied(data) {','function licenceSatisfied(data) {\n  '+marker+'if(data.features?.billingManaged===true&&data.licenseId&&data.status!=="revoked"&&data.expiresAt>0)return true;');
 fs.writeFileSync(rendererFile,r);
}
const preloadFile=path.join(root,'out/preload/index.js');let pre=fs.readFileSync(preloadFile,'utf8');
if(!pre.includes(marker)){pre+='\n'+marker+'\nelectron.contextBridge.exposeInMainWorld("possistemBilling",{status:()=>electron.ipcRenderer.invoke(IPC.invoke,{method:"billing.status",payload:{},options:{timeoutMs:15000}}),open:()=>electron.ipcRenderer.invoke(IPC.invoke,{method:"billing.open",payload:{},options:{timeoutMs:15000}})});\n';fs.writeFileSync(preloadFile,pre);}
fs.mkdirSync(path.join(root,'out/main'),{recursive:true});fs.copyFileSync(path.join(root,'../marketpos/electron/billing.cjs'),path.join(root,'out/main/billing-policy.cjs'));
fs.copyFileSync(path.join(root,'billing-renderer.js'),path.join(root,'packaged-renderer/billing-renderer.js'));
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');if(!html.includes('billing-renderer.js')){html=html.replace('</head>','<script defer src="./billing-renderer.js"></script>\n</head>');fs.writeFileSync(path.join(root,'index.html'),html);}
console.log('Restaurant billing, signed expiry and read-only access ready');
