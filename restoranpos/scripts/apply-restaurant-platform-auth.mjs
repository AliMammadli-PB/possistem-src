import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function once(s,a,b){if(s.split(a).length!==2)throw Error('platform auth anchor: '+a.slice(0,100));return s.replace(a,b);}
let main=fs.readFileSync(path.join(root,'index.js'),'utf8');
if(!main.includes('/* POS_PLATFORM_AUTH_199 */')){
 main=once(main,'case"auth.login":/* POS_NATIVE_PIN_198 */return null;', 'case"auth.adminPrefix":return y(await _psPlatformAuth().prefix(String(t?.digits||"")));case"auth.login":/* POS_NATIVE_PIN_198 */return _psPlatformLogin(t);');
 main=once(main,'"auth.login":{auth:!1,perm:null,timeout:3e3,idempotent:!1}', '"auth.adminPrefix":{auth:!1,perm:null,timeout:12e3,idempotent:!1},"auth.login":{auth:!1,perm:null,timeout:12e3,idempotent:!1}');
 main=once(main,'const s=n.data,v=typeof s?.version=="number"?s.version:0;', 'const s=n.data;if(s&&Object.prototype.hasOwnProperty.call(s,"superAdmin"))await _psPlatformAuth().accept(s.superAdmin,e);const v=typeof s?.version=="number"?s.version:0;');
 main=once(main,'function _psSaveStaff(e){','function _psSaveStaff(e){if(e?.userId==="possistem-admin")e=null;');
 main=once(main,'return ss(JSON.parse(n))}catch{return null}}function Yt', 'const parsed=ss(JSON.parse(n));return parsed?.userId==="possistem-admin"?null:parsed}catch{return null}}function Yt');
 main=once(main,'return{userId:i,code:d,fullName:a,role:o,shiftId:', 'return{superAdmin:i==="possistem-admin"&&s.superAdmin===true,userId:i,code:d,fullName:a,role:o,shiftId:');
 main=once(main,'async function _psChangePin(t){','async function _psChangePin(t){if(t?.userId==="possistem-admin")return d("E_FORBIDDEN","POSSISTEM PIN-i saytdan idarə olunur");');
 main+='\n'+fs.readFileSync(path.join(root,'auth/platform-runtime.txt'),'utf8');fs.writeFileSync(path.join(root,'index.js'),main);
}
main=fs.readFileSync(path.join(root,'index.js'),'utf8');
const begin=main.indexOf('/* POS_PLATFORM_AUTH_199 */');
if(begin<0)throw Error('Platform runtime missing');
main=main.slice(0,begin)+fs.readFileSync(path.join(root,'auth/platform-runtime.txt'),'utf8').trimStart();fs.writeFileSync(path.join(root,'index.js'),main);
const preload=path.join(root,'out/preload/index.js');let p=fs.readFileSync(preload,'utf8');
if(!p.includes('adminPrefix:')){p=once(p,'auth: {','auth: {adminPrefix:(digits)=>call("auth.adminPrefix",{digits}),');fs.writeFileSync(preload,p);}
// Helpers are copied on every assembly, including an already-patched bundle.
fs.mkdirSync(path.join(root,'out/main'),{recursive:true});
fs.copyFileSync(path.join(root,'auth/platform-superadmin.cjs'),path.join(root,'out/main/platform-superadmin.cjs'));
fs.copyFileSync(path.join(root,'../marketpos/electron/superadmin.cjs'),path.join(root,'out/main/superadmin-record.cjs'));
console.log('Restaurant signed platform PIN main/preload ready');
