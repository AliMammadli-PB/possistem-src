import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {customerAccess,ownerProductLabels} from '../api';
import {useAuth} from '../auth/AuthContext';
import {ERP_MENU,erpItem} from '../erp-menu';
import {Icon,type IconName} from './Icon';
import {BrandMark} from './BrandMark';
import {useTheme} from '../theme';
import {ProductSwitcher} from './ProductSwitcher';
import {ErrorState} from './primitives';

type Entry={to:string;label:string;icon:IconName;tabs?:string[]};
function area(path:string){if(path==='/')return 'home';return [['/anbar','anbar'],['/erp','anbar'],['/emeliyyat','anbar'],['/masalar','tables'],['/setup','setup'],['/downloads','downloads'],['/activity','activity'],['/integrations','integrations'],['/settings','settings'],['/support','support'],['/chat','chat']].find(([prefix])=>path.startsWith(prefix))?.[1];}
function allowed(grants:string[]|null,path:string){const key=area(path);return grants===null||!key||(key==='anbar'?(grants.includes('anbar')||grants.includes('restoran')||ERP_MENU.some(g=>g.items.some(i=>grants.includes(i.key)))):grants.includes(key));}
const sections=[{name:'İş sahəsi',items:[{to:'/',label:'İcmal',icon:'home'},{to:'/anbar?tab=goods',label:'Anbar',icon:'building',tabs:['goods','stock','categories','stocktake','transfers','export']},{to:'/anbar?tab=sales',label:'Satışlar',icon:'activity',tabs:['sales']},{to:'/anbar?tab=journal',label:'Qaimələr',icon:'file',tabs:['journal','purchases','documents']},{to:'/anbar?tab=vendors',label:'Partnyorlar',icon:'user',tabs:['vendors']},{to:'/anbar?tab=kassa',label:'Maliyyə',icon:'monitor',tabs:['kassa','expenses','salary','income']} ] as Entry[]},{name:'Hesab və tətbiq',items:[{to:'/activity',label:'Fəaliyyət',icon:'clock'},{to:'/setup',label:'Quraşdırma',icon:'setup'},{to:'/integrations',label:'İnteqrasiyalar',icon:'integrations'},{to:'/settings/profile',label:'Parametrlər',icon:'settings'}] as Entry[]}];
export function AppShell({children}:{children:ReactNode}){
 const {customer,selectedProduct,signOut}=useAuth(),location=useLocation();
 const {theme,toggleTheme}=useTheme();
 const [grants,setGrants]=useState<string[]|null>(null),[drawer,setDrawer]=useState(false),[compact,setCompact]=useState(false),[account,setAccount]=useState(false),[mobile,setMobile]=useState(()=>matchMedia('(max-width: 1000px)').matches);
 const nav=useRef<HTMLElement>(null),stage=useRef<HTMLDivElement>(null),burger=useRef<HTMLButtonElement>(null),profile=useRef<HTMLDivElement>(null),wasOpen=useRef(false);
 const isWarehouse=location.pathname==='/anbar'||location.pathname.startsWith('/erp/')||location.pathname==='/emeliyyat',tab=new URLSearchParams(location.search).get('tab')||'goods';
 useEffect(()=>{let live=true;void customerAccess().then(data=>{if(live)setGrants(data.portal);}).catch(()=>{});return()=>{live=false;};},[customer?.id]);
 useEffect(()=>{const media=matchMedia('(max-width: 1000px)'),update=()=>{setMobile(media.matches);setDrawer(false);};media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 useEffect(()=>{setDrawer(false);setAccount(false);},[location.pathname,location.search,selectedProduct]);
 useEffect(()=>{const dismiss=(e:MouseEvent)=>{if(!profile.current?.contains(e.target as Node))setAccount(false);};document.addEventListener('mousedown',dismiss);return()=>document.removeEventListener('mousedown',dismiss);},[]);
 useEffect(()=>{
  const open=mobile&&drawer,aside=nav.current,body=stage.current;
  if(aside)aside.inert=mobile&&!drawer;if(body)body.inert=open;
  const previousOverflow=document.body.style.overflow;
  if(open){document.body.style.overflow='hidden';aside?.querySelector<HTMLElement>('a,button')?.focus();}else if(wasOpen.current){burger.current?.focus();}wasOpen.current=open;
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setAccount(false);if(open){setDrawer(false);}}if(open&&e.key==='Tab'&&aside){const els=Array.from(aside.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),select,[tabindex="0"]')).filter(el=>el.getClientRects().length);const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=previousOverflow;if(body)body.inert=false;};
 },[mobile,drawer]);
 const targetTo=(item:Entry)=>{const device=new URLSearchParams(location.search).get('device');return device&&item.to.startsWith('/anbar?')?item.to+'&device='+encodeURIComponent(device):item.to;};
 const current=(item:Entry)=>item.to==='/'?location.pathname==='/':item.tabs?isWarehouse&&item.tabs.includes(tab):location.pathname.startsWith(item.to.split('?')[0]);
 const groups=sections.map((s,i)=>({...s,items:[...s.items,...(i===0&&selectedProduct==='restaurant'?[{to:'/masalar',label:'Masalar',icon:'table' as IconName}]:[])].filter(item=>allowed(grants,item.to))}));
 const active=groups.flatMap(g=>g.items).find(current),title=active?.label||erpItem(location.pathname.split('/').pop()||'')?.label||'İş sahəsi';
 const blocked=!allowed(grants,location.pathname)||(location.pathname==='/masalar'&&selectedProduct!=='restaurant');
 const initials=(customer?.name||'PS').trim().split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase();
 return <div className={'workbench'+(compact&&!mobile?' is-compact':'')+(drawer?' drawer-open':'')} data-product={selectedProduct||'restaurant'}>
  <a className="wb-skip" href="#workspace-main">Məzmuna keç</a>
  <aside ref={nav} className="wb-navigation" id="workspace-navigation" aria-label="Əsas menyu" aria-hidden={mobile&&!drawer}>
   <div className="wb-brand-row"><a href="/" className="wb-brand" aria-label="possistem ana səhifə"><BrandMark/><span><b>possistem</b><small>biznesinizin iş sahəsi</small></span></a><button className="wb-drawer-close" aria-label="Menyunu bağla" onClick={()=>{setDrawer(false);}}><Icon name="x"/></button></div>
   <div className="wb-nav-scroll">{groups.map(g=><div className="wb-nav-group" key={g.name}><p>{g.name}</p><nav aria-label={g.name}>{g.items.map(item=><Link key={item.to} to={targetTo(item)} title={compact&&!mobile?item.label:undefined} aria-current={current(item)?'page':undefined} className={'wb-nav-item'+(current(item)?' selected':'')}><span className="wb-nav-icon"><Icon name={item.icon} size={21}/></span><span>{item.label}</span>{current(item)&&<i/>}</Link>)}</nav></div>)}<div className="wb-help-box"><span><Icon name="help" size={24}/></span><strong>Köməyə ehtiyac var?</strong><p>Quraşdırma və gündəlik işlər üçün yanınızdayıq.</p><Link to="/support">Dəstək al <Icon name="arrow-right" size={16}/></Link><Link className="wb-chat-link" to="/chat">Söhbəti aç</Link></div></div>
   <div className="wb-profile-card"><span className="wb-avatar">{initials}</span><div><strong>{customer?.name||'Hesab'}</strong><small>{customer?.email}</small></div><button aria-label="Hesabdan çıx" title="Hesabdan çıx" onClick={()=>void signOut()}><Icon name="logout" size={18}/></button></div>
  </aside>
  {mobile&&drawer&&<button className="wb-scrim" aria-label="Menyunun kənarını bağla" onClick={()=>{setDrawer(false);}}/>}
  <div className="wb-stage" ref={stage}>
   <header className="wb-commandbar"><div className="wb-command-start"><button ref={burger} type="button" className={'wb-burger'+(mobile&&drawer?' opened':'')} aria-label={mobile?'Menyunu aç':compact?'Menyunu genişləndir':'Menyunu yığ'} aria-controls="workspace-navigation" aria-expanded={mobile?drawer:!compact} onClick={()=>mobile?setDrawer(true):setCompact(v=>!v)}><span/><span/><span/></button><div className="wb-breadcrumb"><span>İş sahəsi</span><Icon name="chevron-right" size={14}/><strong>{title}</strong></div></div><div className="wb-command-end"><ProductSwitcher/><button type="button" className="wb-theme" onClick={toggleTheme} aria-label={theme==='dark'?'Açıq rejimə keç':'Tünd rejimə keç'} title={theme==='dark'?'Açıq rejim':'Tünd rejim'}><Icon name={theme==='dark'?'sun':'moon'} size={18}/></button><Link className="wb-bell" to="/activity" aria-label="Bildirişlər"><Icon name="bell" size={20}/></Link><div className="wb-account" ref={profile}><button className="wb-account-button" aria-label="Hesab menyusu" aria-haspopup="menu" aria-expanded={account} onClick={()=>setAccount(v=>!v)}><span className="wb-avatar">{initials}</span><span>{customer?.name||'Hesab'}</span><Icon name="chevron-down" size={15}/></button>{account&&<div className="wb-account-popover" role="menu"><strong>{customer?.name}</strong><small>{customer?.email}</small><Link role="menuitem" to="/settings/profile"><Icon name="user" size={17}/>Profil</Link><Link role="menuitem" to="/settings/security"><Icon name="shield" size={17}/>Təhlükəsizlik</Link><button role="menuitem" onClick={()=>void signOut()}><Icon name="logout" size={17}/>Çıxış</button></div>}</div></div></header>
   <main className="wb-content" id="workspace-main">{blocked?<ErrorState title="Buna icazəniz yoxdur" description="Bu bölmə seçilmiş POS və hesab icazələri üçün açıq deyil."/>:<div key={(customer?.id||'guest')+':'+(selectedProduct||'default')}>{children}</div>}</main>
  </div>
  <nav className="wb-mobile-dock" aria-label="Sürətli menyu">{[{to:'/',label:'İcmal',icon:'home' as IconName},{to:'/anbar?tab=goods',label:'Anbar',icon:'building' as IconName,tabs:['goods','stock','categories','stocktake','transfers','export']},{to:'/anbar?tab=sales',label:'Satışlar',icon:'activity' as IconName,tabs:['sales']}].filter(i=>allowed(grants,i.to)).map(item=><Link to={targetTo(item)} key={item.to} aria-current={current(item)?'page':undefined}><Icon name={item.icon} size={21}/><span>{item.label}</span></Link>)}<button onClick={()=>setDrawer(true)} aria-label="Bütün bölmələr"><Icon name="more" size={21}/><span>Bölmələr</span></button></nav>
 </div>;
}
