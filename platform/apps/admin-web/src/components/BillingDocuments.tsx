import {useEffect,useState} from 'react';
import {api,getAdminSessionToken} from '../lib/api';

type Detail={order:{order_no:string;status:string;amount_minor:number|string;paid_at:string|null};invoice:{buyer:{name:string;email:string;contactPerson:string;phone:string};payment:{transaction_id:string|null;rrn:string|null;card_mask:string|null}|null;consent:{accepted_at:string;withdrawn_at:string|null;terms_version:string}|null}};
const date=(at:string|null)=>at?new Date(at).toLocaleString('az-AZ',{timeZone:'Asia/Baku',hour12:false}):'Qeyd yoxdur';
export function BillingDocuments({id,onClose}:{id:string;onClose:()=>void}){
 const [data,setData]=useState<Detail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
 useEffect(()=>{let live=true;api<Detail>('/admin/billing/orders/'+id).then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[id]);
 async function download(kind:string){
  if(busy)return;setBusy(kind);setError('');
  try{
   const token=getAdminSessionToken(),res=await fetch(`/pos/api/admin/billing/orders/${id}/document.pdf?kind=${kind}`,{credentials:'same-origin',headers:token?{'x-admin-session':token}:{}});
   if(!res.ok||!res.headers.get('content-type')?.includes('application/pdf')){const body=await res.json().catch(()=>null);throw new Error(body?.message||body?.error||'PDF yüklənmədi. Girişinizi yoxlayın.');}
   const url=URL.createObjectURL(await res.blob()),a=document.createElement('a');a.href=url;a.download=`Possistem-${kind}-${id}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(e){setError(e instanceof Error?e.message:'PDF yüklənmədi.');}finally{setBusy('');}
 }
 return <section className="bill-panel"><header><h2>Faktura və təsdiq sənədləri</h2><button onClick={onClose}>Bağla</button></header>{error&&<p role="alert" className="bill-alert error">{error}</p>}{!data&&!error&&<p>Yüklənir…</p>}{data&&<><p><strong>{data.invoice.buyer.contactPerson||data.invoice.buyer.name}</strong> · {data.invoice.buyer.name} · {data.invoice.buyer.email}</p><dl><div><dt>Faktura</dt><dd>{data.order.order_no}</dd></div><div><dt>Ödəniş · Bakı vaxtı</dt><dd>{date(data.order.paid_at)} · {(Number(data.order.amount_minor)/100).toFixed(2)} ₼</dd></div><div><dt>Epoint / RRN</dt><dd>{data.invoice.payment?.transaction_id||'—'} · {data.invoice.payment?.rrn||'—'}</dd></div><div><dt>Elektron qəbul</dt><dd>{date(data.invoice.consent?.accepted_at??null)}</dd></div>{data.invoice.consent?.withdrawn_at&&<div><dt>Razılıq geri götürülüb</dt><dd>{date(data.invoice.consent.withdrawn_at)}</dd></div>}</dl><div className="bill-actions">{[['invoice','Faktura PDF'],['agreement','Elektron razılıq PDF'],['evidence','Bank üçün sənəd paketi PDF']].map(([kind,label])=><button key={kind} disabled={Boolean(busy)} onClick={()=>void download(kind)}>{busy===kind?'Hazırlanır…':label}</button>)}</div><p>Şəxs adı hesab profilindən, ödəniş nəticəsi bank qeydlərindən götürülür. PDF elektron qəbul çıxarışıdır; imzalanmış müqavilə kimi göstərilmir.</p></>}</section>;
}
