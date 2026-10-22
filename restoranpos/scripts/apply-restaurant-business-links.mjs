#!/usr/bin/env node
/** Restaurant 1.9.1: connected catalog/staff, branch access, document corrections. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BUNDLE=path.join(ROOT,'index-DAmHwBc4.js');
const MARK='/* POS_BUSINESS_LINKS_v1 */';
function once(s,a,b){const n=s.split(a).length-1;if(n!==1)throw Error(`business: expected one anchor (${n}): ${a.slice(0,100)}`);return s.replace(a,b);}
function inFunction(s,start,end,fn){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);if(a<0||b<0)throw Error(`business: missing ${start}`);return s.slice(0,a)+fn(s.slice(a,b))+s.slice(b);}
let s=fs.readFileSync(BUNDLE,'utf8');
if(!s.includes(MARK)){
 const components=fs.readFileSync(path.join(ROOT,'scripts/business-ui/components.js'),'utf8')+'\n'+fs.readFileSync(path.join(ROOT,'scripts/business-ui/delivery.js'),'utf8');
 s=once(s,'function OperationsPage() {',components+'\nfunction OperationsPage() {');
 s=s.replaceAll('İnventarizasiya','Sayım').replaceAll('İnventarsiya','Sayım');
 // A single catalogue entrance, with permission-aware restaurant/warehouse tabs.
 s=once(s,'function AdminCatalogPage() {','function PsMenuCatalog() {');
 s=once(s,'jsxRuntimeExports.jsx(AdminCatalogPage, {})','jsxRuntimeExports.jsx(PsUnifiedCatalog, {})');
 s=once(s,'function AdminStaffPage() {','function PsStaffPage() {');
 s=once(s,'jsxRuntimeExports.jsx(AdminStaffPage, {})','jsxRuntimeExports.jsx(PsUnifiedStaff, {})');
 s+='\nfunction PsUnifiedStaff(){return psH("div",{className:"ps-business-staff"},jsxRuntimeExports.jsx(PsStaffPage,{}),jsxRuntimeExports.jsx(PsStaffScope,{}));}\n';
 // Banner remains mounted above the table AND order screens.
 for(const name of ['TablesPage','OrderPage']){
  s=once(s,`function ${name}() {`,`function PsOriginal${name}() {`);
  s+=`\nfunction ${name}(){return psH("div",{className:"ps-business-pos"},jsxRuntimeExports.jsx(PsBranchBanner,{}),psH("div",{className:"ps-business-pos-body"},jsxRuntimeExports.jsx(PsOriginal${name},{})));}\n`;
 }
 s=inFunction(s,'function DashboardPage() {','function ',part=>once(part,'children: [\n      /* @__PURE__ */ jsxRuntimeExports.jsxs(\n        motion.section,','children: [\n      jsxRuntimeExports.jsx(PsDashboardSales, {}),\n      /* @__PURE__ */ jsxRuntimeExports.jsxs(\n        motion.section,'));
 // Resolve the selected sale directly; no dependency on today's list/date filter.
 s=inFunction(s,'function OpsSales() {','function OpsPartners',part=>{
  const anchor='  const [detail, setDetail] = reactExports.useState(null);';
  return once(part,anchor,anchor+`\n  const saleLocation = useLocation();
  const selectedSale = new URLSearchParams(saleLocation.search || (saleLocation.hash.includes("?") ? saleLocation.hash.slice(saleLocation.hash.indexOf("?")) : "")).get("sale");
  reactExports.useEffect(() => { let live=true;if(selectedSale)void window.pos.sales.get(selectedSale).then(r=>{if(!live)return;if(r.success)setDetail(r.data);else toast(r.error.message,"danger");});return()=>{live=false;};},[selectedSale]);`);
 });
 // Payments can be opened from the partner ledger as well as the document section.
 s=inFunction(s,'function OpsPartners','function OpsSalary',part=>{
  part=once(part,'  const [ledger, setLedger] = reactExports.useState(null);','  const [ledger, setLedger] = reactExports.useState(null);\n  const [documentEdit,setDocumentEdit]=reactExports.useState(null);');
  part=once(part,'rows: ledger.rows.map((e) => [opsWhen(e.createdAt), kindLabel(ledger.row, e),','rows: ledger.rows.map((e) => [opsWhen(e.createdAt), psH("span", null, kindLabel(ledger.row, e), e.kind === "payment" ? jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:async()=>{const r=await psBusinessCall("documents");if(!r.success)return toast(r.error.message,"danger");const row=(r.data.documents||[]).find(d=>d.id===e.id);setDocumentEdit({...e,...row,type:ledger.row.src==="supplier"?"supplier":"customer",name:ledger.row.name});},children:psAdminText("Düzəliş","Düzenle","Edit")}) : null),');
  return once(part,'    ledger ? h("section",','    documentEdit ? jsxRuntimeExports.jsx(PsDocumentEdit,{row:documentEdit,onClose:()=>setDocumentEdit(null),onSaved:async()=>{await reload();if(ledger)await openLedger(ledger.row);}}) : null,\n    ledger ? h("section",');
 });
 s=inFunction(s,'function OpsExpenses() {','function PsPartnerPicker',part=>{
  part=once(part,'  const h = psH;','  const h = psH;\n  const [docEdit,setDocEdit]=reactExports.useState(null);\n  const [expenseAccount,setExpenseAccount]=reactExports.useState("");\n  const [expenseKind,setExpenseKind]=reactExports.useState("");');
  part=once(part,'(!expenseObject || m.objectId === expenseObject)','(!expenseObject || m.objectId === expenseObject) && (!expenseAccount || m.accountId === expenseAccount) && (!expenseKind || m.reason === expenseKind)');
  part=once(part,'      psObjectFilter(expenseObjects, expenseObject, setExpenseObject),','      psObjectFilter(expenseObjects, expenseObject, setExpenseObject),\n      h("select",{className:psSelectCls,value:expenseAccount,onChange:e=>setExpenseAccount(e.target.value)},h("option",{value:""},psAdminText("Bütün kassalar","Tüm kasalar","All tills")),(expenseAcc?.accounts||[]).map(a=>h("option",{key:a.id,value:a.id},a.name))),\n      h("select",{className:psSelectCls,value:expenseKind,onChange:e=>setExpenseKind(e.target.value)},h("option",{value:""},psAdminText("Bütün tiplər","Tüm türler","All types")),[...new Set(rows.map(r=>r.reason))].map(k=>h("option",{key:k,value:k},k))),');
  part=once(part,'head: ["Tarix", "Kateqoriya", "Kassa / obyekt", "Məbləğ", "Qeyd"]','head: ["Tarix", "Kateqoriya", "Kassa / obyekt", "Məbləğ", "Qeyd", ""]');
  part=once(part,'formatMoney(m.amountMinor ?? 0)), m.note || "—"])','formatMoney(m.amountMinor ?? 0)), m.note || "—",jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>setDocEdit({...m,type:"expense"}),children:psAdminText("Düzəliş","Düzenle","Edit")})])');
  return once(part,'    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni xərc",','    docEdit ? jsxRuntimeExports.jsx(PsDocumentEdit,{row:docEdit,onClose:()=>setDocEdit(null),onSaved:reload}) : null,\n    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni xərc",');
 });
 // Add branch filter and delivery invoice access to every row state.
 s=inFunction(s,'function OpsDelivery() {','function OpsExport() {',part=>{
  part=once(part,'  const [rows, setRows] = reactExports.useState(null);','  const [rows, setRows] = reactExports.useState(null);\n  const [branch,setBranch]=reactExports.useState("");\n  const [invoice,setInvoice]=reactExports.useState(null);');
  part=once(part,'  const sum = (list, key)', '  const branchOptions=[...new Map(rows.filter(r=>r.objectId).map(r=>[r.objectId,r.objectName])).entries()];\n  const filteredRows=rows.filter(r=>!branch||r.objectId===branch);\n  const sum = (list, key)');
  for(const name of ['unpaid','paid','open'])part=part.replace(`const ${name} = rows.filter`, `const ${name} = filteredRows.filter`);
  part=part.replace(' : open : rows;', ' : open : filteredRows;').replace(' : open : rows;', ' : open : filteredRows;');
  part=part.replace('view === "open" ? open : rows','view === "open" ? open : filteredRows').replace('for (const r of rows) {','for (const r of filteredRows) {');
  part=once(part,'      h("span", { className: "ml-auto" }),','      h("select",{className:psSelectCls,value:branch,onChange:e=>{setBranch(e.target.value);setPicked({});}},h("option",{value:""},psAdminText("Bütün filiallar","Tüm şubeler","All branches")),branchOptions.map(([id,name])=>h("option",{key:id,value:id},name))),\n      h("span", { className: "ml-auto" }),');
  part=once(part,'const base = [h("b", null, "#" + r.orderNumber),','const base = [h("span",null,h("button",{type:"button",className:"ps-business-sale",onClick:()=>setInvoice(r)},"#"+r.orderNumber),h("small",{className:"block text-muted"},r.objectName||"—")),');
  part=once(part,'    settle ? jsxRuntimeExports.jsx(PsAdminDialog,','    invoice ? jsxRuntimeExports.jsx(PsDeliveryInvoice,{row:invoice,onClose:()=>setInvoice(null),onSaved:reload}) : null,\n    settle ? jsxRuntimeExports.jsx(PsAdminDialog,');return part;
 });
 s=inFunction(s,'function OpsObjects() {','function OpsKassalar() {',part=>once(part,'  return h("div", { className: "space-y-4" },','  return h("div", { className: "space-y-4" },\n    !psMarketMode() ? jsxRuntimeExports.jsx(PsBranchNetwork,{}) : null,'));
 s=once(s,'    { id: "income", label: "Qazanc",','    { id: "documents", label: psAdminText("Ödəniş qaimələri","Ödeme belgeleri","Payment documents"), show: !psMarketMode() && (hasPermission("cash.manage") || hasPermission("customers.view") || hasPermission("suppliers.view")), render: () => jsxRuntimeExports.jsx(PsDocuments,{}) },\n    { id: "income", label: "Qazanc",');
 fs.writeFileSync(BUNDLE,s);
}
let main=fs.readFileSync(path.join(ROOT,'index.js'),'utf8');
if(!main.includes('"business.call":')){main=once(main,'Cn={','Cn={"business.call":{auth:!0,perm:null,timeout:3e4,idempotent:!0},"branches.list":{auth:!0,perm:"users.manage",timeout:8e3,idempotent:!1},');fs.writeFileSync(path.join(ROOT,'index.js'),main);}
// Account-scoped peer snapshots travel with the existing inventory sync.
main=fs.readFileSync(path.join(ROOT,'index.js'),'utf8');
if(!main.includes('/* POS_BRANCH_NETWORK_v1 */')){
 main=once(main,'async function _psInventoryPortal(e){','/* POS_BRANCH_NETWORK_v1 */\nlet _psBranchPeerCache={deviceId:"",branches:[]};\nasync function _psInventoryPortal(e){');
 main=once(main,'  const wh=await b("warehouses.list",{},8000);',`  const syncActor=await _psPortalActor();if(!syncActor)return;
  const syncRead=(method,payload={},timeoutMs=8000)=>et.invoke(method,payload,{timeoutMs,actor:{userId:syncActor.id},terminal:{id:_psTerminal().id,name:_psTerminal().name}});
  const wh=await syncRead("warehouses.list",{},8000);
  const branchCash=await syncRead("cashAccounts.list",{},8000);`);
 {const a=main.indexOf('async function _psInventoryPortal(e){'),b=main.indexOf('\n}',a);if(a<0||b<0)throw Error('inventory sync body missing');main=main.slice(0,a)+main.slice(a,b).replaceAll('await b(', 'await syncRead(').replaceAll('    b(', '    syncRead(').replaceAll('),b(', '),syncRead(')+main.slice(b);}

 main=once(main,'  const books={','  const books={\n    accounts:branchCash.success?(branchCash.data?.accounts||[]).map(a=>({id:a.id,name:a.name,objectId:a.objectId,objectName:a.objectName,balanceMinor:a.balanceMinor,terminalId:a.terminalId})):[],');
 main=once(main,'  const sentAck=_psInvAck.slice(0,40),sentFail=_psInvFail.slice(0,40);','  _psBranchPeerCache={deviceId:e.deviceId,branches:Array.isArray(res.data?.branches)?res.data.branches:[]};\n  const sentAck=_psInvAck.slice(0,40),sentFail=_psInvFail.slice(0,40);');
 main=once(main,'case"files.saveText":return _psSaveTextFile(t);','case"branches.list":{const branchSession=await b("business.call",{action:"context"},8000);if(!branchSession.success||!branchSession.data?.manager)return{success:false,data:null,error:{code:"E_FORBIDDEN",message:"Filiallara yalnız müdir baxa bilər",retryable:false}};const current=await J();return{success:true,data:{branches:current&&current.deviceId===_psBranchPeerCache.deviceId?_psBranchPeerCache.branches:[]},error:null}}case"files.saveText":return _psSaveTextFile(t);');
 fs.writeFileSync(path.join(ROOT,'index.js'),main);
}
let preload=fs.readFileSync(path.join(ROOT,'out/preload/index.js'),'utf8');
if(!preload.includes('"business.call"')){preload=once(preload,'  cashAccounts: {','  business: {call: (action,payload={},options) => call("business.call",{...payload,action},options), branches: () => call("branches.list",{})},\n  cashAccounts: {');fs.writeFileSync(path.join(ROOT,'out/preload/index.js'),preload);}
console.log('Restaurant business links ready');

