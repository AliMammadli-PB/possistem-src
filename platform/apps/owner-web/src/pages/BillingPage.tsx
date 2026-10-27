import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingRequest } from '../api';

type Subscription={id:string;product:string;monthlyAmountMinor:number;paidUntil:string|null;state:string;priceVersion:number;autoRenew:boolean;cardMask:string|null;hasSavedCard:boolean;renewalNotice?:{body:string}|null;lastPaymentStatus?:string|null};
type Data={subscriptions:Subscription[];paymentsAvailable:boolean;recurringAvailable:boolean;termsVersion:string|null};
type Order={id:string;order_no:string;kind:string;amount_minor:number|string;status:string;created_at:string;paid_at:string|null;period_end:string|null};
const labels:Record<string,string>={market:'Market POS',restaurant:'Restoran POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS',active:'Aktiv',expired:'Müddət bitib',awaiting_payment:'İlk ödəniş gözlənilir',disabled:'Abunəlik bağlıdır',paid:'Ödənilib',paid_review:'Ödəniş araşdırılır',processing:'Bank cavabı gözlənilir',unknown:'Nəticə dəqiqləşdirilir',failed:'Ödəniş alınmadı',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarma gözlənilir',cancelled:'Ləğv edilib'};
export const billingMoney=(v:number|string)=>new Intl.NumberFormat('az-AZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)/100)+' ₼';
export const billingDate=(v:string|null)=>v?new Date(v).toLocaleString('az-AZ',{timeZone:'Asia/Baku',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';

export default function BillingPage(){
  const [data,setData]=useState<Data|null>(null),[orders,setOrders]=useState<Order[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[consents,setConsents]=useState<Record<string,boolean>>({});
  const keys=useRef<Record<string,string>>({});
  useEffect(()=>setConsents({}),[data?.termsVersion,JSON.stringify(data?.subscriptions.map(s=>[s.id,s.priceVersion,s.state]))]);
  const load=useCallback(async()=>{try{const [d,o]=await Promise.all([billingRequest<Data>(''),billingRequest<{orders:Order[]}>('/orders')]);setData(d);setOrders(o.orders.filter(row=>row.kind==='subscription'));setError('');}catch(e){setError(e instanceof Error?e.message:'Ödənişlər yüklənmədi.');}},[]);
  useEffect(()=>{void load();const refresh=()=>{if(document.visibilityState==='visible'&&!busy)void load();};const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[load,busy]);
  async function pay(s:Subscription){
    if(busy||!consents[s.id]||s.state==='active')return;setBusy(s.id);setError('');setMessage('');
    try{
      const key=s.id+':'+s.priceVersion,requestId=keys.current[key]??(keys.current[key]=crypto.randomUUID());
      const result=await billingRequest<{redirectUrl:string|null;paymentState:string}>('/subscriptions/'+s.id+'/checkout',{method:'POST',body:JSON.stringify({requestId,priceVersion:s.priceVersion,saveCard:true,paymentMode:'automatic',termsVersion:data?.termsVersion})});
      if(result.redirectUrl){window.location.assign(result.redirectUrl);return;}
      setMessage(result.paymentState==='unknown'?'Bank cavabı dəqiqləşdirilir. Təkrar ödəniş etməyin; nəticə burada yenilənəcək.':'Ödəniş vəziyyəti yeniləndi.');await load();
    }catch(e){setError(e instanceof Error?e.message:'Ödəniş başlamadı.');}finally{setBusy('');}
  }
  async function consent(s:Subscription,enabled:boolean){
    if(busy||enabled&&!consents[s.id])return;
    if(!enabled&&!window.confirm('Avtomatik yenilənmə dayandırılsın? Ödənilmiş müddətiniz qalacaq.'))return;
    setBusy(s.id);setError('');try{await billingRequest('/subscriptions/'+s.id+'/consent',{method:'POST',body:JSON.stringify({enabled,...(enabled?{priceVersion:s.priceVersion,termsVersion:data?.termsVersion}:{})})});setMessage(enabled?'Avtomatik yenilənmə qoşuldu. İndi əlavə ödəniş tutulmadı.':'Avtomatik yenilənmə dayandırıldı. Ödənilmiş müddətiniz saxlanılır.');await load();}catch(e){setError(e instanceof Error?e.message:'Dəyişiklik alınmadı.');}finally{setBusy('');}
  }
  const agreement=(s:Subscription)=><label className="bill-consent"><input type="checkbox" disabled={Boolean(busy)} checked={Boolean(consents[s.id])} onChange={e=>setConsents(v=>({...v,[s.id]:e.target.checked}))}/><span>Hər ay <strong>{billingMoney(s.monthlyAmountMinor)}</strong> avtomatik tutulmasına razıyam. Yenilənməni istənilən vaxt dayandıra bilərəm. <a href="/odenis/sertler/" target="_blank" rel="noreferrer">Ödəniş şərtləri</a></span></label>;
  return <div className="bill-page">
    <header className="bill-heading"><div><span className="bill-eyebrow">HESAB VƏ ÖDƏNİŞLƏR</span><h1>POS abunəlikləriniz</h1><p>Proqramlarınız, bağlı kartınız və aylıq ödənişlər bir yerdə.</p></div><button type="button" onClick={()=>void load()} disabled={Boolean(busy)}>↻ Yenilə</button></header>
    {error&&<p className="bill-alert error" role="alert">{error}<button type="button" onClick={()=>void load()}>Yenidən yoxla</button></p>}
    {message&&<p className="bill-alert" role="status">{message}</p>}
    {data&&!data.paymentsAvailable&&<p className="bill-alert">Kartla abunə xidməti hazırda əlçatan deyil. Mövcud istifadə müddətiniz aşağıda göstərilir.</p>}
    {!data&&!error&&<p role="status">Abunəliklər yüklənir…</p>}
    {data?.subscriptions.length===0&&<section className="bill-panel bill-empty"><h2>Aylıq POS abunəliyiniz yoxdur</h2><p>Abunəlik əlavə etmək üçün dəstək ilə əlaqə saxlayın.</p></section>}
    <div className="bill-subscriptions">{data?.subscriptions.map(s=><section className="bill-panel bill-subscription" key={s.id}>
      <header><div className="bill-product"><span className="bill-product-icon" aria-hidden="true">P</span><div><span className="bill-eyebrow">AYLIQ POS XİDMƏTİ</span><h2>{labels[s.product]??s.product}</h2></div></div><span className={'bill-status '+s.state}>{labels[s.state]??s.state}</span></header>
      <div className="bill-subscription-main"><div className="bill-price">{billingMoney(s.monthlyAmountMinor)}<small>/ ay</small><p>Avtomatik aylıq abunə</p></div><dl><div><dt>Ödənilmiş son tarix</dt><dd>{billingDate(s.paidUntil)}</dd></div><div><dt>Yenilənmə</dt><dd>{s.autoRenew?'Hər ay avtomatik':'Dayandırılıb'}</dd></div><div><dt>Ödəniş kartı</dt><dd>{s.cardMask|| (s.hasSavedCard?'Bankda saxlanılıb':'Kart bağlanmayıb')}</dd></div></dl></div>
      {s.renewalNotice&&<p className="bill-alert" role="status">{s.renewalNotice.body}</p>}
      {s.state==='active'?<div className="bill-paid-note" role="status"><span aria-hidden="true">✓</span><div><strong>Cari müddət ödənilib</strong><p>{s.autoRenew?'Növbəti ödəniş göstərilən müddətin sonunda aparılacaq. Yenilənmədən 3 gün əvvəl xəbər verəcəyik.':'Ödənilmiş müddətinizədək istifadə edə bilərsiniz. Yenidən ödəniş tələb olunmur.'}</p></div></div>:s.state!=='disabled'?<div className="bill-enroll"><p>{s.lastPaymentStatus==='failed'?'Son bank ödənişi alınmadı. Kartı bank səhifəsində yenidən yoxlayın.':'İlk ödənişlə bir aylıq istifadə açılır və kartınız növbəti aylar üçün bankda bağlanır.'}</p>{agreement(s)}{!data.recurringAvailable&&<p className="bill-alert">Avtomatik abunə xidməti hazırda əlçatan deyil.</p>}<button type="button" className="bill-primary" disabled={!data.paymentsAvailable||!data.recurringAvailable||!data.termsVersion||!consents[s.id]||Boolean(busy)} onClick={()=>void pay(s)}>{busy===s.id?'Ödəniş hazırlanır…':'Kartı bağla və abunə ol'}</button></div>:null}
      {!s.autoRenew&&s.hasSavedCard&&data.recurringAvailable&&<div className="bill-enroll">{agreement(s)}<button disabled={!consents[s.id]||Boolean(busy)} onClick={()=>void consent(s,true)}>Saxlanmış kartla yenilənməni qoş</button></div>}
      {s.autoRenew&&<footer className="bill-card-footer"><span>Kart məlumatları bankda qorunur</span><button type="button" className="bill-text-button" onClick={()=>void consent(s,false)} disabled={Boolean(busy)}>Yenilənməni dayandır</button></footer>}
    </section>)}</div>
    <section className="bill-panel"><header><div><h2>Ödəniş tarixçəsi</h2><p className="bill-muted">Hər əməliyyatın fakturasını açıb çap edə bilərsiniz.</p></div><span>{orders.length} əməliyyat</span></header>
      {!orders.length?<div className="bill-empty"><p>Abunə ödənişləriniz burada görünəcək.</p></div>:<div className="bill-table-wrap"><table><thead><tr><th>Faktura</th><th>Tarix · Bakı vaxtı</th><th>Məbləğ</th><th>Vəziyyət</th><th>İstifadə müddəti</th><th/></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td><Link className="bill-document-no" to={'/faturalar/'+o.id}>{o.order_no}</Link></td><td>{billingDate(o.paid_at||o.created_at)}</td><td><strong>{billingMoney(o.amount_minor)}</strong></td><td><span className={'bill-status '+o.status}>{labels[o.status]??o.status}</span></td><td>{billingDate(o.period_end)}</td><td><Link className="bill-document-link" to={'/faturalar/'+o.id}>Fakturanı aç →</Link></td></tr>)}</tbody></table></div>}
    </section>
    <div className="bill-shop-note"><div><strong>Mağazadan etdiyiniz alışlar</strong><p>Avadanlıq və digər məhsullar ayrıca, birdəfəlik ödənişlə alınır.</p></div><Link to="/sifarisler">Sifarişlərim →</Link></div>
  </div>;
}
