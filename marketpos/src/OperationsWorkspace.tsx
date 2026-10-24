import './operations1570.css';
import { LayoutGrid, X, PanelTopClose, PanelTopOpen, Package, Warehouse, ArrowLeftRight, ShoppingCart, ClipboardList, Tags, Users, Receipt, Wallet, Settings, FileText, BarChart3, Download, Shield } from 'lucide-react';
import './workflow1535.css';
import { useEffect, useState, useRef, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { OpsFrame } from './OpsFrame';
import { ProfitSummary } from './ProfitSummary';
import { TransfersPage } from './TransfersPage';
import { DocumentsPage } from './DocumentsPage';
import { BranchStockView, BranchRegisters, type BranchStockMode } from './BranchStockView';
import { Modal } from './forms';
import { opsText } from './opsApi';
import type { Lang, SessionUser } from './types';

export type RemoteObject = { objectId: string; deviceId: string; name: string; product: 'market' | 'restaurant' };

/**
 * Əməliyyatlar (1.5.32): one row of tabs under the top bar - the warehouse
 * frame's pages (#/operations?tab=) and Market's own pages side by side, with
 * no second header. With `remote`, the frame shows another object's till over
 * the internet and Market's local pages are left out.
 */
export function OperationsWorkspace({session,lang,notify,initial='warehouse',registers,users,canUsers,remote=null,stockView=null,can=()=>true,objectSwitch=null,extraSections=[]}:{extraSections?:{id:string;name:string;content:ReactNode}[];stockView?:BranchStockMode|null;session:SessionUser;lang:Lang;notify:(text:string)=>void;initial?:string;registers:ReactNode;users:ReactNode;canUsers:boolean;remote?:RemoteObject|null;can?:(keys:string[])=>boolean;objectSwitch?:ReactNode}) {
 const [localStock,setLocalStock]=useState(false);
 const first=initial==='registers'?'kassa':initial==='users'?'users':extraSections.some(x=>x.id===initial)?initial:'';
 const [tab,setTab]=useState(first),[opened,setOpened]=useState<string[]>(first?[first]:[]),[tabsHidden,setTabsHidden]=useState(false);
 const openTab=(id:string)=>{setOpened(old=>old.includes(id)?old:[...old,id]);setTab(id);};
 const closeTab=(id:string)=>{setOpened(old=>old.filter(x=>x!==id));if(tab===id)setTab('');};
 useEffect(()=>{const open=()=>openTab('documents');window.addEventListener('market:document-open',open);return()=>window.removeEventListener('market:document-open',open);},[]);
 const [shiftRegister,setShiftRegister]=useState(''),[cashRevision,setCashRevision]=useState(0);
 useEffect(()=>{const open=(e:Event)=>{const id=(e as CustomEvent<string>).detail;if(typeof id==='string'&&id){openTab('kassa');setShiftRegister(id);}};window.addEventListener('market:register-open',open);return()=>window.removeEventListener('market:register-open',open);},[]);
 useEffect(()=>{const close=(e:Event)=>{const id=(e as CustomEvent<string>).detail;if(typeof id==='string')closeTab(id);};window.addEventListener('market:work-close',close);return()=>window.removeEventListener('market:work-close',close);},[tab]);
 const t=(a:string,r:string,e:string)=>opsText(lang,a,r,e);
 // frame: a page of the warehouse frame; otherwise Market's own page (local only).
 // rights: the Market rights that open the tab (any one) - a tab the user may not use is not shown.
 const tabs:{id:string;name:string;frame?:boolean;rights:string[]}[]=[
  {id:'goods',name:t('Mallar','Товары','Goods'),frame:true,rights:['OPS_GOODS']},
  {id:'stock',name:t('Anbar','Склад','Stock'),frame:true,rights:['OPS_STOCK']},
  {id:'transfers',name:t('Yerdəyişmə','Перемещения','Transfers'),rights:['OPS_TRANSFERS']},
  {id:'purchases',name:t('Alışlar','Закупки','Purchases'),frame:true,rights:['OPS_PURCHASES']},
  {id:'stocktake',name:t('Sayım','Инвентаризация','Stocktake'),frame:true,rights:['OPS_STOCKTAKE']},
  {id:'categories',name:t('Kateqoriyalar','Категории','Categories'),frame:true,rights:['OPS_CATEGORIES']},
  {id:'vendors',name:t('Partnyorlar','Партнёры','Partners'),frame:true,rights:['OPS_PARTNERS']},
  {id:'sales',name:t('Satışlar','Продажи','Sales'),frame:true,rights:['OPS_SALES']},
  {id:'kassa',name:t('Kassalar','Кассы','Registers'),frame:true,rights:['OPS_CASH']},
  {id:'expenses',name:t('Xərclər','Расходы','Expenses'),frame:true,rights:['OPS_EXPENSES']},
  {id:'salary',name:t('Maaşlar','Зарплаты','Salaries'),frame:true,rights:['OPS_SALARY']},
  {id:'documents',name:t('Ödəniş qaimələri','Платёжные документы','Payment documents'),rights:['OPS_DOCUMENTS']},
  {id:'income',name:t('Qazanc','Доход','Profit'),frame:true,rights:['OPS_PROFIT']},
  {id:'export',name:t('İxrac','Экспорт','Export'),frame:true,rights:['OPS_EXPORT']},
  {id:'users',name:t('İstifadəçilər','Пользователи','Users'),rights:['OPS_USERS']},
 ...extraSections.map(x=>({id:x.id,name:x.name,rights:[]})),
 ].filter(x=>(remote?x.frame||x.id==='transfers'&&remote.product==='market':true)&&(x.id!=='users'||canUsers)&&(extraSections.some(e=>e.id===x.id)||can(x.rights)));
 useEffect(()=>{if(initial==='settings'||initial==='management')openTab(initial);},[initial]);
 const current=tabs.find(x=>x.id===tab);
 const remoteFrame=useRef<HTMLIFrameElement>(null),remoteTab=useRef('goods'),previousTab=useRef(tab);
 if(current?.frame)remoteTab.current=current.id;
 useEffect(()=>{if(remote&&previousTab.current==='transfers'&&tab!=='transfers'){
  const child=remoteFrame.current?.contentWindow as (Window&{__psBranchCache?:{refresh:()=>void}})|null;
  child?.__psBranchCache?.refresh();
 }previousTab.current=tab;},[tab,remote?.deviceId]);
 const icons:Record<string,typeof Package>={goods:Package,stock:Warehouse,transfers:ArrowLeftRight,purchases:ShoppingCart,stocktake:ClipboardList,categories:Tags,vendors:Users,sales:Receipt,kassa:Wallet,expenses:Wallet,salary:Users,documents:FileText,income:BarChart3,export:Download,users:Shield,settings:Settings,management:LayoutGrid};
 const workNav=<div className="ops-workbar"><button type="button" className={'ops-catalog-button '+(!tab?'active':'')} onClick={()=>setTab('')}><LayoutGrid size={18}/> Kataloq</button>
 {!tabsHidden&&<div className="ops-open-tabs" role="tablist" aria-label="Açıq iş vərəqləri">{opened.filter(id=>tabs.some(t=>t.id===id)).map(id=><div className={'ops-work-tab '+(tab===id?'active':'')} key={id}><button role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{tabs.find(x=>x.id===id)?.name}</button><button type="button" className="ops-tab-close" onClick={()=>closeTab(id)} aria-label={`${tabs.find(x=>x.id===id)?.name} vərəqini bağla`}><X size={15}/></button></div>)}</div>}
 <div className="ops-workbar-end">{objectSwitch}<button type="button" title={tabsHidden?'Vərəqləri göstər':'Vərəqləri gizlət'} aria-label={tabsHidden?'Vərəqləri göstər':'Vərəqləri gizlət'} onClick={()=>setTabsHidden(x=>!x)}>{tabsHidden?<PanelTopOpen size={18}/>:<PanelTopClose size={18}/>}</button></div></div>;

 const renderPage=(current:typeof tabs[number])=>{
  if(stockView){const scope=stockView.kind==='all'?'Bütün filiallar':stockView.name;return current.id==='kassa'?<BranchRegisters lang={lang} token={session.sessionToken} includeOwn/>:current.id==='goods'||current.id==='stock'?<BranchStockView lang={lang} token={session.sessionToken} mode={stockView}/>:<div className="module-page"><p>{current.name}: {scope} görünüşü üçün sağdan filial seçin.</p></div>;}
  if(remote)return current.id==='transfers'?<TransfersPage session={session} lang={lang} remote={remote}/>:<iframe ref={tab===current.id?remoteFrame:undefined} className="ops-frame" title={remote.name+' · '+current.name} src={`./cloud-branches/${remote.product==='market'?'remote-market':'remote'}/index.html?device=${encodeURIComponent(remote.deviceId)}&product=${remote.product}&lang=${lang}#/operations?tab=${current.id}`}/>;
  const extra=extraSections.find(x=>x.id===current.id);if(extra)return extra.content;
  return <>
   {current.id==='stock'&&session.role==='manager'&&<div className="branch-stock-switch"><button type="button" aria-pressed={!localStock} onClick={()=>setLocalStock(false)}>Filialların qalıqları</button><button type="button" aria-pressed={localStock} onClick={()=>setLocalStock(true)}>Bu filialın anbarı</button></div>}
   {current.id==='kassa'&&session.role==='manager'&&<BranchRegisters lang={lang} token={session.sessionToken}/>}
   {current.id==='income'&&<ProfitSummary lang={lang}/>}
   {current.id==='stock'&&session.role==='manager'&&!localStock?<BranchStockView lang={lang} token={session.sessionToken} mode={{kind:'all'}}/>:current.frame?<OpsFrame key={`${current.id}-${cashRevision}`} lang={lang} session={session} notify={notify} initialTab={current.id}/>:current.id==='transfers'?<TransfersPage session={session} lang={lang}/>:current.id==='documents'?<DocumentsPage session={session} lang={lang}/>:users}
  </>;
 };
 return <div className={'operations-workspace'+(remote?' is-remote':'')+(!current?' ops-catalog-page':'')}>
 {workNav}
 <div hidden={Boolean(current)}><header className="ops-catalog-heading"><span>İŞ SAHƏSİ</span><h2>Əməliyyatlar</h2><p>Bölməni seçin. Açıq vərəqlərdən işinizə qayıdın.</p></header><div className="ops-catalog-grid">{tabs.map(({id,name},index)=>{const Icon=icons[id]??Package;return <button type="button" key={id} onClick={()=>openTab(id)}><span className="ops-module-icon"><Icon size={22}/></span><strong>{name}</strong><small>{String(index+1).padStart(2,'0')}</small></button>;})}</div>{!tabs.length&&<p>Bu bölmələr üçün icazəniz yoxdur.</p>}</div>
 {opened.map(id=>{const item=tabs.find(x=>x.id===id);return item?<section className="ops-tab-page" key={id} hidden={tab!==id} role="tabpanel" aria-label={item.name}>{renderPage(item)}</section>:null;})}
 {!remote&&shiftRegister&&isValidElement(registers)&&<Modal subtitle="Seçilmiş kassanın növbəsi və hesabatları" title="Kassa · Növbə və X/Z" onClose={()=>{setShiftRegister('');setCashRevision(r=>r+1);}} wide>{cloneElement(registers as ReactElement<{focusRegisterId?:string;compact?:boolean}>,{focusRegisterId:shiftRegister,compact:true})}</Modal>}
 </div>;
}
