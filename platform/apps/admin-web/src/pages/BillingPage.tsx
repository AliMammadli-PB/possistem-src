import {BillingAccessControls} from '../components/BillingAccessControls';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import '../billing.css';

type Subscription={id:string;customer_id:string;name:string;email:string;product:string;monthly_amount_minor:string;enabled:boolean;paid_until:string|null;auto_renew:boolean;card_mask?:string|null;cancelled_at?:string|null;cancel_effective_at?:string|null;pending_cancel?:number;access_mode?:string;trial_until?:string|null};
type Order={id:string;customer_name:string;order_no:string;kind:string;amount_minor:string;refunded_minor?:string;admin_charge?:boolean;status:string;created_at:string;fulfillment_status:string;recipient_name:string;recipient_phone:string;delivery_address:string;delivery_kind:string;estimated_at?:string|null;note?:string|null};
/** datetime-local works in the browser's zone; orders are planned in Baku time. */
const bakuInput=(iso?:string|null)=>iso?new Date(iso).toLocaleString('sv-SE',{timeZone:'Asia/Baku'}).replace(' ','T').slice(0,16):'';
const fromBakuInput=(v:string)=>v?new Date(v+':00+04:00').toISOString():null;

type Payment={id:string;order_no:string;customer_name:string;amount_minor:string;transaction_id:string|null;provider_order_id:string;status:string;kind:string;created_at:string;response:{message?:string;trace_id?:string}};
type Entry={id:string;action:string;actor_id:string;created_at:string;entity_id:string;detail:Record<string,unknown>};
type State={subscriptions:Subscription[];orders:Order[];payments:Payment[];events:Entry[]};
type Legal={version:string;sellerName:string;voen:string;address:string;phone:string;subscriptionTerms:string;refundTerms:string;deliveryTerms:string;privacyPolicy:string};
type Settings={enforcement_enabled:boolean;enabled:boolean;recurring_enabled:boolean;pickup_address:string;delivery_fee_minor:string|null;legal:Partial<Legal>};
type Customer={id:string;name:string;email:string};
const money=(v:string|number)=>new Intl.NumberFormat('az-AZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)/100)+' ₼';
const date=(v:string|null)=>v?new Date(v).toLocaleString('az-AZ'):'İlk ödəniş gözlənilir';
const productName:Record<string,string>={market:'Market POS',restaurant:'Restoran POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS'};
const statusName:Record<string,string>={awaiting_payment:'Ödəniş gözlənilir',processing:'Emal olunur',unknown:'Nəticə qeyri-müəyyəndir',paid:'Ödənilib',paid_review:'Admin həlli lazımdır',failed:'Uğursuz',expired:'Vaxtı bitib',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarma gözlənilir',sending:'Göndərilir',redirect:'Bank səhifəsi açılıb',pending:'Gözlənilir',succeeded:'Təsdiqlənib'};
// Draft texts so only the seller's legal details are left to fill; the admin reviews them before publishing.
const initialLegal:Legal={version:'2026-10-27',sellerName:'',voen:'',address:'',phone:'+994 51 333 35 55',
  subscriptionTerms:'Possistem proqram təminatı aylıq abunə ilə təqdim olunur. Aylıq haqq müştəri panelində göstərilir və hər ödənişdən əvvəl təsdiqlənir. Ödəniş Epoint (PAŞA Bank) vasitəsilə kartla qəbul edilir. Avtomatik yenilənməni seçdikdə kartınız bankın təhlükəsiz səhifəsində yadda saxlanılır və ödənilmiş müddət bitəndə eyni məbləğ hər ay avtomatik tutulur. Yenilənmədən 3 gün əvvəl bildiriş göndərilir. Avtomatik yenilənməni istənilən vaxt müştəri panelinin «Abunəlik» bölməsində dayandıra bilərsiniz; ödənilmiş müddət qüvvədə qalır. Ödəniş alınmadıqda sistem 1 və 2 gün sonra yenidən cəhd edir. Ödəniş olmadıqda yeni satışlar dayandırıla bilər, məlumatlara baxış və ixrac açıq qalır. Aylıq haqq dəyişdikdə avtomatik tutulma dayanır və yeni razılığınız istənilir.',
  refundTerms:'Abunə haqqı səhvən və ya iki dəfə tutulubsa, müraciət əsasında tam məbləğ eyni karta qaytarılır. İstifadə olunmuş abunə dövrü üçün qismən qaytarma edilmir. Alınmış avadanlıq istifadə olunmamış, zədəsiz və tam komplektdə olduqda təhvildən sonra 14 gün ərzində qaytarıla bilər; qüsurlu mal dəyişdirilir və ya pulu qaytarılır. Pul ödənişin edildiyi karta qaytarılır; banka görə hesaba düşməsi 1–10 iş günü çəkə bilər. Müraciət: support@possistem.az, +994 51 333 35 55.',
  deliveryTerms:'Sifariş ödəniş təsdiqləndikdən sonra hazırlanır. Təxmini hazır olma və ya çatdırılma vaxtı müştəri panelinin «Sifarişlərim» bölməsində göstərilir. Çatdırılma haqqı sifariş zamanı ayrıca göstərilir; özü götürmə pulsuzdur. Kuryer təhvildən əvvəl qeyd etdiyiniz nömrəyə zəng edir. Təhvil zamanı malı yoxlayın; zədə görsəniz kuryerin yanında qeyd edin və bizə bildirin.',
  privacyPolicy:'Şəxsi məlumatların emalı qaydaları https://possistem.az/mexfilik/ səhifəsindədir. Kart məlumatları yalnız bankın təhlükəsiz səhifəsində daxil edilir. Possistem kart nömrəsini saxlamır; yalnız maskalanmış nömrəni və avtomatik ödəniş üçün bankın verdiyi şifrələnmiş açarı saxlayır.'};

export function BillingPage(){
  const location=useLocation(),tab=location.pathname.split('/').at(-1)||'subscriptions';
  const [data,setData]=useState<State|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[q,setQ]=useState('');
  const [customers,setCustomers]=useState<Customer[]>([]),[customerSearch,setCustomerSearch]=useState(''),[customerId,setCustomerId]=useState(''),[product,setProduct]=useState('market'),[fee,setFee]=useState(''),[enabled,setEnabled]=useState(true),[startsAt,setStartsAt]=useState('');
  const [cancelSub,setCancelSub]=useState<{id:string;request?:CancelRequest}|null>(null),[chargeSub,setChargeSub]=useState<Subscription|null>(null),[refundId,setRefundId]=useState(''),[bankReference,setBankReference]=useState<Record<string,string>>({});
  const load=useCallback(async()=>{try{setData(await api<State>('/admin/billing'));setError('');}catch(e){setError(e instanceof Error?e.message:'Ödənişlər yüklənmədi.');}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{let alive=true;const timer=setTimeout(()=>{void api<{customers:Customer[]}>('/admin/billing/customers?q='+encodeURIComponent(customerSearch)).then(v=>{if(alive)setCustomers(v.customers);}).catch(()=>{});},250);return()=>{alive=false;clearTimeout(timer);};},[customerSearch]);
  const [tracking,setTracking]=useState<Record<string,{eta:string;note:string}>>({});
  const trackOf=(o:Order)=>tracking[o.id]??{eta:bakuInput(o.estimated_at),note:o.note??''};
  async function action(key:string,fn:()=>Promise<unknown>){if(busy)return;setBusy(key);setError('');setNotice('');try{await fn();setNotice('Əməliyyat saxlanıldı.');await load();}catch(e){setError(e instanceof Error?e.message:'Əməliyyat tamamlanmadı.');}finally{setBusy('');}}
  function submit(event:FormEvent){event.preventDefault();const raw=fee.replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(raw)||Number(raw)<=0){setError('Aylıq məbləği müsbət və ən çox iki onluq rəqəmlə yazın.');return;}void action('subscription',()=>api('/admin/billing/subscriptions',{method:'POST',body:JSON.stringify({customerId,product,monthlyAmountMinor:Math.round(Number(raw)*100),enabled,...(startsAt?{startsAt:new Date(startsAt).toISOString()}:{})})}));}
  const pendingCancels=data?.subscriptions.reduce((n,s)=>n+(s.pending_cancel??0),0)??0;
  const subscriptions=useMemo(()=>data?.subscriptions.filter(x=>(x.name+' '+x.email+' '+productName[x.product]).toLowerCase().includes(q.toLowerCase()))??[],[data,q]);
  const orders=useMemo(()=>data?.orders.filter(x=>(x.order_no+' '+x.customer_name+' '+x.status).toLowerCase().includes(q.toLowerCase()))??[],[data,q]);
  const payments=useMemo(()=>data?.payments.filter(x=>(x.order_no+' '+x.customer_name+' '+x.transaction_id+' '+x.provider_order_id).toLowerCase().includes(q.toLowerCase()))??[],[data,q]);
  return <div className="bill-page">
    <header className="bill-heading"><div><span className="bill-eyebrow">POSSİSTEM · ÖDƏNİŞ İDARƏSİ</span><h1>{tab==='orders'?'Sifarişlər':tab==='payments'?'Ödənişlər':tab==='settings'?'Ödəniş parametrləri':tab==='cancellations'?'Ləğv sorğuları':'Abunəliklər'}</h1><p>Müştərinin aylıq haqqını, bank əməliyyatlarını və məhsul sifarişlərini idarə edin.</p></div><button type="button" onClick={()=>void load()} disabled={Boolean(busy)}>Yenilə</button></header>
    <nav className="bill-tabs" aria-label="Ödəniş bölmələri">{[['subscriptions','Abunəliklər'],['cancellations','Ləğv sorğuları'+(pendingCancels?' ('+pendingCancels+')':'')],['payments','Ödənişlər'],['orders','Sifarişlər'],['settings','Parametrlər']].map(([key,label])=><NavLink key={key} to={'/billing/'+key}>{label}</NavLink>)}</nav>
    {error&&<p role="alert" className="bill-alert error">{error}</p>}{notice&&<p role="status" className="bill-alert">{notice}</p>}
    {refundId&&data&&<RefundPanel order={data.orders.find(o=>o.id===refundId)!} onClose={()=>setRefundId('')} onDone={async text=>{setRefundId('');setNotice(text);await load();}}/>}
    {chargeSub&&<ChargePanel sub={chargeSub} onClose={()=>setChargeSub(null)} onDone={async text=>{setChargeSub(null);setNotice(text);await load();}}/>}
    {cancelSub&&<CancelPanel subscriptionId={cancelSub.id} request={cancelSub.request} onClose={()=>setCancelSub(null)} onDone={async text=>{setCancelSub(null);setNotice(text);await load();}}/>}
    {tab==='settings'?<PaymentSettings onError={setError}/>:tab==='cancellations'?<Cancellations onOpen={(id,request)=>{setCancelSub({id,request});window.scrollTo({top:0,behavior:'smooth'});}} onError={setError} refreshKey={data}/>:<>
      {tab==='subscriptions'&&<section className="bill-panel"><header><h2>Müştərini aylıq sistemə qoş</h2></header><p>Hazırkı lisenziya müddəti saxlanılır. Məbləğ dəyişəndə avtomatik tutulma dayanır və yeni razılıq tələb olunur.</p><form className="bill-form" onSubmit={submit}>
        <label>Müştəri axtar<input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="Ad və ya e-poçt"/></label>
        <label>Müştəri<select value={customerId} onChange={e=>setCustomerId(e.target.value)} required><option value="">Müştəri seçin</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}</select></label>
        <label>Proqram<select value={product} onChange={e=>setProduct(e.target.value)}>{Object.entries(productName).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
        <label>Aylıq haqq · ₼<input inputMode="decimal" value={fee} onChange={e=>setFee(e.target.value)} placeholder="Admin məbləği təyin edir" required/></label>
        <label>İlk ödəniş tarixi · yalnız müddətsiz lisenziya üçün<input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label>
        <label>İdarəetmə<select value={String(enabled)} onChange={e=>setEnabled(e.target.value==='true')}><option value="true">Aylıq ödəniş aktivdir</option><option value="false">Aylıq ödənişi dayandır</option></select></label>
        <div className="full"><button className="bill-primary" disabled={Boolean(busy)||!customerId} type="submit">{busy==='subscription'?'Saxlanılır…':'Aylıq haqqı saxla'}</button></div>
      </form></section>}
      <label className="bill-search">Axtarış<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Müştəri, sənəd və ya bank nömrəsi…"/></label>
      {tab==='subscriptions'&&<section className="bill-panel"><div className="bill-table-wrap"><table><thead><tr><th>Müştəri</th><th>Proqram</th><th>Aylıq haqq</th><th>Ödənilmiş son tarix</th><th>Avtomatik</th><th/></tr></thead><tbody>{subscriptions.map(s=><tr key={s.id}><td><b>{s.name}</b><br/>{s.email}</td><td>{productName[s.product]}</td><td>{money(s.monthly_amount_minor)}</td><td>{date(s.paid_until)}{s.access_mode==='trial'&&<p>Sınaq: {date(s.trial_until??null)}</p>}{s.access_mode==='free'&&<p>Abunəsiz istifadə</p>}</td><td>{s.cancelled_at&&!s.auto_renew?<span className="bill-status refunded">Ləğv edilib · {date(s.cancel_effective_at??null)}</span>:s.enabled?(s.auto_renew?'Açıq'+(s.card_mask?' · '+s.card_mask:''):'Bağlı'):'Aylıq idarəetmə bağlıdır'}{Boolean(s.pending_cancel)&&<><br/><NavLink to="/billing/cancellations" className="bill-status failed">Ləğv sorğusu var</NavLink></>}</td><td className="bill-actions">{s.card_mask&&<button disabled={Boolean(busy)} onClick={()=>{setChargeSub(s);window.scrollTo({top:0,behavior:'smooth'});}}>Kartdan ödəniş al</button>}{!(s.cancelled_at&&!s.auto_renew)&&<button disabled={Boolean(busy)} onClick={()=>{setCancelSub({id:s.id});window.scrollTo({top:0,behavior:'smooth'});}}>Ləğv et</button>}<button onClick={()=>{setCustomerId(s.customer_id);setProduct(s.product);setFee(String(Number(s.monthly_amount_minor)/100));setEnabled(s.enabled);setCustomerSearch(s.email);window.scrollTo({top:0,behavior:'smooth'});}}>Düzəliş</button><details><summary>İstifadə icazəsi</summary><BillingAccessControls customerId={s.customer_id} product={s.product} onChanged={()=>void load()}/></details></td></tr>)}</tbody></table></div>{!subscriptions.length&&<p>Abunəlik tapılmadı. Mövcud müştərilər özbaşına bu sistemə keçirilməyib.</p>}</section>}
      {tab==='orders'&&<section className="bill-panel"><div className="bill-table-wrap"><table><thead><tr><th>Sənəd / müştəri</th><th>Tarix</th><th>Məbləğ</th><th>Ödəniş</th><th>Təhvil / əlaqə</th><th>Əməliyyat</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>{o.order_no}<br/><b>{o.customer_name}</b></td><td>{date(o.created_at)}</td><td>{money(o.amount_minor)}</td><td><span className={'bill-status '+o.status}>{o.status==='refunded'&&o.refunded_minor&&Number(o.refunded_minor)<Number(o.amount_minor)?'Qismən qaytarılıb · '+money(o.refunded_minor):statusName[o.status]??o.status}</span></td><td>{o.admin_charge?<>Kartdan tutulma<br/><small>{o.note}</small></>:o.kind==='shop'?<><select aria-label={o.order_no+' təhvil vəziyyəti'} value={o.fulfillment_status} disabled={o.status!=='paid'||Boolean(busy)} onChange={e=>void action(o.id,()=>api('/admin/billing/orders/'+o.id,{method:'PATCH',body:JSON.stringify({fulfillmentStatus:e.target.value})}))}><option value="waiting">Gözləyir</option><option value="preparing">Hazırlanır</option><option value="ready">Təhvilə hazırdır</option><option value="dispatched">Göndərilib</option><option value="completed">Təhvil verilib</option><option value="cancelled">Ləğv edilib</option></select><br/><b>{o.recipient_name}</b> · {o.recipient_phone}<br/>{o.delivery_kind==='delivery'?o.delivery_address:'Özü götürür'}
       {o.status==='paid'&&<form className="bill-tracking" onSubmit={e=>{e.preventDefault();const t=trackOf(o);void action(o.id,()=>api('/admin/billing/orders/'+o.id,{method:'PATCH',body:JSON.stringify({estimatedAt:fromBakuInput(t.eta),note:t.note})})).then(()=>setTracking(v=>{const n={...v};delete n[o.id];return n;}));}}>
        <label>{o.delivery_kind==='delivery'?'Təxmini çatdırılma':'Təxmini hazır olma'} · Bakı vaxtı<input type="datetime-local" value={trackOf(o).eta} onChange={e=>setTracking(v=>({...v,[o.id]:{...trackOf(o),eta:e.target.value}}))}/></label>
        <label>Müştəriyə görünən qeyd<textarea maxLength={2000} rows={2} value={trackOf(o).note} placeholder="Məs. sabah 14:00-dək kuryer zəng edəcək" onChange={e=>setTracking(v=>({...v,[o.id]:{...trackOf(o),note:e.target.value}}))}/></label>
        <button className="bill-primary" disabled={Boolean(busy)} type="submit">Müştəriyə göstər</button>
       </form>}</>:'Abunəlik'}</td><td>{['paid','paid_review'].includes(o.status)&&<button disabled={Boolean(busy)} onClick={()=>{setRefundId(o.id);window.scrollTo({top:0,behavior:'smooth'});}}>Geri qaytar</button>}</td></tr>)}</tbody></table></div>{!orders.length&&<p>Sifariş yoxdur.</p>}</section>}

      {tab==='payments'&&<Ledger q={q} refreshKey={data} onError={setError}/>}
      {tab==='payments'&&<section className="bill-panel"><header><h2>Bank əməliyyatları</h2></header><div className="bill-table-wrap"><table><thead><tr><th>Sənəd / müştəri</th><th>Məbləğ</th><th>Bank nömrəsi</th><th>Vəziyyət</th><th>Nəticə / trace</th><th/></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{p.order_no}<br/>{p.customer_name}<br/>{date(p.created_at)}</td><td>{money(p.amount_minor)}</td><td>{p.transaction_id??'Hələ alınmayıb'}<br/><small>{p.provider_order_id}</small></td><td><span className={'bill-status '+p.status}>{statusName[p.status]??p.status}</span></td><td>{p.response.message}<br/>{p.response.trace_id}</td><td>{['unknown','pending','redirect'].includes(p.status)&&<div className="bill-actions">{!p.transaction_id&&<input aria-label="Epoint əməliyyat nömrəsi" placeholder="Epoint əməliyyat nömrəsi" value={bankReference[p.id]??''} onChange={e=>setBankReference(v=>({...v,[p.id]:e.target.value}))}/>}<button disabled={Boolean(busy)} onClick={()=>void action(p.id,()=>api('/admin/billing/payments/'+p.id+'/reconcile',{method:'POST',body:JSON.stringify({...(bankReference[p.id]?{transactionId:bankReference[p.id]}:{})})}))}>Bankdan yoxla</button></div>}</td></tr>)}</tbody></table></div>{!payments.length&&<p>Bank əməliyyatı yoxdur.</p>}</section>}

    </>}
    {tab==='payments'&&data&&<section className="bill-panel"><header><h2>Əməliyyat tarixçəsi</h2></header><div className="bill-table-wrap"><table><thead><tr><th>Vaxt</th><th>Əməliyyat</th><th>Kim edib</th><th>Sənəd</th></tr></thead><tbody>{data.events.map(e=><tr key={e.id}><td>{date(e.created_at)}</td><td>{e.action}</td><td>{e.actor_id}</td><td>{e.entity_id}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

function PaymentSettings({onError}:{onError:(s:string)=>void}){
  const [loaded,setLoaded]=useState(false),[configured,setConfigured]=useState(false),[verified,setVerified]=useState(false),[live,setLive]=useState(false),[enforce,setEnforce]=useState(false),[recurring,setRecurring]=useState(false),[pickup,setPickup]=useState(''),[delivery,setDelivery]=useState(''),[legal,setLegal]=useState<Legal>(initialLegal),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[check,setCheck]=useState<{ok:boolean;message:string}|null>(null);
  useEffect(()=>{void api<{settings:Settings;configured:boolean;liveVerified:boolean}>('/admin/billing/settings').then(r=>{setConfigured(r.configured);setVerified(r.liveVerified);setLive(r.settings.enabled);setEnforce(r.settings.enforcement_enabled);setRecurring(r.settings.recurring_enabled);setPickup(r.settings.pickup_address);setDelivery(r.settings.delivery_fee_minor===null?'':String(Number(r.settings.delivery_fee_minor)/100));setLegal({...initialLegal,...r.settings.legal});setLoaded(true);}).catch(e=>onError(e.message));},[onError]);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);onError('');try{const d=delivery.trim().replace(',','.');if(d&&!/^\d+(\.\d{1,2})?$/.test(d))throw new Error('Çatdırılma haqqını düzgün yazın.');await api('/admin/billing/settings',{method:'PATCH',body:JSON.stringify({enabled:live,enforcementEnabled:enforce,recurringEnabled:recurring,pickupAddress:pickup,deliveryFeeMinor:d?Math.round(Number(d)*100):null,legal})});setSaved(true);}catch(e){onError(e instanceof Error?e.message:'Saxlanılmadı.');}finally{setBusy(false);}}
  async function checkKeys(){setCheck(null);try{setCheck(await api<{ok:boolean;message:string}>('/admin/billing/epoint/check',{method:'POST',body:'{}'}));}catch(e){setCheck({ok:false,message:e instanceof Error?e.message:'Yoxlama alınmadı.'});}}
  if(!loaded)return <p>Parametrlər yüklənir…</p>;
  return <section className="bill-panel"><header><h2>Epoint və satış parametrləri</h2></header><p className="bill-alert">API açarları: {configured?'serverdə qurulub':'qurulmayıb'} · Real bank yoxlaması: {verified?'təsdiqlənib':'tamamlanmayıb'}. Məxfi açarlar bu paneldə göstərilmir. <button type="button" onClick={()=>void checkKeys()}>Açarları yoxla</button></p>{check&&<p role="status" className={'bill-alert'+(check.ok?'':' error')}>{check.message}</p>}{!legal.sellerName||!legal.voen||!legal.address||!pickup?<p className="bill-alert">Onlayn ödənişi aktiv etmək üçün satıcının hüquqi adını, VÖEN-i, hüquqi ünvanı və özü götürmə ünvanını yazın. Şərt mətnləri nümunədir; dərc etməzdən əvvəl yoxlayın.</p>:null}<form className="bill-form" onSubmit={e=>void submit(e)}>
    <label>Onlayn ödəniş<select value={String(live)} onChange={e=>setLive(e.target.value==='true')}><option value="false">Bağlı</option><option value="true" disabled={!configured||!verified}>Aktiv</option></select></label>
    <label>Ödəniş məcburiyyəti<select value={String(enforce)} onChange={e=>setEnforce(e.target.value==='true')}><option value="false">Hazırlıq dövrü · istifadə davam edir</option><option value="true" disabled={!configured||!verified||!live}>Ödənilməyibsə yeni satışı bağla</option></select></label>
    <label>Avtomatik yenilənmə<select value={String(recurring)} onChange={e=>setRecurring(e.target.value==='true')}><option value="false">Bağlı</option><option value="true">Müştəri razılığı ilə aktiv</option></select></label>
    <label>Özü götürmə ünvanı<input value={pickup} onChange={e=>setPickup(e.target.value)} maxLength={1000}/></label><label>Çatdırılma haqqı · ₼<input inputMode="decimal" value={delivery} onChange={e=>setDelivery(e.target.value)} placeholder="Boş olduqda çatdırılma bağlıdır"/></label>
    {([['sellerName','Satıcının hüquqi adı'],['voen','VÖEN'],['address','Hüquqi ünvan'],['phone','Əlaqə telefonu'],['version','Şərtlərin versiyası']] as const).map(([key,label])=><label key={key}>{label}<input value={legal[key]} onChange={e=>setLegal(v=>({...v,[key]:e.target.value}))}/></label>)}
    {([['subscriptionTerms','Abunəlik və avtomatik tutulma şərtləri'],['refundTerms','Geri qaytarma şərtləri'],['deliveryTerms','Çatdırılma və təhvil şərtləri'],['privacyPolicy','Məxfilik siyasəti']] as const).map(([key,label])=><label className="full" key={key}>{label}<textarea value={legal[key]} onChange={e=>setLegal(v=>({...v,[key]:e.target.value}))}/></label>)}
    <div className="full bill-actions"><button className="bill-primary" disabled={busy}>Parametrləri saxla</button>{saved&&<p role="status">Saxlanıldı.</p>}</div>
  </form></section>;
}

type CancelRequest={id:string;subscription_id:string;source:string;reason:string;details:string;status:'pending'|'cancelled'|'rejected';cancel_mode:string|null;effective_at:string|null;decision_note:string;decided_by:string|null;decided_at:string|null;created_at:string;customer_name:string;email:string;product:string;paid_until:string|null;refunds:{orderNo:string;amountMinor:number;status:string}[]};
type PaidOrder={id:string;order_no:string;kind:string;amount_minor:string;refunded_minor?:string;admin_charge?:boolean;note?:string|null;status:string;paid_at:string;period_start:string|null;period_end:string|null;subscription_id:string|null};
type Context={subscription:{id:string;name:string;email:string;product:string;paid_until:string|null;auto_renew:boolean;card_mask:string|null;monthly_amount_minor:string};orders:PaidOrder[];pendingRequest:CancelRequest|null};
const requestState:Record<string,string>={pending:'Cavab gözləyir',cancelled:'Ləğv edildi',rejected:'İmtina edildi'};

/** Customer cancellation requests: open ones first, then the decided history. */
function Cancellations({onOpen,onError,refreshKey}:{onOpen:(subscriptionId:string,request:CancelRequest)=>void;onError:(s:string)=>void;refreshKey:unknown}){
  const [rows,setRows]=useState<CancelRequest[]|null>(null);
  useEffect(()=>{void api<{requests:CancelRequest[]}>('/admin/billing/cancel-requests').then(r=>setRows(r.requests)).catch(e=>onError(e instanceof Error?e.message:'Sorğular yüklənmədi.'));},[onError,refreshKey]);
  if(!rows)return <p role="status">Sorğular yüklənir…</p>;
  return <section className="bill-panel"><header><h2>Müştərilərin ləğv sorğuları</h2><span>{rows.filter(r=>r.status==='pending').length} cavab gözləyir</span></header>
    {!rows.length?<p>Hələ ləğv sorğusu yoxdur. Müştəri portalda “Abunəliyi ləğv et” düyməsi ilə səbəb yazıb sorğu göndərir.</p>:<div className="bill-table-wrap"><table><thead><tr><th>Müştəri</th><th>Proqram</th><th>Səbəb</th><th>Göndərilib</th><th>Vəziyyət / qərar</th><th/></tr></thead><tbody>{rows.map(r=><tr key={r.id}>
      <td><b>{r.customer_name}</b><br/>{r.email}</td><td>{productName[r.product]??r.product}<br/><small>Ödənilib: {date(r.paid_until)}</small></td>
      <td className="bill-wrap"><b>{r.reason}</b>{r.details&&<><br/>{r.details}</>}{r.source==='admin'&&<><br/><small>Admin özü ləğv edib</small></>}</td><td>{date(r.created_at)}</td>
      <td className="bill-wrap"><span className={'bill-status '+(r.status==='pending'?'failed':r.status==='cancelled'?'refunded':'paid')}>{requestState[r.status]}</span>{r.decided_at&&<><br/><small>{date(r.decided_at)}{r.cancel_mode&&' · '+(r.cancel_mode==='immediate'?'dərhal':'müddət sonunda: '+date(r.effective_at))}</small></>}{r.refunds.length>0&&<><br/><small>Qaytarıldı: {r.refunds.map(x=>money(x.amountMinor)+' '+x.orderNo).join(', ')}</small></>}{r.decision_note&&<><br/><small>Qeyd: {r.decision_note}</small></>}</td>
      <td>{r.status==='pending'&&<button className="bill-primary" onClick={()=>onOpen(r.subscription_id,r)}>Cavab ver</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}

/** Admin decision: cancel (when, which payments to refund, why money stays) or decline a request. */
function CancelPanel({subscriptionId,request,onClose,onDone}:{subscriptionId:string;request?:CancelRequest;onClose:()=>void;onDone:(text:string)=>void}){
  const [ctx,setCtx]=useState<Context|null>(null),[action,setAction]=useState<'cancel'|'reject'>('cancel'),[mode,setMode]=useState<'period_end'|'immediate'>('period_end'),[refunds,setRefunds]=useState<string[]>([]),[pct,setPct]=useState('100'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void api<Context>('/admin/billing/subscriptions/'+subscriptionId+'/cancel-context').then(setCtx).catch(e=>setError(e instanceof Error?e.message:'Məlumat yüklənmədi.'));},[subscriptionId]);
  const req=request??ctx?.pendingRequest??undefined;
  const percent=Math.min(100,Math.max(1,Math.round(Number(pct)||100)));
  const refundTotal=ctx?.orders.filter(o=>refunds.includes(o.id)).reduce((n,o)=>n+(percent===100?Number(o.amount_minor):Math.max(1,Math.round(Number(o.amount_minor)*percent/100))),0)??0;
  const noteRequired=action==='reject'||!refunds.length||percent<100;
  async function submit(e:FormEvent){
    e.preventDefault();if(busy)return;
    if(noteRequired&&note.trim().length<3){setError(action==='reject'?'Müştəriyə imtina səbəbini yazın.':refunds.length?'Məbləğin hamısı qaytarılmırsa, səbəbini müştəriyə yazın.':'Pul qaytarılmırsa, səbəbini müştəriyə yazın.');return;}
    const text=action==='reject'?'Ləğv sorğusu rədd edilsin?':'Abunəlik '+(mode==='immediate'?'DƏRHAL':'ödənilmiş müddətin sonunda')+' ləğv edilsin?'+(refunds.length?' Karta '+money(refundTotal)+' geri qaytarılacaq.':' Pul qaytarılmayacaq.');
    if(!window.confirm(text))return;
    setBusy(true);setError('');
    try{await api('/admin/billing/subscriptions/'+subscriptionId+'/cancel',{method:'POST',body:JSON.stringify({requestId:req?.id,action,mode:action==='cancel'?mode:undefined,refundOrderIds:action==='cancel'?refunds:[],refundPercent:percent,note})});onDone(action==='reject'?'Sorğu rədd edildi, müştəriyə bildiriş göndərildi.':'Abunəlik ləğv edildi'+(refunds.length?', '+money(refundTotal)+' geri qaytarıldı':'')+'. Müştəriyə bildiriş göndərildi.');}
    catch(err){setError(err instanceof Error?err.message:'Əməliyyat alınmadı.');}finally{setBusy(false);}
  }
  return <section className="bill-panel bill-cancel-panel"><header><h2>{req?'Ləğv sorğusuna cavab':'Abunəliyi ləğv et'}</h2><button type="button" onClick={onClose}>Bağla</button></header>
    {error&&<p role="alert" className="bill-alert error">{error}</p>}
    {!ctx?<p role="status">Yüklənir…</p>:<form className="bill-form" onSubmit={e=>void submit(e)}>
      <p className="full"><b>{ctx.subscription.name}</b> · {ctx.subscription.email} · {productName[ctx.subscription.product]??ctx.subscription.product} · {money(ctx.subscription.monthly_amount_minor)}/ay · ödənilib: {date(ctx.subscription.paid_until)} · avtomatik: {ctx.subscription.auto_renew?'açıq'+(ctx.subscription.card_mask?' ('+ctx.subscription.card_mask+')':''):'bağlı'}</p>
      {req&&<p className="full bill-alert"><b>Müştərinin səbəbi:</b> {req.reason}{req.details&&' — '+req.details} · {date(req.created_at)}</p>}
      {req&&<fieldset className="full bill-choice"><legend>Qərar</legend><label><input type="radio" checked={action==='cancel'} onChange={()=>setAction('cancel')}/> Ləğv et</label><label><input type="radio" checked={action==='reject'} onChange={()=>setAction('reject')}/> Ləğv etmə (sorğunu rədd et)</label></fieldset>}
      {action==='cancel'&&<>
        <fieldset className="full bill-choice"><legend>Nə vaxt bağlansın?</legend><label><input type="radio" checked={mode==='period_end'} onChange={()=>setMode('period_end')}/> Ödənilmiş müddətin sonunda ({date(ctx.subscription.paid_until)})</label><label><input type="radio" checked={mode==='immediate'} onChange={()=>setMode('immediate')}/> Dərhal — POS lisenziyası indi bağlanır</label></fieldset>
        <fieldset className="full bill-choice"><legend>Geri qaytarılacaq ödənişlər (karta tam məbləğ)</legend>{ctx.orders.length?ctx.orders.map(o=>{const can=['paid','paid_review'].includes(o.status);return <label key={o.id}><input type="checkbox" disabled={!can} checked={refunds.includes(o.id)} onChange={e=>setRefunds(v=>e.target.checked?[...v,o.id]:v.filter(x=>x!==o.id))}/> {money(o.amount_minor)} · {o.order_no} · {date(o.paid_at)} · {o.kind==='subscription'?'abunə'+(o.period_end?' ('+date(o.period_start)+' — '+date(o.period_end)+')':''):'birdəfəlik'}{o.admin_charge&&' · '+(o.note??'kartdan tutulma')}{!can&&' · '+(o.status==='refunded'&&o.refunded_minor&&Number(o.refunded_minor)<Number(o.amount_minor)?'qismən qaytarılıb '+money(o.refunded_minor):statusName[o.status]??o.status)}</label>;}):<p>Bu müştərinin ödənişi yoxdur.</p>}{refunds.length>0&&<><label>Qaytarma faizi · %<input type="number" min={1} max={100} value={pct} onChange={e=>setPct(e.target.value)}/></label><p><b>Cəmi qaytarılacaq: {money(refundTotal)}</b>{percent<100&&' (seçilən ödənişlərin '+percent+'%-i)'}</p></>}</fieldset>
      </>}
      <label className="full">{action==='reject'?'Müştəriyə imtina səbəbi (müştəri görəcək)':refunds.length&&percent<100?'Niyə tam qaytarılmır? (müştəri görəcək)':refunds.length?'Qeyd (istəyə görə, müştəri görəcək)':'Pul niyə qaytarılmır? (müştəri görəcək)'}<textarea maxLength={2000} rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder={action==='reject'?'Məs. müqavilə 12 aylıqdır, müddət bitməyib':refunds.length?'':'Məs. ödənilmiş ay istifadə olunub, ona görə məbləğ qaytarılmır'} required={noteRequired}/></label>
      <div className="full bill-actions"><button className="bill-primary" disabled={busy} type="submit">{busy?'İcra olunur…':action==='reject'?'Sorğunu rədd et':'Abunəliyi ləğv et'+(refunds.length?' və '+money(refundTotal)+' qaytar':'')}</button><button type="button" onClick={onClose}>İmtina</button></div>
    </form>}
  </section>;
}

type LedgerEntry={type:'payment'|'refund';order_id:string;order_no:string;kind:string;product:string|null;amount_minor:number;at:string;status:string;customer_name:string;email:string;transaction_id:string|null;card_mask:string|null;note:string|null};
/** Every amount that moved through Epoint: payments in, refunds out, with totals. */
function Ledger({q,refreshKey,onError}:{q:string;refreshKey:unknown;onError:(s:string)=>void}){
  const [data,setData]=useState<{entries:LedgerEntry[];totals:{paidMinor:number;refundedMinor:number;refundPendingMinor:number;netMinor:number}}|null>(null);
  useEffect(()=>{void api<NonNullable<typeof data>>('/admin/billing/ledger').then(setData).catch(e=>onError(e instanceof Error?e.message:'Tarixçə yüklənmədi.'));},[onError,refreshKey]);
  const rows=(data?.entries??[]).filter(e=>(e.order_no+' '+e.customer_name+' '+e.email+' '+(e.transaction_id??'')).toLowerCase().includes(q.toLowerCase()));
  return <section className="bill-panel"><header><h2>Bütün məbləğlər</h2><span>{rows.length} əməliyyat</span></header>
    {data&&<dl className="bill-ledger-totals"><div><dt>Ödənilib</dt><dd>{money(data.totals.paidMinor)}</dd></div><div><dt>Geri qaytarılıb</dt><dd>{money(data.totals.refundedMinor)}</dd></div>{data.totals.refundPendingMinor>0&&<div><dt>Qaytarılır</dt><dd>{money(data.totals.refundPendingMinor)}</dd></div>}<div><dt>Xalis gəlir</dt><dd>{money(data.totals.netMinor)}</dd></div></dl>}
    {!data?<p role="status">Yüklənir…</p>:<div className="bill-table-wrap"><table><thead><tr><th>Tarix</th><th>Müştəri</th><th>Əməliyyat</th><th>Sənəd / bank nömrəsi</th><th>Məbləğ</th><th>Vəziyyət</th></tr></thead><tbody>{rows.map(e=><tr key={e.type+e.order_id+e.at}><td>{date(e.at)}</td><td><b>{e.customer_name}</b><br/>{e.email}</td><td className="bill-wrap">{e.type==='refund'?'Geri qaytarma':e.kind==='subscription'?(productName[e.product??'']??'POS')+' · abunə':e.note?'Kartdan tutulma':'Birdəfəlik ödəniş'}{e.card_mask&&<><br/><small>{e.card_mask}</small></>}{e.note&&<><br/><small>{e.type==='refund'?'Səbəb: ':''}{e.note}</small></>}</td><td>{e.order_no}<br/><small>{e.transaction_id??''}</small></td><td className={e.amount_minor<0?'bill-amount-out':'bill-amount-in'}><b>{e.amount_minor<0?'−':'+'}{money(Math.abs(e.amount_minor))}</b></td><td><span className={'bill-status '+(e.type==='refund'?(e.status==='refunded'?'refunded':'unknown'):e.status)}>{e.type==='refund'?(e.status==='refunded'?'Karta qaytarılıb':'Qaytarılır'):statusName[e.status]??e.status}</span></td></tr>)}</tbody></table></div>}
  </section>;
}

/** Full or partial refund of one payment: whole amount, a percentage or a fixed sum. */
function RefundPanel({order,onClose,onDone}:{order:Order;onClose:()=>void;onDone:(text:string)=>void}){
  const total=Number(order.amount_minor),[kind,setKind]=useState<'full'|'percent'|'amount'>('full'),[value,setValue]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const raw=value.replace(',','.'),part=kind==='full'?total:kind==='percent'?Math.round(total*Math.min(100,Math.max(0,Number(raw)||0))/100):Math.round((Number(raw)||0)*100);
  const valid=part>=1&&part<=total&&(kind!=='amount'||/^\d+(\.\d{1,2})?$/.test(raw));
  async function submit(e:FormEvent){
    e.preventDefault();if(busy)return;
    if(!valid){setError('Qaytarma məbləği 0,01 ₼ ilə '+money(total)+' arasında olmalıdır.');return;}
    if(!window.confirm(order.customer_name+' — karta '+money(part)+' geri qaytarılsın?'+(part<total?' Müştəridə '+money(total-part)+' qalacaq.':'')))return;
    setBusy(true);setError('');
    try{const r=await api<{ok:boolean;error?:string}>('/admin/billing/orders/'+order.id+'/refund',{method:'POST',body:JSON.stringify({reason,...(part<total?{amountMinor:part}:{})})});if(!r.ok)throw new Error(r.error);onDone(money(part)+' geri qaytarılır: '+order.order_no+'.');}
    catch(err){setError(err instanceof Error?err.message:'Geri qaytarma alınmadı.');}finally{setBusy(false);}
  }
  return <section className="bill-panel bill-cancel-panel"><header><h2>Geri qaytarma · {order.order_no}</h2><button type="button" onClick={onClose}>Bağla</button></header>
    {error&&<p role="alert" className="bill-alert error">{error}</p>}
    <form className="bill-form" onSubmit={e=>void submit(e)}>
      <p className="full"><b>{order.customer_name}</b> · ödənilib: <b>{money(total)}</b>. Vəsait orijinal Epoint əməliyyatı ilə eyni karta qaytarılır. Bir ödəniş yalnız bir dəfə qaytarılır.</p>
      <fieldset className="full bill-choice"><legend>Nə qədər qaytarılsın?</legend>
        <label><input type="radio" checked={kind==='full'} onChange={()=>setKind('full')}/> Tam məbləğ ({money(total)})</label>
        <label><input type="radio" checked={kind==='percent'} onChange={()=>{setKind('percent');setValue('40');}}/> Faizlə</label>
        <label><input type="radio" checked={kind==='amount'} onChange={()=>{setKind('amount');setValue('');}}/> Məbləğlə</label>
      </fieldset>
      {kind!=='full'&&<label>{kind==='percent'?'Qaytarılacaq faiz · %':'Qaytarılacaq məbləğ · ₼'}<input inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} autoFocus/></label>}
      <p className="full"><b>Qaytarılacaq: {valid?money(part):'—'}</b>{valid&&part<total&&' · müştəridə qalan (tutulan): '+money(total-part)}</p>
      <label className="full">{part<total?'Səbəb — niyə tam qaytarılmır (müştəri görəcək)':'Səbəb'}<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={3} maxLength={1000} required/></label>
      <div className="full bill-actions"><button className="bill-primary" disabled={busy||!valid||reason.trim().length<3}>{busy?'Göndərilir…':'Banka '+(valid?money(part):'')+' geri qaytarma göndər'}</button><button type="button" onClick={onClose}>İmtina</button></div>
    </form></section>;
}

/** One-off charge from the customer's saved card; requires the admin to confirm the cardholder agreed. */
function ChargePanel({sub,onClose,onDone}:{sub:Subscription;onClose:()=>void;onDone:(text:string)=>void}){
  const [value,setValue]=useState(''),[description,setDescription]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const requestId=useMemo(()=>crypto.randomUUID(),[]),raw=value.replace(',','.'),valid=/^\d+(\.\d{1,2})?$/.test(raw)&&Number(raw)>0,minor=Math.round(Number(raw)*100);
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||!valid||!consent)return;
    if(!window.confirm(sub.name+' — kart '+sub.card_mask+' kartından '+money(minor)+' tutulsun?'))return;
    setBusy(true);setError('');
    try{const r=await api<{status:string;orderNo:string;bankMessage:string|null}>('/admin/billing/subscriptions/'+sub.id+'/charge',{method:'POST',body:JSON.stringify({requestId,amountMinor:minor,description,consent:true})});
      if(r.status==='paid')onDone(money(minor)+' kartdan tutuldu ('+r.orderNo+'). Müştəriyə bildiriş göndərildi.');
      else if(r.status==='failed')setError('Bank ödənişi qəbul etmədi'+(r.bankMessage?': '+r.bankMessage:'.'));
      else onDone('Bank cavabı dəqiqləşdirilir ('+r.orderNo+'). Təkrar tutmayın; nəticə Ödənişlər bölməsində yenilənəcək.');}
    catch(err){setError(err instanceof Error?err.message:'Ödəniş alınmadı.');}finally{setBusy(false);}
  }
  return <section className="bill-panel bill-cancel-panel"><header><h2>Saxlanmış kartdan ödəniş al</h2><button type="button" onClick={onClose}>Bağla</button></header>
    {error&&<p role="alert" className="bill-alert error">{error}</p>}
    <form className="bill-form" onSubmit={e=>void submit(e)}>
      <p className="full"><b>{sub.name}</b> · {sub.email} · kart <b>{sub.card_mask}</b>. Məbləğ müştəridən kart məlumatı soruşulmadan dərhal tutulur və ayrıca sənəd kimi bütün tarixçələrdə görünür.</p>
      <label>Məbləğ · ₼<input inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} placeholder="Məs. 50" required autoFocus/></label>
      <label>Təyinat (müştəri görəcək)<input value={description} onChange={e=>setDescription(e.target.value)} maxLength={300} minLength={3} placeholder="Məs. Quraşdırma xidməti" required/></label>
      <label className="full bill-consent-row"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Kart sahibi bu məbləğin kartından tutulmasına razılıq verib.</label>
      <div className="full bill-actions"><button className="bill-primary" disabled={busy||!valid||!consent||description.trim().length<3}>{busy?'Bank cavabı gözlənilir…':'Kartdan '+(valid?money(minor):'')+' tut'}</button><button type="button" onClick={onClose}>İmtina</button></div>
    </form></section>;
}
