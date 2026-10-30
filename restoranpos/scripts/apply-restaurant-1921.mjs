import ts from 'typescript';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index.js');let s=fs.readFileSync(file,'utf8');
function replaceFn(name,code){const ast=ts.createSourceFile('main.js',s,ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!fn)throw Error(name+' missing');s=s.slice(0,fn.getStart(ast))+code+s.slice(fn.end);}
replaceFn('_psSubscriptionAccess',`async function _psSubscriptionAccess(fresh=false,verify=false){if(!_psSubscriptionAccessInstance)_psSubscriptionAccessInstance=require('./subscription-access.cjs')({owner:ft,license:G,now:()=>require('./billing-policy.cjs').now(),status:async verifyPayment=>{
let owner=ft();const ctx=await J();const body={product:'restaurant',refresh:verifyPayment,...(ctx?.deviceId?{deviceId:ctx.deviceId}:{})};let response=await de(te(null),'/billing/desktop/status',body,owner?.token),sessionResumed=false,resumeError=null;
if(response.ok&&owner?.billingOnly&&response.data?.subscriptions?.some(s=>s.product==='restaurant'&&s.hasAccess)){
 const next=await de(te(null),'/tenant/resume',{product:'restaurant',hwid:Zt('tenant-bind')},owner.token);
 if(next.ok&&next.data?.customer?.id===owner.customerId&&!next.data.billingOnly&&ft()?.token===owner.token){const n=next.data;ue({...owner,token:n.token,expiresAt:n.expiresAt,billingOnly:false,billing:n.billing||null,licenses:n.licenses||[],paymentUrl:n.paymentUrl});owner=ft();sessionResumed=true;response=await de(te(null),'/billing/desktop/status',body,owner.token);}else resumeError=next.error||'İstifadə icazəsi təsdiqləndi. Hesaba yenidən daxil olun.';
}
if(response.ok&&response.data?.licenseRefresh){const local=await G();if(local.success)await _psApplyLicenseRefresh(local.data,response.data.licenseRefresh,ctx?.fingerprint);}
return response.ok?{...response,data:{...response.data,sessionResumed,resumeError}}:response;
}});return _psSubscriptionAccessInstance(fresh,verify);}`);
const ast=ts.createSourceFile('main.js',s,ts.ScriptTarget.Latest,true),os=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='os');if(!os)throw Error('tenant login transport missing');let transport=os.getText(ast);if(!transport.includes('t.product')){const anchor='...t.hwid?{hwid:t.hwid}:{}';if(!transport.includes(anchor))throw Error('tenant product anchor missing');transport=transport.replace(anchor,anchor+',...t.product?{product:t.product}:{}');replaceFn('os',transport);}
fs.writeFileSync(file,s);
const cssFile=path.join(root,'possistem-system.css');let css=fs.readFileSync(cssFile,'utf8'),marker='/* POSSISTEM_ACCESS_STYLE_1917 */';const start=css.indexOf(marker);if(start<0)throw Error('access CSS marker missing');const next=css.indexOf('/* POSSISTEM_',start+marker.length);css=css.slice(0,start)+marker+'\n'+fs.readFileSync(path.join(root,'subscription/style.css'),'utf8')+'\n'+(next<0?'':css.slice(next));fs.writeFileSync(cssFile,css);
console.log('1921: keep login product, resume authorized billing sessions, show trial countdown');
