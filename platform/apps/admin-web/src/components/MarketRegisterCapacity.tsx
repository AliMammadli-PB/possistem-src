import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api} from '../lib/api';
import './MarketRegisterCapacity.css';
type Capacity={licenseId:string;capacity:number;used:number;available:number};
export function MarketRegisterCapacity({customerId,customerName,onSaved}:{customerId:string;customerName:string;onSaved?:(result:Capacity)=>void}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Capacity|null>(null),[amount,setAmount]=useState('1'),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),title=useId();
 useEffect(()=>{if(!open)return;let live=true;setLoading(true);setError('');setNotice('');setAmount('1');setData(null);
  void api<Capacity>(`/market-pos/customers/${customerId}/registers`).then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'PC limitini almaq olmadı');}).finally(()=>{if(live)setLoading(false);});
  const previous=document.activeElement as HTMLElement|null;
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!lock.current)setOpen(false);};window.addEventListener('keydown',key);
  return()=>{live=false;window.removeEventListener('keydown',key);previous?.focus();};
 },[open,customerId]);
 const valid=Number.isInteger(Number(amount))&&Number(amount)>=1&&Number(amount)<=20;
 const save=async(event:React.FormEvent)=>{event.preventDefault();if(lock.current||!data||!valid)return;lock.current=true;setSaving(true);setError('');setNotice('');
  try{const result=await api<{capacity:number}>(`/market-pos/customers/${customerId}/register-capacity`,{method:'POST',body:JSON.stringify({amount:Number(amount)})});const next={...data,capacity:result.capacity,available:Math.max(0,result.capacity-data.used)};setData(next);setNotice(`PC limiti ${result.capacity} oldu. Əlavə kompüterdə bu hesabla daxil ola bilərsiniz.`);onSaved?.(next);setAmount('1');}
  catch(e){setError(e instanceof Error?e.message:'PC limitini saxlamaq olmadı');try{setData(await api<Capacity>(`/market-pos/customers/${customerId}/registers`));}catch{/* Preserve the last known capacity and show the save error. */}}
  finally{lock.current=false;setSaving(false);}
 };
 return <><button type="button" className="btn pc-capacity-trigger" onClick={()=>{setError('');setNotice('');setData(null);setLoading(true);setOpen(true);}}>+ PC əlavə et</button>{open&&createPortal(<div className="pc-capacity-overlay" onClick={e=>{if(e.target===e.currentTarget&&!saving)setOpen(false);}}><section className="pc-capacity-panel" role="dialog" aria-modal="true" aria-labelledby={title}>
  <header><div><p>MARKET POS · KOMPÜTERLƏR</p><h2 id={title}>PC limitini artır</h2><span>{customerName}</span></div><button type="button" className="btn secondary" aria-label="Bağla" disabled={saving} onClick={()=>setOpen(false)}>✕</button></header>
  {loading?<p role="status">PC məlumatları yüklənir…</p>:null}
  {data?<><div className="pc-capacity-counts"><div><span>Ümumi limit</span><strong>{data.capacity}</strong></div><div><span>Aktiv PC</span><strong>{data.used}</strong></div><div><span>Boş yer</span><strong>{data.available}</strong></div></div><form onSubmit={e=>void save(e)}><label htmlFor={title+'-amount'}>Əlavə ediləcək PC sayı</label><input id={title+'-amount'} autoFocus type="number" inputMode="numeric" min="1" max="20" step="1" value={amount} disabled={saving} onChange={e=>setAmount(e.target.value)}/><p className="pc-capacity-help">Mövcud {data.capacity} yerə {valid?amount:'…'} yer əlavə ediləcək. Yeni limit: <b>{valid?data.capacity+Number(amount):'—'}</b>.</p><button className="btn" type="submit" disabled={saving||!valid}>{saving?'Saxlanılır…':'PC limitini artır'}</button></form></>:null}
  {error?<p className="pc-capacity-error" role="alert">{error}</p>:null}{notice?<p className="pc-capacity-success" role="status">{notice}</p>:null}
 </section></div>,document.body)}</>;
}
