import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {transform} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'index-DAmHwBc4.js');
let source=fs.readFileSync(file,'utf8');
const astOf=()=>ts.createSourceFile('renderer.js',source,ts.ScriptTarget.Latest,true);
const definition=name=>{const ast=astOf(),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!node)throw Error('Missing function: '+name);return {node,ast,text:node.getText(ast)};};
const edit=(name,fn)=>{const {node,ast,text}=definition(name);source=source.slice(0,node.getStart(ast))+fn(text)+source.slice(node.end);};
const exact=(text,old,next)=>{if(text.split(old).length!==2)throw Error('Management anchor changed: '+old.slice(0,90));return text.replace(old,()=>next);};

if(!source.includes('/* MANAGEMENT_UNIFIED_V1 */')){
  const hub=definition('AdminHubPage');
  let links=hub.text.replace('function AdminHubPage()', 'function usePsManagementLinks()');
  links=exact(links,'  return jsxRuntimeExports.jsx(PsAdminHub, { links });',`  const extra = [
    {to:'/operations?tab=costing',label:psAdminText('Kalkulyasiya','Reçete maliyeti','Recipe costing'),show:!psMarketMode()&&hasPermission('inventory.view'),area:'/operations?tab=stock'},
    {to:'/operations?tab=categories',label:psAdminText('Kateqoriyalar','Kategoriler','Categories'),show:hasPermission('inventory.view'),area:'/operations?tab=stock'},
    {to:'/operations?tab=expenses',label:psAdminText('Xərclər','Giderler','Expenses'),show:hasPermission('cash.manage')},
    {to:'/operations?tab=income',label:psAdminText('Qazanc','Gelir','Income'),show:hasPermission('cash.manage')},
    {to:'/operations?tab=documents',label:psAdminText('Ödəniş qaimələri','Ödeme belgeleri','Payment documents'),show:(!psMarketMode()||window.__psCloudBranchMode||useAuthStore.getState().session?.canPaymentDocuments===true)&&['cash.manage','customers.view','suppliers.view','salary.manage'].some(hasPermission)},
    {to:'/operations?tab=export',label:psAdminText('İxrac','Dışa aktar','Export'),show:hasPermission('reports.export')}
  ].map(link=>({...link,locked:!(link.show&&_psArea(link.area||link.to))}));
  return [...links,...extra];`);
  source=source.slice(0,hub.node.getStart(hub.ast))+links+source.slice(hub.node.end);
  edit('SettingsPage',text=>{
    text=exact(text,'function SettingsPage()', 'function PsManagementSettingsContent()');
    text=exact(text,'  const [settingsSection, setSettingsSection] = reactExports.useState("restaurant");',`  const settingsLocation=useLocation();
  const validSection=()=>{const value=new URLSearchParams(settingsLocation.search).get('section');return settingsSections(t).some(section=>section.id===value)?value:'restaurant';};
  const [settingsSection,setSettingsSection]=reactExports.useState(validSection);
  reactExports.useEffect(()=>{setSettingsSection(validSection());},[settingsLocation.search]);`);
    text=exact(text,'className: "ps-settings-page flex h-full flex-col overflow-auto"','className: "ps-settings-page pm-settings-content"');
    const start=text.indexOf('      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "settings-hero"');
    const end=text.indexOf('      /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsSectionCtx.Provider',start);
    if(start<0||end<0)throw Error('Settings navigation span changed');
    return text.slice(0,start)+`      jsxRuntimeExports.jsx(PsSettingsPicker,{sections:settingsSections(t),value:settingsSection,onChange:id=>{setSettingsSection(id);navigate('/settings?section='+encodeURIComponent(id),{replace:true});}}),\n`+text.slice(end);
  });
  edit('OperationsPage',text=>{
    const start=text.indexOf('  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-operations-page"');
    if(start<0)throw Error('Operations return span changed');
    return text.slice(0,start)+`  return jsxRuntimeExports.jsx(PsOperationsWorkspace,{tabs:_psTabs,current,onSelect:setActive,children:current?.render()});\n}`;
  });
  source='/* MANAGEMENT_UNIFIED_V1 */\n'+source;
}
// An older workspace patch reinserts its global strip on each assembly.
// Management and operations now supply their own context navigation.
edit('PsAdminFrame',text=>text.replace(/\s*jsxRuntimeExports\.jsx\(PsWorkspaceNav,\{\}\),\s*/,' ').replace(/(pathname \},)\s+(\/\* LOCAL_NO_WORKSPACE_TABS)/,'$1 $2'));
// The remote retained-page builder uses this stable render slot as well.
edit('OperationsPage',text=>text.replace('children:current?.render()','children: current?.render()'));
// Run after the older sidebar patches, which used to restore locked links.
edit('AppShell',text=>{
  text=text.replace(/    \{ to: "\/operations\?tab=delivery"[^\n]*\n/g,'');
  const anchor='  const adminLinksNav = [';
  if(!text.includes('/* MANAGEMENT_DELIVERY_NAV */'))text=exact(text,anchor,`  /* MANAGEMENT_DELIVERY_NAV */
  serviceLinks.splice(2,0,{to:'/operations?tab=delivery',label:psAdminText('Çatdırılma','Teslimat','Delivery'),icon:PsDeliveryNavIcon,show:!psMarketMode()&&hasPermission('delivery.view')&&_psArea('/operations?tab=delivery')});
`+anchor);
  // Delivery has its own main destination even though its route is under operations.
  if(!text.includes('/* MANAGEMENT_NAV_ACTIVE */'))text=text.replace('to === "/admin" && psAdminRoute(location.pathname)', 'to === "/admin" && psAdminRoute(location.pathname) && !(location.pathname === "/operations" && new URLSearchParams(location.search).get("tab") === "delivery") /* MANAGEMENT_NAV_ACTIVE */');
  return text.replace('const links = [...serviceLinks, ...adminLinksNav];','const links = visible;').replace('_psArea(l.to)','_psArea(psManagementAccessPath(l.to))').replace("label:psAdminText('Çatdırılma','Teslimat','Delivery'),icon:Move","label:psAdminText('Çatdırılma','Teslimat','Delivery'),icon:PsDeliveryNavIcon");
});
edit('usePsManagementLinks',text=>text.replace('hasPermission("users.manage")||["manager","administrator"].includes(useAuthStore.getState().session?.role)','hasPermission("users.manage")').replace('label: t.nav.license, icon: Key, show: true','label: t.nav.license, icon: Key, show: hasPermission("settings.manage")').replace('_psArea(l.to)','_psArea(psManagementAccessPath(l.to))').replace('  return [...links,...extra];',`  return [...links,...extra].filter(link=>link.show&&!link.locked&&link.to!=='/operations?tab=delivery');`));
// Preserve route-level access checks while applying the same module gates to navigation.
edit('OperationsPage',text=>text.replace('const tabs = _psTabs.filter((tab) => tab.show);',`const tabs = _psTabs.filter((tab) => tab.show && _psArea(tab.id==='goods'||tab.id==='categories'||tab.id==='stocktake'||tab.id==='costing'?'/operations?tab=stock':'/operations?tab='+tab.id));`));
// Delivery navigation lives in the main sidebar. Keep creation inside its own page.
edit('PsOriginalTablesPage',text=>text.replace(/,\s*jsxRuntimeExports\.jsx\(PsDeliveryStartButton,\s*\{\},\s*"ps-delivery-start"\)/g,''));
edit('PsDeliveryStartButton',text=>{
  if(text.includes('ps-delivery-new'))return text;
  const start=text.indexOf('    h("button", { type: "button", className: "ps-delivery-start"');
  const end=text.indexOf('    form ? jsxRuntimeExports.jsx(PsAdminDialog',start);
  if(start<0||end<0)throw Error('Delivery creation button span changed');
  return text.slice(0,start)+`    h("button", {type:"button",className:"ps-ops-button ps-ops-button--gold ps-delivery-new",onClick:()=>setForm({name:"",phone:"",address:"",note:""})},psAdminText("+ Yeni sifariş","+ Yeni sipariş","+ New order")),\n`+text.slice(end);
});
edit('OpsDelivery',text=>text.includes('/* DELIVERY_CREATE_IN_PANEL */')?text:exact(text,'      h("span", { className: "ml-auto" }),','      h("span", { className: "ml-auto" }),\n      /* DELIVERY_CREATE_IN_PANEL */ h(PsDeliveryStartButton, {}),'));
// Updates are a first-class settings destination; keep the existing updater IPC.
edit('settingsSections',text=>{
  text=text.replace('{ id: "system", label: "Cihaz və sistem", hint: "POS və bağlantı",', '{ id: "system", label: psAdminText("Sistem","Sistem","System"), hint: psAdminText("Loglar və POS xidməti","Günlükler ve POS hizmeti","Logs and POS service"),');
  if(!text.includes('id: "updates"'))text=exact(text,'    { id: "system",', '    { id: "updates", label: psAdminText("Yeniləmə","Güncelleme","Updates"), hint: psAdminText("Yeni versiyanı yoxlayın və quraşdırın","Yeni sürümü kontrol edin ve kurun","Check for a new version and install"), icon: Server, tone: "blue" },\n    { id: "system",');
  if(!text.includes('/* MANAGEMENT_RESTAURANT_UPDATES */'))text=exact(text,'  ];','  ].filter(section=>section.id!=="updates"||!psMarketMode()); /* MANAGEMENT_RESTAURANT_UPDATES */');
  return text;
});
edit('PsManagementSettingsContent',text=>{
  if(!text.includes('/* MANAGEMENT_UPDATE_SECTION */')){
    const ast=ts.createSourceFile('settings.js',text,ts.ScriptTarget.Latest,true);
    const property=(node,key)=>node.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)===key)?.initializer;
    let target;
    const visit=node=>{if(ts.isCallExpression(node)&&node.arguments[0]?.getText(ast)==='SettingsAccordion'&&ts.isObjectLiteralExpression(node.arguments[1])&&property(node.arguments[1],'id')?.text==='system')target=node;ts.forEachChild(node,visit);};visit(ast);
    if(!target)throw Error('System settings accordion missing');
    const children=property(target.arguments[1],'children');
    if(!children||!ts.isArrayLiteralExpression(children)||!children.elements[0].getText(ast).includes('t.settings.updates'))throw Error('System update panel changed');
    const next=`/* MANAGEMENT_UPDATE_SECTION */ !psMarketMode() && settingsSection==="updates" && jsxRuntimeExports.jsx(PsUpdateSettingsPanel,{t,version:appVersion,status:updateStatus,checking,statusLabel:updateLabel(),onCheck:()=>void checkUpdates(),onInstall:()=>void installUpdate()}),\njsxRuntimeExports.jsxs(SettingsAccordion,{id:"system",title:psAdminText("Proqram xidməti","Uygulama hizmeti","Application service"),hint:psAdminText("Logları açın və lazım olduqda POS nüvəsini yenidən başladın.","Günlükleri açın, gerekirse POS çekirdeğini yeniden başlatın.","Open logs or restart the POS service when necessary."),children:[${children.elements.slice(1).map(node=>node.getText(ast)).join(',\n')}]})`;
    text=text.slice(0,target.getStart(ast))+next+text.slice(target.end);
  }
  if(!text.includes('jsxRuntimeExports.jsx(PsUpdateSettingsPanel,')){
    const ast=ts.createSourceFile('settings.js',text,ts.ScriptTarget.Latest,true);let old;
    const visit=node=>{if(ts.isCallExpression(node)&&node.arguments[0]?.getText(ast)==='SettingsAccordion'&&ts.isObjectLiteralExpression(node.arguments[1])&&node.arguments[1].properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)==='id'&&p.initializer.text==='updates'))old=node;ts.forEachChild(node,visit);};visit(ast);
    if(!old)throw Error('Updates settings slot missing');
    text=text.slice(0,old.getStart(ast))+'!psMarketMode() && settingsSection==="updates" && jsxRuntimeExports.jsx(PsUpdateSettingsPanel,{t,version:appVersion,status:updateStatus,checking,statusLabel:updateLabel(),onCheck:()=>void checkUpdates(),onInstall:()=>void installUpdate()})'+text.slice(old.end);
  }
  if(!text.includes('/* MANAGEMENT_UPDATE_STATUS */')){
    text=exact(text,'  const updateLabel = () => {\n    switch (updateStatus.state) {','  const updateLabel = () => {\n    switch (updateStatus.state) {\n      /* MANAGEMENT_UPDATE_STATUS */ case "disabled":\n        return updateStatus.message || updateStatus.reason || psAdminText("Yeniləmə yalnız Setup ilə qurulmuş proqramda işləyir.","Güncelleme yalnızca kurulumla yüklenen uygulamada çalışır.","Updates work in the installed application.");');
    text=exact(text,'    const res = await window.pos.updates.check();','    let res;\n    try { res = await window.pos.updates.check(); } catch(error) { res={success:false,error:{message:error?.message||t.settings.updateError}}; }');
    text=exact(text,'    if (!res.success) {\n      toast(res.error.message, "danger");\n      return;\n    }\n    const next = res.data;', '    if (!res.success) {\n      setUpdateStatus({state:"error",message:res.error.message});\n      toast(res.error.message, "danger");\n      return;\n    }\n    const next = res.data;');
  }
  return text;
});
edit('PsManagementSettingsContent',text=>text.includes('!psMarketMode() && settingsSection==="updates"')?text:text.replace('settingsSection==="updates" && jsxRuntimeExports.jsx(PsUpdateSettingsPanel,','!psMarketMode() && settingsSection==="updates" && jsxRuntimeExports.jsx(PsUpdateSettingsPanel,'));
edit('UpdateBanner',text=>text.replace('navigate("/settings")','navigate("/settings?section=updates")'));
// One cash workspace. Preserve the legacy route as a redirect, never a second form.
edit('AdminCashPage',()=>`function AdminCashPage(){const navigate=useNavigate();reactExports.useEffect(()=>{navigate('/operations?tab=kassa',{replace:true});},[navigate]);return null;}`);
edit('usePsManagementLinks',text=>text.replace('{ to: "/admin/cash", label: t.nav.cash,','{ to: "/operations?tab=kassa", label: psAdminText("Kassalar","Kasalar","Cash accounts"),'));
edit('OperationsPage',text=>text.replace("'/operations?tab='+tab.id));","psManagementAccessPath('/operations?tab='+tab.id)));"));
edit('PsKassaMoves',()=>`function PsKassaMoves(props){return psH(PsCashActivity,props);}`);
edit('OpsKassalar',text=>{
  if(text.includes('/* MANAGEMENT_CASH_V1 */'))return text;
  text=exact(text,'  const [transfer, setTransfer] = reactExports.useState(null);',`  /* MANAGEMENT_CASH_V1 */
  const [transfer,setTransfer]=reactExports.useState(null),[transferError,setTransferError]=reactExports.useState('');
  const transferIntent=reactExports.useRef(null),transferLock=reactExports.useRef(false);
  const openTransfer=account=>{transferIntent.current=null;setTransferError('');setTransfer({fromId:account?.id||'',toId:'',value:'',note:''});};`);
  const start=text.indexOf('  const saveTransfer = () => {'),end=text.indexOf('  const remove = async',start);
  if(start<0||end<0)throw Error('Cash transfer handler span changed');
  text=text.slice(0,start)+`  const saveTransfer = () => {
    if(transferLock.current||!canManage)return;
    const amountMinor=opsMinor(transfer.value),from=data.accounts.find(a=>a.id===transfer.fromId);
    if(!from||!transfer.toId||transfer.fromId===transfer.toId||!psStockInputValid(transfer.value)||!Number.isSafeInteger(amountMinor)||amountMinor<=0||amountMinor>Number(from.balanceMinor||0)){setTransferError(psAdminText('Kassaları və məbləği yoxlayın.','Kasaları ve tutarı kontrol edin.','Check the accounts and amount.'));return;}
    const payload={fromId:transfer.fromId,toId:transfer.toId,amountMinor,note:transfer.note.trim()},signature=JSON.stringify(payload);
    if(transferIntent.current?.signature!==signature)transferIntent.current={signature,key:newIdempotencyKey()};
    transferLock.current=true;setTransferError('');
    const request=Promise.resolve().then(()=>window.pos.cashAccounts.transfer(payload,{idempotencyKey:transferIntent.current.key})).then(result=>{if(!result.success)setTransferError(result.error?.message||'Transfer alınmadı');return result;}).catch(error=>{setTransferError(error?.message||'Bağlantı xətası');throw error;});
    void run(request,'Transfer edildi').then(ok=>{if(ok){setTransfer(null);transferIntent.current=null;}}).finally(()=>{transferLock.current=false;});
  };
`+text.slice(end);
  text=exact(text,'return h("div", { className: "space-y-4" },','return h("div", { className: "space-y-4 pm-cash-accounts" },');
  text=exact(text,'onClick: () => setTransfer({ fromId: "", toId: "", value: "", note: "" })','onClick: () => openTransfer(null)');
  const cards=text.indexOf('    accounts.length ? h("div", { className: "ps-kassa-grid" }'),moves=text.indexOf('    moves ? jsxRuntimeExports.jsx(PsKassaMoves',cards);
  if(cards<0||moves<0)throw Error('Cash card span changed');
  text=text.slice(0,cards)+`    h(PsCashAccountsGrid,{accounts,data,busy,canManage,termName,onTransfer:openTransfer,onMoves:openMoves,onEdit:a=>setForm({id:a.id,name:a.name,kind:a.kind,objectId:a.objectId||'',terminalId:a.terminalId||''}),onRemove:remove}),\n`+text.slice(moves);
  const dialog=text.indexOf('    transfer ? jsxRuntimeExports.jsx(PsAdminDialog'),confirm=text.indexOf('    confirmDialog);',dialog);
  if(dialog<0||confirm<0)throw Error('Cash transfer dialog span changed');
  return text.slice(0,dialog)+`    transfer ? h(PsCashTransferDialog,{form:transfer,onChange:next=>{setTransfer(next);setTransferError('');},accounts:data.accounts,busy,error:transferError,onClose:()=>setTransfer(null),onSave:saveTransfer}) : null,\n`+text.slice(confirm);
});
const begin='/* MANAGEMENT_COMPONENTS_START */',end='/* MANAGEMENT_COMPONENTS_END */';
const a=source.indexOf(begin);
if(a>=0){const b=source.indexOf(end,a);if(b<0)throw Error('Management end marker missing');source=source.slice(0,a)+source.slice(b+end.length);}
const compiled=await transform(['components.jsx','cash.jsx'].map(name=>fs.readFileSync(path.join(root,'management',name),'utf8')).join('\n'),{loader:'jsx',target:'es2022',jsxFactory:'psH',jsxFragment:'reactExports.Fragment'});
source=source.trimEnd()+'\n'+begin+'\n'+compiled.code+'\n'+end+'\n';
await transform(source,{loader:'js',target:'es2022'});
fs.writeFileSync(file,source);
const cssFile=path.join(root,'possistem-system.css'),cssStart='/* MANAGEMENT_STYLE_START */',cssEnd='/* MANAGEMENT_STYLE_END */';
let css=fs.readFileSync(cssFile,'utf8');
const ca=css.indexOf(cssStart);
if(ca>=0){const cb=css.indexOf(cssEnd,ca);if(cb<0)throw Error('Management CSS end missing');css=css.slice(0,ca)+css.slice(cb+cssEnd.length);}
fs.writeFileSync(cssFile,css.trimEnd()+'\n'+cssStart+'\n'+fs.readFileSync(path.join(root,'management/style.css'),'utf8')+'\n'+cssEnd+'\n');
console.log('Unified management, settings and compact operations navigation');
