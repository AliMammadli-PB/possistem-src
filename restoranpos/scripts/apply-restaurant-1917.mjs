import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('1917 anchor missing/repeated: '+a.slice(0,80));return s.replace(a,b)};
let main=fs.readFileSync(path.join(root,'index.js'),'utf8');
if(!main.includes('/* POSSISTEM_MAIN_ACCESS_1917 */')){
 main=once(main,'Cn={','Cn={"billing.access":{auth:!1,perm:null,timeout:2e4,idempotent:!1},"print.xprinterDiscover":{auth:!0,perm:"settings.manage",timeout:15e3,idempotent:!1},"print.xprinterConfigure":{auth:!0,perm:"settings.manage",timeout:3e4,idempotent:!1},');
 main=once(main,'async function Is(e,t){',`/* POSSISTEM_MAIN_ACCESS_1917 */
let _psSubscriptionAccessInstance;
async function _psSubscriptionAccess(fresh=false){if(!_psSubscriptionAccessInstance)_psSubscriptionAccessInstance=require('./subscription-access.cjs')({owner:ft,license:G,now:()=>require('./billing-policy.cjs').now(),status:()=>de(te(null),'/billing/desktop/status',{product:'restaurant'},ft()?.token)});return _psSubscriptionAccessInstance(fresh);}
async function Is(e,t){if(e==='billing.access')return y(await _psSubscriptionAccess(Boolean(t?.fresh)));`);
 fs.writeFileSync(path.join(root,'index.js'),main);
}
// Refresh these guards even when the source bundle already carries this patch.
main=fs.readFileSync(path.join(root,'index.js'),'utf8');
main=main.replace('owner:ft,license:G,status:','owner:ft,license:G,now:()=>require(\'./billing-policy.cjs\').now(),status:');
if(!main.includes('/* POSSISTEM_PIN_BATCH_1917 */'))main=once(main,'const{method:s,payload:r,options:a}=n;',`const{method:s,payload:r,options:a}=n;/* POSSISTEM_PIN_BATCH_1917 */if(require('./subscription-access.cjs').requiresPin(s,r||{})){const paid=await _psSubscriptionAccess();if(!paid.loginAllowed)return d(paid.authenticated?'E_LICENSE_EXPIRED':'E_UNAUTHORIZED','Abunəlik aktiv deyil. Davam etmək üçün ödəniş edin.');}`);
fs.writeFileSync(path.join(root,'index.js'),main);
fs.copyFileSync(path.join(root,'subscription/access.cjs'),path.join(root,'out/main/subscription-access.cjs'));
const preloadFile=path.join(root,'out/preload/index.js');let pre=fs.readFileSync(preloadFile,'utf8');if(!pre.includes('/* POSSISTEM_PRELOAD_1917 */')){pre+=`\n/* POSSISTEM_PRELOAD_1917 */
electron.contextBridge.exposeInMainWorld('possistemAccess',{check:(fresh=false)=>electron.ipcRenderer.invoke(IPC.invoke,{method:'billing.access',payload:{fresh},options:{timeoutMs:20000}})});
electron.contextBridge.exposeInMainWorld('posPrinterNetwork',{call:(method,payload)=>['print.xprinterDiscover','print.xprinterConfigure'].includes(method)?electron.ipcRenderer.invoke(IPC.invoke,{method,payload:payload||{},options:{timeoutMs:30000}}):Promise.resolve({success:false,error:{message:'Not allowed'}})});
`;fs.writeFileSync(preloadFile,pre);}
const file=path.join(root,'index-DAmHwBc4.js');let s=fs.readFileSync(file,'utf8'),marker='/* POSSISTEM_ACCESS_1917 */';
if(s.includes(marker)){const a=s.indexOf(marker),b=s.indexOf('function App() {',a);if(b<0)throw Error('1917 component end missing');s=s.slice(0,a)+fs.readFileSync(path.join(root,'subscription/components.js'),'utf8')+'\n'+s.slice(b);}else{
 const a=s.indexOf('function App() {'),b=s.indexOf('function PsGate()',a);const app=s.slice(a,b),ast=ts.createSourceFile('app.js',app,ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App'),ret=fn?.body?.statements.find(ts.isReturnStatement);if(!ret?.expression)throw Error('App return missing');const expression=ret.expression.getText(ast);const wrapped=app.slice(0,ret.expression.getStart(ast))+`jsxRuntimeExports.jsx(PsSubscriptionBoundary,{children:(${expression})})`+app.slice(ret.expression.end);s=s.slice(0,a)+fs.readFileSync(path.join(root,'subscription/components.js'),'utf8')+'\n'+wrapped+s.slice(b);
 const hintStart=s.indexOf('jsxRuntimeExports.jsx("p",{className:"ps-first-login-hint"');const hintEnd=s.indexOf('                        !pinChange?jsxRuntimeExports.jsx("div",{className:"ps-pin-mode-switch"',hintStart);if(hintStart<0||hintEnd<0)throw Error('PIN hint missing');const modeEnd=s.indexOf('}):null',hintEnd);if(modeEnd<0)throw Error('PIN switch missing');s=s.slice(0,hintStart)+'null,\n                        null'+s.slice(modeEnd+7);
 s=once(s,'children: pinMode==="platform"?psAdminText("POSSISTEM Super Admin — saytda təyin etdiyiniz 10 rəqəmli PIN","POSSISTEM Super Admin — sitede belirlediğiniz 10 haneli PIN","POSSISTEM Super Admin — your 10-digit website PIN"):t.login.pinHint','children: psAdminText("PIN kodunuzu yazın","PIN kodunuzu girin","Enter your PIN")');
 s=once(s,'h("h2", { className: "font-display text-lg text-cream" }, L("Printerlər", "Yazıcılar", "Printers")),','h("h2", { className: "font-display text-lg text-cream" }, L("Printerlər", "Yazıcılar", "Printers")),\n    h(PsXprinterNetwork),');
}
fs.writeFileSync(file,s);
const cssFile=path.join(root,'possistem-system.css');let css=fs.readFileSync(cssFile,'utf8');const mark='/* POSSISTEM_ACCESS_STYLE_1917 */';if(!css.includes(mark)){css+='\n'+mark+'\n'+fs.readFileSync(path.join(root,'subscription/style.css'),'utf8');fs.writeFileSync(cssFile,css)}
console.log('1917: subscription before PIN, quiet PIN copy, Xprinter network settings');
