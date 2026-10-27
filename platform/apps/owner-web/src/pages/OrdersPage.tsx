import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingRequest } from '../api';

type Order={id:string;order_no:string;kind:string;status:string;amount_minor:number|string;fulfillment_status:string;created_at:string;estimated_at?:string|null;delivery_kind?:string};
type Address={city?:string;district?:string;street?:string;building?:string;apartment?:string;entrance?:string;floor?:string;landmark?:string;courierNote?:string};
type Detail={order:Order&{delivery_kind:string;recipient_name:string;recipient_phone:string;delivery_address:string;delivery_fee_minor:number|string;delivery_details?:Address|null;note?:string|null;updated_at?:string};items:{product_id:string;name:string;qty:number;unit_price_minor:number}[]};
type Cursor={before:string;beforeId:string};
const money=(v:number|string)=>new Intl.NumberFormat('az-AZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)/100)+' ₼';
const labels:Record<string,string>={paid:'Ödənilib',awaiting_payment:'Ödəniş gözlənilir',processing:'Bank təsdiqi gözlənilir',unknown:'Bank nəticəsi yoxlanılır',failed:'Ödəniş alınmadı',expired:'Vaxtı bitib',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarılır',paid_review:'Əməkdaş yoxlayır',preparing:'Hazırlanır',ready:'Hazırdır',dispatched:'Çatdırılır',completed:'Təhvil verilib',pending:'Gözlənilir',waiting:'Ödəniş gözlənilir',cancelled:'Ləğv edilib'};

const when=(v:string)=>new Date(v).toLocaleString('az-AZ',{timeZone:'Asia/Baku',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
/** The steps a paid order walks through; pickup orders end at "ready" → "completed". */
function steps(kind:string){return kind==='pickup'?[['paid','Ödənilib'],['preparing','Hazırlanır'],['ready','Götürməyə hazırdır'],['completed','Təhvil verilib']]:[['paid','Ödənilib'],['preparing','Hazırlanır'],['ready','Hazırdır'],['dispatched','Çatdırılır'],['completed','Təhvil verilib']];}
function Progress({order}:{order:Order&{delivery_kind:string}}){
 if(order.status!=='paid')return null;
 if(order.fulfillment_status==='cancelled')return <p className="bill-alert error">Sifariş ləğv edilib.</p>;
 const list=steps(order.delivery_kind),current=Math.max(0,list.findIndex(([k])=>k===(order.fulfillment_status==='waiting'||order.fulfillment_status==='pending'?'paid':order.fulfillment_status)));
 return <ol className="commerce-steps" aria-label="Sifarişin gedişatı">{list.map(([k,label],i)=><li key={k} className={i<current?'done':i===current?'current':''} aria-current={i===current?'step':undefined}><span aria-hidden="true">{i<current?'✓':i+1}</span>{label}</li>)}</ol>;
}
const addressRows=(a:Address)=>[['Şəhər',a.city],['Rayon',a.district],['Küçə',a.street],['Bina',a.building],['Mənzil',a.apartment],['Giriş',a.entrance],['Mərtəbə',a.floor],['Orientir',a.landmark],['Kuryer üçün',a.courierNote]].filter((r):r is [string,string]=>Boolean(r[1]));

export default function OrdersPage(){
 const [orders,setOrders]=useState<Order[]|null>(null),[q,setQ]=useState(''),[filter,setFilter]=useState('all'),[open,setOpen]=useState(''),[details,setDetails]=useState<Record<string,Detail>>({}),[error,setError]=useState(''),[next,setNext]=useState<Cursor|null>(null),[more,setMore]=useState(false);
 const generation=useRef(0);
 async function load(append=false){
  if(append&&!next)return;
  const run=++generation.current;
  if(append)setMore(true);
  try{
   const params=new URLSearchParams({q,filter,...(append&&next?next:{})});
   const data=await billingRequest<{orders:Order[];next:Cursor|null}>('/shop-orders?'+params);
   if(run!==generation.current)return;
   setOrders(old=>append?[...(old??[]),...data.orders.filter(o=>!old?.some(x=>x.id===o.id))]:data.orders);setNext(data.next);setError('');
  }catch(e){if(run===generation.current)setError(e instanceof Error?e.message:'Sifarişlər yüklənmədi.');}
  finally{if(run===generation.current)setMore(false);}
 }
 useEffect(()=>{generation.current++;setOrders(null);setNext(null);setMore(false);const t=setTimeout(()=>void load(),250);return()=>{generation.current++;clearTimeout(t);};},[q,filter]);
 // Keep the first page fresh while the customer waits for a status change.
 useEffect(()=>{const tick=()=>{if(document.visibilityState==='visible'&&orders&&!more&&orders.length<=25)void load();};const t=setInterval(tick,15000);window.addEventListener('focus',tick);return()=>{clearInterval(t);window.removeEventListener('focus',tick);};},[q,filter,orders?.length,more]);
 async function toggle(id:string){
  if(open===id){setOpen('');return;}
  setOpen(id);
  if(!details[id])try{const d=await billingRequest<Detail>('/orders/'+id);setDetails(old=>({...old,[id]:d}));}catch(e){setError(e instanceof Error?e.message:'Sifariş açılmadı.');}
 }
 const shown=(orders??[]).filter(o=>(filter==='all'||filter==='paid'&&o.status==='paid'||filter==='pending'&&['awaiting_payment','processing','unknown'].includes(o.status))&&o.order_no.toLowerCase().includes(q.toLowerCase()));
 return <div className="bill-page orders-page">
  <header className="bill-heading"><div><span className="bill-eyebrow">POSSİSTEM MAĞAZA</span><h1>Sifarişlərim</h1><p>Aldığınız məhsullar, ödəniş və təhvil vəziyyəti.</p></div><a className="commerce-action" href="/mehsul/avadanliq/">Məhsullara bax →</a></header>
  {error&&<p role="alert" className="bill-alert error">{error}<button onClick={()=>void load()}>Yenilə</button></p>}
  <div className="commerce-toolbar"><label>Sifariş axtar<input type="search" placeholder="Sifariş nömrəsi" value={q} onChange={e=>setQ(e.target.value)}/></label><label>Vəziyyət<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Bütün sifarişlər</option><option value="paid">Ödənilmiş</option><option value="pending">Ödəniş gözləyən</option></select></label><span>{orders?.length??0} sifariş</span><button onClick={()=>void load()}>Yenilə</button></div>
  {orders?shown.length?<div className="commerce-order-list">{shown.map(o=>{const d=details[o.id];return <section className="bill-panel commerce-order" key={o.id}>
   <button className="commerce-order-head" aria-expanded={open===o.id} onClick={()=>void toggle(o.id)}><span><strong>{o.order_no}</strong><small>{new Date(o.created_at).toLocaleString('az-AZ',{timeZone:'Asia/Baku'})}</small></span><span className={'bill-status '+o.status}>{labels[o.status]??o.status}</span><span>{o.status==='paid'?labels[o.fulfillment_status]??o.fulfillment_status:'—'}{o.status==='paid'&&o.estimated_at&&o.fulfillment_status!=='completed'&&o.fulfillment_status!=='cancelled'&&<small className="commerce-eta-inline">Təxmini: {when(o.estimated_at)}</small>}</span><b>{money(o.amount_minor)}</b><span aria-hidden="true">{open===o.id?'−':'+'}</span></button>
   {open===o.id&&(d?<div className="commerce-order-detail">
    <Progress order={d.order}/>
    {d.order.status==='paid'&&d.order.estimated_at&&d.order.fulfillment_status!=='completed'&&d.order.fulfillment_status!=='cancelled'&&<p className="commerce-eta"><strong>{d.order.delivery_kind==='pickup'?'Təxmini hazır olma vaxtı':'Təxmini çatdırılma vaxtı'}</strong>{when(d.order.estimated_at)}</p>}
    {d.order.note&&<p className="commerce-note"><strong>Satıcıdan qeyd</strong>{d.order.note}{d.order.updated_at&&<small>{when(d.order.updated_at)}</small>}</p>}
    <ul>{d.items.map(i=><li key={i.product_id}><span>{i.name}<small>{i.qty} ədəd × {money(i.unit_price_minor)}</small></span><strong>{money(i.qty*i.unit_price_minor)}</strong></li>)}</ul>
    <p><strong>{d.order.delivery_kind==='pickup'?'Özü götürmə':'Çatdırılma'}</strong> · {d.order.recipient_name} · {d.order.recipient_phone}</p>
    {d.order.delivery_kind!=='pickup'&&d.order.delivery_details&&addressRows(d.order.delivery_details).length?<dl className="commerce-address">{addressRows(d.order.delivery_details).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>:d.order.delivery_address&&<p>{d.order.delivery_address}</p>}
    <p>Çatdırılma: {money(d.order.delivery_fee_minor)} · Yekun: <strong>{money(o.amount_minor)}</strong></p>
    <Link to={'/faturalar/'+o.id}>Fakturanı aç →</Link>
   </div>:<p role="status">Sifariş açılır…</p>)}
  </section>;})}</div>:<section className="bill-panel commerce-empty"><h2>{orders.length?'Uyğun sifariş tapılmadı':'İlk sifarişiniz burada görünəcək'}</h2><p>Məhsulu səbətə əlavə edib sifarişi tamamlayın. Abunə ödənişləri ayrıca “Abunəlik” bölməsindədir.</p><a href="/mehsul/avadanliq/">Mağazaya keç →</a></section>:<p role="status">Sifarişlər yüklənir…</p>}
  {next&&<button disabled={more} onClick={()=>void load(true)}>{more?'Yüklənir…':'Əvvəlki sifarişləri göstər'}</button>}
 </div>;
}
