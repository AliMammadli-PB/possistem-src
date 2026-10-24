'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import { formatManat } from '@/lib/money';
import { packageTotals, type Billing } from '@/lib/package-totals';
import { EditableNumberInput } from './EditableNumberInput';

type Text = { az: string; en: string; ru: string };
type Item = {id:string;kind:'base'|'toggle'|'quantity'|'printers';billing?:Billing;name:Text;description:Text;unit:Text;priceMinor:number;min:number;max:number;defaultQty:number;defaultOn:boolean;active:boolean};
type Content = {items:Item[];printerTargets:Text[];whatsappPhone:string;note:Text};
const COPY = {
  az: { title:'Paketinizi özünüz qurun',lead:'Lazım olan imkanları və avadanlıq sayını seçin. Aylıq xidmətlər və birdəfəlik alışlar ayrıca hesablanır.',monthly:'Aylıq',once:'Bir dəfə',monthlyTotal:'Aylıq ödəniş',onceTotal:'Birdəfəlik ödəniş',first:'İlk ödəniş',included:'Daxildir',qty:'Say',name:'Printerin adı',target:'Çap təyinatı',order:'WhatsApp ilə sorğu göndər',request:'Paket üzrə qiymət sorğusu',note:'İlk ödəniş: birinci ay və birdəfəlik alışlar. Birdəfəlik alış növbəti aylarda təkrar hesablanmır.',error:'Paket seçimləri yüklənmədi.',retry:'Yenidən yoxla',loading:'Paket seçimləri yüklənir…',per:'/ ay',each:' / ədəd',summary:'Seçiminiz',invalid:'Say icazə verilən aralıqda olmalıdır.' },
  en: {title:'Build your package',lead:'Choose the features and equipment quantities you need. Monthly services and one-time purchases are calculated separately.',monthly:'Monthly',once:'One time',monthlyTotal:'Monthly payment',onceTotal:'One-time payment',first:'First payment',included:'Included',qty:'Quantity',name:'Printer name',target:'Print destination',order:'Request on WhatsApp',request:'Package quote request',note:'First payment: the first month plus one-time purchases. One-time purchases are not charged in subsequent months.',error:'Package options could not be loaded.',retry:'Retry',loading:'Loading package options…',per:'/ month',each:' / item',summary:'Your selection',invalid:'Enter a quantity within the allowed range.'},
  ru: {title:'Соберите свой пакет',lead:'Выберите нужные функции и количество оборудования. Ежемесячные услуги и разовые покупки считаются отдельно.',monthly:'Ежемесячно',once:'Один раз',monthlyTotal:'Ежемесячный платёж',onceTotal:'Разовый платёж',first:'Первый платёж',included:'Включено',qty:'Количество',name:'Название принтера',target:'Назначение печати',order:'Запросить в WhatsApp',request:'Запрос стоимости пакета',note:'Первый платёж: первый месяц и разовые покупки. Разовые покупки не оплачиваются повторно в следующие месяцы.',error:'Не удалось загрузить варианты пакета.',retry:'Повторить',loading:'Загрузка вариантов пакета…',per:'/ мес',each:' / шт.',summary:'Ваш выбор',invalid:'Введите количество в допустимом диапазоне.'},
};