main=fs.readFileSync(path.join(ROOT,'index.js'),'utf8');
if(!main.includes('/* POS_BRANCH_POLL_v1 */')){
 main=once(main,'let _psBranchPeerCache={deviceId:"",branches:[]};','/* POS_BRANCH_POLL_v1 */\nlet _psBranchPeerCache={deviceId:"",branches:[]},_psBranchPeerAt=0;');
 main=once(main,'const body=le({deviceId:e.deviceId,deviceFingerprint:e.fingerprint,warehouses,lines,menu,categories,books,','const body=le({deviceId:e.deviceId,deviceFingerprint:e.fingerprint,includeBranches:Date.now()-_psBranchPeerAt>30000,warehouses,lines,menu,categories,books,');
 main=once(main,'  _psBranchPeerCache={deviceId:e.deviceId,branches:Array.isArray(res.data?.branches)?res.data.branches:[]};','  if(Array.isArray(res.data?.branches)){_psBranchPeerCache={deviceId:e.deviceId,branches:res.data.branches};_psBranchPeerAt=Date.now();}');
 fs.writeFileSync(path.join(ROOT,'index.js'),main);
}

s=fs.readFileSync(BUNDLE,'utf8');
if(!s.includes('function AdminCatalogPage() {'))s+='\nfunction AdminCatalogPage() {return jsxRuntimeExports.jsx(PsUnifiedCatalog,{}); }\n';
if(!s.includes('function AdminStaffPage() {'))s+='\nfunction AdminStaffPage() {return jsxRuntimeExports.jsx(PsUnifiedStaff,{}); }\n';
fs.writeFileSync(BUNDLE,s);

