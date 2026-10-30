'use client';
import Link from 'next/link';
import {MarketingLayout} from '@/components/marketing/MarketingLayout';
import {useI18n} from '@/components/providers/I18nProvider';
import './pos-downloads.css';

type Product='market'|'restaurant';
type Release={version:string;size:number;href:string};
const QR_RELEASE:Release={version:'1.9.24',size:356291774,href:'/pos-updates/Possistem-Setup-1.9.24.exe'};
const MARKET_RELEASE:Release={version:'1.5.78',size:381429701,href:'/marketpos/updates/MarketPos-Setup-1.5.78.exe'};
const MARKET_ZIP='/marketpos/updates/MarketPos-Setup-1.5.78-verified.zip';
const QR_ZIP='/pos-updates/Possistem-Setup-1.9.24-verified.zip';
const QR_SHA='3e3db8dfcf5dac55fe125dddcf83447f6b41deb5ec43bd4d92fce7dbd859c6b8';
const copy={
  az:{eyebrow:'WINDOWS ÜÇÜN POSSİSTEM',title:'POS proqramınızı yükləyin.',intro:'Mağazanız və ya restoranınız üçün uyğun proqramı seçin.',market:'Barkodla satış, anbar və kassa əməliyyatları.',restaurant:'Masa, menyu və mətbəx idarəsi. QR ilə sifariş funksiyası daxildir.',stable:'Stabil buraxılış',pilot:'Sınaq buraxılışı',download:'Quraşdırıcını yüklə',zip:'ZIP ilə yüklə',loading:'Versiya yoxlanılır…',error:'Yükləmə məlumatı alınmadı.',retry:'Yenidən yoxla',previous:'Stabil Restoran POS-u yüklə',unsigned:'Windows kod sertifikatı yoxdur. Avtomatik yeniləmə manifesti Possistem imzası ilə yoxlanılır.',helpTitle:'Quraşdırıcı bütövlük xətası göstərirsə',help:'Əvvəlki yarımçıq faylı silin. ZIP nüsxəsini tam endirin, “Hamısını çıxart / Extract all” seçin və çıxarılan .exe faylını açın.',verify:'Faylı yoxlamaq',hash:'Restoran POS 1.9.24 EXE üçün SHA-256',account:'Daxil olmaq üçün administratorun yaratdığı hesabdan istifadə edin.',guide:'Quraşdırma təlimatı',support:'Dəstək al',format:'Windows · 64 bit',size:'MB'},
  en:{eyebrow:'POSSİSTEM FOR WINDOWS',title:'Download your POS.',intro:'Choose the application for your shop or restaurant.',market:'Barcode sales, stock and till operations.',restaurant:'Tables, menus and kitchen management. Includes QR ordering.',stable:'Stable release',pilot:'Test release',download:'Download installer',zip:'Download ZIP',loading:'Checking version…',error:'Download information is unavailable.',retry:'Try again',previous:'Download stable Restaurant POS',unsigned:'The installer has no Windows code-signing certificate. Automatic updates are verified with the Possistem manifest signature.',helpTitle:'If the installer reports an integrity error',help:'Delete the previous incomplete file. Download the ZIP fully, choose “Extract all”, then open the extracted .exe file.',verify:'Verify the file',hash:'SHA-256 for the Restaurant POS 1.9.24 EXE',account:'Sign in with the account created by your administrator.',guide:'Installation guide',support:'Get support',format:'Windows · 64 bit',size:'MB'},
  ru:{eyebrow:'POSSİSTEM ДЛЯ WINDOWS',title:'Скачайте свою POS-программу.',intro:'Выберите программу для магазина или ресторана.',market:'Продажи по штрихкоду, склад и кассовые операции.',restaurant:'Столы, меню и управление кухней. Включает заказы по QR.',stable:'Стабильная версия',pilot:'Тестовая версия',download:'Скачать установщик',zip:'Скачать ZIP',loading:'Проверка версии…',error:'Не удалось получить данные загрузки.',retry:'Повторить',previous:'Скачать стабильную версию Restaurant POS',unsigned:'Установщик не подписан сертификатом Windows. Автоматические обновления проверяются по подписи манифеста Possistem.',helpTitle:'Если установщик сообщает об ошибке целостности',help:'Удалите предыдущий неполный файл. Полностью скачайте ZIP, выберите «Извлечь все», затем откройте извлечённый файл .exe.',verify:'Проверить файл',hash:'SHA-256 EXE Restaurant POS 1.9.24',account:'Войдите с учётной записью, созданной администратором.',guide:'Инструкция по установке',support:'Поддержка',format:'Windows · 64 бит',size:'МБ'},
};
export function PosDownloadsPage(){
  const {language}=useI18n(),t=copy[language];
  return <MarketingLayout solidHeader currentNav="setup" hideWhatsApp><section className="pos-download-page"><div className="marketing-container">
    <header className="pos-download-heading"><p className="marketing-eyebrow">{t.eyebrow}</p><h1>{t.title}</h1><p>{t.intro}</p></header>
    <div className="pos-download-grid">{(['market','restaurant'] as Product[]).map((product)=>{
      const restaurant=product==='restaurant',release=restaurant?QR_RELEASE:MARKET_RELEASE;
      return <article className="pos-download-card" key={product} aria-busy={false}>
        <div className="pos-download-top"><span className="pos-download-number">{restaurant?'02':'01'}</span><span className="pos-download-state">{t.stable}</span></div>
        <h2>{restaurant?'Restoran POS':'Market POS'}</h2><p className="pos-download-description">{t[product]}</p>
        <dl><div><dt>{t.format}</dt><dd>{release?'v'+release.version:t.loading}</dd></div>{!!release?.size&&<div><dt>.exe</dt><dd>{(release.size/1048576).toFixed(1)} {t.size}</dd></div>}</dl>
        <a className="marketing-button primary pos-download-main" href={release.href} download aria-label={(restaurant?'Restoran POS':'Market POS')+' — '+t.download}>{t.download}<span aria-hidden="true">↓</span></a>
        <a className="pos-download-zip" href={restaurant?QR_ZIP:MARKET_ZIP} download>{t.zip} <span aria-hidden="true">↗</span></a><p className="pos-download-notice">{t.unsigned}</p>
      </article>;
    })}</div>
    <section className="pos-download-help"><h2>{t.helpTitle}</h2><p>{t.help}</p><details><summary>{t.verify}</summary><p>{t.hash}</p><code>{QR_SHA}</code><p>Market POS 1.5.78 · SHA-256</p><code>485dc36302f95490482f18c29a71a83ee506c8438bdc96ae04395c2f347e4d96</code></details></section>
    <footer className="pos-download-next"><p>{t.account}</p><div><Link href="/qurasdirma/">{t.guide} <span aria-hidden="true">→</span></Link><Link href="/destek/">{t.support} <span aria-hidden="true">→</span></Link></div></footer>
  </div></section></MarketingLayout>;
}