export function PackageBuilder() {
  const {language}=useI18n(), copy=COPY[language];
  const [content,setContent]=useState<Content|null>(null);
  const [quantities,setQuantities]=useState<Record<string,number>>({});
  const [printers,setPrinters]=useState<Record<string,{name:string;target:number}[]>>({});
  const [error,setError]=useState(false), [attempt,setAttempt]=useState(0);
  const root=useRef<HTMLElement>(null);
  const txt=(value:Text)=>value[language]||value.az;
  useEffect(()=>{
    const controller=new AbortController();setError(false);
    fetch('/pos/api/package-builder',{credentials:'omit',cache:'no-store',signal:controller.signal})
      .then(response=>{if(!response.ok)throw new Error('Package options unavailable');return response.json() as Promise<Content>;})
      .then(data=>{
        if(!Array.isArray(data.items)||!Array.isArray(data.printerTargets))throw new Error('Invalid package options');
        const items=data.items.filter(item=>item.active);
        setContent({...data,items});
        setQuantities(Object.fromEntries(items.map(item=>[item.id,item.kind==='base'?1:item.kind==='toggle'?Number(item.defaultOn):Math.max(item.min,Math.min(item.max,item.defaultQty))])));
      }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[attempt]);
  if(!content)return <section className="package-builder" aria-live="polite"><p>{error?copy.error:copy.loading}</p>{error?<button className="marketing-button secondary" onClick={()=>setAttempt(attempt+1)}>{copy.retry}</button>:null}</section>;
  const lines=content.items.map(item=>({item,qty:quantities[item.id]??0}));
  const totals=packageTotals(lines.map(({item,qty})=>({priceMinor:item.priceMinor,quantity:qty,billing:item.billing})));
  const money=(minor:number)=>formatManat(minor/100,language);
  const billing=(item:Item)=>item.billing==='one_time'?copy.once:copy.monthly;
  const message=[copy.request,...lines.filter(line=>line.qty>0).flatMap(({item,qty})=>[
    `${txt(item.name)} × ${qty}: ${money(item.priceMinor*qty)} (${billing(item)})`,
    ...(item.kind==='printers'?Array.from({length:qty},(_,i)=>{
      const printer=printers[item.id]?.[i];
      return `  ${i+1}. ${printer?.name||''}${content.printerTargets[printer?.target??0]?` — ${txt(content.printerTargets[printer?.target??0])}`:''}`;
    }):[]),
  ]),`${copy.monthlyTotal}: ${money(totals.monthlyMinor)}`,`${copy.onceTotal}: ${money(totals.oneTimeMinor)}`,`${copy.first}: ${money(totals.firstPaymentMinor)}`].join('\n');
  const updatePrinter=(id:string,index:number,patch:Partial<{name:string;target:number}>)=>setPrinters(current=>{
    const rows=[...(current[id]??[])];rows[index]={...(rows[index]??{name:'',target:0}),...patch};return {...current,[id]:rows};
  });
  return <section className="package-builder" id="paket-qurucu" ref={root} aria-labelledby="package-builder-title">
    <header><h3 id="package-builder-title">{copy.title}</h3><p>{copy.lead}</p></header>
    <div className="package-builder-layout"><div className="package-options">
      {lines.map(({item,qty})=><article className={`package-option${qty?' is-selected':''}`} key={item.id}>
        <div className="package-option-copy"><div className="package-option-heading"><h4>{txt(item.name)}</h4><span className={`package-billing${item.billing==='one_time'?' is-once':''}`}>{billing(item)}</span></div>
        <p>{txt(item.description)}</p></div>
        <div className="package-option-controls"><strong>{money(item.priceMinor)} <small>{item.billing==='one_time'?copy.once:copy.per}{item.kind==='quantity'||item.kind==='printers'?copy.each:''}</small></strong>
          {item.kind==='base'?<span>{copy.included}</span>:item.kind==='toggle'?<label className="package-toggle"><input type="checkbox" aria-label={txt(item.name)} checked={qty>0} onChange={event=>setQuantities({...quantities,[item.id]:Number(event.target.checked)})}/><span>{txt(item.name)}</span></label>:<label className="package-quantity">{copy.qty}<EditableNumberInput validationMessage={copy.invalid} value={qty} min={item.min} max={item.max} aria-label={`${txt(item.name)} — ${copy.qty}`} onValueChange={value=>setQuantities({...quantities,[item.id]:value})}/></label>}
        </div>
        {item.kind==='printers'?Array.from({length:qty},(_,index)=><div className="package-printer" key={index}><label>{copy.name} {index+1}<input required maxLength={60} value={printers[item.id]?.[index]?.name??''} onChange={event=>updatePrinter(item.id,index,{name:event.target.value})}/></label>{content.printerTargets.length?<label>{copy.target}<select value={printers[item.id]?.[index]?.target??0} onChange={event=>updatePrinter(item.id,index,{target:Number(event.target.value)})}>{content.printerTargets.map((target,i)=><option value={i} key={i}>{txt(target)}</option>)}</select></label>:null}</div>):null}
      </article>)}
    </div><aside className="package-summary" aria-live="polite"><h4>{copy.summary}</h4><dl>
      <div><dt>{copy.monthlyTotal}</dt><dd data-total="monthly">{money(totals.monthlyMinor)}</dd></div>
      <div><dt>{copy.onceTotal}</dt><dd data-total="one_time">{money(totals.oneTimeMinor)}</dd></div>
      <div className="package-first"><dt>{copy.first}</dt><dd data-total="first">{money(totals.firstPaymentMinor)}</dd></div>
    </dl><p>{copy.note}</p>{txt(content.note)?<p>{txt(content.note)}</p>:null}
    <a className="marketing-button primary" href={`https://wa.me/${content.whatsappPhone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" onClick={event=>{
      const invalid=root.current?.querySelector<HTMLInputElement>('input:invalid');if(invalid){event.preventDefault();invalid.focus();invalid.reportValidity();}
    }}>{copy.order}</a></aside></div>
  </section>;
}
