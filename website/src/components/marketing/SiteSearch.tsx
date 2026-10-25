'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {useI18n} from '@/components/providers/I18nProvider';
import {fetchPublicCatalog,type CatalogProduct} from '@/lib/catalog-products';
import {rankSearch,searchPages,searchProducts} from '@/lib/site-search';
import './site-search.css';

const COPY={
 az:{label:'Saytda axtar',placeholder:'Məhsul, dəstək, quraşdırma…',search:'Axtar',pages:'Səhifələr və xidmətlər',products:'Məhsullar',corrected:'Bunu nəzərdə tuturdunuz?',all:'Mağazada bütün nəticələr',none:'Uyğun təklif tapılmadı. Başqa söz sınayın.',loading:'Məhsullar axtarılır…',failed:'Məhsul təklifləri yüklənmədi.',retry:'Yenidən yoxla',clear:'Axtarışı təmizlə'},
 en:{label:'Search the site',placeholder:'Products, support, setup…',search:'Search',pages:'Pages and services',products:'Products',corrected:'Did you mean?',all:'All store results',none:'No suggestions found. Try another word.',loading:'Searching products…',failed:'Product suggestions could not load.',retry:'Try again',clear:'Clear search'},
 ru:{label:'Поиск по сайту',placeholder:'Товары, поддержка, установка…',search:'Найти',pages:'Страницы и услуги',products:'Товары',corrected:'Вы имели в виду?',all:'Все результаты магазина',none:'Подсказки не найдены. Попробуйте другое слово.',loading:'Поиск товаров…',failed:'Не удалось загрузить товары.',retry:'Повторить',clear:'Очистить поиск'},
};
type Props={variant:'header'|'mobile'|'catalog';onNavigate?:()=>void;value?:string;onChange?:(q:string)=>void;onSearch?:(q:string)=>void;products?:CatalogProduct[]};
export function SiteSearch({variant,onNavigate,value,onChange,onSearch,products}:Props){
 const {language}=useI18n(),c=COPY[language],router=useRouter(),id=useId(),root=useRef<HTMLFormElement>(null);
 const [draft,setDraft]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const [catalog,setCatalog]=useState<CatalogProduct[]|null>(null),[loadState,setLoadState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
 const query=value??draft;const [retry,setRetry]=useState(0);
 useEffect(()=>{setActive(-1);},[query]);
 useEffect(()=>{
  if(products||!open||query.trim().length<2||catalog)return;
  let cancelled=false;const timer=setTimeout(()=>{
   setLoadState('loading');fetchPublicCatalog().then(data=>{if(!cancelled){setCatalog(data.products);setLoadState('ready');}}).catch(()=>{if(!cancelled)setLoadState('error');});
  },180);
  return()=>{cancelled=true;clearTimeout(timer);};
 },[products,open,query,catalog,retry]);
 useEffect(()=>{const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 const entries=useMemo(()=>[...searchPages(language),...searchProducts(products??catalog??[])],[language,products,catalog]);
 const matches=useMemo(()=>rankSearch(query,entries),[query,entries]);
 const pages=matches.filter(e=>e.kind==='page').slice(0,4),items=matches.filter(e=>e.kind==='product').slice(0,4),results=[...pages,...items];
 const allHref=query.trim()?`/mehsul/avadanliq/?bolme=all&q=${encodeURIComponent(query.trim())}`:'/mehsul/avadanliq/';
 const navigate=(href:string)=>{setOpen(false);onNavigate?.();router.push(href);};
 const change=(q:string)=>{if(onChange)onChange(q);else setDraft(q);setOpen(true);};
 const submit=()=>{
  if(active===results.length&&query.trim()){navigate(allHref);return;}
  const selected=active>=0?results[active]:matches.find(e=>e.kind==='page'&&(e.score??0)>=65);
  if(selected){navigate(selected.href);return;}
  setOpen(false);onNavigate?.();if(onSearch)onSearch(query.trim());else router.push(allHref);
 };
 const visible=open;
 return <form ref={root} className={`site-search ${variant==='catalog'?'catalog-searchbar':variant==='mobile'?'ps-nav-search':'ps-header-search'}`} role="search" onSubmit={event=>{event.preventDefault();submit();}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}}>
  <div className="site-search-field"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><label className="sr-only" htmlFor={id}>{c.label}</label><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={`${id}-results`} aria-activedescendant={visible&&active>=0?`${id}-option-${active}`:undefined} value={query} onChange={e=>change(e.target.value)} onFocus={()=>setOpen(true)} onKeyDown={event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);setActive(-1);}
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);const count=results.length+(query.trim()?1:0);if(count)setActive(i=>event.key==='ArrowDown'?(i+1+count)%count:(i<=0?count-1:i-1));}
  }} placeholder={c.placeholder} autoComplete="off" maxLength={120}/>{query&&<button type="button" className="site-search-clear" aria-label={c.clear} onClick={()=>{change('');root.current?.querySelector('input')?.focus();}}>×</button>}</div>
  {variant!=='header'&&<button className="site-search-submit" type="submit">{c.search}</button>}
  {visible&&<div className="site-search-popover"><div id={`${id}-results`} role="listbox" aria-label={c.label}>
   {[{label:c.pages,entries:pages},{label:c.products,entries:items}].map(group=>group.entries.length>0&&<div key={group.label} role="group" aria-label={group.label}><p className="site-search-group">{group.label}</p>{group.entries.map(entry=>{const index=results.indexOf(entry);return <Link key={entry.id} id={`${id}-option-${index}`} role="option" aria-selected={active===index} className="site-search-result" href={entry.href} prefetch={false} onClick={()=>{setOpen(false);onNavigate?.();}}><span>{entry.corrected&&<small>{c.corrected}</small>}<strong>{entry.title}</strong><span>{entry.description}</span></span><span aria-hidden="true">↗</span></Link>;})}</div>)}
   {query.trim()&&<Link id={`${id}-option-${results.length}`} className="site-search-all" role="option" aria-selected={active===results.length} href={allHref} prefetch={false} onClick={()=>{setOpen(false);onNavigate?.();}}>{c.all}<span aria-hidden="true">→</span></Link>}
  </div>{results.length===0&&<p className="site-search-message" role="status">{c.none}</p>}{!products&&loadState==='loading'&&<p className="site-search-message" role="status">{c.loading}</p>}{!products&&loadState==='error'&&<p className="site-search-message" role="status">{c.failed} <button type="button" onClick={()=>setRetry(n=>n+1)}>{c.retry}</button></p>}</div>}
 </form>;
}
