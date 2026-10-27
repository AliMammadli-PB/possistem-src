'use client';

import { useI18n } from '@/components/providers/I18nProvider';
import { useRef, type PointerEvent } from 'react';
import './brand-marquee.css';

const BRANDS = [
  ['asus','ASUS'],['lenovo','Lenovo'],['samsung','Samsung'],['dell','Dell'],['hp','HP'],['acer','Acer'],['nvidia','NVIDIA'],['sony','Sony'],['xiaomi','Xiaomi'],['epson','Epson'],['panasonic','Panasonic'],['msi','MSI'],['amd','AMD'],['razer','Razer'],['corsair','Corsair'],['kingstontechnology','Kingston'],
] as const;
const COPY = { az:'Brend loqoları', en:'Brand logos', ru:'Логотипы брендов' };
const HELP = {az:'Sağa və sola sürüşdürün. Klaviaturada ox düymələrindən istifadə edin.',en:'Drag left or right, or use the arrow keys.',ru:'Перетаскивайте влево и вправо или используйте клавиши со стрелками.'};

export function BrandMarquee() {
  const {language} = useI18n();
  const copy = COPY[language];
  const drag=useRef<{id:number;x:number;scroll:number;width:number}|null>(null);
  const finish=(event:PointerEvent<HTMLDivElement>)=>{
    if(drag.current?.id!==event.pointerId)return;
    drag.current=null;delete event.currentTarget.dataset.dragging;
    if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const wrap=(value:number,width:number)=>(value%width+width)%width;
  return <section className="ps-brand-ribbon" aria-label={copy}>
    <div className="ps-brand-ribbon-window" tabIndex={0} role="group" aria-label={HELP[language]}
      onPointerDown={event=>{
        if(!event.isPrimary||event.button!==0)return;
        const width=event.currentTarget.querySelector('.ps-brand-ribbon-set')?.getBoundingClientRect().width;
        if(!width)return;
        drag.current={id:event.pointerId,x:event.clientX,scroll:event.currentTarget.scrollLeft,width};
        event.currentTarget.dataset.dragging='true';
        try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Native pointer cancellation still ends the drag. */}
      }}
      onPointerMove={event=>{const start=drag.current;if(start?.id===event.pointerId)event.currentTarget.scrollLeft=wrap(start.scroll+start.x-event.clientX,start.width);}}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={event=>{
        if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
        const set=event.currentTarget.querySelector('.ps-brand-ribbon-set');if(!set)return;
        event.preventDefault();const width=set.getBoundingClientRect().width,step=set.firstElementChild?.getBoundingClientRect().width??140;
        event.currentTarget.scrollLeft=wrap(event.currentTarget.scrollLeft+(event.key==='ArrowRight'?step:-step),width);
      }}>
      <div className="ps-brand-ribbon-track">
        {[0,1,2].map(group=><ul key={group} className="ps-brand-ribbon-set" aria-hidden={group>0?true:undefined}>
          {BRANDS.map(([id,name])=><li key={id}><img src={`/assets/brand-ribbon-pc-20261021/${id}.svg`} alt={group===0?name:''} data-brand={id} width="112" height="38" draggable={false}/></li>)}
        </ul>)}
      </div>
    </div>
  </section>;
}
