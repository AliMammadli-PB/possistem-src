'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {MarketingLayout} from '@/components/marketing/MarketingLayout';
import {useAdminSession} from '@/components/providers/AdminSessionProvider';
import {useCustomerSession} from '@/components/providers/CustomerSessionProvider';
import {adminAuthHeaders} from '@/lib/admin-session';
import './payment.css';

type Result={id:string;orderNo:string;qty:number;amountMinor:number;status:'simulated_success'|'simulated_failure';chargedMinor:0;mode:'simulation';createdAt:string};
type Context={mode:'simulation';email:string;csrfToken:string;product:{id:string;name:string;price:number};orders:Result[];notice:string};
const money=(n:number)=>new Intl.NumberFormat('az-AZ',{style:'currency',currency:'AZN'}).format(n/100);
async function request<T>(path:string,body?:unknown,csrf?:string):Promise<T>{
 const res=await fetch('/pos/api/billing/test/'+path,{credentials:'include',cache:'no-store',method:body?'POST':'GET',headers:{...adminAuthHeaders({Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})}),...(body?{'x-csrf-token':csrf??''}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(res.status===404?'Bu sınaq hesabınız üçün əlçatan deyil.':data.error||'Sınaq tamamlanmadı. Yenidən yoxlayın.');return data;
}
export function TestCheckoutPage(){
 const admin=useAdminSession(),customer=useCustomerSession();
 const [context,setContext]=useState<Context|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[qty,setQty]=useState(1),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[result,setResult]=useState<Result|null>(null);
 const keys=useRef<Record<string,string>>({}),sending=useRef(false),epoch=useRef(0);
 useEffect(()=>{let alive=true;epoch.current++;setContext(null);setResult(null);setAccepted(false);setLoading(true);setError('');sending.current=false;setBusy(false);
  void request<Context>('context').then(v=>{if(alive)setContext(v);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};
 },[admin.authenticated,admin.email,customer.authenticated,customer.email]);
 async function run(outcome:'success'|'failure'){
  if(!context||!accepted||sending.current)return;const revision=epoch.current;sending.current=true;setBusy(true);setError('');
  const fingerprint=context.product.id+':'+qty+':'+outcome;const requestId=keys.current[fingerprint]??(keys.current[fingerprint]=crypto.randomUUID());
  try{const r=await request<Result>('checkout',{mode:'simulation',accepted:true,productId:context.product.id,qty,outcome,requestId},context.csrfToken);if(revision!==epoch.current)return;setResult(r);setContext(v=>v?{...v,orders:[r,...v.orders.filter(x=>x.id!==r.id)].slice(0,10)}:v);}
  catch(e){if(revision===epoch.current)setError(e instanceof Error?e.message:'Sınaq tamamlanmadı.');}
  finally{if(revision===epoch.current){sending.current=false;setBusy(false);}}
 }
 return <MarketingLayout><main className="pay-page marketing-container"><header className="pay-heading"><p>POSSİSTEM / SINAQ</p><h1>Test sifarişi</h1><Link href="/mehsul/avadanliq/">Məhsullara qayıt →</Link></header>
  {loading&&<p role="status">Hesab yoxlanılır…</p>}{error&&<p className="pay-alert error" role="alert">{error}</p>}
  {context&&<><p className="pay-alert" role="note"><strong>Yalnız simulyasiya.</strong> {context.notice} Real ödəniş üçün Epoint-in public/private açarları və aktiv merchant hesabı lazımdır.</p><div className="pay-grid"><section className="pay-panel"><h2>{context.product.name}</h2><p>{context.email}</p><p>Göstərilən sınaq qiyməti: {money(Math.round(context.product.price*100))} / ədəd</p><label>Miqdar<input type="number" min={1} max={10} step={1} value={qty} disabled={busy} onChange={e=>{setQty(Math.max(1,Math.min(10,Math.trunc(Number(e.target.value)||1))));setResult(null);}}/></label><p className="pay-total">Sınaq məbləği <strong>{money(Math.round(context.product.price*100)*qty)}</strong></p><p><strong>Kartdan tutulacaq: 0,00 ₼</strong></p><label className="pay-check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>Bunun sınaq olduğunu və real ödəniş edilməyəcəyini başa düşürəm.</span></label><div className="pay-actions"><button className="pay-primary" disabled={!accepted||busy} onClick={()=>void run('success')}>{busy?'Sınaq işlənir…':'Uğurlu sınağı yoxla'}</button><button disabled={!accepted||busy} onClick={()=>void run('failure')}>Uğursuz sınağı yoxla</button></div></section><section className="pay-panel"><h2>Sınaq nəticəsi</h2>{result?<div role="status"><strong>{result.status==='simulated_success'?'Uğurlu nəticə simulyasiya edildi.':'Uğursuz nəticə simulyasiya edildi.'}</strong><p>{result.orderNo}</p><p>Real pul tutulmayıb. Stok, abunəlik və real ödəniş tarixçəsi dəyişməyib.</p><button onClick={()=>{keys.current={};setResult(null);setAccepted(false);}}>Yeni sınaq</button></div>:<p>Nəticə seçdiyiniz ssenariyə görə serverdə ayrıca sınaq qeydi kimi saxlanılacaq.</p>}<h3>Son sınaqlarınız</h3>{context.orders.length?<ul className="pay-items">{context.orders.map(o=><li key={o.id}><span>{o.orderNo}<small>{o.status==='simulated_success'?'Uğurlu simulyasiya':'Uğursuz simulyasiya'} · {new Date(o.createdAt).toLocaleString('az-AZ')}</small></span><strong>{money(o.amountMinor)}<small>0 ₼ tutulub</small></strong></li>)}</ul>:<p>Hələ sınaq yoxdur.</p>}</section></div></>}
 </main></MarketingLayout>;
}
