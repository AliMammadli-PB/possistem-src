import type { CatalogProduct } from './catalog-products';
import { productDetailPath } from './catalog-products';

type Language = 'az' | 'en' | 'ru';
export type SearchEntry = { id:string; href:string; title:string; description:string; keywords:string; kind:'page'|'product'; score?:number; corrected?:boolean };
type Page = [string,string,[string,string,string],[string,string,string],string];
const PAGES:Page[] = [
 ['support','/destek/',['Dəstək','Support','Поддержка'],['Texniki yardım və köməkçi','Technical help and assistant','Техническая помощь'], 'destek support help yardim komek technical texniki problem помощь поддержка'],
 ['store','/mehsul/avadanliq/',['Mağaza','Store','Магазин'],['Avadanlıq və məhsullar','Equipment and products','Оборудование и товары'],'magaza mehsullar products shop store avadanliq equipment katalog магазин товары'],
 ['info','/melumatlar/',['Məlumatlar','Information','Информация'],['Possistem proqramları və imkanları','Possistem applications and features','Программы и возможности Possistem'],'melumat information about imkanlar features haqqimizda информация'],
 ['demo','/demo/',['Canlı demo','Live demo','Демо'],['Market və Restoran proqramlarını sınayın','Try Market and Restaurant applications','Попробуйте Market и Restaurant'],'demo canli sinaq test проба демо'],
 ['setup','/qurasdirma/',['Quraşdırma və yükləmə','Installation and downloads','Установка и загрузка'],['Windows tətbiqlərini yükləyin','Download Windows applications','Скачать приложения Windows'],'qurasdirma yukle download setup install exe windows yukleme установка скачать'],
 ['offline','/melumatlar/#internetsiz',['İnternetsiz satış','Offline sales','Продажи без интернета'],['Bağlantı olmadan POS istifadəsi','Using POS without a connection','Работа POS без подключения'],'internetsiz offline internet kesilmesi без интернета'],
 ['branches','/melumatlar/#filiallar',['Filiallar və anbar','Branches and inventory','Филиалы и склад'],['Qalıqlar və filialların idarəsi','Stock and branch management','Остатки и управление филиалами'],'anbar filiallar stock inventory warehouse transfer yerdeyisme склад филиалы'],
 ['mobile','/melumatlar/#filiallar',['Mobil tətbiq və müştəri paneli','Mobile app and customer portal','Мобильное приложение и кабинет'],['Telefondan biznesinizə nəzarət','Manage your business from your phone','Управление бизнесом с телефона'],'mobil telefon android apk mobile app portal кабинет приложение телефон'],
 ['windows','/melumatlar/#sistemler',['Windows tətbiqi','Windows application','Приложение Windows'],['Market POS və Restoran POS haqqında','About Market POS and Restaurant POS','О Market POS и Restaurant POS'],'windows tetbiq proqram desktop computer komp uter приложение'],
 ['market','/demo/?system=market',['Market POS','Market POS','Market POS'],['Market proqramının canlı demosu','Live market application demo','Демо программы для магазина'],'market kassa supermarket retail kassir касса магазин'],
 ['restaurant','/demo/?system=restaurant',['Restoran POS','Restaurant POS','Restaurant POS'],['Restoran proqramının canlı demosu','Live restaurant application demo','Демо программы для ресторана'],'restoran restaurant cafe kafe masa restoranpos ресторан кафе'],
 ['partner','/partnyor/',['Partnyor','Partners','Партнёры'],['Əməkdaşlıq və partnyor kabineti','Partnership and partner account','Сотрудничество и кабинет партнёра'],'partnyor partner emekdasliq reseller партнер'],
 ['contact','/melumatlar/#elaqe',['Əlaqə','Contact','Контакты'],['Ünvan və əlaqə məlumatları','Address and contact details','Адрес и контакты'],'elaqe contact unvan telefon nomre address əlaqə контакты адрес'],
 ['updates','/yenilikler/',['Yeniliklər','Updates','Обновления'],['Proqram buraxılışları','Application releases','Версии программ'],'yenilik update release versiya обновления версия'],
 ['account','/pos/app/login/',['Müştəri paneli və giriş','Customer portal and sign in','Кабинет и вход'],['Mövcud hesabınıza daxil olun','Sign in to your existing account','Войти в свой аккаунт'],'giris login hesab musteri panel account sifre parol password вход пароль'],
 ['orders','/pos/app/sifarisler',['Sifarişlərim','My orders','Мои заказы'],['Sifarişləriniz və təhvil vəziyyəti','Orders and delivery status','Заказы и доставка'],'sifaris orders order delivery catdirilma заказ доставка'],
 ['billing','/pos/app/abunelik',['Abunəlik və ödənişlər','Subscriptions and payments','Подписки и платежи'],['Aylıq haqq və ödəniş tarixçəsi','Monthly fees and payment history','Ежемесячная плата и история платежей'],'abune abunelik odenis kart payment subscription billing recurring card epoint оплата подписка карта'],
 ['terms','/odenis/sertler/',['Ödəniş şərtləri','Payment terms','Условия оплаты'],['Alış, abunəlik və geri qaytarma şərtləri','Purchase, subscription and refund terms','Условия покупки, подписки и возврата'],'sertler terms refund qaytarma qaydalar возврат условия'],
];
export function normalizeSearch(value:string) {
 return value.toLocaleLowerCase('az').replace(/ı/g,'i').replace(/ə/g,'e').replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ö/g,'o').replace(/ü/g,'u').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9а-яё]+/g,' ').trim();
}
// Small bounded Damerau distance also handles swapped adjacent letters (supprot, destke).
function distance(a:string,b:string) {
 const d=Array.from({length:a.length+1},()=>Array<number>(b.length+1).fill(0));
 for(let i=0;i<=a.length;i++)d[i][0]=i;
 for(let j=0;j<=b.length;j++)d[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
  d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
 }
 return d[a.length][b.length];
}
export function searchPages(language:Language):SearchEntry[]{
 const index=language==='az'?0:language==='en'?1:2;
 return PAGES.map(([id,href,title,description,keywords])=>({id,href,title:title[index],description:description[index],keywords:[...title,keywords].join(' '),kind:'page'}));
}
export function searchProducts(products:CatalogProduct[]):SearchEntry[]{
 return products.filter(p=>!p.isTest).map(p=>({id:'product-'+p.id,href:productDetailPath(p),title:p.name,description:[p.brand,p.sku,p.category].filter(Boolean).join(' · '),keywords:[p.name,p.brand,p.sku,p.category,p.parentCategory,p.shortDescription].filter(Boolean).join(' '),kind:'product'}));
}
export function rankSearch(query:string,entries:SearchEntry[]):SearchEntry[]{
 const q=normalizeSearch(query.slice(0,120));if(!q)return entries.filter(e=>e.kind==='page').slice(0,5);
 const tokens=q.split(' ').slice(0,8);
 return entries.flatMap(entry=>{
  const text=normalizeSearch(entry.keywords),title=normalizeSearch(entry.title),words=text.split(' ');let corrected=false;
  const scores=tokens.map(token=>{
   if(words.includes(token))return 100;
   if(token.length>=2&&words.some(w=>w.startsWith(token)))return 85;
   if(token.length>=3&&words.some(w=>w.includes(token)))return 72;
   const limit=token.length>=7?2:token.length>=4?1:0;
   if(limit&&words.some(w=>Math.abs(w.length-token.length)<=limit&&w.length<40&&distance(token,w)<=limit)){corrected=true;return 65;}
   return 0;
  });
  if(scores.some(s=>s===0))return [];
  const score=scores.reduce<number>((a,b)=>a+b,0)/scores.length+(title===q?20:title.startsWith(q)?10:0);
  return [{...entry,score,corrected}];
 }).sort((a,b)=>(b.score??0)-(a.score??0));
}
