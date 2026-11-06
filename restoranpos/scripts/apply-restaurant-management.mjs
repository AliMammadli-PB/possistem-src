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
const begin='/* MANAGEMENT_COMPONENTS_START */',end='/* MANAGEMENT_COMPONENTS_END */';
const a=source.indexOf(begin);
if(a>=0){const b=source.indexOf(end,a);if(b<0)throw Error('Management end marker missing');source=source.slice(0,a)+source.slice(b+end.length);}
const compiled=await transform(fs.readFileSync(path.join(root,'management/components.jsx'),'utf8'),{loader:'jsx',target:'es2022',jsxFactory:'psH',jsxFragment:'reactExports.Fragment'});
source=source.trimEnd()+'\n'+begin+'\n'+compiled.code+'\n'+end+'\n';
await transform(source,{loader:'js',target:'es2022'});
fs.writeFileSync(file,source);
const cssFile=path.join(root,'possistem-system.css'),cssStart='/* MANAGEMENT_STYLE_START */',cssEnd='/* MANAGEMENT_STYLE_END */';
let css=fs.readFileSync(cssFile,'utf8');
const ca=css.indexOf(cssStart);
if(ca>=0){const cb=css.indexOf(cssEnd,ca);if(cb<0)throw Error('Management CSS end missing');css=css.slice(0,ca)+css.slice(cb+cssEnd.length);}
fs.writeFileSync(cssFile,css.trimEnd()+'\n'+cssStart+'\n'+fs.readFileSync(path.join(root,'management/style.css'),'utf8')+'\n'+cssEnd+'\n');
console.log('Unified management, settings and compact operations navigation');
