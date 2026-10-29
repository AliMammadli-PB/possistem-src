'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import type {ReactNode} from 'react';
import {SiteFooter} from '@/components/marketing/SiteFooter';
import {MarketingLayout} from '@/components/marketing/MarketingLayout';
import {useCustomerSession} from '@/components/providers/CustomerSessionProvider';
import {useCart} from '@/components/providers/CartProvider';
import {usePartner} from '@/components/providers/PartnerProvider';
import './payment.css';

type Legal=Record<string,string>;
type Options={pickupAddress:string;deliveryAvailable:boolean;deliveryFeeMinor:number|null;legal:Legal;paymentsAvailable:boolean};
type Quote={quoteId:string;totalMinor:number;deliveryFeeMinor:number;termsVersion:string;expiresAt:string;items:{id:string;name:string;qty:number;unitPriceMinor:number}[]};
type Sub={id:string;product:string;monthlyAmountMinor:number;paidUntil:string|null;state:string;priceVersion:number;autoRenew:boolean;hasAccess?:boolean;accessStatus?:string;accessMode?:string;trialUntil?:string|null;accessUntil?:string|null;lastPaymentStatus?:string|null};
type Site={customer?:{id:string;name:string;email:string};product?:string;subscriptions:Sub[];paymentsAvailable:boolean;recurringAvailable:boolean;termsVersion:string|null;csrfToken:string};
type SavedCard={id:string;card_mask:string;source:'shop'|'subscription';last_used_at:string|null};

