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
export function OperationsWorkspace({session,lang,notify,initial='warehouse',registers,users,canUsers,remote=null,stockView=null,can=()=>true,objectSwitch=null}:{stockView?:BranchStockMode|null;session:SessionUser;lang:Lang;notify:(text:string)=>void;initial?:string;registers:ReactNode;users:ReactNode;canUsers:boolean;remote?:RemoteObject|null;can?:(keys:string[])=>boolean;objectSwitch?:ReactNode}) {
 const [localStock,setLocalStock]=useState(false);
 const [tab,setTab]=useState(initial==='registers'?'kassa':initial==='users'?'users':'goods');
 useEffect(()=>{const open=()=>setTab('documents');window.addEventListener('market:document-open',open);return()=>window.removeEventListener('market:document-open',open);},[]);
 const [shiftRegister,setShiftRegister]=useState(''),[cashRevision,setCashRevision]=useState(0);
 useEffect(()=>{const open=(e:Event)=>{const id=(e as CustomEvent<string>).detail;if(typeof id==='string'&&id){setTab('kassa');setShiftRegister(id);}};window.addEventListener('market:register-open',open);return()=>window.removeEventListener('market:register-open',open);},[]);
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
 ].filter(x=>(remote?x.frame||x.id==='transfers'&&remote.product==='market':true)&&(x.id!=='users'||canUsers)&&can(x.rights));
 const current=tabs.find(x=>x.id===tab)??tabs[0];
 const remoteFrame=useRef<HTMLIFrameElement>(null),remoteTab=useRef('goods'),previousTab=useRef(tab);
 if(current?.frame)remoteTab.current=current.id;
 useEffect(()=>{if(remote&&previousTab.current==='transfers'&&tab!=='transfers'){
  const child=remoteFrame.current?.contentWindow as (Window&{__psBranchCache?:{refresh:()=>void}})|null;
  child?.__psBranchCache?.refresh();
 }previousTab.current=tab;},[tab,remote?.deviceId]);
 // All branches, or an offline branch's last copy: read-only stock in place of the tabs (1.5.41).
 // All branches, or an offline branch's last copy (1.5.41/1.5.42): the same tab row stays;
 // Mallar and Anbar show the branches' stock, the rest open only for this or an online branch.
 if(stockView&&current){const scope=stockView.kind==='all'?t('Bütün filiallar','Все филиалы','All branches'):stockView.name;
  return <div className="operations-workspace">
   <nav className="operations-tabs" aria-label={t('Əməliyyatlar','Операции','Operations')}>{tabs.map(({id,name})=><button key={id} className={id===current.id?'active':''} onClick={()=>setTab(id)}>{name}</button>)}{objectSwitch&&<span className="operations-object">{objectSwitch}</span>}</nav>
   {current.id==='kassa'?<div className="module-page"><BranchRegisters lang={lang} token={session.sessionToken} includeOwn/></div>:current.id==='goods'||current.id==='stock'
    ?<BranchStockView lang={lang} token={session.sessionToken} mode={stockView}/>
    :<div className="module-page"><p className="label-hint">{t(`${current.name}: "${scope}" görünüşündə yalnız Mallar, Anbar və Kassalar var. Bu bölmə üçün sağ üstdən bu filialı və ya onlayn filialı seçin.`,`${current.name}: в режиме «${scope}» доступны только Товары и Склад. Для этого раздела выберите справа вверху этот или онлайн-филиал.`,`${current.name}: the "${scope}" view has Goods and Stock only. For this section pick this or an online branch at the top right.`)}</p></div>}
  </div>;}
 if(!current)return <div className={"operations-workspace"+(remote?" is-remote":"")}><p className="module-page">{t('Bu bölmə üçün icazəniz yoxdur','Нет доступа к этому разделу','No access to this section')}</p></div>;
 return <div className={"operations-workspace"+(remote?" is-remote":"")}>
  <nav className="operations-tabs" aria-label={t('Əməliyyatlar','Операции','Operations')}>{tabs.map(({id,name})=><button key={id} className={id===current.id?'active':''} onClick={()=>setTab(id)}>{name}</button>)}{objectSwitch&&<span className="operations-object">{objectSwitch}</span>}</nav>
  {remote&&current.id==='transfers'&&<TransfersPage key={remote.deviceId} session={session} lang={lang} remote={remote}/>}
  {remote&&<iframe ref={remoteFrame} hidden={!current.frame} className="ops-frame" title={remote.name} src={`./cloud-branches/${remote.product==='market'?'remote-market':'remote'}/index.html?device=${encodeURIComponent(remote.deviceId)}&product=${remote.product}&lang=${lang}#/operations?tab=${remoteTab.current}`}/>}
  {!remote&&current.id==='stock'&&session.role==='manager'&&<div className="branch-stock-switch"><button type="button" aria-pressed={!localStock} onClick={()=>setLocalStock(false)}>{t('Filialların qalıqları','Остатки филиалов','Branch stock')}</button><button type="button" aria-pressed={localStock} onClick={()=>setLocalStock(true)}>{t('Bu filialın anbarı','Склад этого филиала','This branch warehouse')}</button></div>}
  {!remote&&current.id==='kassa'&&session.role==='manager'&&<BranchRegisters lang={lang} token={session.sessionToken}/>}
  {!remote&&current.id==='income'&&<ProfitSummary lang={lang}/>}
  {!remote&&current.id==='stock'&&session.role==='manager'&&!localStock?<BranchStockView lang={lang} token={session.sessionToken} mode={{kind:'all'}}/>:!remote&&(current.frame
   ?<OpsFrame key={`${current.id}-${cashRevision}`} lang={lang} session={session} notify={notify} initialTab={current.id}/>
   :current.id==='transfers'?<TransfersPage session={session} lang={lang}/>
   :current.id==='documents'?<DocumentsPage session={session} lang={lang}/>
   :users)}
 {!remote&&shiftRegister&&isValidElement(registers)&&<Modal subtitle={t('Seçilmiş kassanın növbəsi və hesabatları','Смена и отчёты выбранной кассы','Selected register shift and reports')} title={t('Kassa · Növbə və X/Z','Касса · Смена и X/Z','Register · Shift and X/Z')} onClose={()=>{setShiftRegister('');setCashRevision(r=>r+1);}} wide>{cloneElement(registers as ReactElement<{focusRegisterId?:string;compact?:boolean}>,{focusRegisterId:shiftRegister,compact:true})}</Modal>}
 </div>;
}
