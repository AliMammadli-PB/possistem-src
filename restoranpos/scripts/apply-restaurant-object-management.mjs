import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const file=path.join(root,'index-DAmHwBc4.js');let s=fs.readFileSync(file,'utf8');
const once=(source,a,b)=>{if(source.split(a).length!==2)throw Error('object management anchor '+a.slice(0,100));return source.replace(a,b);};
const section=(a,b,change)=>{const i=s.indexOf(a),j=s.indexOf(b,i+a.length);if(i<0||j<0)throw Error('object management section '+a);s=s.slice(0,i)+change(s.slice(i,j))+s.slice(j);};
// Converge after older sidebar/hub patch scripts and regenerated admin components.
section('  const serviceLinks = [','  const visible =',part=>part.replace(/    \{ to: "\/refund"[^\n]+\n/,'').replace(/    \{to:"\/branches"[^\n]+\n/,'').replace('show: canAdmin }','show: canAdmin || hasPermission("payment.refund") }'));
section('function AdminHubPage()', 'const LOGO_RASTER_WIDTH',part=>{
 if(!part.includes('to: "/branches"'))part=once(part,'  const links = [','  const links = [\n    {to: "/branches",label:psAdminText("Obyektlər","İşletmeler","Locations"),icon:Store,show:hasPermission("users.manage")||["manager","administrator"].includes(useAuthStore.getState().session?.role)},\n    {to: "/refund",label:psAdminText("Geri qaytarma","İade","Returns"),icon:ReceiptText,show:hasPermission("payment.refund")},');
 return part.replace('l.show && _psArea(l.to)','l.show && (l.to === "/branches" || _psArea(l.to))');
});
// Existing operations URLs remain valid, while the regular Objects entry opens the common location hub.
s=s.replace('jsxRuntimeExports.jsx(OpsObjects, {})','jsxRuntimeExports.jsx(PsObjectsEntry, {})');
if(!s.includes('function PsObjectsEntry()'))s+='\nfunction PsObjectsEntry(){return window.__psCloudBranchMode || psMarketMode()?jsxRuntimeExports.jsx(OpsObjects,{}):jsxRuntimeExports.jsx(PsCloudBranches,{});}\n';
s=s.replace('title:psAdminText("Filialların idarəsi","Şube yönetimi","Branch management")','title:psAdminText("Obyektlərin idarəsi","İşletme yönetimi","Location management")').replace('style:{width:"100%",height:"100%",border:0},className:"ps-cloud-branches"','style:{width:"100%",height:"100%",minHeight:"720px",border:0},className:"ps-cloud-branches"');
if(!s.includes('/* POS_OBJECT_EDIT_v1 */')){
 section('function OpsObjects()', 'function OpsKassalar()',part=>{
  part=once(part,'  const h = psH;','  const h = psH;\n  const [confirmAsk,confirmDialog]=useConfirm();\n  const remove=async(g)=>{if(!(await confirmAsk(psAdminText("Obyekt silinsin? Satış tarixçəsi saxlanılır. Bağlı kassaları və anbar qalığını əvvəlcə köçürün.","İşletme silinsin mi? Geçmiş korunur. Önce kasaları ve stoku taşıyın.","Delete this location? History is preserved. Move linked tills and stock first."),{danger:true})))return;void run(window.pos.cashAccounts.saveObject({id:g.id,active:false}),psAdminText("Silindi","Silindi","Deleted"));};');
  part=part.replace('    !psMarketMode() ? jsxRuntimeExports.jsx(PsBranchNetwork,{}) : null,','');
  part=once(part,'children: "Adını dəyiş" })) : null)))','children: psAdminText("Düzəliş et","Düzenle","Edit") }), jsxRuntimeExports.jsx(OpsButton,{tone:"danger",disabled:busy,onClick:()=>void remove(g),children:psAdminText("Sil","Sil","Delete")}),jsxRuntimeExports.jsx(OpsButton,{onClick:()=>{location.hash="/operations?tab=kassa&objectId="+encodeURIComponent(g.id);},children:psAdminText("Kassaları aç","Kasaları aç","Open tills")})) : null)))');
  part=once(part,'}) : null);','}) : null,confirmDialog);');
  return '/* POS_OBJECT_EDIT_v1 */\n'+part;
 });
 section('function OpsKassalar()', 'const PS_PARTNER_TYPES',part=>part.replace('reactExports.useState("all")','reactExports.useState(()=>new URLSearchParams(location.hash.split("?")[1]||location.search).get("objectId")||"all")').replace('children: "Bağla" }) : null))))','children: psAdminText("Sil","Sil","Delete") }) : null))))').replace("'\"' + a.name + '\" bağlansın? Kassada pul qalmamalıdır.'",'psAdminText("Kassa silinsin? Növbəni bağlayın və qalığı transfer edin. Keçmiş hərəkətlər saxlanılır.","Kasa silinsin mi? Vardiyayı kapatın ve bakiyeyi aktarın. Geçmiş korunur.","Delete the till? Close its shift and transfer its balance first. History is preserved.")'));
}
if(!s.includes('/* POS_OBJECT_FILTER_EDIT_v1 */')){
 section('function OpsKassalar()', 'const PS_PARTNER_TYPES',part=>{
  part=once(part,'      h("span", { className: "ml-auto" }),',`      canManage && data.objects.some(o=>o.id===objectId) ? h("div",{className:"flex gap-2"},
        jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",disabled:busy,onClick:()=>{const o=data.objects.find(o=>o.id===objectId);setObjForm({id:o.id,name:o.name});},children:psAdminText("Obyektə düzəliş","İşletmeyi düzenle","Edit location")}),
        jsxRuntimeExports.jsx(OpsButton,{tone:"danger",disabled:busy,onClick:async()=>{if(await confirmAsk(psAdminText("Obyekt silinsin? Bağlı kassaları və anbar qalığını əvvəlcə köçürün. Tarixçə saxlanılır.","İşletme silinsin mi? Önce kasaları ve stoku taşıyın. Geçmiş korunur.","Delete location? Move linked tills and stock first. History is preserved."),{danger:true})){if(await run(window.pos.cashAccounts.saveObject({id:objectId,active:false}),psAdminText("Silindi","Silindi","Deleted")))setObjectId("all");}},children:psAdminText("Obyekti sil","İşletmeyi sil","Delete location")})) : null,
      h("span", { className: "ml-auto" }),`);
  part=part.replace('title: "Yeni obyekt (filial)"','title: objForm.id ? psAdminText("Obyektə düzəliş","İşletmeyi düzenle","Edit location") : "Yeni obyekt"').replace('setObjForm({ name: v })','setObjForm({ ...objForm, name: v })').replace('saveObject({ name: objForm.name.trim() })','saveObject({ ...(objForm.id?{id:objForm.id}:{}), name: objForm.name.trim() })').replaceAll('"Obyekt (filial)"','"Obyekt"');
  return '/* POS_OBJECT_FILTER_EDIT_v1 */\n'+part;
 });
}
s=s.replaceAll('psBizText(lang,"Filial","Şube","Branch")','psBizText(lang,"Obyekt","İşletme","Location")').replaceAll('"Filial təyin edilməyib","Şube atanmamış","Branch not assigned"','"Obyekt təyin edilməyib","İşletme atanmamış","Location not assigned"');
// Metadata actions are private main-process calls, never raw owner credentials in the renderer.
let main=fs.readFileSync(path.join(root,'index.js'),'utf8');if(!main.includes('case"branches.cloudObject"')){main=once(main,'case"branches.cloudAssign":','case"branches.cloudObject":return _psCloudBranchCall("manage",t);case"branches.cloudAssign":');main=once(main,'action==="list"?await _psCloudClient.list():','action==="manage"?await _psCloudClient.manage(payload):action==="list"?await _psCloudClient.list():');fs.writeFileSync(path.join(root,'index.js'),main);}
const pf=path.join(root,'out/preload/index.js');let p=fs.readFileSync(pf,'utf8');if(!p.includes('cloudObject:')){p=once(p,'business: {cloudAssign:','business: {cloudObject:(input)=>call("branches.cloudObject",input),cloudAssign:');fs.writeFileSync(pf,p);}
fs.writeFileSync(file,s);console.log('Unified object management, returns entry and ledger editing ready');
