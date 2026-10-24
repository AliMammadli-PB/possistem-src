'use client';

import { useI18n } from '@/components/providers/I18nProvider';
import './brand-marquee.css';

const BRANDS = [
  ['asus','ASUS'],['lenovo','Lenovo'],['samsung','Samsung'],['dell','Dell'],['hp','HP'],['acer','Acer'],['nvidia','NVIDIA'],['sony','Sony'],['xiaomi','Xiaomi'],['epson','Epson'],['panasonic','Panasonic'],['msi','MSI'],['amd','AMD'],['razer','Razer'],['corsair','Corsair'],['kingstontechnology','Kingston'],
] as const;
const COPY = { az:'Brend loqoları', en:'Brand logos', ru:'Логотипы брендов' };

export function BrandMarquee() {
  const {language} = useI18n();
  const copy = COPY[language];
  return <section className="ps-brand-ribbon" aria-label={copy}>
    <div className="ps-brand-ribbon-window">
      <div className="ps-brand-ribbon-track">
        {[0,1].map(group=><ul key={group} className="ps-brand-ribbon-set" aria-hidden={group===1?true:undefined}>
          {BRANDS.map(([id,name])=><li key={id}><img src={`/assets/brand-ribbon-pc-20261021/${id}.svg`} alt={group===0?name:''} data-brand={id} width="112" height="38" draggable={false}/></li>)}
        </ul>)}
      </div>
    </div>
  </section>;
}
