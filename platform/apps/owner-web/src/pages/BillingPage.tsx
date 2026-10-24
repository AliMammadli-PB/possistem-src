import { useCallback, useEffect, useRef, useState } from 'react';
import { billingRequest } from '../api';
import '../billing.css';

type Subscription={id:string;product:string;monthlyAmountMinor:number;currency:string;paidUntil:string|null;state:string;priceVersion:number;autoRenew:boolean;cardMask:string|null;hasSavedCard:boolean};
type Data={subscriptions:Subscription[];paymentsAvailable:boolean;recurringAvailable:boolean;termsVersion:string|null};
type Order={id:string;order_no:string;kind:string;amount_minor:number|string;status:string;created_at:string;period_end:string|null;fulfillment_status:string};
const labels:Record<string,string>={market:'Market POS',restaurant:'Restoran POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS',active:'Aktiv',expired:'Müddət bitib',awaiting_payment:'İlk ödəniş gözlənilir',disabled:'Abunəlik bağlıdır',paid:'Ödənilib',paid_review:'Ödəniş alınıb · araşdırılır',processing:'Bank cavabı gözlənilir',unknown:'Nəticə dəqiqləşdirilir',failed:'Ödəniş alınmadı',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarma gözlənilir',subscription:'Abunəlik',shop:'Məhsul sifarişi'};
const money=(v:number|string)=>new Intl.NumberFormat('az-AZ',{style:'currency',currency:'AZN'}).format(Number(v)/100);
const date=(v:string|null)=>v?new Date(v).toLocaleString('az-AZ'):'—';
export default function BillingPage(){
  const [data,setData]=useState<Data|null>(null),[orders,setOrders]=useState<Order[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[consents,setConsents]=useState<Record<string,boolean>>({});
  const keys=useRef<Record<string,string>>({});
  const load=useCallback(async()=>{try{const [d,o]=await Promise.all([billingRequest<Data>(''),billingRequest<{orders:Order[]}>('/orders')]);setData(d);setOrders(o.orders);setError('');}catch(e){setError(e instanceof Error?e.message:'Ödənişlər yüklənmədi.');}},[]);
  useEffect(()=>{void load();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!busy)void load();},15000);return()=>clearInterval(timer);},[load,busy]);
  async function pay(s:Subscription){
    if(busy)return;setBusy(s.id);setError('');setMessage('');
    try{
      const saveCard=Boolean(consents[s.id]),key=s.id+':'+s.priceVersion+':'+saveCard;
      const requestId=keys.current[key]??(keys.current[key]=crypto.randomUUID());
      const result=await billingRequest<{redirectUrl:string|null;paymentState:string}>('/subscriptions/'+s.id+'/checkout',{method:'POST',body:JSON.stringify({requestId,priceVersion:s.priceVersion,saveCard,termsVersion:data?.termsVersion})});
      if(result.redirectUrl){window.location.assign(result.redirectUrl);return;}
      setMessage(result.paymentState==='unknown'?'Bank cavabı dəqiqləşdirilir. Təkrar ödəniş etməyin; nəticə burada yenilənəcək.':'Ödəniş vəziyyəti yeniləndi.');await load();
    }catch(e){setError(e instanceof Error?e.message:'Ödəniş başlamadı.');}finally{setBusy('');}
  }
  async function stop(s:Subscription){
    if(!window.confirm('Avtomatik yenilənmə dayandırılsın? Ödənilmiş müddətiniz qalacaq.'))return;
    setBusy(s.id);try{await billingRequest('/subscriptions/'+s.id+'/consent',{method:'POST',body:JSON.stringify({enabled:false})});setMessage('Avtomatik yenilənmə dayandırıldı.');await load();}catch(e){setError(e instanceof Error?e.message:'Dəyişiklik alınmadı.');}finally{setBusy('');}
  }
  async function resume(s:Subscription){
    if(!consents[s.id])return;setBusy(s.id);setError('');
    try{await billingRequest('/subscriptions/'+s.id+'/consent',{method:'POST',body:JSON.stringify({enabled:true,priceVersion:s.priceVersion,termsVersion:data?.termsVersion})});setMessage('Avtomatik yenilənmə bu məbləğlə aktivləşdirildi.');await load();}catch(e){setError(e instanceof Error?e.message:'Razılıq saxlanılmadı.');}finally{setBusy('');}
  }
  return <div className="bill-page">
    <header className="bill-heading"><div><span className="bill-eyebrow">HESAB VƏ ÖDƏNİŞLƏR</span><h1>Abunəlikləriniz</h1><p>Proqramlarınızın aylıq haqqı, istifadə müddəti və ödəniş tarixçəsi.</p></div><button type="button" onClick={()=>void load()} disabled={Boolean(busy)}>Yenilə</button></header>
    {error&&<p className="bill-alert error" role="alert">{error}<button type="button" onClick={()=>void load()}>Yenidən yoxla</button></p>}
    {message&&<p className="bill-alert" role="status">{message}</p>}
    {data&&!data.paymentsAvailable&&<p className="bill-alert">Onlayn ödəniş hazırda aktivləşdirilməyib. Admin aylıq haqqınızı təyin etdikdən və Epoint qoşulduqdan sonra bu bölmədən ödəyə biləcəksiniz.</p>}
    {!data&&!error&&<p role="status">Abunəliklər yüklənir…</p>}
    {data?.subscriptions.length===0&&<section className="bill-panel"><h2>Aylıq abunəlik təyin edilməyib</h2><p>Mövcud lisenziyalarınız saxlanılır. Admin sizi aylıq ödəniş sisteminə ayrıca qoşacaq.</p></section>}
    <div className="bill-subscriptions">{data?.subscriptions.map(s=><section className="bill-panel" key={s.id}>
      <header><h2>{labels[s.product]??s.product}</h2><span className={'bill-status '+s.state}>{labels[s.state]??s.state}</span></header>
      <p className="bill-price">{money(s.monthlyAmountMinor)}<small>/ ay</small></p>
      <dl><div><dt>Ödənilmiş son tarix</dt><dd>{date(s.paidUntil)}</dd></div><div><dt>Avtomatik yenilənmə</dt><dd>{s.autoRenew?'Açıq':'Bağlı'}{s.cardMask?' · '+s.cardMask:''}</dd></div></dl>
      {s.autoRenew?<button type="button" onClick={()=>void stop(s)} disabled={Boolean(busy)}>Avtomatik yenilənməni dayandır</button>:data.recurringAvailable&&data.termsVersion&&<label className="bill-consent"><input type="checkbox" checked={Boolean(consents[s.id])} onChange={e=>setConsents(v=>({...v,[s.id]:e.target.checked}))}/> <span>{money(s.monthlyAmountMinor)} aylıq haqqın kartımdan avtomatik tutulmasına razıyam. İstənilən vaxt dayandıra bilərəm. <a href="/odenis/sertler" target="_blank" rel="noreferrer">Şərtlər</a></span></label>}
      {!s.autoRenew&&s.hasSavedCard&&data.recurringAvailable&&<button disabled={!consents[s.id]||Boolean(busy)} onClick={()=>void resume(s)}>Saxlanmış kartla avtomatik yenilənməni qoş</button>}
      <button type="button" className="bill-primary" disabled={!data.paymentsAvailable||s.state==='disabled'||Boolean(busy)} onClick={()=>void pay(s)}>{busy===s.id?'Ödəniş hazırlanır…':s.state==='active'?'Bir ay uzat':'Ödə və aktivləşdir'}</button>
    </section>)}</div>
    <section className="bill-panel"><header><h2>Ödəniş və sifariş tarixçəsi</h2><span>{orders.length} sənəd</span></header>
      {!orders.length?<p>Hələ ödəniş və ya sifariş yoxdur.</p>:<div className="bill-table-wrap"><table><thead><tr><th>Sənəd</th><th>Tarix</th><th>Növ</th><th>Məbləğ</th><th>Vəziyyət</th><th>Müddət</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td><a href={'/odenis/ugurlu?order='+o.id}>{o.order_no}</a></td><td>{date(o.created_at)}</td><td>{labels[o.kind]??o.kind}</td><td>{money(o.amount_minor)}</td><td><span className={'bill-status '+o.status}>{labels[o.status]??o.status}</span></td><td>{date(o.period_end)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
