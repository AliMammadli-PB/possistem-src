import {useCallback,useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {marketCoreClient} from './core/client';
import type {Lang} from './types';
import './users1568.css';
const money=(minor:number,lang:Lang)=>new Intl.NumberFormat(lang==='ru'?'ru-RU':lang==='en'?'en-GB':'az-AZ',{style:'currency',currency:'AZN'}).format(minor/100);

/** Real COGS report: sales profit is separate from manually entered other income. */
export function ProfitSummary({lang}:{lang:Lang}){
 const t=(az:string,ru:string,en:string)=>lang==='ru'?ru:lang==='en'?en:az;
 const [period,setPeriod]=useState('day'),[data,setData]=useState<{revenue:number;cost:number}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{setBusy(true);try{const start=new Date();start.setHours(0,0,0,0);if(period==='month')start.setDate(1);const rows=await marketCoreClient.reports.profit(period==='all'?undefined:start.getTime(),period==='all'?undefined:Date.now());const list=Array.isArray(rows)?rows:[];setData({revenue:list.reduce((n,r)=>n+Number(r.revenueMinor||0),0),cost:list.reduce((n,r)=>n+Number(r.cogsMinor||0),0)});setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}},[period]);
 useEffect(()=>{setData(null);void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load]);
 return <section className="market-profit-summary"><header className="users-section-heading"><div><h2>{t('Satış mənfəəti','Прибыль от продаж','Sales profit')}</h2><p>{t('Tamamlanmış satışlar, qaytarmalar və uçota alınmış maya əsasında. Əməliyyat xərcləri bu məbləğdən çıxılmayıb.','По завершённым продажам, возвратам и учтённой себестоимости. Операционные расходы не вычтены.','Completed sales less returns and recorded cost. Operating expenses are not deducted.')}</p></div><select aria-label={t('Hesabat dövrü','Период отчёта','Report period')} value={period} onChange={e=>setPeriod(e.target.value)}><option value="day">{t('Bu gün','Сегодня','Today')}</option><option value="month">{t('Bu ay','Этот месяц','This month')}</option><option value="all">{t('Bütün dövr','Весь период','All time')}</option></select><button disabled={busy} onClick={()=>void load()}><RefreshCw/>{t('Yenilə','Обновить','Refresh')}</button></header>
 {error&&<p className="form-error" role="alert">{error}</p>}<div className="market-profit-metrics">{[[t('Satış gəliri','Выручка','Sales revenue'),data?.revenue],[t('Satılan malın mayası','Себестоимость продаж','Cost of goods sold'),data?.cost],[t('Satış mənfəəti','Прибыль от продаж','Sales profit'),data?data.revenue-data.cost:undefined]].map(([label,value])=><article key={label}><span>{label}</span><strong>{value==null?'—':money(Number(value),lang)}</strong></article>)}</div>
 <p className="users-note">{t('Əlavə gəlir qaimələri aşağıdadır. Satış mənfəətini yenidən gəlir kimi yazmaq lazım deyil.','Ниже — документы прочих доходов. Прибыль от продаж повторно вносить не нужно.','Other income documents are below. Do not enter sales profit again as income.')}</p></section>;
}
