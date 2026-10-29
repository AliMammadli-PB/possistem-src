/**
 * Knowledge base, part 1: the company, products, buying, installation,
 * accounts, hardware and support channels. Facts come from the website,
 * the setup/support pages and the live endpoints in facts.ts.
 */
import { link, t, type Entry } from './engine.js';
import { builderItems, catalogFind, catalogLines, plans, supportHours, azn } from './facts.js';

/** The site shows "Qiymət üçün əlaqə saxlayın" for software; keep the chat consistent. */
export const QUOTE_SOFTWARE_PRICES = false;

const PHONE = '051 333 35 55';
const EMAIL = 'support@possistem.az';
const ADDRESS_AZ = 'Ziya Bünyadov prospekti 5/7, Bakı';
const ADDRESS_EN = 'Ziya Bunyadov avenue 5/7, Baku';
const ADDRESS_RU = 'проспект Зии Буньядова 5/7, Баку';

const L = {
  setup: link('/qurasdirma/', 'Quraşdırma bələdçisi', 'Installation guide', 'Инструкция по установке'),
  demo: link('/demo/', 'Canlı demo', 'Live demo', 'Живое демо'),
  info: link('/melumatlar/', 'Məlumatlar', 'Information', 'Информация'),
  lead: link('/melumatlar/#elaqe', 'Qiymət sorğusu göndər', 'Request a quote', 'Запросить цену'),
  hardware: link('/mehsul/avadanliq/', 'Avadanlıq kataloqu', 'Hardware catalogue', 'Каталог оборудования'),
  support: link('/destek/', 'Dəstək mərkəzi', 'Support centre', 'Центр поддержки'),
  community: link('/destek/chat/', 'İctimai chat', 'Community chat', 'Общий чат'),
  updates: link('/yenilikler/', 'Yeniliklər', 'Updates', 'Обновления'),
  portal: link('/pos/app/', 'Müştəri portalı', 'Customer portal', 'Клиентский портал'),
  login: link('/pos/app/login', 'Portala giriş', 'Portal sign-in', 'Вход в портал'),
  subscription: link('/pos/app/abunelik', 'Abunəlik', 'Subscription', 'Подписка'),
  orders: link('/pos/app/sifarisler', 'Sifarişlərim', 'My orders', 'Мои заказы'),
  notifications: link('/pos/app/settings/notifications', 'Bildiriş ayarları', 'Notification settings', 'Настройки уведомлений'),
  partner: link('/partnyor/', 'Partnyor girişi', 'Partner sign-in', 'Вход для партнёров'),
  terms: link('/odenis/sertler/', 'Ödəniş və abunə şərtləri', 'Payment and subscription terms', 'Условия оплаты и подписки'),
};

const contactAz = `Telefon: ${PHONE}\nE-poçt: ${EMAIL}`;
const contactEn = `Phone: ${PHONE}\nEmail: ${EMAIL}`;
const contactRu = `Телефон: ${PHONE}\nEmail: ${EMAIL}`;

async function hardwareAnswer(ctx: Parameters<Extract<Entry['a'], Function>>[0], pattern: RegExp, head: [string, string, string], empty: [string, string, string]) {
  const { total, items } = await catalogFind(ctx.app, pattern, 8);
  const pick = (x: [string, string, string]) => (ctx.lang === 'ru' ? x[2] : ctx.lang === 'en' ? x[1] : x[0]);
  if (!total) return t(empty[0], empty[1], empty[2]);
  const more = total > items.length
    ? pick([`\n…və daha ${total - items.length} model kataloqda.`, `\n…and ${total - items.length} more in the catalogue.`, `\n…и ещё ${total - items.length} в каталоге.`])
    : '';
  const tail = pick([
    '\n\nQiyməti göstərilməyən məhsulu əməkdaşımızdan soruşa bilərsiniz. Partnyorlar hesabla daxil olub xüsusi qiyməti görür.',
    '\n\nFor items without a listed price, ask our agent. Partners see their special price after signing in.',
    '\n\nЦену товара без цены уточнит наш специалист. Партнёры видят спеццену после входа.',
  ]);
  const body = `${pick(head)} (${total}):\n${catalogLines(items, ctx.lang)}${more}${tail}`;
  return t(body, body, body);
}

