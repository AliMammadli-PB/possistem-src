import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),marker='/* QR_3D_OWNER_PANEL_V1 */';
const mainFile=path.join(root,'index.js');let main=fs.readFileSync(mainFile,'utf8');
if(!main.includes(marker)){
 if(!main.includes('async function Is(e,t){')||!main.includes('Cn={'))throw Error('QR 3D main anchors changed');
 main=main.replace('Cn={','Cn={"qr.open3d":{auth:!0,perm:"settings.manage",timeout:15e3,idempotent:!1},');
 main=main.replace('async function Is(e,t){',`${marker}\nasync function Is(e,t){if(e==="qr.open3d"){try{const owner=ft(),device=await J();if(!owner?.customerId||!device?.deviceId)return d("E_UNAUTHORIZED","Sahibkar hesabına daxil olun.");const url="https://possistem.az/pos/app/qr-3d?"+new URLSearchParams({customer:owner.customerId,device:device.deviceId});await c.shell.openExternal(url);return y({opened:true});}catch(error){return d("E_INTERNAL",error.message||"Panel açıla bilmədi");}}`);
 fs.writeFileSync(mainFile,main);
}
const pre=path.join(root,'out/preload/index.js');let preload=fs.readFileSync(pre,'utf8');preload=preload.replaceAll('["qr.config","qr.inbox","qr.decision"]','["qr.config","qr.inbox","qr.decision","qr.open3d"]');fs.writeFileSync(pre,preload);
const file=path.join(root,'index-DAmHwBc4.js');let renderer=fs.readFileSync(file,'utf8');
if(!renderer.includes('function PsQr3dIcon('))renderer=renderer.replace('function settingsSections(t) {','function PsQr3dIcon(props){return psH("img",{...props,src:"./qr3d-icon.png",alt:"",width:28,height:28,style:{width:28,height:28,objectFit:"contain"}});}\nfunction settingsSections(t) {');
renderer=renderer.replace('id:"qr-orders",label:psAdminText("QR sifariş","QR sipariş","QR orders"),hint:psAdminText("Menyu və masa kodları","Menü ve masa kodları","Menu and table codes"),icon:ReceiptText','id:"qr-orders",label:psAdminText("QR sifariş və 3D","QR sipariş ve 3D","QR orders and 3D"),hint:psAdminText("Menyu, masa kodları və 3D modellər","Menü, masa kodları ve 3D modeller","Menu, table codes and 3D models"),icon:PsQr3dIcon');
if(!renderer.includes('icon:PsQr3dIcon'))throw Error('QR 3D settings icon anchor changed');fs.writeFileSync(file,renderer);
fs.copyFileSync(path.join(root,'qr-orders/qr3d-icon.png'),path.join(root,'qr3d-icon.png'));
console.log('QR order and 3D owner panel: scoped link, PNG icon and settings');
