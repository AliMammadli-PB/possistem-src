import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingRequest } from '../api';

type Subscription={id:string;product:string;monthlyAmountMinor:number;paidUntil:string|null;state:string;priceVersion:number;autoRenew:boolean;hasAccess?:boolean;accessStatus?:string;accessMode?:string;accessUntil?:string|null;trialUntil?:string|null;cardMask:string|null;hasSavedCard:boolean;renewalNotice?:{body:string}|null;lastPaymentStatus?:string|null};
type Data={subscriptions:Subscription[];paymentsAvailable:boolean;recurringAvailable:boolean;termsVersion:string|null};
type Entry={type:'payment'|'refund';order_id:string;order_no:string;kind:string;product:string|null;amount_minor:number;at:string;status:string;card_mask:string|null;note:string|null;refunded_minor:number};
type Ledger={entries:Entry[];totals:{paidMinor:number;refundedMinor:number;refundPendingMinor:number;netMinor:number}};
type CancelRequest={id:string;subscription_id:string;source:string;reason:string;details:string;status:'pending'|'cancelled'|'rejected';cancel_mode:string|null;effective_at:string|null;decision_note:string;decided_at:string|null;created_at:string;refunds:{orderNo:string;amountMinor:number;paidMinor:number;status:string}[]};
const reasons=['Qiymət mənə baha gəlir','Proqramdan istifadə etmirəm','Başqa proqrama keçirəm','Texniki problem var','Biznesimi bağlayıram','Digər'];
const labels:Record<string,string>={market:'Market POS',restaurant:'Restoran POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS',active:'Aktiv',expired:'Müddət bitib',awaiting_payment:'İlk ödəniş gözlənilir',disabled:'Abunəlik bağlıdır',paid:'Ödənilib',paid_review:'Ödəniş araşdırılır',processing:'Bank cavabı gözlənilir',unknown:'Nəticə dəqiqləşdirilir',failed:'Ödəniş alınmadı',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarma gözlənilir',cancelled:'Ləğv edilib'};
export const billingMoney=(v:number|string)=>new Intl.NumberFormat('az-AZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)/100)+' ₼';
export const billingDate=(v:string|null)=>v?new Date(v).toLocaleString('az-AZ',{timeZone:'Asia/Baku',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';

export default function BillingPage(){
  const [data,setData]=useState<Data|null>(null),[ledger,setLedger]=useState<Ledger|null>(null),[requests,setRequests]=useState<CancelRequest[]>([]),[cancelOpen,setCancelOpen]=useState(''),[reason,setReason]=useState(''),[details,setDetails]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[consents,setConsents]=useState<Record<string,boolean>>({});
  const keys=useRef<Record<string,string>>({});
  useEffect(()=>setConsents({}),[data?.termsVersion,JSON.stringify(data?.subscriptions.map(s=>[s.id,s.priceVersion,s.state]))]);
  const load=useCallback(async()=>{try{const [d,l,r]=await Promise.all([billingRequest<Data>(''),billingRequest<Ledger>('/ledger'),billingRequest<{requests:CancelRequest[]}>('/cancel-requests')]);setData(d);setLedger(l);setRequests(r.requests);setError('');}catch(e){setError(e instanceof Error?e.message:'Ödənişlər yüklənmədi.');}},[]);
  useEffect(()=>{void load();const refresh=()=>{if(document.visibilityState==='visible'&&!busy)void load();};const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[load,busy]);
  async function pay(s:Subscription){
    if(busy||!consents[s.id]||(s.state==='active'||s.hasAccess))return;setBusy(s.id);setError('');setMessage('');
    try{
      const key=s.id+':'+s.priceVersion,requestId=keys.current[key]??(keys.current[key]=crypto.randomUUID());
      const result=await billingRequest<{redirectUrl:string|null;paymentState:string}>('/subscriptions/'+s.id+'/checkout',{method:'POST',body:JSON.stringify({requestId,priceVersion:s.priceVersion,saveCard:true,paymentMode:'automatic',termsVersion:data?.termsVersion})});
      if(result.redirectUrl){window.location.assign(result.redirectUrl);return;}
      setMessage(result.paymentState==='unknown'?'Bank cavabı dəqiqləşdirilir. Təkrar ödəniş etməyin; nəticə burada yenilənəcək.':'Ödəniş vəziyyəti yeniləndi.');await load();
    }catch(e){setError(e instanceof Error?e.message:'Ödəniş başlamadı.');}finally{setBusy('');}
  }
  async function resume(s:Subscription){
    if(busy||!consents[s.id])return;
    setBusy(s.id);setError('');try{await billingRequest('/subscriptions/'+s.id+'/consent',{method:'POST',body:JSON.stringify({enabled:true,priceVersion:s.priceVersion,termsVersion:data?.termsVersion})});setMessage('Avtomatik yenilənmə qoşuldu. İndi əlavə ödəniş tutulmadı.');await load();}catch(e){setError(e instanceof Error?e.message:'Dəyişiklik alınmadı.');}finally{setBusy('');}
  }
  // Customers ask; the admin cancels or declines and decides about refunds.
  async function sendCancel(s:Subscription){
    if(busy||!reason)return;setBusy(s.id);setError('');
    try{await billingRequest('/subscriptions/'+s.id+'/cancel-request',{method:'POST',body:JSON.stringify({reason,details})});setCancelOpen('');setReason('');setDetails('');setMessage('Ləğv sorğunuz göndərildi. Cavabı burada və bildirişlərdə görəcəksiniz.');await load();}catch(e){setError(e instanceof Error?e.message:'Sorğu göndərilmədi.');}finally{setBusy('');}
  }
  const lastRequest=(s:Subscription)=>requests.find(r=>r.subscription_id===s.id);
  const decision=(r:CancelRequest)=>r.status==='pending'?<p className="bill-alert" role="status"><strong>Ləğv sorğunuz baxılır.</strong> Göndərildi: {billingDate(r.created_at)} · Səbəb: {r.reason}{r.details?' — '+r.details:''}. Cavab verilənədək abunəlik əvvəlki qaydada davam edir.</p>
    :r.status==='rejected'?<p className="bill-alert" role="status"><strong>Ləğv sorğunuz qəbul edilmədi</strong> ({billingDate(r.decided_at)}). {r.decision_note}</p>
    :<p className="bill-alert" role="status"><strong>Abunəlik ləğv edilib</strong> ({billingDate(r.decided_at)}). {r.cancel_mode==='immediate'?'Dərhal dayandırıldı.':'İstifadə '+billingDate(r.effective_at)+' tarixinədək davam edir, sonra yenilənmir.'} Kartınızdan artıq avtomatik ödəniş tutulmayacaq. {r.refunds.length?'Geri qaytarılır: '+r.refunds.map(x=>billingMoney(x.amountMinor)+(Number(x.amountMinor)<Number(x.paidMinor)?' ('+billingMoney(x.paidMinor)+' ödənişdən)':'')+' — '+x.orderNo).join(', ')+'.':'Ödənilmiş məbləğ geri qaytarılmır.'}{r.decision_note?' Səbəb / qeyd: '+r.decision_note:''}</p>;
  const agreement=(s:Subscription)=><label className="bill-consent"><input type="checkbox" disabled={Boolean(busy)} checked={Boolean(consents[s.id])} onChange={e=>setConsents(v=>({...v,[s.id]:e.target.checked}))}/><span>Hər ay <strong>{billingMoney(s.monthlyAmountMinor)}</strong> avtomatik tutulmasına razıyam. Ləğv etmək üçün istənilən vaxt səbəbini yazıb sorğu göndərə bilərəm. <a href="/odenis/sertler/" target="_blank" rel="noreferrer">Ödəniş şərtləri</a></span></label>;
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
      {s.accessStatus==='free'?<p className="bill-alert">Bu POS üçün abunə məcburiyyəti götürülüb. Ödəniş tələb olunmur.</p>:s.accessStatus==='trial'?<p className="bill-alert">Pulsuz istifadə müddəti: {billingDate(s.accessUntil??null)}. Bu tarixədək istifadə edə bilərsiniz.</p>:s.state==='active'?<div className="bill-paid-note" role="status"><span aria-hidden="true">✓</span><div><strong>Cari müddət ödənilib</strong><p>{s.autoRenew?'Növbəti ödəniş göstərilən müddətin sonunda aparılacaq. Yenilənmədən 3 gün əvvəl xəbər verəcəyik.':'Ödənilmiş müddətinizədək istifadə edə bilərsiniz. Yenidən ödəniş tələb olunmur.'}</p></div></div>:s.state!=='disabled'?<div className="bill-enroll"><p>{s.lastPaymentStatus==='failed'?'Son bank ödənişi alınmadı. Kartı bank səhifəsində yenidən yoxlayın.':'İlk ödənişlə bir aylıq istifadə açılır və kartınız növbəti aylar üçün bankda bağlanır.'}</p>{agreement(s)}{!data.recurringAvailable&&<p className="bill-alert">Avtomatik abunə xidməti hazırda əlçatan deyil.</p>}<button type="button" className="bill-primary" disabled={!data.paymentsAvailable||!data.recurringAvailable||!data.termsVersion||!consents[s.id]||Boolean(busy)} onClick={()=>void pay(s)}>{busy===s.id?'Ödəniş hazırlanır…':'Kartı bağla və abunə ol'}</button></div>:null}
      {s.accessMode!=='free'&&s.accessMode!=='trial'&&!s.autoRenew&&s.hasSavedCard&&data.recurringAvailable&&<div className="bill-enroll">{agreement(s)}<button disabled={!consents[s.id]||Boolean(busy)} onClick={()=>void resume(s)}>Saxlanmış kartla yenilənməni qoş</button></div>}
      {lastRequest(s)&&<div className="bill-enroll">{decision(lastRequest(s)!)}</div>}
      {cancelOpen===s.id&&<form className="bill-enroll bill-cancel-form" onSubmit={e=>{e.preventDefault();void sendCancel(s);}}>
        <h3>Abunəliyi ləğv etmək istəyirəm</h3>
        <p className="bill-muted">Sorğunuza əməkdaşımız baxacaq. Ləğv vaxtı və ödənişin qaytarılması barədə qərar burada və bildirişlərdə göstəriləcək. Cavab verilənədək abunəlik davam edir.</p>
        <label>Səbəb<select required value={reason} onChange={e=>setReason(e.target.value)}><option value="">Səbəbi seçin</option>{reasons.map(r=><option key={r}>{r}</option>)}</select></label>
        <label>Ətraflı (istəyə görə)<textarea maxLength={2000} rows={3} value={details} onChange={e=>setDetails(e.target.value)} placeholder="Məs. hansı problem var, nə vaxtdan bağlamaq istəyirsiniz"/></label>
        <div className="bill-actions"><button type="submit" className="bill-primary" disabled={!reason||Boolean(busy)}>{busy===s.id?'Göndərilir…':'Ləğv sorğusu göndər'}</button><button type="button" onClick={()=>setCancelOpen('')}>Bağla</button></div>
      </form>}
      {s.autoRenew&&lastRequest(s)?.status!=='pending'&&cancelOpen!==s.id&&<footer className="bill-card-footer"><span>Kart məlumatları bankda qorunur</span><button type="button" className="bill-text-button" onClick={()=>{setCancelOpen(s.id);setReason('');setDetails('');}} disabled={Boolean(busy)}>Abunəliyi ləğv et</button></footer>}

    </section>)}</div>
    <section className="bill-panel"><header><div><h2>Ödəniş tarixçəsi</h2><p className="bill-muted">Kartınızdan tutulan bütün məbləğlər və geri qaytarmalar. Hər əməliyyatın fakturasını açıb çap edə bilərsiniz.</p></div><span>{ledger?.entries.length??0} əməliyyat</span></header>
      {ledger&&ledger.entries.length>0&&<dl className="bill-ledger-totals"><div><dt>Ödənilib</dt><dd>{billingMoney(ledger.totals.paidMinor)}</dd></div><div><dt>Geri qaytarılıb</dt><dd>{billingMoney(ledger.totals.refundedMinor)}</dd></div>{ledger.totals.refundPendingMinor>0&&<div><dt>Qaytarılır</dt><dd>{billingMoney(ledger.totals.refundPendingMinor)}</dd></div>}<div><dt>Yekun</dt><dd>{billingMoney(ledger.totals.netMinor)}</dd></div></dl>}
      {!ledger?.entries.length?<div className="bill-empty"><p>Ödənişləriniz burada görünəcək.</p></div>:<div className="bill-table-wrap"><table><thead><tr><th>Tarix · Bakı vaxtı</th><th>Əməliyyat</th><th>Sənəd</th><th>Məbləğ</th><th>Vəziyyət</th><th/></tr></thead><tbody>{ledger.entries.map(e=><tr key={e.type+e.order_id+e.at}><td>{billingDate(e.at)}</td><td>{e.type==='refund'?'Geri qaytarma':e.kind==='subscription'?(labels[e.product??'']??'POS')+' · aylıq abunə':e.note?'Kartdan ödəniş · '+e.note:'Birdəfəlik ödəniş'}{e.card_mask&&<small className="bill-muted"> · {e.card_mask}</small>}</td><td><Link className="bill-document-no" to={'/faturalar/'+e.order_id}>{e.order_no}</Link></td><td className={e.amount_minor<0?'bill-amount-out':'bill-amount-in'}><strong>{e.amount_minor<0?'−':''}{billingMoney(Math.abs(e.amount_minor))}</strong></td><td><span className={'bill-status '+(e.type==='refund'?(e.status==='refunded'?'refunded':'refund_pending'):e.status)}>{e.type==='refund'?(e.status==='refunded'?'Kartınıza qaytarılıb':'Qaytarılır'):e.status==='refunded'&&e.refunded_minor>0&&e.refunded_minor<e.amount_minor?'Qismən qaytarılıb':labels[e.status]??e.status}</span></td><td><Link className="bill-document-link" to={'/faturalar/'+e.order_id}>Fakturanı aç →</Link></td></tr>)}</tbody></table></div>}
    </section>
    <div className="bill-shop-note"><div><strong>Mağazadan etdiyiniz alışlar</strong><p>Avadanlıq və digər məhsullar ayrıca, birdəfəlik ödənişlə alınır.</p></div><Link to="/sifarisler">Sifarişlərim →</Link></div>
  </div>;
}
