'use client';
import { useReducedMotion } from '@/lib/browser-ui';
import { reportUiState } from '@/lib/ui-diagnostics';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import './hero-slider.css';

const SLIDES = [
  {
    "id": "01-restaurant",
    "system": "Restoran",
    "image": "/assets/hero-real-screens-20261022/01-restaurant.webp"
  },
  {
    "id": "02-market",
    "system": "Market",
    "image": "/assets/hero-real-screens-20261022/02-market.webp"
  },
  {
    "id": "16-manufacturing",
    "system": "İstehsalat",
    "image": "/assets/hero-sectors-20261027/16-manufacturing.webp"
  },
  {
    "id": "03-fashion",
    "system": "Geyim",
    "image": "/assets/hero-sectors-20261022/03-fashion.webp"
  },
  {
    "id": "04-pharmacy",
    "system": "Aptek",
    "image": "/assets/hero-sectors-20261022/04-pharmacy.webp"
  },
  {
    "id": "05-auto-parts",
    "system": "Avto hissələri",
    "image": "/assets/hero-sectors-20261022/05-auto-parts.webp"
  },
  {
    "id": "06-car-accessories",
    "system": "Avto aksesuarları",
    "image": "/assets/hero-sectors-20261022/06-car-accessories.webp"
  },
  {
    "id": "07-electronics",
    "system": "Elektronika",
    "image": "/assets/hero-sectors-20261022/07-electronics.webp"
  },
  {
    "id": "08-bakery",
    "system": "Çörək mağazası",
    "image": "/assets/hero-sectors-20261022/08-bakery.webp"
  },
  {
    "id": "09-florist",
    "system": "Gül mağazası",
    "image": "/assets/hero-sectors-20261022/09-florist.webp"
  },
  {
    "id": "10-cosmetics",
    "system": "Kosmetika",
    "image": "/assets/hero-sectors-20261022/10-cosmetics.webp"
  },
  {
    "id": "11-hardware",
    "system": "Tikinti materialları",
    "image": "/assets/hero-sectors-20261022/11-hardware.webp"
  },
  {
    "id": "12-wholesale",
    "system": "Topdansatış",
    "image": "/assets/hero-sectors-20261022/12-wholesale.webp"
  },
  {
    "id": "13-pet",
    "system": "Heyvan məhsulları",
    "image": "/assets/hero-sectors-20261022/13-pet.webp"
  },
  {
    "id": "14-books",
    "system": "Kitab mağazası",
    "image": "/assets/hero-sectors-20261022/14-books.webp"
  },
  {
    "id": "15-jewelry",
    "system": "Zərgərlik",
    "image": "/assets/hero-sectors-20261022/15-jewelry.webp"
  }
];
const COPY = {
  "az": {
    "label": "Biznesinizə uyğun Possistem",
    "previous": "Əvvəlki şəkil",
    "next": "Növbəti şəkil",
    "scenes": [
      "Masa, sifariş və hesab",
      "Məhsullar, satış və qalıq",
      "Xammal, istehsal və hazır məhsullar",
      "Ölçü, rəng və geyim satışı",
      "Dərman və məhsul uçotu",
      "Ehtiyat hissələri və model seçimi",
      "Avtomobil üçün aksesuarlar",
      "Kompüter və elektronika satışı",
      "Çörək, şirniyyat və gündəlik satış",
      "Buketlər və sifarişlər",
      "Kosmetika və qulluq məhsulları",
      "Alətlər və tikinti məhsulları",
      "Böyük sifarişlər və qaimələr",
      "Yem və qulluq məhsulları",
      "Kitab və dəftərxana məhsulları",
      "Zinət əşyaları və məhsul uçotu"
    ]
  },
  "en": {
    "label": "Possistem for your business",
    "previous": "Previous image",
    "next": "Next image",
    "scenes": [
      "Tables, orders and bills",
      "Products, sales and stock",
      "Materials, production and finished goods",
      "Sizes, colours and clothing",
      "Pharmacy product management",
      "Spare parts and vehicle models",
      "Car accessories and retail",
      "Computers and electronics",
      "Bread, pastries and daily sales",
      "Bouquets and orders",
      "Cosmetics and skincare",
      "Tools and building supplies",
      "Bulk orders and invoices",
      "Pet food and supplies",
      "Books and stationery",
      "Jewellery and product management"
    ]
  },
  "ru": {
    "label": "Possistem для вашего бизнеса",
    "previous": "Предыдущее изображение",
    "next": "Следующее изображение",
    "scenes": [
      "Столы, заказы и счета",
      "Товары, продажи и остатки",
      "Сырьё, производство и готовая продукция",
      "Размеры, цвета и одежда",
      "Учёт товаров в аптеке",
      "Запчасти и модели автомобилей",
      "Автомобильные аксессуары",
      "Компьютеры и электроника",
      "Хлеб, выпечка и продажи",
      "Букеты и заказы",
      "Косметика и уход",
      "Инструменты и стройматериалы",
      "Оптовые заказы и накладные",
      "Корма и зоотовары",
      "Книги и канцтовары",
      "Ювелирные изделия и учёт"
    ]
  }
};

