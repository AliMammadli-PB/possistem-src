import {useEffect,useRef,useState} from 'react';
import {api} from '../lib/api';
type Props={customerId:string;product:string;onChanged?:()=>void};
export function BillingAccessControls({customerId,product,onChanged}:Props){
 const [days,setDays]=useState(7),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const pending=useRef<{key:string;id:string}|null>(null),lock=useRef(false),scope=useRef('');scope.current=customerId+':'+product;
 useEffect(()=>{setNotice('');setError('');pending.current=null;},[customerId,product]);
 async function run(action:'trial'|'free'|'subscription'|'delete'){
  if(lock.current)return;
  if(action==='delete'&&!window.confirm('Abunəlik aktiv siyahıdan silinsin? POS abunəsiz işləyəcək. Ödəniş tarixçəsi saxlanılır və avtomatik tutulma dayandırılır.'))return;
  if(action==='free'&&!window.confirm('Bu POS üçün abunə məcburiyyəti götürülsün? Avtomatik tutulma dayanacaq.'))return;
  if(action==='subscription'&&!window.confirm('Aylıq abunə məcburiyyəti bərpa edilsin? Ödənilmiş müddət bitibsə ödəniş tələb olunacaq.'))return;
  const selected=scope.current,key=selected+':'+action+':'+days;
  if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()};
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{const result=await api<{trialUntil:string|null}>('/admin/billing/access',{method:'POST',body:JSON.stringify({customerId,product,action,...(action==='trial'?{days}:{}),reason:'Admin panelindən '+action,requestId:pending.current.id})});if(scope.current!==selected)return;pending.current=null;setNotice(action==='trial'?'Pulsuz istifadə verildi: '+new Date(result.trialUntil!).toLocaleString('az-AZ'):action==='subscription'?'Abunə məcburiyyəti bərpa edildi.':'Abunəsiz istifadə açıldı; avtomatik tutulma dayandı.');onChanged?.();}catch(e){if(scope.current===selected)setError(e instanceof Error?e.message:'Əməliyyat alınmadı.');}finally{lock.current=false;setBusy(false);}
 }
 return <div className="billing-access-controls"><strong>POS istifadə icazəsi</strong><div className="billing-access-trial"><label>Pulsuz gün<input aria-label="Pulsuz istifadə günləri" type="number" min={1} max={365} value={days} disabled={busy} onChange={e=>setDays(Number(e.target.value))}/></label><button type="button" disabled={busy||!Number.isInteger(days)||days<1||days>365} onClick={()=>void run('trial')}>Pulsuz gün ver</button></div><div className="button-row"><button type="button" disabled={busy} onClick={()=>void run('free')}>Abunəsiz istifadəyə aç</button><button type="button" disabled={busy} onClick={()=>void run('subscription')}>Aylıq abunəni bərpa et</button><button type="button" disabled={busy} onClick={()=>void run('delete')}>Abunəliyi sil</button></div>{busy&&<p role="status">Saxlanılır…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}</div>;
}
