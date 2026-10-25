import { useCallback, useEffect, useRef, useState } from 'react';
import { billingRequest } from '../api';

type Subscription={id:string;product:string;monthlyAmountMinor:number;currency:string;paidUntil:string|null;state:string;priceVersion:number;autoRenew:boolean;cardMask:string|null;hasSavedCard:boolean;hasPaidSubscription?:boolean;renewalNotice?:{body:string}|null;lastPaymentStatus?:string|null};
type Data={subscriptions:Subscription[];paymentsAvailable:boolean;recurringAvailable:boolean;termsVersion:string|null};
type Order={payment_mode?:string|null;id:string;order_no:string;kind:string;amount_minor:number|string;status:string;created_at:string;period_end:string|null;fulfillment_status:string};
const labels:Record<string,string>={market:'Market POS',restaurant:'Restoran POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS',active:'Aktiv',expired:'Müddət bitib',awaiting_payment:'İlk ödəniş gözlənilir',disabled:'Abunəlik bağlıdır',paid:'Ödənilib',paid_review:'Ödəniş alınıb · araşdırılır',processing:'Bank cavabı gözlənilir',unknown:'Nəticə dəqiqləşdirilir',failed:'Ödəniş alınmadı',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarma gözlənilir',subscription:'Abunəlik',shop:'Məhsul sifarişi'};
const money=(v:number|string)=>new Intl.NumberFormat('az-AZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)/100)+' ₼';
const date=(v:string|null)=>v?new Date(v).toLocaleString('az-AZ'):'—';
export default function BillingPage(){
  const [data,setData]=useState<Data|null>(null),[orders,setOrders]=useState<Order[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[consents,setConsents]=useState<Record<string,boolean>>({});
  const keys=useRef<Record<string,string>>({});
  const [modes,setModes]=useState<Record<string,'manual'|'automatic'>>({});
  useEffect(()=>{setConsents({});},[data?.termsVersion,JSON.stringify(data?.subscriptions.map(s=>[s.id,s.priceVersion]))]);
  const load=useCallback(async()=>{try{const [d,o]=await Promise.all([billingRequest<Data>(''),billingRequest<{orders:Order[]}>('/orders')]);setData(d);setOrders(o.orders);setError('');}catch(e){setError(e instanceof Error?e.message:'Ödənişlər yüklənmədi.');}},[]);
  useEffect(()=>{void load();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!busy)void load();},15000);return()=>clearInterval(timer);},[load,busy]);
  async function pay(s:Subscription){
    if(busy||!consents[s.id])return;setBusy(s.id);setError('');setMessage('');
    try{
      const paymentMode=modes[s.id]??'automatic',saveCard=paymentMode==='automatic',key=s.id+':'+s.priceVersion+':'+paymentMode;
      const requestId=keys.current[key]??(keys.current[key]=crypto.randomUUID());
      const result=await billingRequest<{redirectUrl:string|null;paymentState:string}>('/subscriptions/'+s.id+'/checkout',{method:'POST',body:JSON.stringify({requestId,priceVersion:s.priceVersion,saveCard,paymentMode,termsVersion:data?.termsVersion})});
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
    <header className="bill-heading"><div><span className="bill-eyebrow">HESAB VƏ ÖDƏNİŞLƏR</span><h1>Abunəlik və kartınız</h1><p>Kartınızı bir dəfə bağlayın, hər ay avtomatik yenilənsin. Yenilənmədən 3 gün əvvəl bildiriş alacaqsınız.</p></div><button type="button" onClick={()=>void load()} disabled={Boolean(busy)}>Yenilə</button></header>
    {error&&<p className="bill-alert error" role="alert">{error}<button type="button" onClick={()=>void load()}>Yenidən yoxla</button></p>}
    {message&&<p className="bill-alert" role="status">{message}</p>}
    {data&&!data.paymentsAvailable&&<p className="bill-alert">Epoint API qoşulması gözlənilir. Aylıq kart ödənişi və bir aylıq link bankın private key-i aktivləşəndən sonra açılacaq. Bu müddətdə mövcud istifadə icazəniz saxlanılır.</p>}
    {!data&&!error&&<p role="status">Abunəliklər yüklənir…</p>}
    {data?.subscriptions.length===0&&<section className="bill-panel"><h2>Aylıq abunəlik təyin edilməyib</h2><p>Mövcud lisenziyalarınız saxlanılır. Admin sizi aylıq ödəniş sisteminə ayrıca qoşacaq.</p></section>}
    <div className="bill-subscriptions">{data?.subscriptions.map(s=><section className="bill-panel" key={s.id}>
      <header><div><span className="bill-eyebrow">AYLIQ ABUNƏ</span><h2>{labels[s.product]??s.product}</h2></div><span className={'bill-status '+s.state}>{labels[s.state]??s.state}</span></header>
      <p className="bill-price">{money(s.monthlyAmountMinor)}<small>/ ay</small></p>
      <dl><div><dt>İstifadə müddəti</dt><dd>{date(s.paidUntil)}</dd></div><div><dt>Avtomatik yenilənmə</dt><dd>{s.autoRenew?'Aktiv':'Kart bağlanmayıb'}{s.cardMask?' · '+s.cardMask:''}</dd></div></dl>
      {s.renewalNotice&&<p className="bill-alert" role="status">{s.renewalNotice.body}</p>}
      {s.state!=='active'&&<p className="bill-alert">{s.lastPaymentStatus==='failed'?'Son ödəniş alınmayıb.':'Ödənilmiş istifadə müddəti yoxdur və ya bitib.'} Ödənişdən sonra yeni satışlar açılacaq; baxış və ixrac əlçatandır.</p>}
      {s.autoRenew&&<button type="button" onClick={()=>void stop(s)} disabled={Boolean(busy)}>Avtomatik yenilənməni dayandır</button>}
      <fieldset className="bill-modes" disabled={Boolean(busy)}><legend>Yenilənmə üsulu</legend>{(['automatic','manual'] as const).map(mode=><label key={mode} className={(modes[s.id]??'automatic')===mode?'selected':''}><input type="radio" name={'billing-mode-'+s.id} checked={(modes[s.id]??'automatic')===mode} onChange={()=>{setModes(v=>({...v,[s.id]:mode}));setConsents(v=>({...v,[s.id]:false}));}}/><span><strong>{mode==='automatic'?'Aylıq avtomatik abunə':'Linklə bir aylıq ödəniş'}</strong><small>{mode==='automatic'?'Hər ay razılığınızla kartdan yenilənir.':'Növbəti ay özünüz yenidən ödəyirsiniz.'}</small></span></label>)}</fieldset>
      {(modes[s.id]??'automatic')==='manual'&&s.autoRenew&&<p>Bu üsulla ödənişi başladanda əvvəlki avtomatik yenilənmə dayandırılacaq. Ödənilmiş müddət qalır.</p>}
      <label className="bill-consent"><input type="checkbox" disabled={Boolean(busy)} checked={Boolean(consents[s.id])} onChange={e=>setConsents(v=>({...v,[s.id]:e.target.checked}))}/><span>{(modes[s.id]??'automatic')==='automatic'?`${money(s.monthlyAmountMinor)} hər ay avtomatik tutulmasına razıyam; istənilən vaxt dayandıra bilərəm.`:`Yalnız bir aylıq ${money(s.monthlyAmountMinor)} ödənişini təsdiqləyirəm; avtomatik yenilənmə olmayacaq.`} <a href="/odenis/sertler" target="_blank" rel="noreferrer">Ödəniş şərtləri</a></span></label>
      {(modes[s.id]??'automatic')==='automatic'&&!data.recurringAvailable&&<p className="bill-alert">Epoint avtomatik yenilənmə xidməti hələ aktiv deyil.</p>}
      {!s.autoRenew&&s.hasSavedCard&&data.recurringAvailable&&(modes[s.id]??'automatic')==='automatic'&&<button disabled={!consents[s.id]||Boolean(busy)} onClick={()=>void resume(s)}>Saxlanmış kartla avtomatik yenilənməni qoş</button>}
      <button type="button" className="bill-primary" disabled={!data.paymentsAvailable||!data.termsVersion||!consents[s.id]||s.state==='disabled'||Boolean(busy)||(modes[s.id]??'automatic')==='automatic'&&!data.recurringAvailable} onClick={()=>void pay(s)}>{busy===s.id?'Ödəniş hazırlanır…':(modes[s.id]??'automatic')==='automatic'?'Avtomatik abunəni başlat':'Bir aylıq ödəniş linkini aç'}</button>
      {!data.paymentsAvailable&&<details className="bill-explainer"><summary>Bir aylıq link niyə bağlıdır?</summary><p>Epoint imzalı API təsdiqi olmadan linkdən gələn ödənişi abunəliyinizlə təhlükəsiz əlaqələndirmək olmur. 1 ₼ sınaq linki ayrıca sınaq üçündür. Aktivləşəndə uğurlu bank təsdiqi bir təqvim ayı əlavə edəcək.</p></details>}
    </section>)}</div>
    <section className="bill-panel"><header><h2>Abunə ödənişləri</h2><span>{orders.filter(o=>o.kind==='subscription').length} ödəniş</span></header>
      {!orders.some(o=>o.kind==='subscription')?<p>Hələ abunə ödənişi yoxdur. Məhsul alışlarını “Sifarişlərim” bölməsindən izləyin.</p>:<div className="bill-table-wrap"><table><thead><tr><th>Sənəd</th><th>Tarix</th><th>Növ</th><th>Məbləğ</th><th>Vəziyyət</th><th>Müddət</th></tr></thead><tbody>{orders.filter(o=>o.kind==='subscription').map(o=><tr key={o.id}><td><a href={'/odenis/ugurlu?order='+o.id}>{o.order_no}</a></td><td>{date(o.created_at)}</td><td>{o.payment_mode==='manual'?'Bir aylıq əl ilə':o.payment_mode==='automatic'?'Avtomatik abunə':labels[o.kind]??o.kind}</td><td>{money(o.amount_minor)}</td><td><span className={'bill-status '+o.status}>{labels[o.status]??o.status}</span></td><td>{date(o.period_end)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