type ImageState = 'pending' | 'loading' | 'ready' | 'failed';
const EMPTY_IMAGES = () => SLIDES.map(():ImageState=>'pending');
const INTERVAL = 4500;
export function HeroSlider(){
 const {language}=useI18n(),c=COPY[language],reduced=useReducedMotion();
 const [active,setActive]=useState(0),[outgoing,setOutgoing]=useState<number|null>(null),[direction,setDirection]=useState(1),[phase,setPhase]=useState<'still'|'prepared'|'moving'>('still');
 const [images,setImages]=useState<ImageState[]>(EMPTY_IMAGES),[attempt,setAttempt]=useState(0),[focused,setFocused]=useState(false),[visible,setVisible]=useState(true),[inView,setInView]=useState(true),[due,setDue]=useState(false);
 const keyboard=useRef(false);
 const region=useRef<HTMLDivElement>(null),touch=useRef<{x:number;y:number}|null>(null),lock=useRef(false);
 const pending=useRef(new Map<number,{image:HTMLImageElement;timer:number}>());
 const failed=images.flatMap((state,index)=>state==='failed'?[index]:[]);
 const seek=(step:number)=>{for(let offset=1;offset<SLIDES.length;offset++){const index=(active+step*offset+SLIDES.length)%SLIDES.length;if(images[index]!=='failed')return index;}return null;};
 const previous=seek(-1),next=seek(1),currentReady=images[active]==='ready',allFailed=failed.length===SLIDES.length;
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{if(event.key==='Tab')keyboard.current=true;};document.addEventListener('keydown',key);
  const visibility=()=>setVisible(document.visibilityState==='visible');visibility();document.addEventListener('visibilitychange',visibility);
  let observer:IntersectionObserver|null=null;
  const measure=()=>{const r=region.current?.getBoundingClientRect();setInView(!r||(r.bottom>0&&r.top<innerHeight));};
  if(typeof IntersectionObserver==='function'){observer=new IntersectionObserver(([entry])=>setInView(entry.isIntersecting));if(region.current)observer.observe(region.current);}
  else{measure();window.addEventListener('scroll',measure,{passive:true});window.addEventListener('resize',measure);}
  return()=>{observer?.disconnect();document.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);};
 },[]);
 useEffect(()=>()=>{pending.current.forEach(({image,timer})=>{image.onload=null;image.onerror=null;clearTimeout(timer);});pending.current.clear();},[attempt]);
 useEffect(()=>{
  const preload=new Set([active,(active+1)%SLIDES.length,(active+2)%SLIDES.length,(active+SLIDES.length-1)%SLIDES.length]);
  if(next!==null)preload.add(next);if(previous!==null)preload.add(previous);
  for(const index of preload){
   if(images[index]!=='pending'||pending.current.has(index))continue;
   const image=new Image();
   const finish=(state:ImageState)=>{const item=pending.current.get(index);if(!item||item.image!==image)return;clearTimeout(item.timer);image.onload=null;image.onerror=null;pending.current.delete(index);setImages(old=>old.map((value,i)=>i===index?state:value));};
   const timer=window.setTimeout(()=>finish('failed'),8000);pending.current.set(index,{image,timer});
   setImages(old=>old.map((value,i)=>i===index?'loading':value));
   image.decoding='async';image.onload=()=>{if(!image.naturalWidth){finish('failed');return;}if(typeof image.decode==='function')void image.decode().then(()=>finish('ready')).catch(()=>finish(image.naturalWidth?'ready':'failed'));else finish('ready');};image.onerror=()=>finish('failed');image.src=SLIDES[index].image;
  }
 },[active,images,attempt,next,previous]);
 const move=(target:number,step:number)=>{
  if(lock.current||target===active||images[target]!=='ready')return;
  lock.current=true;setDue(false);setDirection(step);setOutgoing(currentReady?active:null);setActive(target);setPhase(currentReady?'prepared':'still');
  if(!currentReady)lock.current=false;
 };
 useEffect(()=>{
  if(phase==='still')return;
  let second=0;const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setPhase('moving'));});
  const timer=window.setTimeout(()=>{setOutgoing(null);setPhase('still');lock.current=false;},reduced?180:700);
  return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);clearTimeout(timer);};
  // Only the target starts a transition. Updating its phase must not restart it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[active]);
 useEffect(()=>{
  if(images[active]!=='failed')return;
  const replacement=images.findIndex(state=>state==='ready');if(replacement>=0)move(replacement,1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[images,active]);
 const canTime=!focused&&visible&&inView&&currentReady&&next!==null;
 useEffect(()=>{
  if(!canTime||due)return;
  const timer=window.setTimeout(()=>setDue(true),INTERVAL);return()=>clearTimeout(timer);
 },[active,canTime,due]);
 useEffect(()=>{if(due&&canTime&&next!==null&&images[next]==='ready'&&!lock.current)move(next,1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[due,canTime,next,images,phase]);
 const pauseReason=allFailed?'all-images-failed':focused?'keyboard-focus':!visible?'tab-hidden':!inView?'outside-viewport':!currentReady?'current-image-loading':next===null?'no-other-images':due&&images[next]!=='ready'?'next-image-loading':'running';
 useEffect(()=>reportUiState('slider',{active:SLIDES[active].id,status:pauseReason,intervalMs:INTERVAL,failedImages:failed.map(i=>SLIDES[i].id),direction,transition:phase}),[active,pauseReason,failed.join(','),direction,phase]);
 const navigate=(step:number)=>{const target=step===1?next:previous;if(target!==null)move(target,step);};
 const err=({az:'Şəkillər yüklənmədi.',en:'Images could not be loaded.',ru:'Не удалось загрузить изображения.'})[language];
 const retry=({az:'Yenidən yoxla',en:'Try again',ru:'Повторить'})[language];
 return <div ref={region} className="ps-hero-slider" data-phase={phase} data-motion={reduced?'quiet':'full'} style={{'--slide-direction':direction} as React.CSSProperties} role="region" aria-roledescription="carousel" aria-label={c.label}
  onFocusCapture={event=>{try{setFocused(event.target.matches(':focus-visible'));}catch{setFocused(keyboard.current);}}} onPointerDownCapture={()=>{keyboard.current=false;setFocused(false);}} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}}
  onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigate(event.key==='ArrowLeft'?-1:1);}}}
  onTouchStart={event=>{const t=event.touches[0];touch.current={x:t.clientX,y:t.clientY};}}
  onTouchEnd={event=>{const start=touch.current;touch.current=null;if(!start)return;const end=event.changedTouches[0],dx=end.clientX-start.x,dy=end.clientY-start.y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy))navigate(dx<0?1:-1);}}>
  {outgoing!==null&&<div key={SLIDES[outgoing].id} className="ps-hero-slide is-outgoing" aria-hidden="true"><img src={SLIDES[outgoing].image} alt="" width={1536} height={1024} draggable={false}/></div>}
  {(currentReady||images[active]==='pending'||images[active]==='loading')&&<div key={SLIDES[active].id} className="ps-hero-slide is-current" data-active="true"><img src={SLIDES[active].image} alt={`${SLIDES[active].system} — ${c.scenes[active]}`} width={1536} height={1024} draggable={false} decoding="async" fetchPriority={active===0?'high':'auto'}/></div>}
  {!currentReady&&<div className="ps-slider-load" role="status">{allFailed?<><span>{err}</span><button type="button" onClick={()=>{setImages(EMPTY_IMAGES());setActive(0);setDue(false);setAttempt(v=>v+1);}}>{retry}</button></>:<span>{({az:'Şəkillər hazırlanır…',en:'Loading images…',ru:'Загрузка изображений…'})[language]}</span>}</div>}
  <button className="ps-slider-arrow ps-slider-arrow-previous" type="button" aria-label={c.previous} disabled={phase!=='still'||previous===null||images[previous]!=='ready'} onClick={()=>navigate(-1)}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button>
  <button className="ps-slider-arrow ps-slider-arrow-next" type="button" aria-label={c.next} disabled={phase!=='still'||next===null||images[next]!=='ready'} onClick={()=>navigate(1)}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m10 5 7 7-7 7"/></svg></button>
  {currentReady&&<div className="ps-slider-caption"><div><strong>{SLIDES[active].system}</strong><span>{c.scenes[active]}</span></div><span className="ps-slider-count" aria-label={`${active+1} / ${SLIDES.length}`}>{String(active+1).padStart(2,'0')}<i>/ {SLIDES.length}</i></span></div>}
  <div className="ps-slider-progress" aria-hidden="true">{SLIDES.map((slide,index)=><span key={slide.id} data-active={index===active}/>)}</div>
 </div>;
}
