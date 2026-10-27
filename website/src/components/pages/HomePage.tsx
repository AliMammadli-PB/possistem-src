'use client';
import Link from 'next/link';
import {useEffect} from 'react';
import {BrandMarquee} from '@/components/marketing/BrandMarquee';
import {HeroSlider} from '@/components/marketing/HeroSlider';
import {MarketingLayout} from '@/components/marketing/MarketingLayout';
import {useI18n} from '@/components/providers/I18nProvider';
import {ArrowUpRight,Play,Check,Smartphone,Monitor,WifiOff,Transfer} from '@/components/marketing/DesignIcons';
import {HOME_COPY} from './HomeContent';
const FACT_ICONS=[WifiOff,Transfer,Smartphone,Monitor];
const FACT_LINKS=['/melumatlar/#internetsiz','/melumatlar/#filiallar','/melumatlar/#filiallar','/melumatlar/#sistemler'];
export function HomePage(){
 const {language}=useI18n();const c=HOME_COPY[language];
 useEffect(()=>{
   if(['tarifler','elaqe','sistemler'].includes(window.location.hash.slice(1))){
     window.location.replace(`/melumatlar/${window.location.search}${window.location.hash}`);
   }
 },[]);
 return <MarketingLayout compactHome>
    <div className="ps-home">
      <section className="ps-hero">
        <div className="marketing-container"><BrandMarquee /></div>
        <div className="marketing-container ps-hero-grid">
          <div className="ps-hero-copy">
            <p className="ps-kicker">{c.eyebrow}</p>
            <h1>{c.title}<br /><span className="ps-mark">{c.accent}</span></h1>
            <p className="ps-lead">{c.intro}</p>
            <div className="ps-actions"><Link prefetch={false} href="/demo/" className="ps-button ps-button-primary"><Play />{c.demo}</Link><Link prefetch={false} href="/melumatlar/#elaqe" className="ps-button ps-button-primary">{c.contact}<ArrowUpRight /></Link></div>
          </div>
          <div className="ps-hero-comparison">
            {/* Before/after comparison remains in HeroCompare.tsx for a future return. */}
            <HeroSlider />
          </div>
        </div>
        <div className="marketing-container"><ul className="ps-proof">{c.facts.map((x, i) => { const Icon = FACT_ICONS[i] ?? Check; return <li key={x}><Link href={FACT_LINKS[i]}><Icon width={24} height={24} /><span>{x}</span><ArrowUpRight className="ps-proof-arrow" aria-hidden="true"/></Link></li>; })}</ul></div>
      </section>
    </div>
 </MarketingLayout>;
}
