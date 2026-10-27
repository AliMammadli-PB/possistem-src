'use client';
import Link from 'next/link';
import {useI18n} from '@/components/providers/I18nProvider';

const COPY={
  az:{nav:'Sayt keçidləri',tag:'Satış və biznes idarəetməsi',partner:'Partnyor',contact:'Əlaqə',privacy:'Məxfilik siyasəti',terms:'Ödəniş şərtləri',rights:'Bütün hüquqlar qorunur.',made:'Azərbaycan üçün hazırlanıb',phone:'Telefon',address:'Ünvan',support:'Dəstək'},
  en:{nav:'Website links',tag:'Sales and business management',partner:'Partners',contact:'Contact',privacy:'Privacy policy',terms:'Payment terms',rights:'All rights reserved.',made:'Built for Azerbaijan',phone:'Phone',address:'Address',support:'Support'},
  ru:{nav:'Разделы сайта',tag:'Продажи и управление бизнесом',partner:'Партнёры',contact:'Контакты',privacy:'Политика конфиденциальности',terms:'Условия оплаты',rights:'Все права защищены.',made:'Создано для Азербайджана',phone:'Телефон',address:'Адрес',support:'Поддержка'},
};

function Icon({name}:{name:'phone'|'map'|'mail'}){
  const common={viewBox:'0 0 24 24',width:16,height:16,'aria-hidden':true,fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  if(name==='phone') return <svg {...common}><path d="M6.5 4.5h2.6l1.2 3-1.7 1a11 11 0 0 0 5.9 5.9l1-1.7 3 1.2v2.6a1.5 1.5 0 0 1-1.6 1.5A13.5 13.5 0 0 1 5 6.1a1.5 1.5 0 0 1 1.5-1.6Z"/></svg>;
  if(name==='map') return <svg {...common}><path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/></svg>;
  return <svg {...common}><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/></svg>;
}

export function SiteFooter({compact=false}:{compact?:boolean}){
  const {language}=useI18n();
  const c=COPY[language];
  return <footer className={`marketing-footer${compact?' is-compact':''}`}>
    <div className="ps-footer-transition" aria-hidden="true"><svg viewBox="0 0 1440 40" preserveAspectRatio="none"><path className="ps-footer-wave-tint" d="M0 18C240 42 390-8 680 12S1180 38 1440 8V40H0Z"/><path className="ps-footer-wave" d="M0 27C240 48 420 0 720 22S1190 43 1440 18V40H0Z"/></svg></div>
    <div className="marketing-container ps-footer-top">
      <div className="ps-footer-address"><Icon name="map"/><span>Ziya Bünyadov Pr. 5/7</span></div>
      <div className="ps-footer-contact">
        <span>{c.contact}</span>
        <a className="ps-footer-line ps-footer-phone" href="tel:+994513333555"><Icon name="phone"/><span className="ps-phone"><span className="ps-phone-cc">+994</span><span className="ps-phone-op">51</span><span className="ps-phone-a">3333</span><span className="ps-phone-b">555</span></span></a>
        <a className="ps-footer-line" href="mailto:support@possistem.az"><Icon name="mail"/><span>support@possistem.az</span></a>
      </div>
    </div>
    <div className="marketing-container ps-footer-bottom">
      <span>© {new Date().getFullYear()} possistem. {c.rights}</span>
      <nav className="ps-footer-legal" aria-label={c.nav}>
        <Link href="/elaqe/">{c.contact}</Link>
        <Link href="/mexfilik/">{c.privacy}</Link>
        <Link href="/odenis/sertler/">{c.terms}</Link>
      </nav>
      <span>{c.made}</span>
    </div>
  </footer>;
}