s=fs.readFileSync(BUNDLE,'utf8');
if(!s.includes('/* POS_CATALOG_LINK_ACTION_v1 */')){
 s=inFunction(s,'function OpsGoods() {','function ',part=>{
  const anchor='          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm(psGoodForm(g, true)), children: "Kopyala" }),';
  return once(part,anchor,anchor+'\n          /* POS_CATALOG_LINK_ACTION_v1 */\n          !psMarketMode() && useAuthStore.getState().hasPermission("catalog.manage") ? jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",disabled:busy,onClick:()=>void run(psBusinessCall("catalog.publish",{ingredientId:g.id}),psAdminText("Menyuyla birləşdirildi","Menüye bağlandı","Linked to menu")),children:psAdminText("Menyuya bağla","Menüye bağla","Link to menu")}) : null,');
 });
 fs.writeFileSync(BUNDLE,s);
}

s=fs.readFileSync(BUNDLE,'utf8');
if(!s.includes('/* POS_EXPENSE_CANCEL_v1 */')){
 s=inFunction(s,'function OpsExpenses() {','function PsPartnerPicker',part=>{
 part=once(part,'  const [docEdit,setDocEdit]=reactExports.useState(null);','  const [docEdit,setDocEdit]=reactExports.useState(null);\n  const [expenseConfirm,expenseConfirmDialog]=useConfirm(); /* POS_EXPENSE_CANCEL_v1 */');
 part=once(part,'    docEdit ? jsxRuntimeExports.jsx(PsDocumentEdit,','    expenseConfirmDialog,\n    docEdit ? jsxRuntimeExports.jsx(PsDocumentEdit,');
 return once(part,'children:psAdminText("Düzəliş","Düzenle","Edit")})])','children:psAdminText("Düzəliş","Düzenle","Edit")}),jsxRuntimeExports.jsx(OpsButton,{tone:"danger",disabled:busy,onClick:async()=>{if(!await expenseConfirm(psAdminText("Xərc ləğv edilsin? Məbləğ kassaya qaytarılacaq.","Gider iptal edilsin mi? Tutar kasaya geri döner.","Cancel this expense? The amount returns to the till."),{danger:true}))return;void run(psBusinessCall("correct",{type:"expense",id:m.id,amountMinor:0,cancel:true,accountId:m.accountId||""},newIdempotencyKey()),psAdminText("Ləğv edildi","İptal edildi","Cancelled"));},children:psAdminText("Sil","Sil","Delete")})])');
 });
 fs.writeFileSync(BUNDLE,s);
}

