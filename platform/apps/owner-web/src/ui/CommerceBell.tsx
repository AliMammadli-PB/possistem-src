import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingRequest } from '../api';
import { Icon } from './Icon';

type Notice={id:string;kind:string;title:string;body:string;payload?:{url?:string}|null;readAt:string|null;createdAt:string};
type Feed={notifications:Notice[];unread:number};
/** Portal links stored in notifications point at /pos/app/…; inside the app they are router paths. */
const target=(n:Notice)=>n.payload?.url==='/pos/app/abunelik'?'/abunelik':n.payload?.url==='/pos/app/sifarisler'?'/sifarisler':'/activity';

export function CommerceBell(){
 const [feed,setFeed]=useState<Feed>({notifications:[],unread:0}),[open,setOpen]=useState(false),[error,setError]=useState('');
 const box=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
 async function load(){try{setFeed(await billingRequest<Feed>('/notifications'));setError('');}catch{setError('Bildirişlər yüklənmədi.');}}
 useEffect(()=>{let alive=true;const tick=()=>{if(alive&&document.visibilityState==='visible')void load();};tick();const timer=setInterval(tick,15000);window.addEventListener('focus',tick);
  const outside=(e:MouseEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',outside);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',tick);document.removeEventListener('mousedown',outside);};},[]);
 async function markRead(id?:string){try{await billingRequest('/notifications/read',{method:'POST',body:JSON.stringify(id?{id}:{})});await load();}catch{setError('Oxunmuş kimi qeyd edilmədi. Yenidən yoxlayın.');}}
 return <div className="commerce-bell" ref={box} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}}}>
  <button ref={button} className="wb-bell" aria-label={'Bildirişlər'+(feed.unread?': '+feed.unread+' oxunmamış':'')} aria-expanded={open} onClick={()=>{setOpen(v=>!v);void load();}}><Icon name="bell"/>{feed.unread>0&&<span className="commerce-badge">{feed.unread>99?'99+':feed.unread}</span>}</button>
  {open&&<section className="commerce-notices" aria-label="Bildirişlər">
   <header><strong>Bildirişlər</strong><button onClick={()=>void markRead()} disabled={!feed.unread}>Hamısını oxu</button></header>
   {error&&<p role="alert">{error}<button onClick={()=>void load()}>Yenilə</button></p>}
   <div>{!feed.notifications.length&&<p>Yeni bildirişiniz yoxdur.</p>}{feed.notifications.slice(0,20).map(n=><article key={n.id} className={n.readAt?'':'unread'}><Link to={target(n)} onClick={()=>{void markRead(n.id);setOpen(false);}}><strong>{n.title}</strong><span>{n.body}</span><time>{new Date(n.createdAt).toLocaleString('az-AZ',{timeZone:'Asia/Baku'})}</time></Link>{!n.readAt&&<button aria-label="Oxunmuş kimi qeyd et" onClick={()=>void markRead(n.id)}><Icon name="check" size={16}/></button>}</article>)}</div>
   <Link to="/activity" onClick={()=>setOpen(false)}>Bütün bildirişlər →</Link>
  </section>}
 </div>;
}
