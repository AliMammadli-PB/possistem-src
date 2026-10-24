'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {MarketingLayout} from '@/components/marketing/MarketingLayout';
import {useAdminSession} from '@/components/providers/AdminSessionProvider';
import {useCustomerSession} from '@/components/providers/CustomerSessionProvider';
import {adminAuthHeaders} from '@/lib/admin-session';
import './payment.css';

type Result={id:string;orderNo:string;qty:number;amountMinor:number;status:'simulated_success'|'simulated_failure';chargedMinor:0;mode:'simulation';createdAt:string};
type Context={mode:'simulation';email:string;csrfToken:string;product:{id:string;name:string;price:number};hostedPayment:{url:string|null;amountMinor:number;verification:'manual';repeatable:boolean;status:'ready'|'paid'|'awaiting_payment';paidAt:string|null;invoiceId:string|null}|null;hostedReceipts:{invoiceId:string;paidAt:string;amountMinor:number}[];orders:Result[];notice:string};
const money=(n:number)=>new Intl.NumberFormat('az-AZ',{style:'currency',currency:'AZN'}).format(n/100);
async function request<T>(path:string,body?:unknown,csrf?:string):Promise<T>{
 const res=await fetch('/pos/api/billing/test/'+path,{credentials:'include',cache:'no-store',method:body?'POST':'GET',headers:{...adminAuthHeaders({Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})}),...(body?{'x-csrf-token':csrf??''}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(res.status===404?'Bu sınaq hesabınız üçün əlçatan deyil.':data.error||'Sınaq tamamlanmadı. Yenidən yoxlayın.');return data;
}
export function TestCheckoutPage(){
 const admin=useAdminSession(),customer=useCustomerSession();
 const [context,setContext]=useState<Context|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[qty,setQty]=useState(1),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState<Result|null>(null);
 const keys=useRef<Record<string,string>>({}),sending=useRef(false),epoch=useRef(0);
 const [realAccepted,setRealAccepted]=useState(false);
 useEffect(()=>{let alive=true;epoch.current++;setContext(null);setResult(null);setAccepted(false);setRealAccepted(false);setLoading(true);setError('');sending.current=false;setBusy(false);
  void request<Context>('context').then(v=>{if(alive)setContext(v);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};
 },[admin.authenticated,admin.email,customer.authenticated,customer.email]);
 useEffect(()=>{
  let alive=true;
  const refresh=(event:Event)=>{if(document.visibilityState==='hidden')return;const revision=epoch.current;setRealAccepted(false);if(event.type==='pageshow'){sending.current=false;setBusy(false);}void request<Context>('context').then(v=>{if(alive&&epoch.current===revision)setContext(v);}).catch(()=>{});};
  window.addEventListener('pageshow',refresh);window.addEventListener('focus',refresh);
  return()=>{alive=false;window.removeEventListener('pageshow',refresh);window.removeEventListener('focus',refresh);};
 },[admin.authenticated,admin.email,customer.authenticated,customer.email]);
 async function startHosted(){
  if(!realAccepted||sending.current)return;const revision=epoch.current;sending.current=true;setBusy(true);setError('');
  try{const fresh=await request<Context>('context');if(revision!==epoch.current)return;setContext(fresh);setRealAccepted(false);if(fresh.hostedPayment?.url&&fresh.hostedPayment.status!=='paid'){window.location.assign(fresh.hostedPayment.url);return;}}
  catch(e){if(revision===epoch.current)setError(e instanceof Error?e.message:'Ödəniş açılmadı.');}
  finally{if(revision===epoch.current){sending.current=false;setBusy(false);}}
 }
 async function run(outcome:'success'|'failure'){
  if(!context||!accepted||sending.current)return;const revision=epoch.current;sending.current=true;setBusy(true);setError('');
  const fingerprint=context.product.id+':'+qty+':'+outcome;const requestId=keys.current[fingerprint]??(keys.current[fingerprint]=crypto.randomUUID());
  try{const r=await request<Result>('checkout',{mode:'simulation',accepted:true,productId:context.product.id,qty,outcome,requestId},context.csrfToken);if(revision!==epoch.current)return;setResult(r);setContext(v=>v?{...v,orders:[r,...v.orders.filter(x=>x.id!==r.id)].slice(0,10)}:v);}
  catch(e){if(revision===epoch.current)setError(e instanceof Error?e.message:'Sınaq tamamlanmadı.');}
  finally{if(revision===epoch.current){sending.current=false;setBusy(false);}}
 }
 return <MarketingLayout><main className="pay-page marketing-container"><header className="pay-heading"><p>POSSİSTEM / SINAQ</p><h1>Kartla ödəniş sınağı</h1><Link href="/mehsul/avadanliq/">Məhsullara qayıt →</Link></header>
  {loading&&<p role="status">Hesab yoxlanılır…</p>}{error&&<p className="pay-alert error" role="alert">{error}</p>}
  {context&&<>
   {context.hostedPayment&&<section className="pay-panel pay-sub"><h2>Epoint ilə real kart ödənişi</h2><p>{context.email} · {context.hostedPayment.repeatable?'hər yeni sınaq 1 ₼':'bir dəfəlik şəxsi yoxlama'}</p><p className="pay-amount">{money(context.hostedPayment.amountMinor)}</p>
    {context.hostedPayment.status==='paid'?<div role="status"><strong>Ödənildi — real kart ödənişi təsdiqlənib.</strong><p>Epoint kabinetində faktura #{context.hostedPayment.invoiceId} yoxlanıldı. Ödəniş tarixi: {context.hostedPayment.paidAt?new Date(context.hostedPayment.paidAt).toLocaleString('az-AZ',{timeZone:'Asia/Baku'}):'—'}.</p><p>Bu birdəfəlik faktura artıq ödənilib. Aylıq abunəlik və avtomatik tutulma açılmayıb.</p></div>:<>
     <p>{context.hostedPayment.repeatable?'Hər dəfə bu düymədən yeni 1 ₼ ödəniş sınağı başlada bilərsiniz.':'Bu düymə Epoint-in fakturasını açır.'} Epoint səhifəsində “Ödəniş” seçin, kartınızı bank səhifəsində daxil edib təsdiqləyin.</p><p>Hər tamamladığınız ödəniş kartınızdan real 1 ₼ tutur. Avtomatik və aylıq tutulma yoxdur. Yeni sınaq etmək üçün sayta qayıdıb yenidən təsdiqləyin; əvvəlki ödəniş qeyri-müəyyəndirsə, əvvəl Epoint qəbzini yoxlayın.</p><label className="pay-check"><input type="checkbox" disabled={busy} checked={realAccepted} onChange={e=>setRealAccepted(e.target.checked)}/><span>Bu yeni sınaqda kartımdan real olaraq {money(context.hostedPayment.amountMinor)} tutulacağını başa düşürəm.</span></label><button className="pay-primary" disabled={busy||!realAccepted||!context.hostedPayment.url} onClick={()=>void startHosted()}>{busy?'Epoint açılır…':'Yeni 1 ₼ kart ödənişi →'}</button><p>Ödəniş nəticəsini Epoint qəbzində görəcəksiniz. Aşağıdakı tarixçəyə yalnız kabinetdə ayrıca doğrulanan qəbzlər əlavə olunur; sayt onları hələ avtomatik yeniləmir.</p>
    </>}
    {!!context.hostedReceipts?.length&&<><h3>Yoxlanılmış əvvəlki ödənişlər</h3><ul className="pay-items">{context.hostedReceipts.map(r=><li key={r.invoiceId}><span>Faktura #{r.invoiceId}<small>{new Date(r.paidAt).toLocaleString('az-AZ',{timeZone:'Asia/Baku'})} · Ödənildi</small></span><strong>{money(r.amountMinor)}</strong></li>)}</ul></>}
   </section>}
   <details open={!context.hostedPayment}><summary>Pulsuz simulyasiya və əvvəlki sınaqlar</summary><p className="pay-alert" role="note"><strong>Simulyasiya: 0 ₼.</strong> {context.notice}</p><div className="pay-grid"><section className="pay-panel"><h2>Pulsuz sifariş simulyasiyası</h2><p>{context.email}</p><p>Nominal qiymət: {money(Math.round(context.product.price*100))} / ədəd</p><label>Miqdar<input type="number" min={1} max={10} step={1} value={qty} disabled={busy} onChange={e=>{setQty(Math.max(1,Math.min(10,Math.trunc(Number(e.target.value)||1))));setResult(null);}}/></label><p className="pay-total">Sınaq məbləği <strong>{money(Math.round(context.product.price*100)*qty)}</strong></p><p><strong>Kartdan tutulacaq: 0,00 ₼</strong></p><label className="pay-check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>Bunun simulyasiya olduğunu və real ödəniş edilməyəcəyini başa düşürəm.</span></label><div className="pay-actions"><button className="pay-primary" disabled={!accepted||busy} onClick={()=>void run('success')}>{busy?'Sınaq işlənir…':'Uğurlu sınağı yoxla'}</button><button disabled={!accepted||busy} onClick={()=>void run('failure')}>Uğursuz sınağı yoxla</button></div></section><section className="pay-panel"><h2>Simulyasiyanın nəticəsi</h2>{result?<div role="status"><strong>{result.status==='simulated_success'?'Uğurlu nəticə simulyasiya edildi.':'Uğursuz nəticə simulyasiya edildi.'}</strong><p>{result.orderNo}</p><p>Real pul tutulmayıb. Stok, abunəlik və real ödəniş tarixçəsi dəyişməyib.</p><button onClick={()=>{keys.current={};setResult(null);setAccepted(false);}}>Yeni sınaq</button></div>:<p>Nəticə seçdiyiniz ssenariyə görə ayrıca simulyasiya qeydi kimi saxlanılacaq.</p>}<h3>Son simulyasiyalarınız</h3>{context.orders.length?<ul className="pay-items">{context.orders.map(o=><li key={o.id}><span>{o.orderNo}<small>{o.status==='simulated_success'?'Uğurlu simulyasiya':'Uğursuz simulyasiya'} · {new Date(o.createdAt).toLocaleString('az-AZ')}</small></span><strong>{money(o.amountMinor)}<small>0 ₼ tutulub</small></strong></li>)}</ul>:<p>Hələ sınaq yoxdur.</p>}</section></div></details></>}
 </main></MarketingLayout>;
}