s=fs.readFileSync(BUNDLE,'utf8');
if(!s.includes('/* POS_PAYROLL_DOCUMENTS_v1 */')){
 s=once(s,'function OpsSalary() {','function PsOriginalSalary() {');
 s+='\n/* POS_PAYROLL_DOCUMENTS_v1 */\nfunction OpsSalary(){return psH("div",{className:"space-y-4"},jsxRuntimeExports.jsx(PsOriginalSalary,{}),jsxRuntimeExports.jsx(PsDocuments,{partyType:"salary"}));}\n';
 fs.writeFileSync(BUNDLE,s);
}
// Keep public component declarations before bootstrap, also for isolated UI QA.
s=fs.readFileSync(BUNDLE,'utf8');
{
 const a=s.indexOf('\nfunction PsUnifiedStaff(){');
 const boot=s.indexOf('const container = document.getElementById("root");');
 if(a>boot && boot>=0){const wrappers=s.slice(a);s=s.slice(0,boot)+wrappers+'\n'+s.slice(boot,a);fs.writeFileSync(BUNDLE,s);}
}

s=fs.readFileSync(BUNDLE,'utf8');
if(!s.includes('/* POS_DELIVERY_BRANCH_QUERY_v1 */')){
 s=inFunction(s,'function OpsDelivery() {','function OpsExport() {',part=>{
 part=once(part,'  const [branch,setBranch]=reactExports.useState("");','  const [branch,setBranch]=reactExports.useState("");\n  const [branchObjects,setBranchObjects]=reactExports.useState([]); /* POS_DELIVERY_BRANCH_QUERY_v1 */');
 part=once(part,'courierId: courierFilter }), window.pos.delivery.couriers()','courierId: courierFilter,objectId:branch }), window.pos.delivery.couriers()');
 part=once(part,'if (l.success) setRows(l.data.deliveries ?? []);','if (l.success) {setRows(l.data.deliveries ?? []);setBranchObjects(l.data.objects||[]);}');
 part=once(part,'  }, [period, courierFilter]);','  }, [period, courierFilter,branch]);');
 part=once(part,'const branchOptions=[...new Map(rows.filter(r=>r.objectId).map(r=>[r.objectId,r.objectName])).entries()];','const branchOptions=[...new Map([...branchObjects.map(o=>[o.id,o.name]),...rows.filter(r=>r.objectId).map(r=>[r.objectId,r.objectName])]).entries()];');
 return part;
 });
 fs.writeFileSync(BUNDLE,s);
}