type Order={id:string;order_no:string;kind:string;status:string;amount_minor:number;period_end:string|null;fulfillment_status:string;delivery_kind:string;delivery_address:string;recipient_name:string;recipient_phone:string;estimated_at?:string|null;note?:string|null};
const CITIES=['Bakı','Sumqayıt','Xırdalan','Gəncə','Mingəçevir','Şirvan','Lənkəran','Şəki','Naxçıvan','Quba','Qəbələ','Şamaxı'];
type Detail={order:Order;items?:{name:string;qty:number;unit_price_minor:number}[]};
const money=(n:number)=>new Intl.NumberFormat('az-AZ',{style:'currency',currency:'AZN'}).format(n/100);
const date=(s:string|null)=>s?new Date(s).toLocaleString('az-AZ'):'—';
const labels:Record<string,string>={paid:'Ödəniş təsdiqləndi',paid_review:'Ödəniş alınıb · admin yoxlayır',refunded:'Geri qaytarılıb',refund_pending:'Geri qaytarma gözlənilir',failed:'Ödəniş alınmadı',expired:'Rezerv müddəti bitib',processing:'Bank təsdiqi gözlənilir',unknown:'Ödəniş nəticəsi dəqiqləşdirilir',awaiting_payment:'Ödəniş gözlənilir',preparing:'Hazırlanır',ready:'Təhvil üçün hazırdır',dispatched:'Çatdırılır',completed:'Təhvil verilib',cancelled:'Təhvil dayandırılıb'};
async function api<T>(path:string,body?:unknown,csrf?:string|null):Promise<T>{
 const res=await fetch('/pos/api/'+path,{method:body?'POST':'GET',credentials:'include',cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','x-csrf-token':csrf??''}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json().catch(()=>null);if(!res.ok)throw new Error(data?.error||'Sorğu tamamlanmadı. Yenidən yoxlayın.');return data as T;
}
function PaymentLayout({scoped,children}:{scoped:boolean;children:ReactNode}){return scoped?<div className="brand-site pay-scoped-layout"><header className="pay-scope-header marketing-container"><Link href="/" className="pay-scope-brand">possistem</Link><span>POS abunəliyi</span></header><main>{children}</main><SiteFooter/></div>:<MarketingLayout>{children}</MarketingLayout>;}
function TermsLink({version}:{version?:string|null}){return <Link href={'/odenis/sertler/'+(version?'?version='+encodeURIComponent(version):'')} target="_blank">Ödəniş və abunə şərtləri</Link>;}
function SignIn(){return <section className="pay-panel"><h2>Hesabınıza daxil olun</h2><p>Alış və sifariş tarixçəsi mövcud müştəri hesabınızla əlaqələndiriləcək.</p><a className="pay-primary" href="/pos/app/login?next=%2Fodenis%2F">Hesabıma daxil ol</a><p>Girişdən sonra bu səhifəyə qayıdın. Səbətiniz saxlanılır.</p></section>;}

type PaymentMode='automatic';
function SubscriptionChoice({sub,site,busy,onPay}:{sub:Sub;site:Site;busy:boolean;onPay:(mode:PaymentMode)=>void}){
 const [agreed,setAgreed]=useState(false);
 useEffect(()=>{setAgreed(false);},[sub.priceVersion,site.termsVersion]);
 return <section className="pay-panel pay-sub"><h2>{sub.product==='market'?'Market POS':'Restoran POS'}</h2><p className="pay-amount">{money(sub.monthlyAmountMinor)} <small>/ təqvim ayı</small></p><p>Ödənilmiş son tarix: <strong>{date(sub.paidUntil)}</strong></p>
 {sub.accessStatus==='free'?<p className="pay-alert">Administrator bu POS üçün abunə məcburiyyətini götürüb. Ödəniş tələb olunmur.</p>:sub.accessStatus==='trial'?<p className="pay-alert">Pulsuz istifadə müddəti: {date(sub.accessUntil??null)}. Bu tarixədək ödəniş tələb olunmur.</p>:sub.state==='active'?<><p className="pay-alert">Cari müddətiniz ödənilib. Yenidən ödəniş tələb olunmur. {sub.autoRenew?'Növbəti ödəniş müddət bitdikdə kartınızdan avtomatik tutulacaq.':''}</p><p>POS tətbiqinə qayıdıb “Ödənişi yoxla” düyməsini basın.</p></>:<><p>Kartınızı bank səhifəsində bir dəfə bağlayın. Hər ay {money(sub.monthlyAmountMinor)} razılığınızla avtomatik tutulur. Yenilənmədən 3 gün əvvəl bildiriş alacaqsınız.</p>
 {sub.lastPaymentStatus==='failed'&&<p className="pay-alert error">Son ödəniş alınmayıb. Kartınızı yenidən yoxlayın.</p>}
 {['processing','unknown'].includes(sub.lastPaymentStatus??'')&&<p className="pay-alert">Əvvəlki bank əməliyyatının nəticəsi gözlənilir. Mövcud əməliyyat yoxlanılacaq.</p>}
 <label className="pay-check"><input type="checkbox" disabled={busy} checked={agreed} onChange={e=>setAgreed(e.target.checked)}/><span><TermsLink version={site.termsVersion}/> ilə tanış oldum. Hər ay {money(sub.monthlyAmountMinor)} avtomatik tutulmasına razıyam; istənilən vaxt dayandıra bilərəm.</span></label>
 {!site.recurringAvailable&&<p className="pay-alert">Avtomatik abunə xidməti hazırda əlçatan deyil.</p>}
 <button className="pay-primary" disabled={busy||!agreed||!site.paymentsAvailable||!site.termsVersion||sub.state==='disabled'||!site.recurringAvailable} onClick={()=>onPay('automatic')}>{busy?'Ödəniş hazırlanır…':'Kartı bağla və abunə ol'}</button><p>Ödəniş alınmasa, ödənilmiş müddət bitdikdə yeni satışlar dayanır. Baxış və ixrac açıq qalır.</p></>}
 </section>;
}

export function PaymentPage({mode}:{mode:'shop'|'handoff'|'result'|'terms'}){
 const session=useCustomerSession(),cart=useCart(),partner=usePartner();
 const [options,setOptions]=useState<Options|null>(null),[quote,setQuote]=useState<Quote|null>(null),[site,setSite]=useState<Site|null>(null),[detail,setDetail]=useState<Detail|null>(null),[legal,setLegal]=useState<Legal|null>(null);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[accepted,setAccepted]=useState(false);
 // Shop cards saved on earlier purchases; '' means a new card on the bank page.
 const [cards,setCards]=useState<SavedCard[]>([]),[cardId,setCardId]=useState(''),[saveCard,setSaveCard]=useState(false);
 const [form,setForm]=useState({kind:'pickup',name:'',phone:'',city:'Bakı',district:'',street:'',building:'',apartment:'',entrance:'',floor:'',landmark:'',courierNote:''});
 const field=(key:keyof typeof form)=>({value:form[key],onChange:(e:{target:{value:string}})=>setForm({...form,[key]:e.target.value})});
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
 useEffect(()=>{if(mode!=='shop'||!session.authenticated)return;let alive=true;api<{cards:SavedCard[]}>('customer/billing/cards').then(r=>{if(!alive)return;const shop=r.cards.filter(c=>c.source==='shop');setCards(shop);setCardId(id=>id||shop[0]?.id||'');}).catch(()=>{});return()=>{alive=false;};},[mode,session.authenticated]);
 useEffect(()=>{setQuote(null);setAccepted(false);},[JSON.stringify(form),JSON.stringify(cart.items.map(i=>[i.id,i.qty,i.price]))]);
 async function getQuote(){
  setBusy(true);setError('');setMessage('');try{
   const partnerProof=await partner.checkoutProof();
   // Delivery sends the address as separate fields; the server also builds the one-line address from them.
   const {kind,name,phone,...address}=form,clean=Object.fromEntries(Object.entries(address).map(([k,v])=>[k,v.trim()]).filter(([,v])=>v));
   const shipping=kind==='delivery'?{kind,name,phone,details:clean}:{kind,name,phone,address:''};
   const q=await api<Quote>('customer/billing/quote',{items:cart.items.map(i=>({id:i.id,qty:i.qty})),shipping,partnerProof},session.csrfToken);
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
 return <PaymentLayout scoped={mode==='handoff'}><div className="pay-page marketing-container"><header className="pay-heading"><p>POSSİSTEM / ÖDƏNİŞLƏR</p><h1>{title}</h1><Link href="/mehsul/avadanliq/">Məhsullara qayıt →</Link></header>
  {error&&<p className="pay-alert error" role="alert">{error} <button onClick={()=>window.location.reload()}>Yenidən yoxla</button></p>}
  {message&&<p className="pay-alert" role="status">{message}</p>}{!loaded&&<p role="status">Yüklənir…</p>}
  {mode==='shop'&&(session.loading?<p>Hesab yoxlanılır…</p>:!session.authenticated?<SignIn/>:<div className="pay-grid"><form className="pay-panel" onSubmit={e=>{e.preventDefault();void getQuote();}}><h2>Təhvil məlumatları</h2><p>{session.name} · {session.email}</p>
   <label>Ad və soyad<input required minLength={2} maxLength={150} autoComplete="name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
   <label>Əlaqə telefonu<input required minLength={7} maxLength={40} type="tel" autoComplete="tel" placeholder="+994 50 123 45 67" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
   <label>Təhvil üsulu<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="pickup">Özüm götürəcəyəm</option>{options?.deliveryAvailable&&<option value="delivery">Çatdırılma · {money(options.deliveryFeeMinor??0)}</option>}</select></label>
   {form.kind==='pickup'?<p>{options?.pickupAddress||'Götürmə ünvanı hələ təyin edilməyib.'}</p>:<fieldset className="pay-address"><legend>Çatdırılma ünvanı</legend>
    <label>Şəhər<input required minLength={2} maxLength={80} list="pay-cities" autoComplete="address-level2" {...field('city')}/><datalist id="pay-cities">{CITIES.map(c=><option key={c} value={c}/>)}</datalist></label>
    <label>Rayon / qəsəbə<input maxLength={120} autoComplete="address-level3" placeholder="Məs. Nəsimi" {...field('district')}/></label>
    <label className="wide">Küçə / prospekt<input required minLength={2} maxLength={200} autoComplete="address-line1" placeholder="Məs. Ziya Bünyadov prospekti" {...field('street')}/></label>
    <label>Bina / ev<input required maxLength={40} {...field('building')}/></label>
    <label>Mənzil<input maxLength={40} autoComplete="address-line2" {...field('apartment')}/></label>
    <label>Giriş<input maxLength={40} {...field('entrance')}/></label>
    <label>Mərtəbə<input maxLength={40} inputMode="numeric" {...field('floor')}/></label>
    <label className="wide">Orientir<input maxLength={300} placeholder="Məs. metro yaxınlığı, mağazanın yanı" {...field('landmark')}/></label>
    <label className="wide">Kuryer üçün qeyd<textarea maxLength={500} rows={2} placeholder="Məs. zəng edin, domofon işləmir" {...field('courierNote')}/></label>
   </fieldset>}
   <button className="pay-primary" disabled={busy||!cart.items.length} type="submit">{busy?'Hesablanır…':'Məbləği yoxla'}</button>
  </form><section className="pay-panel"><h2>Sifarişiniz</h2>{!cart.items.length?<p>Səbət boşdur. <Link href="/mehsul/avadanliq/">Məhsullara baxın</Link></p>:<ul className="pay-items">{(quote?.items??cart.items.map(i=>({id:i.id,name:i.name,qty:i.qty,unitPriceMinor:Math.round(i.price*100)}))).map(i=><li key={i.id}><span>{i.name}<small>{i.qty} ədəd</small></span><strong>{money(i.qty*i.unitPriceMinor)}</strong></li>)}</ul>}
   {!quote&&cart.items.length>0&&<p className="pay-total">Məhsulların cəmi <strong>{money(Math.round(cart.total*100))}</strong></p>}
   {quote&&<><p>Çatdırılma: {money(quote.deliveryFeeMinor)}</p><p className="pay-total">Yekun <strong>{money(quote.totalMinor)}</strong></p><p>Qiymət təklifi {date(quote.expiresAt)} tarixinədək qüvvədədir. Stok ödəniş yaradıldıqda 15 dəqiqə rezerv edilir.</p><fieldset className="pay-cards"><legend>Ödəniş kartı</legend>{cards.map(c=><label key={c.id} className="pay-check"><input type="radio" name="pay-card" checked={cardId===c.id} onChange={()=>setCardId(c.id)}/><span>Saxlanmış kart <strong>{c.card_mask}</strong><small>Bank səhifəsi açılmadan dərhal ödənilir</small></span></label>)}<label className="pay-check"><input type="radio" name="pay-card" checked={!cardId} onChange={()=>setCardId('')}/><span>{cards.length?'Yeni kartla ödə':'Kartla ödə'}<small>Kart məlumatlarını bankın təhlükəsiz səhifəsində daxil edirsiniz</small></span></label>{!cardId&&<label className="pay-check pay-save"><input type="checkbox" checked={saveCard} onChange={e=>setSaveCard(e.target.checked)}/><span>Kartımı növbəti alışlar üçün yadda saxla. Kart nömrəsi bizdə saxlanmır, yalnız bankın verdiyi açar saxlanılır; kartı istənilən vaxt “Kartlarım” bölməsindən silə bilərsiniz.</span></label>}</fieldset><label className="pay-check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span><TermsLink version={quote.termsVersion}/> ilə tanış oldum və qəbul edirəm.</span></label><button className="pay-primary" disabled={!accepted||busy||!options?.paymentsAvailable||!quote.termsVersion} onClick={()=>{const card=cards.find(c=>c.id===cardId);if(card&&!window.confirm(card.card_mask+' kartından '+money(quote.totalMinor)+' tutulsun?'))return;void redirect('customer/billing/checkout',{quoteId:quote.quoteId,requestId:key(quote.quoteId+':'+(cardId||(saveCard?'save':'new'))),termsVersion:quote.termsVersion,...(cardId?{cardId}:saveCard?{saveCard:true}:{})},session.csrfToken);}}>{busy?'Ödəniş gedir…':cardId?'Saxlanmış kartla '+money(quote.totalMinor)+' ödə':'Epoint ilə '+money(quote.totalMinor)+' ödə'}</button></>}
   {options&&!options.paymentsAvailable&&<p className="pay-alert">Epoint API qoşulması gözlənilir. Məhsulların qiyməti yuxarıdadır; kartla sifariş bank inteqrasiyası aktivləşəndə açılacaq. Səbətiniz saxlanılır.</p>}
  </section></div>)}
  {mode==='handoff'&&site&&<><section className="pay-panel pay-account-context" aria-label="Ödəniş edilən hesab"><h2>Ödəniş edilən hesab</h2><strong>{site.customer?.name}</strong><p>{site.customer?.email}</p><p>{site.product==='restaurant'?'Restoran POS':site.product==='market'?'Market POS':site.product}</p><p>Bu təhlükəsiz keçid POS-da daxil olduğunuz hesaba aiddir. Brauzerdə açıq olan digər hesabın abunəliyinə ödəniş yazılmır.</p>{session.authenticated&&session.customerId!==site.customer?.id&&<p className="pay-alert">Brauzerdə {session.email} açıqdır. Buradakı ödəniş yalnız <strong>{site.customer?.email}</strong> üçündür.</p>}</section>{!site.subscriptions.length&&<section className="pay-panel"><h2>Bu POS üçün abunəlik təyin edilməyib</h2><p>Administrator bu hesaba uyğun POS lisenziyasını və aylıq haqqı əlavə etməlidir. Digər POS və ya hesab üçün ödəniş yaratmırıq.</p><Link href="/destek/">Dəstəyə müraciət et</Link></section>}{!site.paymentsAvailable&&<p className="pay-alert">Epoint API ödənişləri hələ aktivləşdirilməyib. Bu seçimlər hazırdır; hazırda ödəniş təsdiqlənmiş kimi göstərilmir.</p>}{site.subscriptions.map(sub=><SubscriptionChoice key={sub.id} sub={sub} site={site} busy={busy} onPay={paymentMode=>void redirect('billing/site/checkout',{customerId:site.customer?.id,requestId:key(sub.id+':'+sub.priceVersion+':'+paymentMode),priceVersion:sub.priceVersion,saveCard:paymentMode==='automatic',paymentMode,termsVersion:site.termsVersion},site.csrfToken)}/>)}</>}
  {mode==='result'&&detail&&<section className="pay-panel"><span className={'pay-state '+detail.order.status}>{labels[detail.order.status]??detail.order.status}</span><h2>{detail.order.order_no}</h2><p className="pay-amount">{money(Number(detail.order.amount_minor))}</p>{detail.order.status==='paid'?<p>{detail.order.kind==='subscription'?'Yeni istifadə müddəti: '+date(detail.order.period_end):'Sifariş: '+(labels[detail.order.fulfillment_status]??detail.order.fulfillment_status)}</p>:<p>Bu səhifəyə keçid ödənişi təsdiqləmir. Bank nəticəsi serverdə yoxlanılır. Nəticə qeyri-müəyyəndirsə, ikinci dəfə ödəməyin.</p>}{detail.order.kind==='shop'&&detail.order.estimated_at&&<p><strong>{detail.order.delivery_kind==='pickup'?'Təxmini hazır olma vaxtı':'Təxmini çatdırılma vaxtı'}:</strong> {new Date(detail.order.estimated_at).toLocaleString('az-AZ',{timeZone:'Asia/Baku',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p>}{detail.order.kind==='shop'&&detail.order.note&&<p className="pay-alert"><strong>Satıcıdan qeyd:</strong> {detail.order.note}</p>}{detail.items?.map((i,n)=><p key={n}>{i.name} · {i.qty} ədəd · {money(Number(i.unit_price_minor)*i.qty)}</p>)}<div className="pay-actions"><button onClick={()=>void loadResult().catch(e=>setError(e.message))}>Nəticəni yenilə</button><a className="pay-primary" href={'/pos/app/faturalar/'+detail.order.id}>Fakturanı aç</a><a href={detail.order.kind==='shop'?'/pos/app/sifarisler':'/pos/app/abunelik'}>Tarixçəyə qayıt</a></div></section>}
  {mode==='terms'&&loaded&&<section className="pay-panel pay-legal">{legal?.version?<><h2>{legal.sellerName}</h2><p>VÖEN: {legal.voen} · {legal.address}</p><p>{legal.phone} · Şərtlərin versiyası: {legal.version}</p>{[['subscriptionTerms','Aylıq abunə'],['deliveryTerms','Təhvil və çatdırılma'],['refundTerms','Geri qaytarma'],['privacyPolicy','Məxfilik']].map(([k,title])=><section key={k}><h3>{title}</h3><p>{legal[k]}</p></section>)}</>:<p>Satıcı məlumatları və ödəniş şərtləri hələ dərc edilməyib. Onlayn ödəniş bağlıdır.</p>}</section>}
 </div></PaymentLayout>;
}
