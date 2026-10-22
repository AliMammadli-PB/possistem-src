import {useEffect, useMemo, useRef, useState} from 'react';
import {Check, ChevronLeft, ChevronRight, ReceiptText, RotateCcw, Search, X} from 'lucide-react';
import {marketCoreClient} from './core/client';
import {money} from './format';
import {Modal} from './forms';
import {tr} from './i18n';
import type {CartLine, Lang, PersistedState, Sale, StaffProfile} from './types';
import './returns1560.css';

/** A lookup hint, not a unique sale identity: always confirm the date and amount. */
export const receiptLookupCode = (receiptNo: string): string => receiptNo.match(/\d+$/)?.[0] || receiptNo;
export const normalizeReceiptSearch = (query: string): string => query.replace(/[\s-]+/g,'').toLowerCase();
const PAGE_SIZE=50;
const remaining = (sale:Sale) => Math.max(0,sale.totalMinor-(sale.refunds ?? []).flatMap(r=>r.lines).reduce((sum,l)=>sum+l.amountMinor,0));

export function ReturnsPage({state,staff,lang,coreReady,onRefund}:{state:PersistedState;staff:StaffProfile[];lang:Lang;coreReady:boolean;onRefund:(sale:Sale)=>Promise<void>}) {
 const t=(az:string,ru:string,en:string)=>lang==='ru'?ru:lang==='en'?en:az;
 const [query,setQuery]=useState(''),[date,setDate]=useState(''),[page,setPage]=useState(0),[tick,setTick]=useState(0);
 const [rows,setRows]=useState<Sale[]>([]),[hasMore,setHasMore]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [selected,setSelected]=useState<Sale|null>(null),[busy,setBusy]=useState(false),[refundError,setRefundError]=useState('');
 const lock=useRef(false),searchRef=useRef<HTMLInputElement>(null);
 const products=useMemo(()=>new Map(state.products.map(p=>[p.id,p])),[state.products]);
 const when=(at:number)=>new Date(at).toLocaleString(lang==='ru'?'ru-RU':lang==='en'?'en-GB':'az-AZ');
 useEffect(()=>{
  let live=true;setLoading(true);setError('');
  const timer=window.setTimeout(()=>void(async()=>{
   try{
    const since=date?new Date(date+'T00:00:00').getTime():0;
    const end=date?new Date(date+'T00:00:00'):null;if(end)end.setDate(end.getDate()+1);
    const before=end?.getTime();
    const result=coreReady&&marketCoreClient.available()
     ?await marketCoreClient.sales.list({query:query.trim(),since,before,offset:page*PAGE_SIZE,limit:PAGE_SIZE+1})
     :state.sales.filter(s=>(!query||normalizeReceiptSearch(s.receiptNo).includes(normalizeReceiptSearch(query)))&&s.createdAt>=since&&(!before||s.createdAt<before)).sort((a,b)=>b.createdAt-a.createdAt).slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE+1);
    if(live){setRows(result.slice(0,PAGE_SIZE));setHasMore(result.length>PAGE_SIZE);}
   }catch(e){if(live)setError(e instanceof Error?e.message:String(e));}
   finally{if(live)setLoading(false);}
  })(),query?200:0);
  return()=>{live=false;window.clearTimeout(timer)};
 },[query,date,page,tick,state.sales,coreReady]);
 useEffect(()=>{if(!selected)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!lock.current){setSelected(null);searchRef.current?.focus();}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[selected]);
 const open=(sale:Sale)=>{setSelected(sale);setRefundError('')};
 const close=()=>{if(!lock.current){setSelected(null);searchRef.current?.focus()}};
 const confirm=async()=>{
  if(!selected||selected.refunded||lock.current)return;
  lock.current=true;setBusy(true);setRefundError('');
  try{await onRefund(selected);setSelected(null);setTick(n=>n+1);searchRef.current?.focus();}
  catch(e){setRefundError(e instanceof Error?e.message:String(e));}
  finally{lock.current=false;setBusy(false);}
 };
 return <div className="module-page market-returns">
  <header className="returns-heading"><span className="returns-mark"><RotateCcw size={30}/></span><div><h2>{tr(lang,'returns')}</h2><p>{t('Çeki tapın, məbləği yoxlayın və qaytarmanı təsdiqləyin.','Найдите чек, проверьте сумму и подтвердите возврат.','Find the receipt, check the amount and confirm the return.')}</p></div><button type="button" className="returns-refresh" disabled={loading} onClick={()=>setTick(n=>n+1)}><RotateCcw size={19}/>{t('Yenilə','Обновить','Refresh')}</button></header>
  <section className="returns-find" aria-label={t('Çek axtarışı','Поиск чека','Find a receipt')}>
   <label className="returns-query"><span>{t('Qaytarma kodu və ya çek nömrəsi','Код возврата или номер чека','Return code or receipt number')}</span><div><Search size={22}/><input ref={searchRef} autoFocus value={query} maxLength={120} onChange={e=>{setQuery(e.target.value);setPage(0)}} placeholder={t('Son rəqəmləri yazın və ya çeki skan edin','Последние цифры или сканирование чека','Type the last digits or scan the receipt')}/>{query&&<button type="button" aria-label={t('Axtarışı təmizlə','Очистить поиск','Clear search')} onClick={()=>{setQuery('');setPage(0);searchRef.current?.focus()}}><X/></button>}</div></label>
   <label className="returns-date"><span>{t('Satış tarixi','Дата продажи','Sale date')}</span><input type="date" value={date} onChange={e=>{setDate(e.target.value);setPage(0)}}/></label>
   {date&&<button type="button" onClick={()=>{setDate('');setPage(0)}}>{t('Bütün tarixlər','Все даты','All dates')}</button>}
   <p>{t('Uzun kodu tam yazmaq lazım deyil. Eyni son rəqəmlərlə bir neçə çek çıxa bilər — tarix və məbləğə görə seçin.','Полный код не нужен. Последние цифры могут совпадать — выберите чек по дате и сумме.','You do not need the full code. Last digits may match several receipts — choose by date and amount.')}</p>
  </section>
  {loading&&<p className="returns-status" role="status">{t('Çeklər axtarılır…','Поиск чеков…','Finding receipts…')}</p>}
  {error&&<div className="returns-error" role="alert">{error}<button type="button" onClick={()=>setTick(n=>n+1)}>{tr(lang,'retry')}</button></div>}
  {!loading&&!error&&!rows.length&&<div className="returns-empty"><ReceiptText size={40}/><h3>{t('Çek tapılmadı','Чек не найден','No receipts found')}</h3><p>{t('Kodu və tarixi yoxlayın. Bu kassada edilmiş satışlar göstərilir.','Проверьте код и дату. Показаны продажи этой кассы.','Check the code and date. Sales made at this till are shown.')}</p></div>}
  {!error&&<div className="returns-receipts" aria-busy={loading}>{rows.map(sale=><article key={sale.id} className={sale.refunded?'is-returned':''}>
   <div className="returns-code"><small>{t('Qaytarma kodu','Код возврата','Return code')}</small><strong>{receiptLookupCode(sale.receiptNo)}</strong></div>
   <div className="returns-receipt-copy"><h3>{sale.receiptNo}</h3><time>{when(sale.createdAt)}</time><p>{sale.customerName||state.registers.find(r=>r.id===sale.registerId)?.name||'—'} · {sale.items.length} {t('sətir','строк','lines')}</p></div>
   <div className="returns-amount"><strong>{money(sale.refunded?sale.totalMinor:remaining(sale),lang)}</strong><span>{sale.refunded?t('Qaytarılıb','Возвращён','Returned'):sale.refunds?.length?t('Qalan məbləğ','Остаток','Remaining'):tr(lang,sale.payment.method)}</span></div>
   <button type="button" disabled={loading} onClick={()=>open(sale)}><ReceiptText size={20}/>{t('Bax və qaytar','Просмотр и возврат','View and return')}</button>
  </article>)}</div>}
  <nav className="returns-pages" aria-label={t('Çek səhifələri','Страницы чеков','Receipt pages')}><button type="button" disabled={loading||page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}><ChevronLeft/>{t('Əvvəlki','Назад','Previous')}</button><span>{page+1}</span><button type="button" disabled={loading||!hasMore} onClick={()=>setPage(p=>p+1)}>{t('Sonrakı','Далее','Next')}<ChevronRight/></button></nav>
  {selected&&<Modal title={t('Geri qaytarmanı yoxlayın','Проверьте возврат','Review the return')} subtitle={selected.receiptNo} wide onClose={close}>
   <div className="returns-review"><div className="returns-review-code"><span>{t('Qaytarma kodu','Код возврата','Return code')}</span><b>{receiptLookupCode(selected.receiptNo)}</b><time>{when(selected.createdAt)}</time></div>
   <dl><div><dt>{t('Kassa','Касса','Till')}</dt><dd>{state.registers.find(r=>r.id===selected.registerId)?.name||selected.registerId}</dd></div><div><dt>{t('Kassir','Кассир','Cashier')}</dt><dd>{staff.find(s=>s.id===selected.cashierId)?.name||'—'}</dd></div><div><dt>{t('Ödəniş','Оплата','Payment')}</dt><dd>{tr(lang,selected.payment.method)}</dd></div></dl>
   <div className="returns-review-items">{selected.items.map((line,index)=>{const original=line as CartLine&{lineTotalMinor?:number};return <div key={line.saleItemId??index}><span>{products.get(line.productId)?.name[lang]||products.get(line.productId)?.name.az||t('Məhsul','Товар','Product')}<small>× {line.qtyMilli?line.qtyMilli/1000:line.qty}</small></span><b>{original.lineTotalMinor==null?'—':money(original.lineTotalMinor,lang)}</b></div>})}</div>
   <div className="returns-review-total"><span>{selected.refunded?t('Qaytarılmış çek','Возвращённый чек','Returned receipt'):t('Qaytarılacaq məbləğ','Сумма возврата','Return amount')}</span><strong>{money(selected.refunded?0:remaining(selected),lang)}</strong></div>
   {!selected.refunded&&<p className="returns-review-note">{t('Çekin qalan məhsulları anbara qayıdacaq; kassa və varsa müştəri borcu uyğun yenilənəcək. Əməliyyat müdir təsdiqi ilə tamamlanır.','Оставшиеся товары вернутся на склад; касса и долг клиента обновятся. Требуется подтверждение руководителя.','The remaining goods return to stock; the till and any customer debt are updated. Manager approval is required.')}</p>}
   {refundError&&<p role="alert" className="returns-error">{refundError}</p>}
   <div className="returns-review-actions"><button type="button" disabled={busy} onClick={close}>{t('Bağla','Закрыть','Close')}</button>{!selected.refunded&&<button type="button" className="returns-confirm" disabled={busy} onClick={()=>void confirm()}><Check/>{busy?t('Təsdiqlənir…','Подтверждение…','Confirming…'):t('Qaytarmanı təsdiqlə','Подтвердить возврат','Confirm return')}</button>}</div>
   </div>
  </Modal>}
 </div>;
}
