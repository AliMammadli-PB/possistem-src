'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {MarketingLayout} from '@/components/marketing/MarketingLayout';
import {useCustomerSession} from '@/components/providers/CustomerSessionProvider';
import {useCart} from '@/components/providers/CartProvider';
import {usePartner} from '@/components/providers/PartnerProvider';
import './payment.css';

type Legal=Record<string,string>;
type Options={pickupAddress:string;deliveryAvailable:boolean;deliveryFeeMinor:number|null;legal:Legal;paymentsAvailable:boolean};
type Quote={quoteId:string;totalMinor:number;deliveryFeeMinor:number;termsVersion:string;expiresAt:string;items:{id:string;name:string;qty:number;unitPriceMinor:number}[]};
type Sub={id:string;product:string;monthlyAmountMinor:number;paidUntil:string|null;state:string;priceVersion:number;autoRenew:boolean;lastPaymentStatus?:string|null};
type Site={subscriptions:Sub[];paymentsAvailable:boolean;recurringAvailable:boolean;termsVersion:string|null;csrfToken:string};
type Order={id:string;order_no:string;kind:string;status:string;amount_minor:number;period_end:string|null;fulfillment_status:string;delivery_kind:string;delivery_address:string;recipient_name:string;recipient_phone:string};
type Detail={order:Order;items?:{name:string;qty:number;unit_price_minor:number}[]};
const money=(n:number)=>new Intl.NumberFormat('az-AZ',{style:'currency',currency:'AZN'}).format(n/100);
const date=(s:string|null)=>s?new Date(s).toLocaleString('az-AZ'):'—';
const labels:Record<string,string>={paid:'Ödəniş təsdiqləndi',paid_review:'Ödəniş alınıb · admin yoxlayır',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarma gözlənilir',failed:'Ödəniş alınmadı',expired:'Rezerv müddəti bitib',processing:'Bank təsdiqi gözlənilir',unknown:'Ödəniş nəticəsi dəqiqləşdirilir',awaiting_payment:'Ödəniş gözlənilir',preparing:'Hazırlanır',ready:'Təhvil üçün hazırdır',dispatched:'Çatdırılır',completed:'Təhvil verilib',cancelled:'Təhvil dayandırılıb'};
async function api<T>(path:string,body?:unknown,csrf?:string|null):Promise<T>{
 const res=await fetch('/pos/api/'+path,{method:body?'POST':'GET',credentials:'include',cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','x-csrf-token':csrf??''}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json().catch(()=>null);if(!res.ok)throw new Error(data?.error||'Sorğu tamamlanmadı. Yenidən yoxlayın.');return data as T;
}
function TermsLink({version}:{version?:string|null}){return <Link href={'/odenis/sertler/'+(version?'?version='+encodeURIComponent(version):'')} target="_blank">Ödəniş və abunə şərtləri</Link>;}
function SignIn(){return <section className="pay-panel"><h2>Hesabınıza daxil olun</h2><p>Alış və sifariş tarixçəsi mövcud müştəri hesabınızla əlaqələndiriləcək.</p><a className="pay-primary" href="/pos/app/login?next=%2Fodenis%2F">Hesabıma daxil ol</a><p>Girişdən sonra bu səhifəyə qayıdın. Səbətiniz saxlanılır.</p></section>;}

type PaymentMode='manual'|'automatic';
function SubscriptionChoice({sub,site,busy,onPay}:{sub:Sub;site:Site;busy:boolean;onPay:(mode:PaymentMode)=>void}){
 const [mode,setMode]=useState<PaymentMode>(()=>typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('mode')==='automatic'?'automatic':'manual'),[agreed,setAgreed]=useState(false);
 useEffect(()=>{setAgreed(false);},[sub.priceVersion,site.termsVersion]);
 return <section className="pay-panel pay-sub"><h2>{sub.product==='market'?'Market POS':'Restoran POS'}</h2><p className="pay-amount">{money(sub.monthlyAmountMinor)} <small>/ təqvim ayı</small></p><p>{sub.state==='active'?'Abunəliyiniz aktivdir.':sub.state==='expired'?'Abunəliyin müddəti bitib. Yeni satışlar üçün ödəniş edin.':'Aktiv ödənilmiş abunəliyiniz yoxdur. Ödəniş üsulunu seçin.'}</p><p>Ödənilmiş son tarix: <strong>{date(sub.paidUntil)}</strong></p>
 <fieldset className="pay-modes" disabled={busy}><legend>Ödəniş üsulu</legend>{(['automatic','manual'] as const).map(value=><label className={mode===value?'selected':''} key={value}><input type="radio" name={'payment-mode-'+sub.id} value={value} checked={mode===value} onChange={()=>{setMode(value);setAgreed(false);}}/><span><strong>{value==='automatic'?'Aylıq avtomatik abunə':'Linklə bir aylıq ödəniş'}</strong><small>{value==='automatic'?'İlk ödənişdən sonra hər ay kartınızdan yenilənir.':'Yalnız bir ay ödənilir. Növbəti ay özünüz ödəyirsiniz.'}</small></span></label>)}</fieldset>
 {mode==='automatic'?<p>Kart bankda saxlanılır. Hər ay {money(sub.monthlyAmountMinor)} tutulmasına ayrıca razılıq verirsiniz. Ödəniş alınmasa, ödənilmiş müddət bitəndə yeni satışlar dayanır və ödəniş ekranından davam edirsiniz.</p>:<p>Avtomatik pul tutulmur. {sub.autoRenew?'Bu üsulla ödənişi başladanda əvvəlki avtomatik yenilənmə dayandırılacaq. ':''}Bir ayın sonunda yenidən əl ilə ödəyənədək yeni satışlar dayanır.</p>}
 {sub.lastPaymentStatus==='failed'&&sub.state!=='active'&&<p className="pay-alert error">Son ödəniş alınmayıb. Kartı yenidən yoxlayıb uyğun üsulla ödəniş edin.</p>}
 {['processing','unknown'].includes(sub.lastPaymentStatus??'')&&<p className="pay-alert">Əvvəlki bank əməliyyatının nəticəsi gözlənilir. Yeni tutulma yaratmadan mövcud sifarişin vəziyyəti yoxlanılacaq.</p>}
 <label className="pay-check"><input type="checkbox" disabled={busy} checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span><TermsLink version={site.termsVersion}/> ilə tanış oldum. {mode==='automatic'?`Hər ay ${money(sub.monthlyAmountMinor)} avtomatik tutulmasına razıyam; istənilən vaxt dayandıra bilərəm.`:'Yalnız bir aylıq ödəniş edirəm; sonrakı ödənişi özüm edəcəyəm.'}</span></label>
 {mode==='automatic'&&!site.recurringAvailable&&<p className="pay-alert">Avtomatik yenilənmə Epoint Card Storage və API aktivləşəndən sonra açılacaq.</p>}
 <button className="pay-primary" disabled={busy||!agreed||!site.paymentsAvailable||!site.termsVersion||sub.state==='disabled'||mode==='automatic'&&!site.recurringAvailable} onClick={()=>onPay(mode)}>{busy?'Ödəniş hazırlanır…':mode==='automatic'?'Avtomatik abunəni başlat':'Bir aylıq ödəniş linkini aç'}</button><p>Erkən ödəniş cari müddətə bir ay əlavə edir. Gecikmiş ödəniş bank təsdiqindən yeni ay başladır. Məlumatlara baxış və ixrac açıq qalır.</p></section>;
}

export function PaymentPage({mode}:{mode:'shop'|'handoff'|'result'|'terms'}){
 const session=useCustomerSession(),cart=useCart(),partner=usePartner();
 const [options,setOptions]=useState<Options|null>(null),[quote,setQuote]=useState<Quote|null>(null),[site,setSite]=useState<Site|null>(null),[detail,setDetail]=useState<Detail|null>(null),[legal,setLegal]=useState<Legal|null>(null);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[accepted,setAccepted]=useState(false);
 const [form,setForm]=useState({kind:'pickup',name:'',phone:'',address:''});
 const keys=useRef<Record<string,string>>({}),handoffOnce=useRef<Promise<Site>|null>(null),orderRef=useRef('');
 function key(id:string){return keys.current[id]??(keys.current[id]=crypto.randomUUID());}
 const loadResult=useCallback(async()=>{
  const id=orderRef.current;if(!id)return;
  let result:Detail;
  try{result=await api<Detail>('customer/billing/orders/'+encodeURIComponent(id));}
  catch{result=await api<Detail>('billing/site/orders/'+encodeURIComponent(id));}
  setDetail(result);setError('');setLoaded(true);
 },[]);
 useEffect(()=>{
  let alive=true;
  async function load(){
   try{
    if(mode==='handoff'){
     if(!handoffOnce.current)handoffOnce.current=(async()=>{
      const token=new URLSearchParams(window.location.search).get('handoff');
      if(token){const selected=new URLSearchParams(window.location.search).get('mode');window.history.replaceState(null,'','/odenis/davam/'+(selected==='manual'||selected==='automatic'?'?mode='+selected:''));await api('billing/handoff',{token});}
      return api<Site>('billing/site');
     })();
     const data=await handoffOnce.current;if(alive)setSite(data);
    }else if(mode==='result'){
     orderRef.current=new URLSearchParams(window.location.search).get('order')??'';
     if(!/^[a-f0-9-]{36}$/i.test(orderRef.current))throw new Error('Sifariş nömrəsi yoxdur. Tarixçədən ödənişi seçin.');
     await loadResult();
    }else if(mode==='terms'){
     const version=new URLSearchParams(window.location.search).get('version');
     const data=await api<{legal:Legal|null}>('billing/terms'+(version?'?version='+encodeURIComponent(version):''));if(alive)setLegal(data.legal);
    }else{const o=await api<Options>('billing/options');if(alive)setOptions(o);}
   }catch(e){if(alive)setError(e instanceof Error?e.message:'Məlumat yüklənmədi.');}finally{if(alive)setLoaded(true);}
  }
  void load();return()=>{alive=false;};
 },[mode,loadResult]);
 useEffect(()=>{
  if(mode!=='result')return;
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void loadResult().catch(e=>setError(e.message));},5000);
  return()=>clearInterval(timer);
 },[mode,loadResult]);
 useEffect(()=>{if(mode==='result'&&detail?.order.kind==='shop'&&detail.order.status==='paid'&&session.customerId)cart.completeOrder(detail.order.id,session.customerId);},[mode,detail?.order.status,detail?.order.kind,detail?.order.id,session.customerId,cart.completeOrder]);
 useEffect(()=>{setQuote(null);setAccepted(false);},[JSON.stringify(form),JSON.stringify(cart.items.map(i=>[i.id,i.qty,i.price]))]);
 async function getQuote(){
  setBusy(true);setError('');setMessage('');try{
   const partnerProof=await partner.checkoutProof();
   const q=await api<Quote>('customer/billing/quote',{items:cart.items.map(i=>({id:i.id,qty:i.qty})),shipping:form,partnerProof},session.csrfToken);
   setQuote(q);setAccepted(false);
  }catch(e){setError(e instanceof Error?e.message:'Qiymət alınmadı.');}finally{setBusy(false);}
 }
 async function redirect(path:string,body:unknown,csrf?:string|null){
  setBusy(true);setError('');try{
   const r=await api<{id:string;redirectUrl:string|null;paymentState:string}>(path,body,csrf);
   if(path==='customer/billing/checkout'&&session.customerId)cart.rememberOrder(r.id,session.customerId);
   if(r.redirectUrl){const url=new URL(r.redirectUrl);if(url.protocol!=='https:')throw new Error('Bank ünvanı etibarlı deyil.');window.location.assign(url.toString());return;}
   window.location.assign('/odenis/ugurlu/?order='+encodeURIComponent(r.id));
  }catch(e){setError(e instanceof Error?e.message:'Ödəniş başlamadı.');}finally{setBusy(false);}
 }
 const title=mode==='shop'?'Sifarişinizi tamamlayın':mode==='handoff'?'POS abunəliyi':mode==='terms'?'Ödəniş şərtləri':'Ödənişin nəticəsi';
 return <MarketingLayout><div className="pay-page marketing-container"><header className="pay-heading"><p>POSSİSTEM / ÖDƏNİŞLƏR</p><h1>{title}</h1><Link href="/mehsul/avadanliq/">Məhsullara qayıt →</Link></header>
  {error&&<p className="pay-alert error" role="alert">{error} <button onClick={()=>window.location.reload()}>Yenidən yoxla</button></p>}
  {message&&<p className="pay-alert" role="status">{message}</p>}{!loaded&&<p role="status">Yüklənir…</p>}
  {mode==='shop'&&(session.loading?<p>Hesab yoxlanılır…</p>:!session.authenticated?<SignIn/>:<div className="pay-grid"><form className="pay-panel" onSubmit={e=>{e.preventDefault();void getQuote();}}><h2>Təhvil məlumatları</h2><p>{session.name} · {session.email}</p>
   <label>Ad və soyad<input required minLength={2} maxLength={150} autoComplete="name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
   <label>Əlaqə telefonu<input required minLength={7} maxLength={40} type="tel" autoComplete="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
   <label>Təhvil üsulu<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="pickup">Özüm götürəcəyəm</option>{options?.deliveryAvailable&&<option value="delivery">Çatdırılma · {money(options.deliveryFeeMinor??0)}</option>}</select></label>
   {form.kind==='pickup'?<p>{options?.pickupAddress||'Götürmə ünvanı hələ təyin edilməyib.'}</p>:<label>Ünvan<textarea required minLength={5} maxLength={1000} autoComplete="street-address" value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></label>}
   <button className="pay-primary" disabled={busy||!cart.items.length} type="submit">{busy?'Hesablanır…':'Məbləği yoxla'}</button>
  </form><section className="pay-panel"><h2>Sifarişiniz</h2>{!cart.items.length?<p>Səbət boşdur. <Link href="/mehsul/avadanliq/">Məhsullara baxın</Link></p>:<ul className="pay-items">{(quote?.items??cart.items.map(i=>({id:i.id,name:i.name,qty:i.qty,unitPriceMinor:Math.round(i.price*100)}))).map(i=><li key={i.id}><span>{i.name}<small>{i.qty} ədəd</small></span><strong>{money(i.qty*i.unitPriceMinor)}</strong></li>)}</ul>}
   {!quote&&cart.items.length>0&&<p className="pay-total">Məhsulların cəmi <strong>{money(Math.round(cart.total*100))}</strong></p>}
   {quote&&<><p>Çatdırılma: {money(quote.deliveryFeeMinor)}</p><p className="pay-total">Yekun <strong>{money(quote.totalMinor)}</strong></p><p>Qiymət təklifi {date(quote.expiresAt)} tarixinədək qüvvədədir. Stok ödəniş yaradıldıqda 15 dəqiqə rezerv edilir.</p><label className="pay-check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span><TermsLink version={quote.termsVersion}/> ilə tanış oldum və qəbul edirəm.</span></label><button className="pay-primary" disabled={!accepted||busy||!options?.paymentsAvailable||!quote.termsVersion} onClick={()=>void redirect('customer/billing/checkout',{quoteId:quote.quoteId,requestId:key(quote.quoteId),termsVersion:quote.termsVersion},session.csrfToken)}>Epoint ilə {money(quote.totalMinor)} ödə</button></>}
   {options&&!options.paymentsAvailable&&<p className="pay-alert">Epoint API qoşulması gözlənilir. Məhsulların qiyməti yuxarıdadır; kartla sifariş bank inteqrasiyası aktivləşəndə açılacaq. Səbətiniz saxlanılır.</p>}
  </section></div>)}
  {mode==='handoff'&&site&&<>{!site.paymentsAvailable&&<p className="pay-alert">Epoint API ödənişləri hələ aktivləşdirilməyib. Bu seçimlər hazırdır; hazırda ödəniş təsdiqlənmiş kimi göstərilmir.</p>}{site.subscriptions.map(sub=><SubscriptionChoice key={sub.id} sub={sub} site={site} busy={busy} onPay={paymentMode=>void redirect('billing/site/checkout',{requestId:key(sub.id+':'+sub.priceVersion+':'+paymentMode),priceVersion:sub.priceVersion,saveCard:paymentMode==='automatic',paymentMode,termsVersion:site.termsVersion},site.csrfToken)}/>)}</>}
  {mode==='result'&&detail&&<section className="pay-panel"><span className={'pay-state '+detail.order.status}>{labels[detail.order.status]??detail.order.status}</span><h2>{detail.order.order_no}</h2><p className="pay-amount">{money(Number(detail.order.amount_minor))}</p>{detail.order.status==='paid'?<p>{detail.order.kind==='subscription'?'Yeni istifadə müddəti: '+date(detail.order.period_end):'Sifariş: '+(labels[detail.order.fulfillment_status]??detail.order.fulfillment_status)}</p>:<p>Bu səhifəyə keçid ödənişi təsdiqləmir. Bank nəticəsi serverdə yoxlanılır. Nəticə qeyri-müəyyəndirsə, ikinci dəfə ödəməyin.</p>}{detail.items?.map((i,n)=><p key={n}>{i.name} · {i.qty} ədəd · {money(Number(i.unit_price_minor)*i.qty)}</p>)}<div className="pay-actions"><button onClick={()=>void loadResult().catch(e=>setError(e.message))}>Nəticəni yenilə</button><a className="pay-primary" href="/pos/app/abunelik">Ödəniş tarixçəsi</a></div></section>}
  {mode==='terms'&&loaded&&<section className="pay-panel pay-legal">{legal?.version?<><h2>{legal.sellerName}</h2><p>VÖEN: {legal.voen} · {legal.address}</p><p>{legal.phone} · Şərtlərin versiyası: {legal.version}</p>{[['subscriptionTerms','Aylıq abunə'],['deliveryTerms','Təhvil və çatdırılma'],['refundTerms','Geri qaytarma'],['privacyPolicy','Məxfilik']].map(([k,title])=><section key={k}><h3>{title}</h3><p>{legal[k]}</p></section>)}</>:<p>Satıcı məlumatları və ödəniş şərtləri hələ dərc edilməyib. Onlayn ödəniş bağlıdır.</p>}</section>}
 </div></MarketingLayout>;
}
