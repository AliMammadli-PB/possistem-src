'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {MarketingLayout} from '@/components/marketing/MarketingLayout';
import {useI18n} from '@/components/providers/I18nProvider';
import './pos-downloads.css';

type Product='market'|'restaurant';
type Release={version:string;size:number;href:string};
const QR_RELEASE:Release={version:'1.9.16',size:356067584,href:'/pos-updates/pilot/qr-orders-20261028/Possistem-Setup-1.9.16-verified.exe'};
const QR_ZIP='/pos-updates/pilot/qr-orders-20261028/Possistem-Setup-1.9.16-verified.zip';
const QR_SHA='d638f80a9944d785d6e44e808354cd886fee0abf8a1d0498e8b9bae2f339c5d9';
const feeds={market:'/marketpos/updates/',restaurant:'/pos-updates/'};
const copy={
  az:{eyebrow:'WINDOWS ÜÇÜN POSSİSTEM',title:'POS proqramınızı yükləyin.',intro:'Mağazanız və ya restoranınız üçün uyğun proqramı seçin.',market:'Barkodla satış, anbar və kassa əməliyyatları.',restaurant:'Masa, menyu və mətbəx idarəsi. QR ilə sifariş funksiyası daxildir.',stable:'Stabil buraxılış',pilot:'QR sifariş · sınaq buraxılışı',download:'Quraşdırıcını yüklə',zip:'ZIP ilə yüklə',loading:'Versiya yoxlanılır…',error:'Yükləmə məlumatı alınmadı.',retry:'Yenidən yoxla',previous:'Stabil Restoran POS-u yüklə',unsigned:'1.9.16 sınaq buraxılışı Windows kod sertifikatı ilə imzalanmayıb. Stabil avtomatik yeniləmə ayrıca saxlanılır.',helpTitle:'Quraşdırıcı bütövlük xətası göstərirsə',help:'Əvvəlki yarımçıq faylı silin. ZIP nüsxəsini tam endirin, “Hamısını çıxart / Extract all” seçin və çıxarılan .exe faylını açın.',verify:'Faylı yoxlamaq',hash:'Restoran POS 1.9.16 EXE üçün SHA-256',account:'Daxil olmaq üçün administratorun yaratdığı hesabdan istifadə edin.',guide:'Quraşdırma təlimatı',support:'Dəstək al',format:'Windows · 64 bit',size:'MB'},
  en:{eyebrow:'POSSİSTEM FOR WINDOWS',title:'Download your POS.',intro:'Choose the application for your shop or restaurant.',market:'Barcode sales, stock and till operations.',restaurant:'Tables, menus and kitchen management. Includes QR ordering.',stable:'Stable release',pilot:'QR ordering · test release',download:'Download installer',zip:'Download ZIP',loading:'Checking version…',error:'Download information is unavailable.',retry:'Try again',previous:'Download stable Restaurant POS',unsigned:'The 1.9.16 test release is not Windows code-signed. The stable automatic update feed remains separate.',helpTitle:'If the installer reports an integrity error',help:'Delete the previous incomplete file. Download the ZIP fully, choose “Extract all”, then open the extracted .exe file.',verify:'Verify the file',hash:'SHA-256 for the Restaurant POS 1.9.16 EXE',account:'Sign in with the account created by your administrator.',guide:'Installation guide',support:'Get support',format:'Windows · 64 bit',size:'MB'},
  ru:{eyebrow:'POSSİSTEM ДЛЯ WINDOWS',title:'Скачайте свою POS-программу.',intro:'Выберите программу для магазина или ресторана.',market:'Продажи по штрихкоду, склад и кассовые операции.',restaurant:'Столы, меню и управление кухней. Включает заказы по QR.',stable:'Стабильная версия',pilot:'QR-заказы · тестовая версия',download:'Скачать установщик',zip:'Скачать ZIP',loading:'Проверка версии…',error:'Не удалось получить данные загрузки.',retry:'Повторить',previous:'Скачать стабильную версию Restaurant POS',unsigned:'Тестовая версия 1.9.16 не подписана сертификатом Windows. Канал стабильных автоматических обновлений остаётся отдельным.',helpTitle:'Если установщик сообщает об ошибке целостности',help:'Удалите предыдущий неполный файл. Полностью скачайте ZIP, выберите «Извлечь все», затем откройте извлечённый файл .exe.',verify:'Проверить файл',hash:'SHA-256 EXE Restaurant POS 1.9.16',account:'Войдите с учётной записью, созданной администратором.',guide:'Инструкция по установке',support:'Поддержка',format:'Windows · 64 бит',size:'МБ'},
};
function parseFeed(text:string,product:Product):Release{
  const version=text.match(/^version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m)?.[1];
  const file=text.match(/^path:\s*['"]?([^\s'"]+)['"]?\s*$/m)?.[1];
  const prefix=product==='market'?'MarketPos-Setup-':'Possistem-Setup-';
  if(!version||file!==prefix+version+'.exe')throw Error('Invalid release');
  const size=Number(text.match(/^\s*size:\s*(\d+)/m)?.[1]||0);
  return {version,size,href:feeds[product]+encodeURIComponent(file)};
}
export function PosDownloadsPage(){
  const {language}=useI18n(),t=copy[language];
  const [releases,setReleases]=useState<Partial<Record<Product,Release>>>({});
  const [errors,setErrors]=useState<Partial<Record<Product,boolean>>>({});
  const load=useCallback(async(product:Product)=>{
    setErrors(old=>({...old,[product]:false}));
    try{const r=await fetch(feeds[product]+'latest.yml',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Unavailable');const release=parseFeed(await r.text(),product);setReleases(old=>({...old,[product]:release}));}
    catch{setErrors(old=>({...old,[product]:true}));}
  },[]);
  useEffect(()=>{void load('market');void load('restaurant');},[load]);
  return <MarketingLayout solidHeader currentNav="setup" hideWhatsApp><section className="pos-download-page"><div className="marketing-container">
    <header className="pos-download-heading"><p className="marketing-eyebrow">{t.eyebrow}</p><h1>{t.title}</h1><p>{t.intro}</p></header>
    <div className="pos-download-grid">{(['market','restaurant'] as Product[]).map((product)=>{
      const restaurant=product==='restaurant',release=restaurant?QR_RELEASE:releases.market;
      return <article className="pos-download-card" key={product} aria-busy={!release&&!errors[product]}>
        <div className="pos-download-top"><span className="pos-download-number">{restaurant?'02':'01'}</span><span className="pos-download-state">{restaurant?t.pilot:t.stable}</span></div>
        <h2>{restaurant?'Restoran POS':'Market POS'}</h2><p className="pos-download-description">{t[product]}</p>
        <dl><div><dt>{t.format}</dt><dd>{release?'v'+release.version:t.loading}</dd></div>{!!release?.size&&<div><dt>.exe</dt><dd>{(release.size/1048576).toFixed(1)} {t.size}</dd></div>}</dl>
        {release?<a className="marketing-button primary pos-download-main" href={release.href} download aria-label={(restaurant?'Restoran POS':'Market POS')+' — '+t.download}>{t.download}<span aria-hidden="true">↓</span></a>:errors[product]?<div className="pos-download-error" role="alert"><p>{t.error}</p><button onClick={()=>void load(product)}>{t.retry}</button></div>:<p role="status">{t.loading}</p>}
        {restaurant&&<><a className="pos-download-zip" href={QR_ZIP} download>{t.zip} <span aria-hidden="true">↗</span></a><p className="pos-download-notice">{t.unsigned}</p>{releases.restaurant&&<a className="pos-download-stable" href={releases.restaurant.href} download>{t.previous} · v{releases.restaurant.version}</a>}</>}
      </article>;
    })}</div>
    <section className="pos-download-help"><h2>{t.helpTitle}</h2><p>{t.help}</p><details><summary>{t.verify}</summary><p>{t.hash}</p><code>{QR_SHA}</code></details></section>
    <footer className="pos-download-next"><p>{t.account}</p><div><Link href="/qurasdirma/">{t.guide} <span aria-hidden="true">→</span></Link><Link href="/destek/">{t.support} <span aria-hidden="true">→</span></Link></div></footer>
  </div></section></MarketingLayout>;
}
