import {useEffect,useState} from 'react';
import {CreditCard,RefreshCw,ArrowLeft,LogOut} from 'lucide-react';
import type {Lang} from './types';
import './market-billing.css';

export type PaymentMode='manual'|'automatic';
type BillingStatus={subscriptions:{monthlyAmountMinor:number;paidUntil:string|null;state:string;hasPaidSubscription?:boolean;autoRenew?:boolean;renewalNotice?:{title:string;body:string}|null;lastPaymentStatus?:string|null}[];billingOnly:boolean;paymentsAvailable:boolean;recurringAvailable?:boolean;enforcementEnabled?:boolean};
export function MarketBilling({compact=false,lang='az',onManage}:{compact?:boolean;lang?:Lang;onManage?:()=>void}){
 const [data,setData]=useState<BillingStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[mode]=useState<PaymentMode>('automatic');
 const t=(az:string,ru:string,en:string)=>lang==='ru'?ru:lang==='en'?en:az;
 useEffect(()=>{if(!window.marketSystem?.billing)return;let alive=true;
  const load=()=>{void window.marketSystem!.billing.status().then(d=>{if(alive){setData(d);setError('');}}).catch(()=>{if(alive)setError(t('Ödəniş məlumatı alınmadı. Bağlantını yoxlayın.','Не удалось загрузить подписку. Проверьте соединение.','Could not load billing. Check your connection.'));});};
  load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},15000);window.addEventListener('focus',load);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',load);};
 },[lang]);
 const sub=data?.subscriptions[0];
 async function open(){if(busy)return;if(onManage){onManage();return;}setBusy(true);setError('');try{await window.marketSystem?.billing.open(mode);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 if(!sub)return compact?null:<section className="mp-billing"><p role={error?'alert':'status'}>{error||(!data?t('Abunəlik yoxlanılır…','Проверка подписки…','Checking subscription…'):t('Bu hesaba Market POS abunəliyi təyin edilməyib. İdarəçi ilə əlaqə saxlayın.','Подписка Market POS не назначена. Обратитесь к администратору.','No Market POS subscription assigned. Contact your administrator.'))}</p></section>;
 if(compact&&sub.state==='active'&&sub.hasPaidSubscription&&!sub.renewalNotice)return null;
 const amount=(sub.monthlyAmountMinor/100).toFixed(2)+' ₼';
 if(compact)return <aside className="mp-billing-banner"><CreditCard size={20}/><strong>Market POS · {amount}/{t('ay','мес.','month')}</strong><span>{sub.state==='expired'?t('Müddət bitib. Yeni satış üçün ödəniş edin.','Подписка истекла. Оплатите для новых продаж.','Subscription expired. Pay to resume sales.'):(sub.renewalNotice?.body||t('Aylıq avtomatik abunə','Автоматическая подписка','Automatic monthly subscription'))}</span><button type="button" disabled={busy} onClick={()=>void open()}>{t('Abunəliyi idarə et','Управление подпиской','Manage subscription')}</button>{error&&<small role="alert">{error}</small>}</aside>;
 return <section className="mp-billing"><header><CreditCard/><div><h2>Market POS</h2><p>{amount} / {t('təqvim ayı','календарный месяц','calendar month')}</p></div></header>
  <p className="mp-billing-state">{sub.state==='active'?t('Ödənilmiş son tarix: ','Оплачено до: ','Paid through: ')+(sub.paidUntil?new Date(sub.paidUntil).toLocaleString(lang==='ru'?'ru-RU':lang==='en'?'en-GB':'az-AZ'):'—'):sub.state==='expired'?t('Abunəliyin müddəti bitib. Ödəniş edin.','Подписка истекла. Необходима оплата.','Subscription expired. Payment required.'):t('Ödənilmiş abunəliyiniz yoxdur. Ödəniş üsulunu seçin.','Нет оплаченной подписки. Выберите способ оплаты.','No paid subscription. Choose a payment method.')}</p>
  {sub.lastPaymentStatus==='failed'&&sub.state!=='active'&&<p className="mp-billing-error" role="alert">{t('Son ödəniş alınmayıb. Kartı yeniləyə və ya bir aylıq ödəniş edə bilərsiniz.','Последний платёж не прошёл. Обновите карту или оплатите один месяц.','The last payment failed. Update your card or pay for one month.')}</p>}
  <div className="mp-billing-note"><strong>Aylıq avtomatik abunə</strong><p>Kartınızı bank səhifəsində bir dəfə bağlayın. Hər ay razılığınızla yenilənir. Yenilənməyə 3 gün qalmış məlumat veriləcək.</p></div>
  {sub.renewalNotice&&<p className="mp-billing-note" role="status">{sub.renewalNotice.body}</p>}
  {!data?.paymentsAvailable&&<p className="mp-billing-note">{t('Epoint API aktivləşməsi gözlənilir. Hazırlıq dövründə istifadə davam edir; təsdiqsiz ödəniş yazılmır.','Ожидается активация API Epoint. Доступ пока сохраняется; неподтверждённая оплата не засчитывается.','Epoint API activation is pending. Setup access continues; unverified payments are not credited.')}</p>}
  <button className="mp-billing-pay" type="button" disabled={busy} onClick={()=>void open()}>{busy?t('Açılır…','Открывается…','Opening…'):t('Ödənişə keç','Перейти к оплате','Continue to payment')}</button>
  <p className="mp-billing-note">{t('Bank təsdiqindən sonra bir ay açılır. Ödənilmiş müddət bitəndə yeni satışlar bağlanır. Baxış və ixrac saxlanılır.','Месяц доступа открывается после подтверждения банка. По окончании оплаты новые продажи блокируются; просмотр и экспорт доступны.','One month unlocks after bank confirmation. Both methods block new sales at expiry; viewing and export remain available.')}</p>
  {data?.billingOnly&&sub.state==='active'&&<p role="status">{t('Ödəniş təsdiqləndi. Davam etmək üçün hesabınıza yenidən daxil olun.','Оплата подтверждена. Войдите в аккаунт снова.','Payment confirmed. Sign in again to continue.')}</p>}{error&&<p className="mp-billing-error" role="alert">{error}</p>}
 </section>;
}
export function SubscriptionPaymentScreen({lang,onClose,onCheck,onSwitch,closeLabel}:{lang:Lang;closeLabel?:string;onClose?:()=>void;onCheck:()=>void;onSwitch?:()=>void}){
 const t=(az:string,ru:string,en:string)=>lang==='ru'?ru:lang==='en'?en:az;
 return <div className="mp-subscription-screen" role="dialog" aria-modal="true" aria-label={t('Market POS abunəliyi','Подписка Market POS','Market POS subscription')}><div className="mp-subscription-card"><div className="mp-subscription-brand"><img src="./assets/brand-mark.png" alt="Possistem"/><span>POSSİSTEM / MARKET POS</span></div><h1>{t('Abunəlik və ödəniş','Подписка и оплата','Subscription and payment')}</h1><MarketBilling lang={lang}/><footer><button type="button" onClick={onCheck}><RefreshCw size={18}/>{t('Ödənişi yoxla','Проверить оплату','Check payment')}</button>{onClose&&<button type="button" onClick={onClose}><ArrowLeft size={18}/>{closeLabel||t('Məlumatlara bax','Просмотр данных','View data')}</button>}{onSwitch&&<button type="button" onClick={onSwitch}><LogOut size={18}/>{t('Hesaba yenidən giriş','Войти снова','Sign in again')}</button>}</footer></div></div>;
}