export const SITE_KB: Entry[] = [
  {
    id: 'about',
    title: t('Possistem nədir', 'What Possistem is', 'Что такое Possistem'),
    q: ['possistem nedir', 'sistem nece isleyir', 'nece isleyir', 'possistem haqqinda melumat', 'siz kimsiniz', 'sirketiniz haqqinda', 'bu sistem ne ise yarayir', 'ne is gorursuz', 'what is possistem', 'about your company', 'что такое possistem', 'о компании'],
    a: t(
      `Possistem restoran, kafe, market, mağaza, aptek, geyim və topdan satış üçün kassa və idarəetmə sistemidir. Azərbaycan üçün hazırlanıb.\n\n• Kassa: toxunuş ekranına uyğun sürətli satış, çek çapı, X/Z hesabatları.\n• Anbar: alış, qalıq, sayım, filiallar arası yerdəyişmə.\n• Sahibkar portalı: satış, kassa və hesabatları telefondan canlı izləmək, bildirişlər.\n• İnternet kəsiləndə əsas satış dayanmır, bağlantı qayıdanda məlumat sinxronlaşır.\n\nÜnvan: ${ADDRESS_AZ}\n${contactAz}`,
      `Possistem is a till and management system for restaurants, cafés, markets, shops, pharmacies, clothing stores and wholesale, built for Azerbaijan.\n\n• Till: fast touch-screen sales, receipt printing, X/Z reports.\n• Stock: purchases, levels, stocktakes, transfers between branches.\n• Owner portal: live sales, cash and reports from your phone, plus notifications.\n• Sales keep running without internet and sync when the connection returns.\n\nAddress: ${ADDRESS_EN}\n${contactEn}`,
      `Possistem — кассовая и управленческая система для ресторанов, кафе, маркетов, магазинов, аптек, магазинов одежды и оптовой торговли, сделанная для Азербайджана.\n\n• Касса: быстрые продажи на сенсорном экране, печать чеков, X/Z-отчёты.\n• Склад: закупки, остатки, инвентаризация, перемещения между филиалами.\n• Портал владельца: продажи, касса и отчёты с телефона онлайн, уведомления.\n• Без интернета продажи продолжаются, данные синхронизируются после восстановления связи.\n\nАдрес: ${ADDRESS_RU}\n${contactRu}`,
    ),
    links: [L.info, L.demo],
    chips: ['products', 'features', 'pricing', 'demo'],
  },
  {
    id: 'products',
    title: t('Hansı proqramlar var', 'Which applications exist', 'Какие есть программы'),
    q: ['hansi proqramlar var', 'hansi pos var', 'neçə növ proqram var', 'proqramlariniz', 'hansi biznes ucun', 'which products do you have', 'what pos systems', 'какие программы есть', 'для какого бизнеса'],
    a: t(
      'Possistem-də biznes növünə görə ayrıca iş ekranları var:\n\n• Restoran POS — restoran, kafe, fast food, bar: zal və masa, sifariş, mətbəx, hesab bölmə, menyu.\n• Market POS — market, mağaza: barkodla satış, tərəzi, alış qaiməsi, borc, filiallar.\n• Aptek POS — aptek: partiya və son istifadə tarixi nəzarəti.\n• Geyim POS — geyim və ayaqqabı mağazası, butik.\n• Topdan POS — topdan satış və tədarük.\n\nHamısını quraşdırmadan brauzerdə demo ilə sınaya bilərsiniz.',
      'Possistem has a workspace for each type of business:\n\n• Restaurant POS — restaurants, cafés, fast food, bars: floor plan, orders, kitchen, split bills, menu.\n• Market POS — markets and shops: barcode sales, scales, purchases, customer debt, branches.\n• Pharmacy POS — batches and expiry control.\n• Clothing POS — clothing and shoe stores, boutiques.\n• Wholesale POS — wholesale and supply.\n\nYou can try each one in the browser demo without installing anything.',
      'В Possistem есть рабочие места под каждый тип бизнеса:\n\n• Ресторан POS — рестораны, кафе, фастфуд, бары: зал и столы, заказы, кухня, разделение счёта, меню.\n• Маркет POS — маркеты и магазины: продажи по штрихкоду, весы, закупки, долги, филиалы.\n• Аптека POS — партии и контроль сроков годности.\n• Одежда POS — магазины одежды и обуви, бутики.\n• Опт POS — оптовые продажи и поставки.\n\nКаждую можно попробовать в браузерном демо без установки.',
    ),
    links: [L.demo],
    chips: ['restaurant_pos', 'market_pos', 'compare', 'demo'],
  },
  {
    id: 'restaurant_pos',
    title: t('Restoran və kafe üçün', 'For restaurants and cafés', 'Для ресторанов и кафе'),
    q: ['restoran ucun program', 'kafe ucun uygundur', 'restoran ucun ne var', 'fast food ucun', 'bar ucun kassa', 'cayxana ucun program', 'restaurant pos', 'cafe system', 'программа для ресторана', 'для кафе подходит'],
    needs: ['@restaurant'],
    avoid: ['@problem'],
    a: t(
      'Restoran POS restoran, kafe, fast food və bar üçündür:\n\n• Zal planı və masalar: boş, dolu və hesab gözləyən masalar bir baxışda.\n• Sifariş və mətbəxə göndəriş, hər printerə öz təyinatı (mətbəx, bar və s.).\n• Açıq hesablar, hesab bölmə, nağd və kartla ödəniş.\n• Menyu, resept və maya dəyəri, anbar.\n• Ofisiant və kassir rolları, növbələr, X/Z hesabatı.\n• Çatdırılma və kuryer uçotu.\n• Sahibkar portalında canlı masalar və satış.',
      'Restaurant POS is for restaurants, cafés, fast food and bars:\n\n• Floor plan and tables: free, busy and waiting-for-bill at a glance.\n• Orders sent to the kitchen, each printer with its own target (kitchen, bar…).\n• Open bills, split bills, cash and card payments.\n• Menu, recipes and cost price, stock.\n• Waiter and cashier roles, shifts, X/Z reports.\n• Delivery and courier tracking.\n• Live tables and sales in the owner portal.',
      'Ресторан POS — для ресторанов, кафе, фастфуда и баров:\n\n• Схема зала и столы: свободные, занятые и ожидающие счёт.\n• Отправка заказов на кухню, у каждого принтера своё назначение (кухня, бар…).\n• Открытые счета, разделение счёта, оплата наличными и картой.\n• Меню, рецепты и себестоимость, склад.\n• Роли официанта и кассира, смены, X/Z-отчёты.\n• Учёт доставки и курьеров.\n• Столы и продажи онлайн в портале владельца.',
    ),
    links: [link('/demo/?system=restaurant', 'Restoran demosu', 'Restaurant demo', 'Демо ресторана')],
    chips: ['tables', 'kitchen', 'pricing', 'hardware'],
  },
  {
    id: 'market_pos',
    title: t('Market və mağaza üçün', 'For markets and shops', 'Для маркетов и магазинов'),
    q: ['market ucun program', 'magaza ucun kassa', 'dukan ucun program', 'supermarket ucun', 'market pos nedir', 'program for a shop', 'retail pos', 'программа для магазина', 'для маркета'],
    needs: ['@market'],
    avoid: ['@problem'],
    a: t(
      'Market POS market və mağaza üçündür:\n\n• Barkodla sürətli satış, tərəzi və çəki etiketi (PLU).\n• Alış qaiməsi, mal qəbulu, qalıq, sayım, silinmə.\n• Müştəri borcu (nisyə), bonus, qaytarma.\n• Tədarükçülər və onlara borc.\n• Bir neçə kassa və filial, filiallar arası yerdəyişmə.\n• Kassa və bank hesabları, gəlir-xərc, maaş.\n• Sahibkar portalında canlı satış və anbar.',
      'Market POS is for markets and shops:\n\n• Fast barcode sales, scales and weight labels (PLU).\n• Purchase documents, goods receipt, stock levels, stocktakes, write-offs.\n• Customer debt, loyalty bonuses, returns.\n• Suppliers and supplier balances.\n• Several tills and branches, transfers between branches.\n• Cash and bank accounts, income and expenses, salaries.\n• Live sales and stock in the owner portal.',
      'Маркет POS — для маркетов и магазинов:\n\n• Быстрые продажи по штрихкоду, весы и весовые этикетки (PLU).\n• Приходные накладные, приёмка, остатки, инвентаризация, списание.\n• Долги покупателей, бонусы, возвраты.\n• Поставщики и расчёты с ними.\n• Несколько касс и филиалов, перемещения между филиалами.\n• Кассовые и банковские счета, доходы и расходы, зарплата.\n• Продажи и склад онлайн в портале владельца.',
    ),
    links: [link('/demo/?system=market', 'Market demosu', 'Market demo', 'Демо маркета')],
    chips: ['hardware', 'pricing', 'branches', 'debt'],
  },
  {
    id: 'pharmacy_pos',
    title: t('Aptek üçün', 'For pharmacies', 'Для аптек'),
    q: ['aptek ucun program', 'aptek pos', 'eczane ucun', 'pharmacy software', 'программа для аптеки'],
    needs: ['@pharmacy'],
    a: t(
      'Aptek POS aptek üçün ayrıca iş ekranıdır: barkodla satış, partiya və son istifadə tarixi nəzarəti, alış qaiməsi, qalıq, müştəri və filiallar. Bitmək üzrə olan partiyalar üçün hesabat var.\n\nBrauzerdə Aptek demosunu açıb sınaya bilərsiniz.',
      'Pharmacy POS is a dedicated workspace: barcode sales, batch and expiry control, purchase documents, stock, customers and branches. There is a report for batches close to expiry.\n\nTry the Pharmacy demo in the browser.',
      'Аптека POS — отдельное рабочее место: продажи по штрихкоду, контроль партий и сроков годности, приходные накладные, остатки, клиенты и филиалы. Есть отчёт по партиям с истекающим сроком.\n\nПопробуйте демо аптеки в браузере.',
    ),
    links: [link('/demo/?system=aptek', 'Aptek demosu', 'Pharmacy demo', 'Демо аптеки')],
    chips: ['expiry', 'pricing'],
  },
  {
    id: 'clothing_pos',
    title: t('Geyim mağazası üçün', 'For clothing stores', 'Для магазинов одежды'),
    q: ['geyim magazasi ucun', 'butik ucun program', 'ayaqqabi magazasi', 'paltar magazasi ucun kassa', 'clothing store pos', 'для магазина одежды'],
    needs: ['@clothing'],
    a: t(
      'Geyim POS geyim, ayaqqabı mağazası və butik üçündür: məhsul kartında ölçü və rəng, barkodla satış, qaytarma və dəyişmə, müştəri bazası və bonus, anbar və filiallar.\n\nBrauzerdə Geyim demosunu sınaya bilərsiniz.',
      'Clothing POS is for clothing and shoe stores and boutiques: size and colour on the product card, barcode sales, returns and exchanges, customer base and bonuses, stock and branches.\n\nTry the Clothing demo in the browser.',
      'Одежда POS — для магазинов одежды, обуви и бутиков: размер и цвет в карточке товара, продажи по штрихкоду, возвраты и обмен, база клиентов и бонусы, склад и филиалы.\n\nПопробуйте демо в браузере.',
    ),
    links: [link('/demo/?system=geyim', 'Geyim demosu', 'Clothing demo', 'Демо одежды')],
    chips: ['pricing', 'loyalty'],
  },
  {
    id: 'wholesale_pos',
    title: t('Topdan satış üçün', 'For wholesale', 'Для оптовой торговли'),
    q: ['topdan satis ucun', 'topdan program', 'optom satis', 'wholesale software', 'программа для опта'],
    needs: ['@wholesale'],
    a: t(
      'Topdan POS topdan satış üçündür: müştəri və tədarükçü balansları, borc, alış və satış qaimələri, anbar və filiallar arası yerdəyişmə.\n\nBrauzerdə Topdan demosunu sınaya bilərsiniz.',
      'Wholesale POS covers customer and supplier balances, debt, purchase and sales documents, stock and transfers between branches.\n\nTry the Wholesale demo in the browser.',
      'Опт POS: балансы клиентов и поставщиков, долги, приходные и расходные накладные, склад и перемещения между филиалами.\n\nПопробуйте демо в браузере.',
    ),
    links: [link('/demo/?system=topdan', 'Topdan demosu', 'Wholesale demo', 'Демо опта')],
    chips: ['pricing', 'debt'],
  },
  {
    id: 'compare',
    title: t('Market və Restoran POS fərqi', 'Market vs Restaurant POS', 'Разница Маркет и Ресторан POS'),
    q: ['market pos ile restoran pos ferqi', 'restoran ve market ferqi nedir', 'hansini secim', 'menim ucun hansi uygundur', 'difference between market and restaurant', 'чем отличается маркет от ресторана'],
    a: t(
      'Restoran POS masa və sifariş ətrafında qurulub: zal, masa, mətbəx, hesab bölmə, menyu və resept.\n\nMarket POS barkod və anbar ətrafında qurulub: sürətli barkod satışı, tərəzi, alış qaiməsi, müştəri borcu.\n\nYeməyi masaya verirsinizsə — Restoran POS. Malı rəfdən satırsınızsa — Market POS (aptek, geyim və topdan üçün ayrıca variantlar var). İkisi eyni sahibkar hesabında birlikdə işləyə bilər.',
      'Restaurant POS is built around tables and orders: floor plan, kitchen, split bills, menu and recipes.\n\nMarket POS is built around barcodes and stock: fast scanning, scales, purchases, customer debt.\n\nServing food at tables → Restaurant POS. Selling goods off the shelf → Market POS (with pharmacy, clothing and wholesale variants). Both can run under one owner account.',
      'Ресторан POS построен вокруг столов и заказов: зал, кухня, разделение счёта, меню и рецепты.\n\nМаркет POS — вокруг штрихкодов и склада: быстрые продажи, весы, закупки, долги.\n\nПодаёте еду за столом — Ресторан POS. Продаёте товар с полки — Маркет POS (есть варианты для аптеки, одежды и опта). Обе работают в одном аккаунте владельца.',
    ),
    links: [L.demo],
    chips: ['restaurant_pos', 'market_pos', 'demo'],
  },
  {
    id: 'features',
    title: t('Funksiyalar', 'Features', 'Возможности'),
    q: ['proqramin funksiyalari', 'imkanlari nelerdir', 'ne ede bilir', 'hansi funksiyalar var', 'xususiyyetleri', 'what features', 'what can it do', 'какие функции', 'возможности программы'],
    a: t(
      'Əsas imkanlar:\n\n• Satış: barkod, tərəzi, endirim, nağd/kart/borc, qaytarma, çek çapı.\n• Restoran: zal, masa, sifariş, mətbəx printerləri, hesab bölmə, çatdırılma.\n• Anbar: alış qaiməsi, qalıq, sayım, silinmə, partiya və son istifadə tarixi, yerdəyişmə.\n• Pul: kassa və bank hesabları, gəlir-xərc, tədarükçü və müştəri borcları, maaş.\n• Komanda: işçilər, rollar və icazələr, növbələr, X/Z hesabatı.\n• Sahibkar: portal və telefon paneli, WhatsApp və push bildirişləri, bir neçə filial.\n• İnternetsiz iş və sinxronizasiya, bulud ehtiyat nüsxə.',
      'Main features:\n\n• Sales: barcode, scales, discounts, cash/card/credit, returns, receipts.\n• Restaurant: floor plan, tables, orders, kitchen printers, split bills, delivery.\n• Stock: purchases, levels, stocktakes, write-offs, batches and expiry, transfers.\n• Money: cash and bank accounts, income and expenses, supplier and customer balances, salaries.\n• Team: staff, roles and permissions, shifts, X/Z reports.\n• Owner: portal and phone panel, WhatsApp and push notifications, multiple branches.\n• Offline work with sync, cloud backup.',
      'Основные возможности:\n\n• Продажи: штрихкод, весы, скидки, наличные/карта/долг, возвраты, чеки.\n• Ресторан: зал, столы, заказы, кухонные принтеры, разделение счёта, доставка.\n• Склад: закупки, остатки, инвентаризация, списание, партии и сроки годности, перемещения.\n• Деньги: кассовые и банковские счета, доходы и расходы, долги поставщиков и клиентов, зарплата.\n• Команда: сотрудники, роли и права, смены, X/Z-отчёты.\n• Владелец: портал и панель в телефоне, уведомления WhatsApp и push, несколько филиалов.\n• Работа без интернета с синхронизацией, облачные резервные копии.',
    ),
    links: [L.info, L.demo],
    chips: ['products', 'pricing', 'demo'],
  },
  {
    id: 'pricing',
    offerAgent: true,
    title: t('Qiymətlər', 'Prices', 'Цены'),
    q: ['qiymetler nedir', 'neceyedir', 'nece manatdir', 'paketlerin qiymeti', 'program neceyedir', 'ayliq ne qederdir', 'tarifler', 'qiymet', 'abune qiymeti', 'pos sistemi neceye', 'how much does it cost', 'what are the prices', 'pricing plans', 'сколько стоит', 'цены на программу', 'тарифы'],
    needs: ['@price', '@monthly', '@subscription'],
    avoid: ['@computer', '@printer', '@scanner', '@scale', '@drawer', '@camera', '@product'],
    a: async (ctx) => {
      if (!QUOTE_SOFTWARE_PRICES) {
        return t(
          'Proqramın qiyməti biznesinizə görə hesablanır: hansı proqram (Restoran, Market və s.), neçə kassa, neçə filial və hansı əlavələr (anbar, bulud ehtiyat nüsxə, telefon paneli və s.).\n\nQiymət sorğusunu saytdakı formadan göndərin və ya əməkdaşımızla danışın. Satış komandası ehtiyacınıza uyğun təklif və təqdimatla geri dönür. Quraşdırma və təlim daxildir.\n\n' + contactAz,
          'The software price depends on your business: which application (Restaurant, Market…), how many tills and branches, and which add-ons (stock, cloud backup, phone panel…).\n\nSend a quote request from the website form or talk to our agent. The sales team replies with an offer for your setup. Installation and training are included.\n\n' + contactEn,
          'Цена программы зависит от бизнеса: какая программа (Ресторан, Маркет…), сколько касс и филиалов, какие дополнения (склад, облачные копии, панель в телефоне…).\n\nОтправьте запрос через форму на сайте или поговорите со специалистом — отдел продаж пришлёт предложение. Установка и обучение включены.\n\n' + contactRu,
        );
      }
      const [list, items] = await Promise.all([plans(ctx.app, ctx.lang), builderItems(ctx.app)]);
      const planLines = list.map((p) => `• ${p.name}${p.tagline ? ` (${p.tagline})` : ''}: ${azn(p.monthlyMinor)}`).join('\n');
      const itemLines = items.filter((i) => i.priceMinor > 0).map((i) => `• ${i.name[ctx.lang] ?? i.name.az}: ${azn(i.priceMinor)}`).join('\n');
      return t(
        `Aylıq paketlər:\n${planLines}\n\nPaketi özünüz də qura bilərsiniz (aylıq):\n${itemLines}\n\nYekun qiymət kassa və filial sayından asılıdır. Dəqiq təklif üçün: ${PHONE}.`,
        `Monthly plans:\n${planLines}\n\nOr build your own package (monthly):\n${itemLines}\n\nThe total depends on tills and branches. For an exact offer: ${PHONE}.`,
        `Ежемесячные пакеты:\n${planLines}\n\nИли соберите пакет сами (в месяц):\n${itemLines}\n\nИтог зависит от числа касс и филиалов. Точное предложение: ${PHONE}.`,
      );
    },
    links: [L.lead],
    chips: ['plans', 'demo', 'yearly', 'hardware'],
  },
  {
    id: 'plans',
    offerAgent: true,
    title: t('Paketlər (Standart, Biznes, Premium)', 'Plans (Standard, Business, Premium)', 'Пакеты (Стандарт, Бизнес, Премиум)'),
    q: ['hansi paketler var', 'standart biznes premium ferqi', 'paketlerin ferqi', 'premium paket', 'biznes paket ne verir', 'which plans', 'plan comparison', 'какие пакеты', 'чем отличается премиум'],
    a: async (ctx) => {
      const list = await plans(ctx.app, ctx.lang);
      if (!list.length) return t('Paket siyahısını indi oxuya bilmədim. ' + PHONE, 'I could not load the plans right now. ' + PHONE, 'Не удалось загрузить пакеты. ' + PHONE);
      const body = list.map((p) => `${p.name}${p.tagline ? ` — ${p.tagline}` : ''}${QUOTE_SOFTWARE_PRICES ? `, ${azn(p.monthlyMinor)}/ay` : ''}\n${p.features.map((f) => `  • ${f}`).join('\n')}`).join('\n\n');
      return t(
        `${body}\n\nSizə hansının uyğun olduğunu kassa və filial sayınıza görə satış komandası dəqiqləşdirir.`,
        `${body}\n\nThe sales team will confirm which fits your number of tills and branches.`,
        `${body}\n\nКакой подходит, уточнит отдел продаж по числу касс и филиалов.`,
      );
    },
    links: [L.lead],
    chips: ['pricing', 'demo'],
  },
  {
    id: 'yearly',
    title: t('Aylıq və illik ödəniş', 'Monthly and yearly billing', 'Оплата помесячно и за год'),
    q: ['illik odenis var', 'ilin pulunu birden odemek', 'illik abune', 'ayliq odenis', 'odenis her ay', 'yearly payment', 'annual plan', 'оплата за год', 'годовая подписка'],
    needs: ['@yearly'],
    a: t(
      'Abunəlik təqvim ayı üzrə hesablanır. Ödənişi portalda hər ay özünüz edə bilərsiniz, ya da kartı bankda saxlayıb hər ay avtomatik tutulmaya razılıq verirsiniz. Ödəniş alınmasa, ödənilmiş müddət bitəndə yeni satışlar dayanır və ödəniş ekranından davam edir.\n\nBir neçə ayı və ya ili əvvəlcədən ödəmək barədə satış komandası ilə danışın: ' + PHONE,
      'The subscription is billed per calendar month. Pay manually in the portal each month, or save your card at the bank and consent to an automatic monthly charge. If a payment fails, new sales stop when the paid period ends and resume from the payment screen.\n\nTo prepay several months or a year, talk to sales: ' + PHONE,
      'Подписка считается по календарным месяцам. Платите вручную в портале каждый месяц или сохраните карту в банке и согласитесь на автоматическое списание. Если оплата не прошла, после окончания оплаченного срока новые продажи останавливаются и продолжаются после оплаты.\n\nОплату за несколько месяцев или год обсудите с отделом продаж: ' + PHONE,
    ),
    links: [L.terms, L.subscription],
    chips: ['pay_methods', 'subscription_status'],
  },
  {
    id: 'free',
    title: t('Pulsuz versiya', 'Free version', 'Бесплатная версия'),
    q: ['pulsuz versiya var', 'pulsuzdur', 'havayi istifade', 'pulsuz yuklemek olar', 'is there a free version', 'is it free', 'бесплатная версия есть', 'бесплатно'],
    needs: ['@free'],
    a: t(
      'Pulsuz daimi versiya yoxdur. Amma pulsuz canlı demo var: Restoran, Market, Aptek, Geyim və Topdan iş ekranlarını heç nə quraşdırmadan, nümunə məlumatları ilə brauzerdə açırsınız.\n\nMüştəri hesabı yaratmaq da pulsuzdur, amma ödənişli lisenziya avtomatik verilmir — lisenziyanı satış komandası kassa və filial sayınıza görə açır.',
      'There is no permanent free version. There is a free live demo: open the Restaurant, Market, Pharmacy, Clothing and Wholesale workspaces in your browser with sample data, nothing to install.\n\nCreating a customer account is free too, but it does not include a paid licence — sales activates the licence for your tills and branches.',
      'Бесплатной постоянной версии нет. Есть бесплатное живое демо: рабочие места Ресторана, Маркета, Аптеки, Одежды и Опта открываются в браузере с примерами данных, без установки.\n\nСоздать аккаунт клиента тоже бесплатно, но платная лицензия не выдаётся автоматически — её подключает отдел продаж.',
    ),
    links: [L.demo, L.lead],
    chips: ['demo', 'trial', 'pricing'],
  },
  {
    id: 'trial',
    offerAgent: true,
    title: t('Sınaq müddəti', 'Trial', 'Пробный период'),
    q: ['sinaq muddeti var', 'evvelce yoxlamaq isteyirem', 'yoxlayib sonra alaram', 'sinaq versiyasi', 'nece gun pulsuz', 'test etmek olar', 'evvelce yoxlamaq isteyirem', 'free trial', 'can i test it', 'пробный период', 'есть ли пробная версия', 'попробовать'],
    needs: ['@trial', '@free'],
    a: t(
      'Ən sürətli yol canlı demodur: brauzerdə açılır, nümunə məlumatları var, istədiyiniz qədər sınaya bilərsiniz.\n\nÖz kompüterinizdə, öz mallarınızla sınaq lisenziyası istəyirsinizsə, satış komandasına yazın — biznesinizə uyğun təqdimat edirlər: ' + PHONE,
      'The fastest way is the live demo: it opens in your browser with sample data, try it as long as you like.\n\nFor a trial licence on your own computer with your own products, contact sales for a presentation: ' + PHONE,
      'Быстрее всего — живое демо: открывается в браузере с примерами данных, пробуйте сколько угодно.\n\nДля пробной лицензии на своём компьютере со своими товарами напишите в отдел продаж: ' + PHONE,
    ),
    links: [L.demo],
    chips: ['demo', 'pricing'],
  },
  {
    id: 'demo',
    title: t('Canlı demo', 'Live demo', 'Живое демо'),
    q: ['demo var', 'demo nece acim', 'demoya baxmaq', 'programi gormek isteyirem', 'online sinamaq', 'show me a demo', 'live demo', 'демо версия', 'посмотреть программу'],
    needs: ['@demo', '@trial'],
    a: t(
      'Demo səhifəsini açın və sistemi seçin: Restoran, Market, Topdan, Aptek və ya Geyim. Demo brauzerdə nümunə məlumatları ilə açılır, heç nə quraşdırmaq lazım deyil. Demodakı dəyişikliklər real hesabınıza təsir etmir.',
      'Open the demo page and choose a system: Restaurant, Market, Wholesale, Pharmacy or Clothing. It opens in the browser with sample data, nothing to install. Changes in the demo do not affect a real account.',
      'Откройте страницу демо и выберите систему: Ресторан, Маркет, Опт, Аптека или Одежда. Демо открывается в браузере с примерами данных, устанавливать ничего не нужно. Изменения в демо не влияют на реальный аккаунт.',
    ),
    links: [L.demo, link('/demo/?system=restaurant', 'Restoran', 'Restaurant', 'Ресторан'), link('/demo/?system=market', 'Market', 'Market', 'Маркет')],
    chips: ['pricing', 'install'],
  },
  {
    id: 'discount',
    offerAgent: true,
    title: t('Endirim və kampaniyalar', 'Discounts and offers', 'Скидки и акции'),
    q: ['endirim var', 'kampaniya var', 'aksiya varmi', 'ucuz olar', 'endirim ede bilersiz', 'any discount', 'promo', 'есть скидки', 'акции'],
    needs: ['@discount'],
    avoid: ['@sale', '@receipt'],
    a: t(
      'Saytda sabit endirim elan olunmayıb. Bir neçə kassa, filial və ya avadanlıqla birlikdə alanda fərdi təklif soruşun — satış komandası paketinizə uyğun hesablayır.\n\n' + contactAz,
      'No fixed discount is published. Ask for a custom offer for several tills, branches or a bundle with hardware — sales will price your package.\n\n' + contactEn,
      'Фиксированных скидок на сайте нет. Запросите индивидуальное предложение для нескольких касс, филиалов или комплекта с оборудованием.\n\n' + contactRu,
    ),
    links: [L.lead],
    chips: ['pricing'],
  },
  {
    id: 'pay_methods',
    title: t('Necə ödəmək olar', 'How to pay', 'Как оплатить'),
    q: ['nece odeyim', 'abune odenisini nece edim', 'kartla odemek olar', 'nagd odemek olar', 'odenisi harda edim', 'abuneni nece odeyim', 'onlayn odenis', 'how can i pay', 'pay by card', 'как оплатить', 'оплата картой'],
    needs: ['@pay', '@card', '@cash'],
    avoid: ['@sale', '@debt', '@customer'],
    a: t(
      'Abunəlik ödənişi müştəri portalında edilir: Portal → Abunəlik → ödəniş üsulunu seçin.\n\n• Hər ay özünüz kartla ödəyirsiniz, və ya\n• Kartı bankda saxlayıb hər ay avtomatik tutulmaya razılıq verirsiniz.\n\nKart məlumatı bankın (Epoint) səhifəsində daxil edilir, Possistem kart nömrənizi saxlamır. Nağd və ya köçürmə ilə ödəmək üçün satış komandası ilə danışın: ' + PHONE,
      'Subscription payments are made in the customer portal: Portal → Subscription → choose a method.\n\n• Pay by card yourself each month, or\n• Save the card at the bank and consent to an automatic monthly charge.\n\nCard details are entered on the bank (Epoint) page; Possistem does not store your card number. For cash or bank transfer, contact sales: ' + PHONE,
      'Оплата подписки — в клиентском портале: Портал → Подписка → способ оплаты.\n\n• Каждый месяц оплачиваете картой сами, или\n• Сохраняете карту в банке и соглашаетесь на автосписание.\n\nДанные карты вводятся на странице банка (Epoint), Possistem номер карты не хранит. Наличными или переводом — через отдел продаж: ' + PHONE,
    ),
    links: [L.subscription, L.terms],
    chips: ['subscription_status', 'yearly'],
  },
  {
    id: 'buy',
    offerAgent: true,
    title: t('Necə qoşulmaq / almaq', 'How to get started', 'Как подключиться'),
    q: ['programi nece alim', 'almaq isteyirem', 'qosulmaq isteyirem', 'abune olmaq', 'lisenziya almaq', 'sifaris vermek isteyirem', 'how to buy', 'i want to buy', 'как купить', 'хочу подключиться'],
    a: t(
      'Qoşulma addımları:\n\n1. Demo ilə uyğun proqramı seçin.\n2. Qiymət sorğusu göndərin və ya zəng edin — kassa, filial sayı və lazım olan avadanlığı qeyd edin.\n3. Satış komandası təklif hazırlayır və lisenziyanı aktivləşdirir.\n4. Müştəri portalında hesab yaradın, proqramı yükləyib quraşdırın. Quraşdırma və təlim daxildir.\n\n' + contactAz,
      'Getting started:\n\n1. Pick the right application in the demo.\n2. Send a quote request or call — mention tills, branches and hardware you need.\n3. Sales prepares an offer and activates the licence.\n4. Create a portal account, download and install the app. Installation and training are included.\n\n' + contactEn,
      'Как подключиться:\n\n1. Выберите программу в демо.\n2. Отправьте запрос или позвоните — укажите кассы, филиалы и оборудование.\n3. Отдел продаж готовит предложение и активирует лицензию.\n4. Создайте аккаунт в портале, скачайте и установите программу. Установка и обучение включены.\n\n' + contactRu,
    ),
    links: [L.lead, L.demo],
    chips: ['pricing', 'install', 'hardware'],
  },
  {
    id: 'install',
    title: t('Proqramı quraşdırmaq', 'Installing the application', 'Установка программы'),
    q: ['programi nece yukleyim', 'possistemi nece yukleyim', 'yukleme linki', 'windows ucun yukleme linki', 'kompyutere nece yazim programi', 'proqrami haradan yukleyim', 'nece qurasdirim', 'kompyutere nece yazim', 'qurasdirma qaydasi', 'setup faylini harda tapim', 'yuklemek isteyirem', 'how do i install', 'where to download', 'как установить программу', 'где скачать'],
    needs: ['@install'],
    avoid: ['@problem', '@android', '@ios', '@update', '@phone'],
    a: t(
      'Yükləmə faylı müştəri portalının Yükləmələr bölməsindədir (aşağıdakı keçid, hesabla daxil olmaq lazımdır) — orada həmişə son stabil Windows versiyası olur.\n\nQuraşdırma 4 addımdır:\n\n1. Müştəri portalında hesab yaradın və biznes məlumatlarını doldurun.\n2. Portalın Yükləmələr bölməsindən son stabil Windows versiyasını yükləyin (ölçü və checksum orada göstərilir).\n3. Faylı açıb quraşdırın, proqramı işə salın və aktivasiya məlumatını daxil edin.\n4. Portal kassanızın real bağlantısını görüb quraşdırmanı təsdiqləyir.\n\nPortal hər addımı yadda saxlayır, yarımçıq qoyub sonra davam edə bilərsiniz. Texniki bilik tələb olunmur, lazım olsa komandamız quraşdırmada kömək edir.',
      'The installer is in the customer portal’s Downloads section (link below, sign-in required) — it always has the latest stable Windows version.\n\nInstallation takes 4 steps:\n\n1. Create a customer portal account and fill in your business details.\n2. Download the latest stable Windows version from the portal’s Downloads section (size and checksum are shown).\n3. Run the installer, start the app and enter the activation details.\n4. The portal sees the till’s real connection and confirms the installation.\n\nThe portal remembers each step, so you can continue later. No technical knowledge needed; our team can help.',
      'Установщик — в разделе Загрузки клиентского портала (ссылка ниже, нужен вход); там всегда последняя стабильная версия для Windows.\n\nУстановка в 4 шага:\n\n1. Создайте аккаунт в клиентском портале и заполните данные бизнеса.\n2. Скачайте последнюю стабильную версию для Windows в разделе Загрузки портала (размер и checksum указаны).\n3. Запустите установщик, откройте программу и введите данные активации.\n4. Портал увидит реальное подключение кассы и подтвердит установку.\n\nПортал запоминает шаги, можно продолжить позже. Технические знания не нужны, команда поможет.',
    ),
    links: [link('/pos/app/downloads', 'Yükləmələr (portal)', 'Downloads (portal)', 'Загрузки (портал)'), L.setup, L.login],
    chips: ['requirements', 'activation', 'install_problem'],
  },
  {
    id: 'install_problem',
    offerAgent: true,
    title: t('Quraşdırma alınmır', 'Installation fails', 'Установка не проходит'),
    q: ['setup fayli acilmir', 'qurasdirma yarimciq qalir', 'yukleme alinmir', 'qurasdirmada xeta', 'program qurulmur', 'installer will not run', 'installation error', 'установка не проходит', 'ошибка установки'],
    needs: ['@install'],
    a: t(
      'Quraşdırma alınmırsa:\n\n1. Kompüter tələblərə uyğun olsun: Windows 10 64-bit (22H2+) və ya Windows 11, ən azı 4 GB RAM, 2 GB boş yer.\n2. Faylı yalnız portalın Yükləmələr bölməsindən götürün və tam yüklənməsini gözləyin.\n3. Windows “naməlum tətbiq” xəbərdarlığı versə, “Ətraflı → Hər halda işə sal” seçin; antivirus faylı saxlayıbsa, onu buraxın.\n4. Quraşdırıcını bir dəfə açın, ikinci nüsxə ilə eyni anda işə salmayın.\n5. Xəta qalırsa, ekrandakı mətni və Windows versiyasını əməkdaşa göndərin.',
      'If installation fails:\n\n1. Check requirements: Windows 10 64-bit (22H2+) or Windows 11, at least 4 GB RAM, 2 GB free space.\n2. Download only from the portal’s Downloads section and wait for it to finish.\n3. If Windows warns about an unknown app, choose “More info → Run anyway”; if antivirus quarantined the file, restore it.\n4. Run the installer once; do not start a second copy at the same time.\n5. If it still fails, send the error text and Windows version to an agent.',
      'Если установка не проходит:\n\n1. Требования: Windows 10 64-bit (22H2+) или Windows 11, от 4 ГБ ОЗУ, 2 ГБ свободного места.\n2. Скачивайте только из раздела Загрузки портала и дождитесь окончания.\n3. Если Windows предупреждает о неизвестном приложении — «Подробнее → Выполнить в любом случае»; если антивирус поместил файл в карантин — восстановите.\n4. Запускайте установщик один раз.\n5. Если ошибка остаётся, отправьте текст ошибки и версию Windows специалисту.',
    ),
    links: [L.setup],
    chips: ['requirements', 'human'],
  },
  {
    id: 'requirements',
    title: t('Sistem tələbləri', 'System requirements', 'Системные требования'),
    q: ['sistem telebleri', 'windows 10 lazimdir', 'hansi windows lazimdir', 'noutbukda isleyer', 'zeif komputerde gedermi', 'hansi komputer lazimdir', 'nece gb ram lazimdir', 'zeif komputerde isleyer', 'minimum telebler', 'system requirements', 'what computer do i need', 'системные требования', 'какой компьютер нужен'],
    a: t(
      'Kassa proqramı üçün:\n\n• Windows 10 64-bit (22H2 və yuxarı) və ya Windows 11\n• Prosessor: ən azı 2 nüvə ~2 GHz, tövsiyə Core i3 / Ryzen 3\n• RAM: minimum 4 GB, rahat iş üçün 8 GB\n• Disk: SSD tövsiyə olunur, ən azı 2 GB boş yer\n• Ayrıca NVIDIA kartı lazım deyil — daxili Intel/AMD qrafika kifayətdir\n• Aktivləşdirmə və sinxronizasiya üçün internet',
      'For the till application:\n\n• Windows 10 64-bit (22H2 or later) or Windows 11\n• CPU: at least 2 cores ~2 GHz, Core i3 / Ryzen 3 recommended\n• RAM: 4 GB minimum, 8 GB for comfortable work\n• Disk: SSD recommended, at least 2 GB free\n• No NVIDIA card needed — integrated Intel/AMD graphics are enough\n• Internet for activation and sync',
      'Для кассовой программы:\n\n• Windows 10 64-bit (22H2 и новее) или Windows 11\n• Процессор: от 2 ядер ~2 ГГц, рекомендуется Core i3 / Ryzen 3\n• ОЗУ: минимум 4 ГБ, комфортно 8 ГБ\n• Диск: рекомендуется SSD, минимум 2 ГБ свободно\n• Видеокарта NVIDIA не нужна — достаточно встроенной Intel/AMD\n• Интернет для активации и синхронизации',
    ),
    links: [L.setup, L.hardware],
    chips: ['hw_pc', 'install', 'win7'],
  },
  {
    id: 'win7',
    title: t('Köhnə Windows (7/8)', 'Older Windows (7/8)', 'Старая Windows (7/8)'),
    q: ['windows 7de isleyir', 'windows 8 olar', 'xp de isleyer', 'kohne windows', 'does it run on windows 7', 'работает на windows 7'],
    needs: ['@win7'],
    a: t(
      'Xeyr, Windows 7, 8 və XP dəstəklənmir. Proqram Windows 10 64-bit (22H2+) və ya Windows 11 tələb edir. Kompüter imkan verirsə Windows-u yeniləyin, ya da kataloqdan uyğun POS kompüter seçin.',
      'No, Windows 7, 8 and XP are not supported. The app needs Windows 10 64-bit (22H2+) or Windows 11. Upgrade Windows if the computer allows it, or choose a POS computer from the catalogue.',
      'Нет, Windows 7, 8 и XP не поддерживаются. Нужна Windows 10 64-bit (22H2+) или Windows 11. Обновите Windows или выберите POS-компьютер из каталога.',
    ),
    links: [L.hardware],
    chips: ['requirements', 'hw_pc'],
  },
  {
    id: 'mac',
    title: t('Mac və Linux', 'Mac and Linux', 'Mac и Linux'),
    q: ['mac ucun var', 'macbookda isleyir', 'macos versiyasi', 'linux ucun var', 'does it work on mac', 'есть для mac'],
    needs: ['@mac'],
    a: t(
      'Kassa proqramı Windows üçündür, Mac və Linux üçün ayrıca versiya yoxdur. Sahibkar portalı isə istənilən cihazın brauzerində açılır — Mac, iPhone və Android daxil.',
      'The till application is for Windows; there is no Mac or Linux version. The owner portal works in any browser, including Mac, iPhone and Android.',
      'Кассовая программа — для Windows, версии для Mac и Linux нет. Портал владельца открывается в любом браузере, включая Mac, iPhone и Android.',
    ),
    links: [L.portal],
    chips: ['requirements', 'owner_portal'],
  },
  {
    id: 'android_app',
    title: t('Telefon və Android tətbiqi', 'Phone and Android app', 'Телефон и Android-приложение'),
    q: ['telefona yuklemek olar', 'android tetbiq var', 'mobil tetbiq', 'telefondan istifade', 'apk haradan yukleyim', 'is there a mobile app', 'android app', 'приложение для телефона', 'андроид приложение'],
    needs: ['@phone', '@android'],
    avoid: ['@ios'],
    a: t(
      'Telefon üçün iki yol var:\n\n• Müştəri portalı telefon brauzerində açılır — satış, kassa, hesabat və bildirişlər.\n• Android müştəri tətbiqi (Android 8 və yuxarı) Quraşdırma səhifəsindədir. APK quraşdırılarkən Android mənbəyə icazə istəyə bilər. APK-nı yalnız rəsmi keçiddən yükləyin.\n\nKassa proqramının özü Windows kompüterdə işləyir.',
      'Two options on a phone:\n\n• The customer portal opens in the phone browser — sales, cash, reports and notifications.\n• The Android customer app (Android 8+) is on the Installation page. Android may ask to allow installing from this source. Download the APK only from the official link.\n\nThe till itself runs on a Windows computer.',
      'На телефоне два варианта:\n\n• Клиентский портал открывается в браузере телефона — продажи, касса, отчёты, уведомления.\n• Android-приложение (Android 8+) — на странице установки. Android может запросить разрешение на установку. Скачивайте APK только по официальной ссылке.\n\nСама касса работает на компьютере с Windows.',
    ),
    links: [L.setup, L.portal],
    chips: ['owner_portal', 'ios'],
  },
  {
    id: 'ios',
    title: t('iPhone', 'iPhone', 'iPhone'),
    q: ['iphone ucun app varmi', 'iphoneda isleyir', 'ios tetbiq', 'iphone bildiris gelmir', 'iphone app', 'приложение для iphone'],
    needs: ['@ios'],
    a: t(
      'iPhone üçün App Store tətbiqi yoxdur, portal Safari-də işləyir. Tətbiq kimi istifadə üçün: portalı Safari-də açın → Paylaş → “Əsas ekrana əlavə et”, sonra həmin ikonla açın. Push bildirişləri üçün iOS 16.4+ və bildiriş icazəsi lazımdır.',
      'There is no App Store app; the portal runs in Safari. To use it like an app: open the portal in Safari → Share → “Add to Home Screen”, then open it from that icon. Push notifications need iOS 16.4+ and notification permission.',
      'Приложения в App Store нет, портал работает в Safari. Чтобы пользоваться как приложением: откройте портал в Safari → Поделиться → «На экран Домой» и запускайте с этой иконки. Для push нужна iOS 16.4+ и разрешение на уведомления.',
    ),
    links: [L.portal, L.notifications],
    chips: ['notifications', 'owner_portal'],
  },
  {
    id: 'activation',
    title: t('Aktivasiya və lisenziya', 'Activation and licence', 'Активация и лицензия'),
    q: ['aktivasiya acari harda', 'lisenziya nece aktiv edim', 'aktivlesdirme kodu', 'lisenziya acari', 'activation key', 'how to activate', 'ключ активации', 'как активировать'],
    needs: ['@license'],
    avoid: ['@expire', '@renew'],
    a: t(
      'Müştəri hesabı yaratmaq avtomatik ödənişli lisenziya vermir. Satış komandası kassa və filial sayınıza uyğun planı açır və aktivasiya məlumatını verir. Proqramı ilk açanda həmin məlumatı daxil edin; ilk aktivləşmə üçün internet lazımdır. Portal kassanın bağlantısını görəndə quraşdırma tamamlanır.',
      'Creating an account does not grant a paid licence. Sales opens a plan for your tills and branches and gives you the activation details. Enter them when the app first starts; the first activation needs internet. Installation is complete when the portal sees the till online.',
      'Создание аккаунта не даёт платную лицензию. Отдел продаж открывает план по числу касс и филиалов и выдаёт данные активации. Введите их при первом запуске; для первой активации нужен интернет. Установка завершена, когда портал видит кассу онлайн.',
    ),
    links: [L.setup, L.portal],
    chips: ['subscription_status', 'not_visible'],
  },
  {
    id: 'license_expired',
    title: t('Lisenziya bitib / uzatmaq', 'Licence expired / renew', 'Лицензия истекла / продлить'),
    q: ['lisenziya bitib', 'lisenziyani nece uzadim', 'abunelik bitib', 'muddeti bitib', 'satis dayandi odenis', 'license expired', 'renew subscription', 'лицензия истекла', 'продлить подписку'],
    needs: ['@license', '@subscription', '@expire', '@renew'],
    a: t(
      'Ödənilmiş müddət bitəndə yeni satışlar dayanır, məlumatlarınız silinmir. Davam etmək üçün: Portal → Abunəlik → ödənişi edin. Ödəniş təsdiqlənəndən sonra kassa növbəti bağlantıda açılır.\n\nHesabınıza daxil olsanız, abunəliyinizin nə vaxta qədər ödəndiyini burada deyə bilərəm — “abunəliyim nə vaxt bitir” yazın.',
      'When the paid period ends, new sales stop; your data is not deleted. To continue: Portal → Subscription → pay. After the payment is confirmed the till unlocks on its next connection.\n\nIf you sign in, I can tell you when your subscription is paid until — ask “when does my subscription end”.',
      'Когда оплаченный срок заканчивается, новые продажи останавливаются, данные не удаляются. Чтобы продолжить: Портал → Подписка → оплата. После подтверждения касса откроется при следующем подключении.\n\nЕсли вы вошли в аккаунт, я подскажу, до какого числа оплачено — спросите «когда заканчивается подписка».',
    ),
    links: [L.subscription],
    chips: ['subscription_status', 'pay_methods'],
  },
  {
    id: 'update',
    title: t('Yeni versiyaya yeniləmək', 'Updating to a new version', 'Обновление версии'),
    q: ['yeni versiya nece yukleyim', 'programi nece yenileyim', 'programi nece yenilim', 'son versiya hansidir', 'yenileme var', 'update necedir', 'how to update', 'latest version', 'как обновить', 'новая версия'],
    needs: ['@update'],
    avoid: ['@problem'],
    a: t(
      'Yeniləmə qaydası:\n\n1. Açıq növbəni tamamlayın və sinxronizasiyanın bitməsini gözləyin.\n2. Portalın Yükləmələr bölməsindən son versiyanı yükləyib quraşdırın — köhnənin üstünə qurulur, məlumatlar qalır.\n3. Məlumat qovluğunu əl ilə silməyin.\n\nPortal kassadakı versiyanı son versiya ilə müqayisə edir; buraxılış qeydləri Yeniliklər səhifəsindədir.',
      'To update:\n\n1. Finish the open shift and let sync complete.\n2. Download the latest version from the portal’s Downloads and install it over the old one — data stays.\n3. Do not delete the data folder manually.\n\nThe portal compares the till’s version with the latest one; release notes are on the Updates page.',
      'Как обновить:\n\n1. Закройте открытую смену и дождитесь синхронизации.\n2. Скачайте последнюю версию в разделе Загрузки портала и установите поверх — данные сохраняются.\n3. Не удаляйте папку данных вручную.\n\nПортал сравнивает версию кассы с последней; заметки о выпуске — на странице Обновления.',
    ),
    links: [L.updates, L.portal],
    chips: ['update_problem', 'backup'],
  },
  {
    id: 'update_problem',
    offerAgent: true,
    title: t('Yeniləmə alınmır', 'Update fails', 'Обновление не проходит'),
    q: ['proqram yenilenmir', 'yenileme dayanir', 'yenilemeden sonra acilmir', 'versiya gorunmur', 'update failed', 'не обновляется', 'после обновления не открывается'],
    needs: ['@update'],
    a: t(
      '1. Proqramı tam bağlayın (bildiriş zonasında da) və yeniləməni yenidən başladın.\n2. Faylı portalın Yükləmələr bölməsindən yenidən yükləyin — yarımçıq yüklənmiş fayl açılmaya bilər.\n3. Antivirus faylı saxlayıbsa, buraxın.\n4. Yeniləmədən sonra açılmırsa, bazanı silməyin və proqramı silib təzədən qurmayın — xəta mətni və versiya ilə əməkdaşa yazın.',
      '1. Close the app completely (including the tray) and start the update again.\n2. Re-download the file from the portal — a partial download may not run.\n3. If antivirus quarantined it, restore it.\n4. If it will not open after updating, do not delete the database or reinstall — send the error text and version to an agent.',
      '1. Полностью закройте программу (и в трее) и запустите обновление снова.\n2. Скачайте файл заново из портала — недокачанный файл может не запуститься.\n3. Если антивирус поместил файл в карантин — восстановите.\n4. Если после обновления не открывается, не удаляйте базу и не переустанавливайте — отправьте текст ошибки и версию специалисту.',
    ),
    links: [L.updates],
    chips: ['human', 'backup'],
  },
  {
    id: 'offline',
    title: t('İnternetsiz iş', 'Working offline', 'Работа без интернета'),
    q: ['internet olmadan isleyir', 'offline isleyirmi', 'internet kesilse ne olar', 'internetsiz satis', 'works without internet', 'offline mode', 'работает без интернета', 'если пропадёт интернет'],
    needs: ['@internet'],
    avoid: ['@problem'],
    a: t(
      'Bəli. Əsas satış kassada lokal işləyir: internet kəsiləndə satış, çek və anbar hərəkəti davam edir. Bağlantı qayıdanda məlumatlar serverə ötürülür və sahibkar portalı yenidən canlı rəqəmləri göstərir. Bağlantı yoxkən portal son məlum rəqəmləri “köhnə” işarəsi ilə saxlayır.\n\nİnternet lazım olan hallar: ilk aktivləşdirmə, portal, bildirişlər, bulud ehtiyat nüsxə və filiallar arası məlumat.',
      'Yes. Core sales run locally on the till: when the internet drops, sales, receipts and stock movements continue. When it returns, data is sent to the server and the owner portal shows live numbers again. Meanwhile the portal keeps the last known numbers marked as stale.\n\nInternet is needed for first activation, the portal, notifications, cloud backup and data between branches.',
      'Да. Основные продажи работают локально: без интернета продажи, чеки и движения склада продолжаются. После восстановления связи данные уходят на сервер, и портал снова показывает онлайн-цифры. Пока связи нет, портал хранит последние цифры с пометкой «устарело».\n\nИнтернет нужен для первой активации, портала, уведомлений, облачных копий и обмена между филиалами.',
    ),
    links: [link('/melumatlar/#internetsiz', 'İnternetsiz iş', 'Offline work', 'Работа без интернета')],
    chips: ['sync_problem', 'backup'],
  },
  {
    id: 'sync_problem',
    title: t('Sinxronizasiya problemi', 'Sync problem', 'Проблема синхронизации'),
    q: ['satis portala dusmur', 'portalda satis gorunmur', 'saytda melumat yenilenmir', 'sinxronizasiya islemir', 'filiallar arasi melumat catmir', 'internet var amma portal kohnedir', 'data not syncing', 'не синхронизируется', 'данные не доходят'],
    needs: ['@sync', '@internet', '@owner_view', '@branch'],
    a: t(
      '1. Adi bir saytı açıb interneti yoxlayın. Kompüterin tarix və saatı düzgün olsun.\n2. Kassada proqram açıq və eyni sahibkar hesabına bağlı olmalıdır. Portalda düzgün filial/POS seçildiyinə baxın.\n3. Portal son göndərilən məlumatı göstərir — müqayisədə son yenilənmə vaxtına baxın. Gecikmə var deyə eyni sənədi təkrar yaratmayın.\n4. Bağlantı qayıdanda səhifəni bir dəfə yeniləyin.\n5. Bazanı silmək, başqa kompüterin bazasını köçürmək və ya yenidən quraşdırmaq olmaz — məlumat itə bilər.\n\nHansı filialdan nə çatmır və son yenilənmə vaxtı nədir? Bunu əməkdaşa yazın.',
      '1. Open any website to check the internet. Make sure the computer’s date and time are correct.\n2. The app must be open on the till and linked to the same owner account. Check the branch/POS selected in the portal.\n3. The portal shows the last data sent — compare using the last update time. Do not recreate documents because of a delay.\n4. Refresh the page once the connection is back.\n5. Never delete the database, copy another computer’s database or reinstall — data can be lost.',
      '1. Откройте любой сайт и проверьте интернет. Дата и время компьютера должны быть верными.\n2. На кассе программа должна быть открыта и привязана к тому же аккаунту. Проверьте выбранный филиал/POS в портале.\n3. Портал показывает последние отправленные данные — сравнивайте по времени обновления. Не создавайте документы повторно из-за задержки.\n4. После восстановления связи обновите страницу.\n5. Нельзя удалять базу, копировать базу с другого компьютера или переустанавливать — данные могут потеряться.',
    ),
    chips: ['not_visible', 'human'],
  },
  {
    id: 'not_visible',
    title: t('Kassa portalda görünmür', 'Till not visible in the portal', 'Касса не видна в портале'),
    q: ['pos serverde gorunmur', 'kassa portalda gorunmur', 'cihaz oflayn gorunur', 'baglantini yoxla', 'qurasdirma tamamlanmir', 'till shows offline', 'касса не видна', 'устройство офлайн'],
    needs: ['@owner_view', '@internet', '@problem', '@install'],
    a: t(
      'POS tətbiqini açıq saxlayın, kompüterin internetini və aktivasiya məlumatını yoxlayın. Sonra müştəri portalında Quraşdırma → “Bağlantını yoxla” seçin. Portal cihazın real bağlantısını, son əlaqə vaxtını və versiyasını görmədən quraşdırmanı tamamlanmış saymır.\n\nVəziyyətlər: “hələ bağlantı yoxdur” — kassa heç qoşulmayıb; “əvvəl görülüb, indi oflayndır” — internet və ya proqram bağlıdır; “onlayn” — hər şey qaydasındadır.',
      'Keep the POS app open and check the computer’s internet and activation details. Then in the portal choose Installation → “Check connection”. The portal does not mark setup complete until it sees the device, its last contact time and version.\n\nStates: “no connection yet” — the till never connected; “seen before, now offline” — internet or the app is closed; “online” — all good.',
      'Держите POS открытой, проверьте интернет и данные активации. Затем в портале: Установка → «Проверить подключение». Портал не считает установку завершённой, пока не увидит устройство, время связи и версию.\n\nСостояния: «подключения ещё нет» — касса не подключалась; «была видна, сейчас офлайн» — нет интернета или закрыта программа; «онлайн» — всё в порядке.',
    ),
    links: [L.portal, L.setup],
    chips: ['activation', 'sync_problem', 'devices_status'],
  },
  {
    id: 'backup',
    title: t('Ehtiyat nüsxə və bərpa', 'Backup and restore', 'Резервные копии и восстановление'),
    q: ['ehtiyat nusxe', 'backup nece edim', 'baza nece saxlanir', 'baza harda saxlanir', 'melumatlar harda saxlanir', 'bulud backup', 'berpa etmek', 'how to back up', 'where is data stored', 'резервная копия', 'где хранятся данные'],
    needs: ['@backup', '@dataloss'],
    a: t(
      'Məlumatlar kassanın öz kompüterində lokal bazada saxlanır və sinxronizasiya ilə serverə də ötürülür.\n\n• Proqramda Parametrlər → Ehtiyat nüsxə bölməsindən nüsxə alın.\n• “Bulud baza və backup” əlavəsi (Premium paketdə daxildir) məlumatı avtomatik serverdə saxlayır və istənilən cihazdan tam bərpa imkanı verir.\n• Bərpadan əvvəl cari bazanın ayrıca nüsxəsini saxlayın və bərpanı başqa kompüterin bazası ilə etməyin.',
      'Data is kept in a local database on the till and also synced to the server.\n\n• Take a copy in Settings → Backup.\n• The “Cloud database & backup” add-on (included in Premium) stores data on the server automatically and allows a full restore on any device.\n• Before restoring, save a copy of the current database, and never restore another computer’s database.',
      'Данные хранятся в локальной базе на кассе и синхронизируются с сервером.\n\n• Копию можно сделать в Настройки → Резервная копия.\n• Дополнение «Облачная база и резервные копии» (входит в Премиум) хранит данные на сервере автоматически и позволяет полностью восстановиться на любом устройстве.\n• Перед восстановлением сохраните копию текущей базы и не восстанавливайте базу с другого компьютера.',
    ),
    chips: ['dataloss', 'plans'],
  },
  {
    id: 'dataloss',
    offerAgent: true,
    title: t('Kompüter xarab olsa', 'If the computer breaks', 'Если компьютер сломается'),
    q: ['melumatlar itse ne olar', 'komputer xarab olsa', 'baza silinse', 'disk yandi', 'what if i lose data', 'если компьютер сломается', 'данные пропали'],
    needs: ['@dataloss', '@backup'],
    a: t(
      'Sinxronizasiya olunmuş məlumat serverdə də var. Bulud backup aktivdirsə, yeni kompüterdə tam bərpa mümkündür. Yerli ehtiyat nüsxə almısınızsa, onu da bərpa etmək olar.\n\nNə etməli: köhnə diski silməyin, yeni kompüterdə proqramı quraşdırın və dərhal əməkdaşa yazın — bərpanı birlikdə edək. Özbaşına başqa bazanı köçürməyin.',
      'Synced data also exists on the server. With cloud backup, a full restore on a new computer is possible. A local backup can be restored too.\n\nWhat to do: do not wipe the old disk, install the app on the new computer and contact an agent right away so we restore together. Do not copy another database yourself.',
      'Синхронизированные данные есть и на сервере. С облачным бэкапом возможно полное восстановление на новом компьютере. Локальную копию тоже можно восстановить.\n\nЧто делать: не форматируйте старый диск, установите программу на новый компьютер и сразу напишите специалисту — восстановим вместе. Не копируйте чужую базу самостоятельно.',
    ),
    chips: ['backup', 'human'],
  },
  {
    id: 'security',
    title: t('Məlumatların təhlükəsizliyi', 'Data security', 'Безопасность данных'),
    q: ['melumatlarim tehlukesizdir', 'melumatlari kim gorur', 'baza qorunurmu', 'is my data safe', 'кто видит мои данные', 'безопасность данных'],
    needs: ['@security'],
    a: t(
      'Hər sahibkarın məlumatı ayrıca hesab daxilində saxlanır, başqa müştəri onu görmür. Portal qorunan sessiya ilə işləyir. Dəstəyə göndərilən diaqnostika faylları açıq web qovluğuna düşmür, 30 günlük saxlanma müddəti var. Kart məlumatı bankın səhifəsində daxil edilir, Possistem kart nömrəsini saxlamır.\n\nŞifrə və PIN-i heç kimlə, o cümlədən bu chatla paylaşmayın.',
      'Each owner’s data is isolated in their own account. The portal uses protected sessions. Diagnostic files sent to support never land in a public folder and are kept for 30 days. Card details are entered on the bank page; Possistem does not store card numbers.\n\nNever share passwords or PINs, including in this chat.',
      'Данные каждого владельца изолированы в его аккаунте. Портал работает с защищёнными сессиями. Файлы диагностики не попадают в публичную папку и хранятся 30 дней. Данные карты вводятся на странице банка, Possistem не хранит номер карты.\n\nНе сообщайте пароли и PIN никому, в том числе в этом чате.',
    ),
    chips: ['backup'],
  },
  {
    id: 'register',
    title: t('Qeydiyyat', 'Registration', 'Регистрация'),
    q: ['qeydiyyatdan nece kecim', 'hesab nece yaradim', 'yeni hesab acmaq', 'qeydiyyat', 'how to register', 'create an account', 'как зарегистрироваться', 'создать аккаунт'],
    needs: ['@register'],
    a: t(
      'Müştəri portalının giriş səhifəsində qeydiyyat keçidini seçin, e-poçt və şifrə yazın, sonra biznes, əlaqə və ünvan məlumatlarını doldurun. Hesab yaratmaq pulsuzdur, lisenziyanı satış komandası açır.',
      'On the customer portal sign-in page choose registration, enter your email and a password, then fill in business, contact and address details. An account is free; sales activates the licence.',
      'На странице входа в портал выберите регистрацию, укажите email и пароль, затем заполните данные бизнеса, контакты и адрес. Аккаунт бесплатный, лицензию подключает отдел продаж.',
    ),
    links: [L.login],
    chips: ['install', 'activation'],
  },
  {
    id: 'login_problem',
    title: t('Hesaba girə bilmirəm', 'Cannot sign in', 'Не могу войти'),
    q: ['hesaba gire bilmirem', 'giris olmur', 'login olmur', 'invalid credentials', 'daxil ola bilmirem', 'cannot log in', 'не могу войти', 'не пускает в аккаунт'],
    needs: ['@login', '@password'],
    avoid: ['@forgot'],
    a: t(
      '1. Hansı giriş olduğunu ayırın: sayt/portal (e-poçt + şifrə), proqramın ilk aktivləşməsi, yoxsa kassir PIN-i.\n2. E-poçtda artıq boşluq, klaviatura dili və Caps Lock-u yoxlayın.\n3. “Invalid credentials” — məlumat qəbul olunmayıb, hesab silinməyib. Şifrəni unutmusunuzsa, bərpa keçidindən istifadə edin.\n4. PIN və rolu icazəli rəhbər dəyişir.\n\nŞifrə və PIN-i bu chata yazmayın.',
      '1. Identify the sign-in: website/portal (email + password), first activation of the app, or cashier PIN.\n2. Check for extra spaces in the email, keyboard language and Caps Lock.\n3. “Invalid credentials” means the details were rejected, not that the account was deleted. If you forgot the password, use the reset link.\n4. PINs and roles are changed by an authorised manager.\n\nDo not type passwords or PINs here.',
      '1. Определите вход: сайт/портал (email + пароль), первая активация программы или PIN кассира.\n2. Проверьте лишние пробелы в email, раскладку и Caps Lock.\n3. «Invalid credentials» — данные не приняты, аккаунт не удалён. Если забыли пароль — используйте восстановление.\n4. PIN и роли меняет руководитель с правами.\n\nНе пишите пароли и PIN в чат.',
    ),
    links: [L.login],
    chips: ['forgot_password', 'pin'],
  },
  {
    id: 'forgot_password',
    title: t('Şifrəni unutmuşam', 'Forgot password', 'Забыл пароль'),
    q: ['parolumu unutdum', 'sifremi unutmusam', 'sifreni nece berpa edim', 'parol berpa', 'forgot my password', 'reset password', 'забыл пароль', 'восстановить пароль'],
    needs: ['@forgot', '@password'],
    a: t(
      'Portalın giriş səhifəsində “Şifrəni unutmusunuz?” keçidini açın və qeydiyyat e-poçtunuzu yazın. Hesab mövcuddursa, 30 dəqiqə keçərli yeniləmə məktubu gəlir; “Spam” qovluğuna da baxın.\n\nKassir PIN-ini unudubsa, onu rəhbər hesabı İşçilər bölməsindən yeniləyir.',
      'On the portal sign-in page open “Forgot password?” and enter your registration email. If the account exists, a reset email valid for 30 minutes arrives; check Spam too.\n\nA forgotten cashier PIN is reset by the manager in the Staff section.',
      'На странице входа нажмите «Забыли пароль?» и укажите email регистрации. Если аккаунт существует, придёт письмо, действующее 30 минут; проверьте «Спам».\n\nЗабытый PIN кассира сбрасывает руководитель в разделе Сотрудники.',
    ),
    links: [L.login],
    chips: ['login_problem', 'pin'],
  },
  {
    id: 'pin',
    title: t('Kassir PIN-i', 'Cashier PIN', 'PIN кассира'),
    q: ['pin kodu unutdum', 'kassir pin', 'pin qebul olunmur', 'pin nece deyisim', 'cashier pin', 'pin кассира'],
    needs: ['@password', '@staff'],
    a: t(
      'Hər işçinin öz PIN-i var. PIN-i rəhbər və ya icazəsi olan istifadəçi proqramda İşçilər bölməsindən dəyişir. PIN qəbul olunmursa, düzgün işçi seçildiyinə və klaviaturaya baxın; PIN-dən sonra çıxan filial/sessiya xətası PIN xətası deyil — onun mətnini yazın.',
      'Each employee has their own PIN. A manager or authorised user changes it in the Staff section. If a PIN is rejected, check the selected employee and keyboard; a branch/session error after the PIN is not a PIN error — send its text.',
      'У каждого сотрудника свой PIN. Его меняет руководитель или пользователь с правами в разделе Сотрудники. Если PIN не принимается, проверьте выбранного сотрудника и раскладку; ошибка филиала/сессии после PIN — это не ошибка PIN, пришлите её текст.',
    ),
    chips: ['staff_add', 'roles'],
  },
  {
    id: 'hardware',
    offerAgent: true,
    title: t('Hansı avadanlıq lazımdır', 'What hardware you need', 'Какое оборудование нужно'),
    q: ['hansi avadanliq lazimdir', 'kassa ucun ne lazimdir', 'avadanliq satirsiz', 'komplekt lazimdir', 'what hardware do i need', 'do you sell equipment', 'какое оборудование нужно', 'продаёте оборудование'],
    a: t(
      'Tipik kassa dəsti:\n\n• POS kompüter və ya monoblok (Windows 10/11)\n• Çek printeri (termal, 80 mm)\n• Barkod skaneri (market üçün)\n• Pul qutusu\n• Tərəzi (çəki ilə satış varsa)\n• Restoranda əlavə mətbəx/bar printeri\n\nBunların hamısı avadanlıq kataloqumuzda var: POS kompüterlər, çek və barkod printerləri, skanerlər, pul yeşikləri, tərəzilər, həmçinin kamera, UPS və şəbəkə avadanlığı.',
      'A typical till set:\n\n• POS computer or all-in-one (Windows 10/11)\n• Receipt printer (thermal, 80 mm)\n• Barcode scanner (for retail)\n• Cash drawer\n• Scale (if you sell by weight)\n• Extra kitchen/bar printer for restaurants\n\nAll of these are in our hardware catalogue: POS computers, receipt and label printers, scanners, cash drawers, scales, plus cameras, UPS and network gear.',
      'Типовой комплект кассы:\n\n• POS-компьютер или моноблок (Windows 10/11)\n• Чековый принтер (термо, 80 мм)\n• Сканер штрихкода (для магазина)\n• Денежный ящик\n• Весы (если продаёте на вес)\n• Для ресторана — дополнительный принтер кухни/бара\n\nВсё это есть в нашем каталоге: POS-компьютеры, чековые и этикеточные принтеры, сканеры, денежные ящики, весы, а также камеры, ИБП и сеть.',
    ),
    links: [L.hardware],
    chips: ['hw_pc', 'hw_printer', 'hw_scanner', 'hw_buy'],
  },
  {
    id: 'hw_printer',
    title: t('Çek printerləri', 'Receipt printers', 'Чековые принтеры'),
    q: ['printer hansi modeldi', 'termal printer', 'cek printeri', 'cek printeri satirsiz', 'hansi printer uygundur', 'printer almaq isteyirem', 'printer qiymeti', 'barkod printer', 'which printer', 'buy a receipt printer', 'какой принтер нужен', 'купить чековый принтер'],
    needs: ['@printer', '@label'],
    avoid: ['@problem'],
    a: (ctx) => hardwareAnswer(ctx, /cek pri|printer|mini print|barkod print/, ['Kataloqdakı printerlər', 'Printers in the catalogue', 'Принтеры в каталоге'], ['Kataloqda indi printer görünmür. ' + PHONE, 'No printers in the catalogue right now. ' + PHONE, 'Принтеров в каталоге сейчас нет. ' + PHONE]),
    links: [L.hardware],
    chips: ['printer_connect', 'hw_buy'],
  },
  {
    id: 'hw_scanner',
    title: t('Barkod skanerləri', 'Barcode scanners', 'Сканеры штрихкода'),
    q: ['barkod skaner satirsiz', 'skaner lazimdir', 'hansi skaner uygundur', 'skaner qiymeti', 'barcode scanner', 'сканер штрихкода купить'],
    needs: ['@scanner', '@barcode'],
    avoid: ['@problem'],
    a: (ctx) => hardwareAnswer(ctx, /skaner|scaner|scanner/, ['Kataloqdakı skanerlər', 'Scanners in the catalogue', 'Сканеры в каталоге'], ['Kataloqda indi skaner görünmür. ' + PHONE, 'No scanners in the catalogue right now. ' + PHONE, 'Сканеров в каталоге сейчас нет. ' + PHONE]),
    links: [L.hardware],
    chips: ['scanner_problem', 'hw_buy'],
  },
  {
    id: 'hw_scale',
    title: t('Tərəzilər', 'Scales', 'Весы'),
    q: ['terezi satirsiz', 'hansi terezi uygundur', 'etiketli terezi', 'terezi qiymeti', 'buy a scale', 'весы купить'],
    needs: ['@scale'],
    avoid: ['@problem'],
    a: (ctx) => hardwareAnswer(ctx, /terezi|scale/, ['Kataloqdakı tərəzilər', 'Scales in the catalogue', 'Весы в каталоге'], ['Kataloqda indi tərəzi görünmür. ' + PHONE, 'No scales in the catalogue right now. ' + PHONE, 'Весов в каталоге сейчас нет. ' + PHONE]),
    links: [L.hardware],
    chips: ['scale_connect', 'hw_buy'],
  },
  {
    id: 'hw_drawer',
    title: t('Pul qutuları', 'Cash drawers', 'Денежные ящики'),
    q: ['pul qutusu satirsiz', 'pul yesiyi', 'kassa qutusu lazimdir', 'cash drawer', 'денежный ящик купить'],
    needs: ['@drawer'],
    avoid: ['@problem'],
    a: (ctx) => hardwareAnswer(ctx, /pul yes|pul qut|drawer/, ['Kataloqdakı pul qutuları', 'Cash drawers in the catalogue', 'Денежные ящики в каталоге'], ['Kataloqda indi pul qutusu görünmür. ' + PHONE, 'No cash drawers right now. ' + PHONE, 'Денежных ящиков сейчас нет. ' + PHONE]),
    links: [L.hardware],
    chips: ['drawer_problem', 'hw_buy'],
  },
  {
    id: 'hw_pc',
    title: t('POS kompüterlər və monobloklar', 'POS computers and all-in-ones', 'POS-компьютеры и моноблоки'),
    q: ['pos komputer satirsiz', 'monoblok lazimdir', 'monoblok satirsiz', 'sensor ekranli kompyuter', 'kassa ucun komputer', 'noutbuk satirsiz', 'pos computer', 'touch screen terminal', 'pos компьютер', 'сенсорный моноблок'],
    needs: ['@computer', '@pos_hw'],
    avoid: ['@problem', '@requirements'],
    a: (ctx) => hardwareAnswer(ctx, /pos komp|monobok|monoblok|mini komp|planset|ofis komp/, ['Kataloqdakı POS kompüterlər və monobloklar', 'POS computers and all-in-ones', 'POS-компьютеры и моноблоки'], ['Kataloqda indi kompüter görünmür. ' + PHONE, 'No computers right now. ' + PHONE, 'Компьютеров сейчас нет. ' + PHONE]),
    links: [L.hardware],
    chips: ['requirements', 'hw_buy'],
  },
  {
    id: 'hw_camera',
    title: t('Kamera sistemləri', 'Camera systems', 'Видеонаблюдение'),
    q: ['kamera satirsiz', 'videomusahide sistemi', 'wifi kamera', 'dvr', 'camera system', 'камеры видеонаблюдения'],
    needs: ['@camera'],
    a: (ctx) => hardwareAnswer(ctx, /kamera|dvr|camera/, ['Kataloqdakı kamera və DVR-lar', 'Cameras and DVRs', 'Камеры и DVR'], ['Kataloqda indi kamera görünmür. ' + PHONE, 'No cameras right now. ' + PHONE, 'Камер сейчас нет. ' + PHONE]),
    links: [L.hardware],
    chips: ['hw_buy'],
  },
  {
    id: 'hw_buy',
    offerAgent: true,
    title: t('Avadanlıq sifarişi', 'Ordering hardware', 'Заказ оборудования'),
    q: ['avadanligi nece sifaris edim', 'avadanliq sifarisi', 'avadanliq catdirilma', 'avadanligi catdirirsiz', 'sebete nece elave edim', 'catdirilma var', 'ozum goture bilerem', 'avadanliq odenisi', 'sifarisim harada', 'how to order hardware', 'delivery of equipment', 'как заказать оборудование', 'доставка оборудования'],
    a: t(
      'Kataloqda məhsulu səbətə əlavə edin və sifarişi tamamlayın: özünüz götürmə və ya ünvana çatdırılma seçilir, yekun və çatdırılma haqqı göstərilir. Kartla onlayn ödəniş bank inteqrasiyası aktiv olanda açılır.\n\nSifarişlərinizin vəziyyəti portalda “Sifarişlərim” bölməsindədir.',
      'Add products to the cart in the catalogue and complete the order: choose pickup or delivery; the total and delivery fee are shown. Online card payment opens once the bank integration is active.\n\nOrder status is in the portal under “My orders”.',
      'Добавьте товары в корзину и оформите заказ: самовывоз или доставка, итог и стоимость доставки показываются. Онлайн-оплата картой включается после активации банковской интеграции.\n\nСтатус заказов — в портале, «Мои заказы».',
    ),
    links: [L.hardware, L.orders],
    chips: ['hardware', 'partner'],
  },
  {
    id: 'contact',
    offerAgent: true,
    title: t('Əlaqə', 'Contact', 'Контакты'),
    q: ['elaqe nomreniz', 'telefon nomresi', 'nomrenizi verin', 'size nece zeng edim', 'whatsapp nomresi', 'elaqe', 'contact number', 'phone number', 'how to contact you', 'номер телефона', 'как с вами связаться'],
    needs: ['@contact', '@whatsapp', '@email'],
    avoid: ['@notify'],
    a: t(
      `${contactAz}\nÜnvan: ${ADDRESS_AZ}\n\nSatış, qoşulma və texniki suallar eyni xəttə gedir.`,
      `${contactEn}\nAddress: ${ADDRESS_EN}\n\nSales, setup and technical questions use the same line.`,
      `${contactRu}\nАдрес: ${ADDRESS_RU}\n\nПродажи, подключение и техвопросы — на одной линии.`,
    ),
    links: [L.support],
    chips: ['hours', 'address', 'human'],
  },
  {
    id: 'address',
    title: t('Ünvan', 'Address', 'Адрес'),
    q: ['unvaniniz', 'ofisiniz haradadir', 'haradasiniz', 'yaxinliqda ofis', 'gelmek isteyirem ofise', 'where is your office', 'address', 'где ваш офис', 'адрес'],
    needs: ['@address'],
    a: t(
      `Ofis: ${ADDRESS_AZ}.\n\nGəlməzdən əvvəl zəng edin ki, sizi düzgün mütəxəssis qarşılasın: ${PHONE}.`,
      `Office: ${ADDRESS_EN}.\n\nPlease call before visiting so the right specialist can meet you: ${PHONE}.`,
      `Офис: ${ADDRESS_RU}.\n\nПозвоните перед визитом, чтобы вас встретил нужный специалист: ${PHONE}.`,
    ),
    chips: ['hours', 'contact'],
  },
  {
    id: 'hours',
    title: t('İş saatları', 'Working hours', 'Часы работы'),
    q: ['is saatlariniz', 'saat neceye qeder isleyirsiz', 'bazar gunu isleyirsiz', 'indi aciqsiz', 'neche de baglanirsiz', 'working hours', 'are you open now', 'часы работы', 'вы сейчас работаете'],
    needs: ['@hours'],
    a: async (ctx) => {
      const h = await supportHours(ctx.app);
      const start = h?.start ?? '10:00', end = h?.end ?? '18:00';
      const now = h ? (h.isOpen ? ['İndi açığıq.', 'We are open now.', 'Сейчас работаем.'] : ['İndi iş vaxtı deyil — mesajınızı yazın, növbəti iş vaxtında cavab veririk.', 'We are closed now — leave a message and we will reply in working hours.', 'Сейчас нерабочее время — оставьте сообщение, ответим в рабочие часы.']) : ['', '', ''];
      return t(
        `Dəstək iş saatları: hər gün ${start}–${end} (Bakı vaxtı). ${now[0]}\n\nBu köməkçi isə 24/7 cavab verir.`,
        `Support hours: every day ${start}–${end} (Baku time). ${now[1]}\n\nThis assistant answers 24/7.`,
        `Поддержка: ежедневно ${start}–${end} (по Баку). ${now[2]}\n\nЭтот помощник отвечает круглосуточно.`,
      );
    },
    chips: ['contact', 'human'],
  },
  {
    id: 'human',
    title: t('Canlı əməkdaşla danışmaq', 'Talk to a person', 'Связаться с человеком'),
    avoid: ['@bot'],
    q: ['operatorla danismaq isteyirem', 'canli emekdas', 'insanla danismaq', 'live agent', 'menecere yazmaq', 'talk to a human', 'connect me to an agent', 'позовите оператора', 'хочу поговорить с человеком'],
    needs: ['@human'],
    a: t(
      '“Əməkdaşa yaz” düyməsini seçin və ya “live agent” yazın. Söhbəti nəzərdən keçirib göndərirsiniz, sorğu dəstək siyahısına düşür. Bunun üçün müştəri hesabına daxil olmaq lazımdır.\n\n' + contactAz,
      'Choose “Contact an agent” or type “live agent”. You review and send the conversation, and it goes to the support list. You need to be signed in.\n\n' + contactEn,
      'Нажмите «Написать специалисту» или напишите «live agent». Вы проверяете и отправляете переписку, запрос попадает в список поддержки. Нужно войти в аккаунт.\n\n' + contactRu,
    ),
    chips: ['hours', 'contact'],
  },
  {
    id: 'remote_help',
    offerAgent: true,
    title: t('Uzaqdan kömək', 'Remote help', 'Удалённая помощь'),
    q: ['uzaqdan qosula bilersiz', 'uzaqdan qosulun', 'anydesk ile baxin', 'kompyuterime qosulun', 'uzaqdan kompyutere baxin', 'remote support', 'подключитесь удалённо'],
    needs: ['@remote'],
    a: t(
      'Bəli, dəstək əməkdaşı lazım olanda kompüterinizə uzaqdan qoşulub kömək edə bilir. Əvvəlcə canlı əməkdaşa yazın — o, qoşulma qaydasını özü deyəcək. Qoşulma kodunu və şifrəni yalnız danışdığınız rəsmi əməkdaşla paylaşın.\n\n' + contactAz,
      'Yes, a support agent can connect to your computer remotely when needed. Contact a live agent first — they will explain how to connect. Share connection codes only with the official agent you are talking to.\n\n' + contactEn,
      'Да, специалист может при необходимости подключиться к компьютеру удалённо. Сначала напишите специалисту — он объяснит, как подключиться. Коды подключения сообщайте только официальному специалисту.\n\n' + contactRu,
    ),
    chips: ['human', 'onsite'],
  },
  {
    id: 'onsite',
    offerAgent: true,
    title: t('Yerində quraşdırma', 'On-site installation', 'Установка на месте'),
    q: ['qurasdirmani siz edirsiz', 'evime gele bilersiz', 'texnik gondere bilersiz', 'obyekte gelirsiz', 'usta lazimdir', 'do you install on site', 'приедете установить', 'нужен мастер'],
    needs: ['@onsite', '@install'],
    a: t(
      'Quraşdırma və təlim xidmətə daxildir. Komandamız quraşdırmanı uzaqdan və ya lazım olduqda obyektdə edir — avadanlığın qoşulması, proqramın qurulması və işçilərə təlim. Vaxtı razılaşdırmaq üçün zəng edin və ya yazın: ' + PHONE,
      'Installation and training are included. Our team installs remotely or on site when needed — connecting hardware, setting up the app and training staff. Call or message to schedule: ' + PHONE,
      'Установка и обучение включены. Команда устанавливает удалённо или на месте при необходимости — подключение оборудования, настройка программы и обучение сотрудников. Договоритесь о времени: ' + PHONE,
    ),
    chips: ['training', 'hardware'],
  },
  {
    id: 'training',
    title: t('Təlim', 'Training', 'Обучение'),
    q: ['telim kecirsiz', 'iscilere oyrede bilersiz', 'programi oyrenmek isteyirem', 'kurs var', 'do you provide training', 'обучение сотрудников'],
    needs: ['@training'],
    a: t(
      'Bəli, quraşdırma və təlim daxildir: kassir, menecer və sahibkar üçün gündəlik işi göstəririk. Özünüz də demoda sınaya və bu köməkçidən istənilən əməliyyatı soruşa bilərsiniz.',
      'Yes, installation and training are included: we walk cashiers, managers and owners through daily work. You can also practise in the demo and ask this assistant about any task.',
      'Да, установка и обучение включены: показываем кассирам, менеджерам и владельцу ежедневную работу. Также можно потренироваться в демо и спрашивать этого помощника.',
    ),
    links: [L.demo],
    chips: ['video', 'onsite'],
  },
  {
    id: 'video',
    title: t('Video təlimatlar', 'Video guides', 'Видеоинструкции'),
    q: ['video telimat var', 'youtube kanaliniz', 'video ile gosterin', 'video tutorial', 'видеоинструкция'],
    needs: ['@video'],
    a: t(
      'Saytda ayrıca video kanal elan olunmayıb. Əvəzində: Quraşdırma bələdçisi addım-addımdır, demoda real ekranları sınaya bilərsiniz, mənə istənilən əməliyyatı yazın — addımları deyəcəm. Canlı göstəriş üçün təlim daxildir.',
      'No video channel is published on the site. Instead: the installation guide is step by step, the demo shows the real screens, and you can ask me about any task. Live training is included.',
      'Отдельного видеоканала на сайте нет. Зато: пошаговая инструкция по установке, демо с реальными экранами, и можно спросить меня о любой операции. Живое обучение включено.',
    ),
    links: [L.setup, L.demo],
    chips: ['training'],
  },
  {
    id: 'partner',
    offerAgent: true,
    title: t('Partnyor və bayi', 'Partners and resellers', 'Партнёры и дилеры'),
    q: ['bayi olmaq isteyirem', 'partnyor proqrami', 'diler olmaq', 'sizinle emekdasliq', 'partnyor qiymeti', 'become a reseller', 'partner program', 'стать дилером', 'партнёрская программа'],
    needs: ['@partner'],
    a: t(
      'Partnyorlar üçün ayrıca hesab və xüsusi qiymətlər var: daxil olduqda məhsul kartında, səhifədə və səbətdə sizə ayrılmış qiymət görünür. Partnyor hesabını Possistem yaradır — əməkdaşlıq üçün bizimlə əlaqə saxlayın.\n\n' + contactAz,
      'Partners get a separate account with special prices shown on product cards, pages and in the cart. Possistem creates partner accounts — contact us to discuss cooperation.\n\n' + contactEn,
      'Для партнёров — отдельный аккаунт и специальные цены в карточках, на страницах и в корзине. Аккаунт создаёт Possistem — свяжитесь с нами для сотрудничества.\n\n' + contactRu,
    ),
    links: [L.partner],
    chips: ['contact'],
  },
  {
    id: 'community',
    title: t('İctimai chat', 'Community chat', 'Общий чат'),
    q: ['ictimai chat', 'forum var', 'diger istifadecilerle yazismaq', 'community chat', 'форум пользователей'],
    a: t(
      'Saytda ictimai chat var: istifadəçilər bir-biri ilə POS və sayt haqqında yazışır, dəstək komandası da orada cavab verir. Mesajlar hamıya açıqdır — hesab məlumatı, kart və şifrə yazmayın. Gündə bir yeni mövzu açmaq olar.',
      'There is a public community chat where users discuss the POS and website and the support team answers. Messages are public — never post account details, cards or passwords. You can open one new topic per day.',
      'На сайте есть общий чат: пользователи обсуждают POS и сайт, отвечает и поддержка. Сообщения публичны — не публикуйте данные аккаунта, карты и пароли. Можно открыть одну новую тему в день.',
    ),
    links: [L.community],
    chips: ['human'],
  },
  {
    id: 'language',
    title: t('Dil seçimi', 'Languages', 'Языки'),
    q: ['rus dilinde var', 'rusca var', 'ingilis dili var', 'proqramin dili', 'dili nece deyisim', 'which languages', 'есть на русском'],
    needs: ['@language'],
    a: t(
      'Sayt və müştəri portalı Azərbaycan, rus və ingilis dillərindədir — dili səhifənin yuxarısından dəyişin. Bu köməkçi də üç dildə cavab verir. Kassa proqramının dil seçimi barədə dəqiqləşdirmə üçün demoya baxın və ya dəstəyə yazın.',
      'The website and customer portal are in Azerbaijani, Russian and English — switch at the top of the page. This assistant answers in all three. For the till app’s language options, check the demo or ask support.',
      'Сайт и клиентский портал — на азербайджанском, русском и английском, язык меняется вверху страницы. Помощник отвечает на трёх языках. Про языки кассовой программы — смотрите демо или спросите поддержку.',
    ),
    chips: ['demo'],
  },
  {
    id: 'speed',
    title: t('Proqram yavaş işləyir / donur', 'App is slow or freezes', 'Программа тормозит или зависает'),
    q: ['proqram yavas isleyir', 'proqram donur', 'gec acilir', 'kassa ilisir', 'app is slow', 'программа тормозит', 'зависает'],
    needs: ['@speed', '@problem'],
    a: t(
      '1. Kompüter tələblərə uyğun olsun: 4 GB RAM minimum (8 GB tövsiyə), SSD.\n2. Eyni anda ağır proqramlar (oyun, çoxlu brauzer tabı) bağlı olsun.\n3. Proqramı tam bağlayıb yenidən açın; donma davam edirsə, nə vaxt baş verdiyini (satışda, hesabatda, açılışda) qeyd edin.\n4. Bazanı silməyin və yenidən quraşdırmayın. Versiyanı və anını əməkdaşa yazın.',
      '1. Check requirements: 4 GB RAM minimum (8 GB recommended), SSD.\n2. Close heavy programs (games, many browser tabs).\n3. Close and reopen the app; if it keeps freezing, note when (during sale, reports, start-up).\n4. Do not delete the database or reinstall. Send the version and moment to an agent.',
      '1. Требования: от 4 ГБ ОЗУ (рекомендуется 8), SSD.\n2. Закройте тяжёлые программы (игры, много вкладок).\n3. Перезапустите программу; если зависает дальше, отметьте когда (продажа, отчёты, запуск).\n4. Не удаляйте базу и не переустанавливайте. Сообщите версию и момент специалисту.',
    ),
    chips: ['requirements', 'human'],
  },
  {
    id: 'tax',
    offerAgent: true,
    title: t('Vergi, NKA və e-kassa', 'Tax, fiscal device and e-kassa', 'Налоги, ККА и e-kassa'),
    q: ['e-kassa ile isleyir', 'vergi kassasi qosulur', 'nka ile inteqrasiya', 'nkm ile inteqrasiya', 'fiskal cek', 'vergiye hesabat gedir', 'edv hesablayir', 'fiscal printer', 'works with tax authority', 'фискальный чек', 'интеграция с налоговой'],
    needs: ['@tax'],
    a: t(
      'Azərbaycanda nağd və kartla hesablaşmada qanunvericiliyə görə Vergi Xidmətində qeydiyyatlı nəzarət-kassa aparatı (NKA, “e-kassa”) tələb olunur; alıcı çeki e-kassa.gov.az üzərindən yoxlaya bilir.\n\nPossistem satış, anbar və idarəetmə proqramıdır. Məhsul kartında ƏDV dərəcəsi saxlanılır (standart 18%). Sizin NKA modelinizlə inteqrasiya imkanını dəqiqləşdirmək üçün modeli satış komandasına yazın: ' + PHONE + '\n\nVergi öhdəliyi barədə qərarı mühasibinizlə dəqiqləşdirin.',
      'In Azerbaijan, cash and card settlements legally require a fiscal cash register (NKA, “e-kassa”) registered with the State Tax Service; buyers can verify receipts on e-kassa.gov.az.\n\nPossistem is sales, stock and management software. Product cards store the VAT rate (standard 18%). To confirm integration with your fiscal device model, send the model to sales: ' + PHONE + '\n\nConfirm tax obligations with your accountant.',
      'В Азербайджане при расчётах наличными и картой по закону нужен зарегистрированный в Налоговой службе контрольно-кассовый аппарат (NKA, «e-kassa»); покупатель может проверить чек на e-kassa.gov.az.\n\nPossistem — программа продаж, склада и управления. В карточке товара хранится ставка НДС (стандарт 18%). Совместимость с вашей моделью ККА уточните у отдела продаж: ' + PHONE + '\n\nНалоговые обязательства уточняйте у бухгалтера.',
    ),
    chips: ['contact', 'reports'],
  },
];
