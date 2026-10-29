import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingRequest } from '../api';
import { billingDate } from './BillingPage';

type Card={id:string;card_mask:string;created_at:string;last_used_at:string|null;source:'shop'|'subscription';product:string|null};
const product:Record<string,string>={market:'Market POS',restaurant:'Restoran POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS'};

/** Saved cards: shop cards pay later purchases without the bank page; subscription cards renew the plan. */
export default function CardsPage(){
  const [cards,setCards]=useState<Card[]|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState('');
  const load=useCallback(async()=>{try{setCards((await billingRequest<{cards:Card[]}>('/cards')).cards);setError('');}catch(e){setError(e instanceof Error?e.message:'Kartlar yüklənmədi.');}},[]);
  useEffect(()=>{void load();},[load]);
  async function remove(c:Card){
    if(busy||!window.confirm(c.card_mask+' kartı silinsin? Növbəti alışda kart məlumatlarını bank səhifəsində yenidən daxil edəcəksiniz.'))return;
    setBusy(c.id);setError('');
    try{await billingRequest('/cards/'+c.id,{method:'DELETE'});setMessage('Kart silindi.');await load();}catch(e){setError(e instanceof Error?e.message:'Kart silinmədi.');}finally{setBusy('');}
  }
  return <div className="bill-page">
    <header className="bill-heading"><div><span className="bill-eyebrow">HESAB VƏ ÖDƏNİŞLƏR</span><h1>Kartlarım</h1><p>Yadda saxladığınız kartlar. Kart nömrəsi bizdə saxlanmır: yalnız maskalanmış nömrə və bankın (Epoint) verdiyi şifrələnmiş açar saxlanılır.</p></div><button type="button" onClick={()=>void load()} disabled={Boolean(busy)}>↻ Yenilə</button></header>
    {error&&<p className="bill-alert error" role="alert">{error}</p>}{message&&<p className="bill-alert" role="status">{message}</p>}
    {!cards&&!error&&<p role="status">Kartlar yüklənir…</p>}
    {cards&&!cards.length&&<section className="bill-panel bill-empty"><h2>Saxlanmış kartınız yoxdur</h2><p>Mağazada ödəniş edərkən “Kartımı növbəti alışlar üçün yadda saxla” seçin — növbəti alışlarınız bank səhifəsi açılmadan bir kliklə ödəniləcək.</p><a href="/mehsul/avadanliq/">Mağazaya keç →</a></section>}
    {cards&&cards.length>0&&<div className="bill-cards">{cards.map(c=><section className="bill-panel bill-card" key={c.source+c.id}>
      <div className="bill-card-face" aria-hidden="true"><span>possistem</span><strong>{c.card_mask.replace(/\*+/,' •••• •••• ')}</strong></div>
      <dl><div><dt>İstifadə</dt><dd>{c.source==='shop'?'Mağaza alışları':(product[c.product??'']??'POS')+' · aylıq abunə'}</dd></div><div><dt>Əlavə edilib</dt><dd>{billingDate(c.created_at)}</dd></div><div><dt>Son istifadə</dt><dd>{billingDate(c.last_used_at)}</dd></div></dl>
      {c.source==='shop'?<button type="button" className="bill-text-button" disabled={Boolean(busy)} onClick={()=>void remove(c)}>{busy===c.id?'Silinir…':'Kartı sil'}</button>
        :<p className="bill-muted">Bu kart abunəliyin avtomatik yenilənməsi üçündür. Dayandırmaq üçün <Link to="/abunelik">Abunəlik</Link> bölməsindən ləğv sorğusu göndərin.</p>}
    </section>)}</div>}
  </div>;
}
