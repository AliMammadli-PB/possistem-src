'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import { usePartner } from '@/components/providers/PartnerProvider';
import { SiteSearch } from './SiteSearch';
import { asset } from '@/lib/assets';
import { LanguageSelector } from './LanguageSelector';
import { CustomerAccountMenu } from './CustomerAccountMenu';
import {AccountNotifications} from './AccountNotifications';
import { CartToggle } from './CartDrawer';
import { Menu, Close, Play, Sun, Moon } from './DesignIcons';

type SiteHeaderProps = { solid?: boolean; currentNav?: 'information' | 'product' | 'pricing' | 'setup' | 'updates' | 'support' | 'chat' };
export const HEADER_COMPACT_MAX = 1279;
const COPY = {
  az: { information:'Məlumatlar',product:'Mağaza',pricing:'Qiymətlər',demo:'Canlı demo',setup:'Quraşdırma',updates:'Yeniliklər',support:'Dəstək',partner:'Partnyor',account:'Partnyor kabineti',menu:'Menyunu aç',close:'Menyunu bağla',nav:'Əsas menyu',chat:'Canlı chat' },
  en: { information:'Information',product:'Store',pricing:'Pricing',demo:'Live demo',setup:'Setup',updates:'Updates',support:'Support',partner:'Partners',account:'Partner account',menu:'Open menu',close:'Close menu',nav:'Main navigation',chat:'Live chat' },
  ru: { information:'Информация',product:'Магазин',pricing:'Тарифы',demo:'Демо',setup:'Установка',updates:'Обновления',support:'Поддержка',partner:'Партнёры',account:'Кабинет партнёра',menu:'Открыть меню',close:'Закрыть меню',nav:'Главное меню',chat:'Онлайн-чат' },
};
export function SiteHeader({currentNav}:SiteHeaderProps) {
  const pathname=usePathname();const {language,t}=useI18n();const c=COPY[language];const {theme,toggleTheme}=useTheme();const {partner}=usePartner();
  const catalogPage=pathname.replace(/\/+$/,'')==='/mehsul/avadanliq';
  const [hydrated,setHydrated]=useState(false);
  useEffect(()=>setHydrated(true),[]);
  const [open,setOpen]=useState(false);const toggle=useRef<HTMLButtonElement>(null);const panel=useRef<HTMLElement>(null);const id=useId();
  const close=()=>setOpen(false);
  const previousPathname=useRef(pathname);
  useEffect(()=>{if(previousPathname.current!==pathname)setOpen(false);previousPathname.current=pathname;},[pathname]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);toggle.current?.focus();}
      if(e.key==='Tab') {const items=[toggle.current,...Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled])')??[])].filter((item):item is HTMLElement=>Boolean(item&&item.getClientRects().length));const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    };
    const resize=()=>{if(innerWidth>HEADER_COMPACT_MAX)setOpen(false);};document.addEventListener('keydown',key);window.addEventListener('resize',resize);Array.from(panel.current?.querySelectorAll<HTMLElement>('input,a')??[]).find(item=>item.getClientRects().length)?.focus();
    return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);window.removeEventListener('resize',resize);};
  },[open]);
  const links=[['product','/mehsul/avadanliq/',c.product],['information','/melumatlar/',c.information],['demo','/demo/',c.demo],['support','/destek/',c.support],['partner','/partnyor/',partner?c.account:c.partner]];
  return <header className="ps-header" id="siteHeader">
    <div className="marketing-container ps-header-inner">
      <Link prefetch={false} className="ps-brand" href="/" onClick={close} aria-label="Possistem"><img src={asset('/assets/brands/logo.png')} alt="" width="52" height="52" /><span>Possistem</span></Link>
      {open&&<button className="ps-nav-backdrop" type="button" aria-label={c.close} onClick={()=>{close();toggle.current?.focus();}} />}
      <nav ref={panel} className={`ps-nav${open?' is-open':''}`} id={id} aria-label={c.nav}>
        {!catalogPage&&<SiteSearch variant="mobile" onNavigate={close}/>}
        {links.map(([key,href,label])=><Link prefetch={false} key={key} href={href} onClick={close} aria-current={(currentNav===key||pathname===href||key==='demo'&&pathname.startsWith('/demo'))?'page':undefined} className={key==='demo'?'ps-nav-demo':undefined}>{key==='demo'&&<Play />}{label}</Link>)}
        <button className="ps-mobile-theme" type="button" disabled={!hydrated} onClick={toggleTheme}>{t(theme==='dark'?'common.theme.light':'common.theme.dark')}</button>
      </nav>
      <div className="ps-header-controls"><Link prefetch={false} className="ps-mobile-demo" href="/demo/" onClick={close}>Demo<Play /></Link>{!catalogPage&&<SiteSearch variant="header" onNavigate={close}/>}<CartToggle /><AccountNotifications/><CustomerAccountMenu /><LanguageSelector /><button className="ps-theme-toggle" type="button" disabled={!hydrated} onClick={toggleTheme} aria-label={t(theme==='dark'?'common.theme.light':'common.theme.dark')} aria-pressed={theme==='dark'}>{theme==='dark'?<Sun />:<Moon />}</button><button ref={toggle} className="ps-menu-toggle" type="button" disabled={!hydrated} onClick={()=>setOpen(x=>!x)} aria-expanded={open} aria-controls={id} aria-label={open?c.close:c.menu}>{open?<Close />:<Menu />}</button></div>
    </div>
  </header>;
}
