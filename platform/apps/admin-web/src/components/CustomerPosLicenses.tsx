import {BillingAccessControls} from './BillingAccessControls';
import { useLiveEffect } from '../lib/live';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api} from '../lib/api';
const products={restaurant:'Restoran POS',market:'Market POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS'};
type Product=keyof typeof products;
type Pack={customer:{email:string;active:boolean};branches:Array<{id:string;name:string}>;licenses:Array<{id:string;product:Product;branchId:string|null;status:string;validUntil:string|null;seats:number}>};
export function CustomerPosLicenses({customerId}:{customerId:string}){
 const [pcCount,setPcCount]=useState('1'),[capacitySaved,setCapacitySaved]=useState('');
 const [selectedLicense,setSelectedLicense]=useState('');
 const [data,setData]=useState<Pack|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[product,setProduct]=useState<Product>('restaurant'),[branch,setBranch]=useState(''),[name,setName]=useState(''),[days,setDays]=useState('30'),[seats,setSeats]=useState('1'),[monthlyFee,setMonthlyFee]=useState(''),[issued,setIssued]=useState<{activationKey:string;product:Product}|null>(null);
 const currentOwner=useRef(customerId);currentOwner.current=customerId;
 const lock=useRef(false),request=useRef<{body:string;id:string}|null>(null);
 const load=async()=>{try{const requested=customerId;const result=await api<Pack>(`/customers/${requested}/pos-licenses`);if(currentOwner.current===requested){setData(result);setError('');}}catch(e){setError(e instanceof Error?e.message:'POS-lar alınmadı');}};
 useEffect(()=>{setData(null);setSelectedLicense('');setCapacitySaved('');setIssued(null);setOpen(false);setBranch('');setName('');setError('');request.current=null;},[customerId]);
 useLiveEffect(()=>{void load();},[customerId]);
 const save=async(e:FormEvent)=>{const requested=customerId;e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');
  const value={product,days:Number(days),maxDevices:Number(seats),plan:'standart',...(monthlyFee.trim()?{monthlyAmountMinor:Math.round(Number(monthlyFee.replace(',','.'))*100)}:{}),...(branch?{branchId:branch}:{branchName:name.trim()})};const body=JSON.stringify(value);
  if(request.current?.body!==body)request.current={body,id:crypto.randomUUID()};
  try{const result=await api<{activationKey:string;product:Product}>(`/customers/${customerId}/pos-licenses`,{method:'POST',body:JSON.stringify({...value,requestId:request.current.id})});if(currentOwner.current!==requested)return;setIssued(result);setOpen(false);request.current=null;await load();}
  catch(e){setError(e instanceof Error?e.message:'POS əlavə edilmədi');}finally{lock.current=false;setBusy(false);}
 };
 const saveCapacity=async(e:FormEvent,licenseId:string)=>{e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');setCapacitySaved('');try{await api(`/customers/${customerId}/device-capacity`,{method:'PATCH',body:JSON.stringify({licenseId,maxDevices:Number(pcCount)})});setCapacitySaved('Seçilmiş POS üçün kompüter sayı saxlanıldı.');await load();}catch(e){setError(e instanceof Error?e.message:'Kompüter sayı saxlanılmadı');}finally{lock.current=false;setBusy(false);}};
 return <section className="card owner-pos-manager" aria-label="Sahibkarın POS və filialları">
  <div className="owner-pos-heading"><div><h2>POS-lar və filiallar</h2><p className="muted">Bir sahibkar, bir e-poçt. Ayrı Restoran, Market və digər POS-lar bu hesabdan idarə olunur.</p></div><button type="button" className="btn primary" disabled={busy||!data?.customer.active} onClick={()=>{setOpen(!open);setIssued(null);}}>+ POS və filial əlavə et</button></div>
  {error&&<p className="error" role="alert">{error} <button type="button" className="btn" onClick={()=>void load()}>Yenidən yoxla</button></p>}
  {!data&&!error&&<p>POS-lar yüklənir…</p>}
  {data&&<div className="owner-pos-list">{data.licenses.map(l=><article key={l.id}><button type="button" className="owner-pos-select" aria-pressed={selectedLicense===l.id} onClick={()=>{setSelectedLicense(selectedLicense===l.id?'':l.id);setPcCount(String(l.seats));setCapacitySaved('');}}><strong>{products[l.product]||l.product}</strong><span>{data.branches.find(b=>b.id===l.branchId)?.name||'Filial hələ təyin edilməyib'}</span><small>{l.status==='active'&&(!l.validUntil||Date.parse(l.validUntil)>Date.now())?'Aktiv':'Aktiv deyil'} · {l.seats} kompüter · {l.validUntil?new Date(l.validUntil).toLocaleDateString('az-AZ'):'Müddətsiz'}</small></button>{selectedLicense===l.id&&<div className="owner-pos-detail"><p>Bu POS <strong>{data.customer.email}</strong> hesabına bağlıdır. Aktivləşdirilən kassalar {data.branches.find(b=>b.id===l.branchId)?.name||'seçilən filial'} daxilində görünür. Digər filialların anbarına tətbiqin Filiallar bölməsindən keçə bilərsiniz.</p><form onSubmit={e=>void saveCapacity(e,l.id)}><label>Bu POS üçün kompüter sayı<input type="number" min={1} max={100000} required value={pcCount} onChange={e=>setPcCount(e.target.value)}/></label><button className="btn" disabled={busy}>Kompüter sayını saxla</button></form>{capacitySaved&&<p role="status">{capacitySaved}</p>}<BillingAccessControls customerId={customerId} product={l.product} onChanged={()=>void load()}/></div>}</article>)}</div>}
  {open&&<form className="form-grid owner-pos-form" onSubmit={save}>
   <p className="span-2">Giriş e-poçtu: <strong>{data?.customer.email}</strong>. Mövcud giriş və parol saxlanılır.</p>
   <label>POS növü<select aria-label="POS növü" value={product} onChange={e=>setProduct(e.target.value as Product)}>{Object.entries(products).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <label>Filial<select aria-label="Filial" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">+ Yeni filial</option>{data?.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   {!branch&&<label className="span-2">Yeni filialın adı<input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={120} required placeholder="Məsələn, Nərimanov restoranı"/></label>}
   <label>Müddət (gün)<input type="number" min={1} max={36500} required value={days} onChange={e=>setDays(e.target.value)}/></label>
   <label>Kompüter sayı<input type="number" min={1} max={100000} required value={seats} onChange={e=>setSeats(e.target.value)}/></label>
   {(product==='restaurant'||product==='market')&&<label>Aylıq haqq · ₼<input inputMode="decimal" value={monthlyFee} onChange={e=>setMonthlyFee(e.target.value)} placeholder="Mövcud abunəlik varsa boş saxlayın"/><small>Həmin proqram üzrə mövcud aylıq haqq saxlanılır.</small></label>}
   <div className="span-2 button-row"><button className="btn primary" disabled={busy}>{busy?'Əlavə edilir…':'POS-u əlavə et'}</button><button type="button" className="btn" disabled={busy} onClick={()=>setOpen(false)}>Bağla</button></div>
  </form>}
  {issued&&<div className="owner-pos-issued" role="status"><strong>{products[issued.product]} əlavə edildi</strong><p>Yeni POS-u bu sahibkarın e-poçtu və mövcud parolu ilə açın. Aktivasiya açarı:</p><code>{issued.activationKey}</code><button type="button" className="btn" onClick={()=>void navigator.clipboard.writeText(issued.activationKey)}>Açarı kopyala</button></div>}
 </section>;
}
