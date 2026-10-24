import translations from './translations.json';

export type Language = 'en' | 'az' | 'ru';

export const SUPPORTED_LANGUAGES: Language[] = ['en', 'az', 'ru'];
export const STORAGE_KEY = 'possistem-language';

type TranslationMap = Record<string, Partial<Record<Language, string>>>;

const catalog = translations as TranslationMap;

const extras: TranslationMap = {
  'common.theme.light': { en: 'Switch to light mode', az: 'İşıqlı rejimə keç', ru: 'Включить светлую тему' },
  'common.theme.dark': { en: 'Switch to dark mode', az: 'Qaranlıq rejimə keç', ru: 'Включить тёмную тему' },
  'common.menu.open': { en: 'Open menu', az: 'Menyunu aç', ru: 'Открыть меню' },
  'common.menu.close': { en: 'Close menu', az: 'Menyunu bağla', ru: 'Закрыть меню' },
  'common.languageLabel': { en: 'Language', az: 'Dil', ru: 'Язык' },
  'common.language.az': { en: 'Azerbaijani', az: 'Azərbaycan', ru: 'Азербайджанский' },
  'common.language.en': { en: 'English', az: 'İngilis', ru: 'Английский' },
  'common.language.ru': { en: 'Russian', az: 'Rus', ru: 'Русский' },
  'form.error.name': { en: 'Enter at least two characters.', az: 'Ad və soyad ən azı 2 simvol olmalıdır.', ru: 'Введите не менее двух символов.' },
  'form.error.businessName': { en: 'Enter your business name.', az: 'Biznesin adını qeyd edin.', ru: 'Введите название бизнеса.' },
  'form.error.phone': { en: 'Enter a valid phone number.', az: 'Düzgün telefon nömrəsi daxil edin.', ru: 'Введите корректный номер телефона.' },
  'form.error.generic': { en: 'Complete this field correctly.', az: 'Bu sahəni düzgün doldurun.', ru: 'Заполните это поле правильно.' },
  'form.error.invalid': { en: 'Please correct the highlighted fields.', az: 'Zəhmət olmasa işarələnmiş sahələri düzgün doldurun.', ru: 'Исправьте выделенные поля.' },
  'form.sending': { en: 'Sending request…', az: 'Sorğu göndərilir…', ru: 'Отправка запроса…' },
  'form.requestError': { en: 'The request could not be sent.', az: 'Sorğu göndərilə bilmədi.', ru: 'Не удалось отправить запрос.' },
  'form.success': { en: 'Request received. Our sales team will contact you shortly.', az: 'Sorğunuz qəbul edildi. Satış komandamız qısa müddətdə sizinlə əlaqə saxlayacaq.', ru: 'Запрос получен. Наша команда продаж скоро свяжется с вами.' },
  'form.failure': { en: 'The form could not be sent. Please contact us on WhatsApp at 051 333 35 55.', az: 'Hazırda forma göndərilmədi. Zəhmət olmasa WhatsApp vasitəsilə 051 333 35 55 nömrəsinə yazın.', ru: 'Форму отправить не удалось. Напишите нам в WhatsApp: 051 333 35 55.' },
  'form.offline': {
    en: 'You appear to be offline. Reconnect and try again, or reach us on WhatsApp: 051 333 35 55.',
    az: 'İnternet bağlantısı yoxdur. Qoşulub yenidən cəhd edin və ya WhatsApp: 051 333 35 55.',
    ru: 'Нет подключения к интернету. Подключитесь и повторите, или напишите в WhatsApp: 051 333 35 55.',
  },
  'form.retry': { en: 'Try again', az: 'Yenidən cəhd edin', ru: 'Повторить' },
  'form.submit': { en: 'Send pricing request', az: 'Qiymət sorğusunu göndərin', ru: 'Отправить запрос цены' },
  'index.attr.heroTrust': {
    en: 'Main advantages',
    az: 'Əsas üstünlüklər',
    ru: 'Основные преимущества',
  },
  'form.error.summaryTitle': {
    en: 'There is a problem with your submission',
    az: 'Formada düzəliş tələb olunan sahələr var',
    ru: 'В форме есть поля, требующие исправления',
  },
  'form.successNext': {
    en: 'We usually respond within one business day via phone or WhatsApp.',
    az: 'Adətən bir iş günü ərzində telefon və ya WhatsApp ilə geri dönüş edirik.',
    ru: 'Обычно мы отвечаем в течение одного рабочего дня по телефону или WhatsApp.',
  },
  'updates.releaseStatus': {
    en: 'Latest stable possistem release for Windows.',
    az: 'Windows üçün son stabil possistem buraxılışı.',
    ru: 'Последняя стабильная версия possistem для Windows.',
  },
  'meta.siteTitle': {
    en: 'possistem — Business operations in one system',
    az: 'possistem — Biznes əməliyyatları bir sistemdə',
    ru: 'possistem — Операции бизнеса в одной системе',
  },
  'meta.siteDescription': {
    en: 'possistem — POS for restaurants, retail, cafés and more: checkout, management, live owner portal, setup and updates.',
    az: 'possistem — restoran, market, kafe və digər bizneslər üçün kassa, idarəetmə, canlı portal, quraşdırma və yeniliklər.',
    ru: 'possistem — POS для ресторанов, ритейла, кафе и других бизнесов: касса, управление, портал, установка и обновления.',
  },
  'meta.ogDescription': {
    en: 'Manage checkout, sales, live reports, setup and updates — for every business.',
    az: 'Kassa, satış, canlı hesabat, quraşdırma və yenilikləri biznesiniz üçün aydın idarə edin.',
    ru: 'Управляйте кассой, продажами, отчётами, установкой и обновлениями для любого бизнеса.',
  },
  'hero.compare.beforeLabel': { en: 'Before', az: 'Köhnə', ru: 'Старое' },
  'hero.compare.afterLabel': { en: 'possistem', az: 'possistem', ru: 'possistem' },
  'hero.compare.beforeAlt': {
    en: 'Legacy POS system',
    az: 'Köhnə POS sistemi',
    ru: 'Устаревшая POS-система',
  },
  'hero.compare.afterAlt': {
    en: 'possistem modern business management system',
    az: 'possistem müasir biznes idarəetmə sistemi',
    ru: 'Современная система possistem для бизнеса',
  },
  'common.brandName': { en: 'possistem', az: 'possistem', ru: 'possistem' },
  'image.product.hero': {
    en: 'possistem product overview',
    az: 'possistem məhsul icmalı',
    ru: 'Обзор продукта possistem',
  },
  'image.product.cashier': {
    en: 'possistem cashier screen',
    az: 'possistem kassa ekranı',
    ru: 'Экран кассы possistem',
  },
  'image.product.owner': {
    en: 'possistem owner portal',
    az: 'possistem sahibkar portalı',
    ru: 'Портал владельца possistem',
  },
  'image.product.notifications': {
    en: 'possistem notifications panel',
    az: 'possistem bildiriş paneli',
    ru: 'Панель уведомлений possistem',
  },
  'image.home.setup': {
    en: 'possistem setup workflow',
    az: 'possistem quraşdırma axını',
    ru: 'Процесс установки possistem',
  },
  'image.home.offline': {
    en: 'possistem offline reliability',
    az: 'possistem offline etibarlılıq',
    ru: 'Надёжность possistem в offline',
  },
  'image.home.journey': {
    en: 'Business onboarding with possistem',
    az: 'possistem ilə biznes onboarding',
    ru: 'Подключение бизнеса к possistem',
  },
  'image.home.downloads': {
    en: 'possistem downloads and updates',
    az: 'possistem yükləmələr və yeniliklər',
    ru: 'Загрузки и обновления possistem',
  },
  'index.mock.activityTitle': {
    en: 'Activity & notifications',
    az: 'Fəaliyyət və bildirişlər',
    ru: 'Активность и уведомления',
  },
  'index.mock.activitySub': {
    en: 'Live events and reports',
    az: 'Canlı hadisələr və hesabatlar',
    ru: 'События и отчёты в реальном времени',
  },
  'index.mock.tabAll': { en: 'All', az: 'Hamısı', ru: 'Все' },
  'index.mock.tabAlerts': { en: 'Alerts', az: 'Bildirişlər', ru: 'Уведомления' },
  'index.mock.tabAccount': { en: 'Account', az: 'Hesab', ru: 'Аккаунт' },
  'index.mock.posOnline': { en: 'POS connected', az: 'POS bağlıdır', ru: 'POS подключён' },
  'index.mock.posIp': { en: 'Main register · 192.168.1.45', az: 'Əsas kassa · 192.168.1.45', ru: 'Основная касса · 192.168.1.45' },
  'index.mock.salesReport': { en: 'Daily sales report', az: 'Günlük satış hesabatı', ru: 'Дневной отчёт продаж' },
  'index.mock.salesAmount': { en: 'Daily sales · 1,245.50 AZN', az: 'Günlük satış · 1 245.50 ₼', ru: 'Дневные продажи · 1 245.50 ₼' },
  'index.mock.newOrder': { en: 'New order', az: 'Yeni sifariş', ru: 'Новый заказ' },
  'index.mock.tableOrder': { en: 'Table 5 · #0284', az: 'Masa 5 · #0284', ru: 'Стол 5 · #0284' },
  'index.mock.waTitle': {
    en: 'Integrations · WhatsApp',
    az: 'İnteqrasiyalar · WhatsApp',
    ru: 'Интеграции · WhatsApp',
  },
  'index.mock.waSub': {
    en: 'Live alerts, chat link and test message',
    az: 'Canlı bildirişlər, söhbət linki və test mesajı',
    ru: 'Уведомления, ссылка на чат и тестовое сообщение',
  },
  'index.mock.statusOnline': { en: 'Online', az: 'Onlayn', ru: 'Онлайн' },
  'index.mock.statusConnected': { en: 'Connected', az: 'Bağlı', ru: 'Подключено' },
  'index.mock.activitySummary': {
    en: '{count} events · full timeline in portal',
    az: '{count} hadisə · portaldakı tam siyahı',
    ru: '{count} событий · полный список в портале',
  },
  'index.mock.waOpenChat': {
    en: 'Open WhatsApp chat',
    az: 'WhatsApp söhbətini aç',
    ru: 'Открыть чат WhatsApp',
  },
  'index.mock.waPhoneLabel': { en: 'Phone number', az: 'Telefon nömrəsi', ru: 'Номер телефона' },
  'index.mock.waTestBtn': { en: 'Send test message', az: 'Test mesajı göndər', ru: 'Отправить тест' },
  'index.mock.waTestSent': { en: 'Opening WhatsApp…', az: 'WhatsApp açılır…', ru: 'Открываем WhatsApp…' },
  'index.mock.waChannel': {
    en: 'WhatsApp Business',
    az: 'WhatsApp Business',
    ru: 'WhatsApp Business',
  },
  'index.mock.waPreviewLabel': {
    en: 'Recent alerts',
    az: 'Son bildirişlər',
    ru: 'Последние уведомления',
  },
  'index.mock.waMsgTime': { en: '09:41', az: '09:41', ru: '09:41' },
  'index.mock.waMsg1Title': {
    en: 'Daily sales report',
    az: 'Günlük satış hesabatı',
    ru: 'Дневной отчёт продаж',
  },
  'index.mock.waMsg1Body': {
    en: 'Today: 1,245.50 AZN · 84 receipts · vs yesterday +6%',
    az: 'Bu gün: 1 245.50 ₼ · 84 çek · dünənə +6%',
    ru: 'Сегодня: 1 245.50 ₼ · 84 чека · к вчера +6%',
  },
  'index.mock.waMsg2Title': {
    en: 'Stock alert',
    az: 'Stok xəbərdarlığı',
    ru: 'Оповещение о запасах',
  },
  'index.mock.waMsg2Body': {
    en: 'Potato stock low — 4 kg left. Reorder suggested.',
    az: 'Kartof stoku azalıb — 4 kq qalıb. Sifariş tövsiyə olunur.',
    ru: 'Запас картофеля низкий — осталось 4 кг. Рекомендуем заказ.',
  },
  'index.mock.waActive': { en: 'active', az: 'aktiv', ru: 'активно' },
  'index.mock.waAlertsLabel': {
    en: 'Alert types',
    az: 'Bildiriş növləri',
    ru: 'Типы уведомлений',
  },
  'index.mock.waCheck1': { en: 'Daily report', az: 'Günlük hesabat', ru: 'Дневной отчёт' },
  'index.mock.waCheck2': { en: 'Stock alert', az: 'Stok xəbərdarlığı', ru: 'Оповещение о запасах' },
  'index.mock.waCheck3': { en: 'System events', az: 'Sistem hadisələri', ru: 'Системные события' },
  'index.mock.dlTitle': {
    en: 'Windows setup',
    az: 'Windows quruluşu',
    ru: 'Установка Windows',
  },
  'index.mock.dlAccount': { en: 'Demo LLC', az: 'Demo MMC', ru: 'Demo ООО' },
  'index.mock.dlVersion': { en: 'Version 1.6.0', az: 'Versiya 1.6.0', ru: 'Версия 1.6.0' },
  'index.mock.dlFile': {
    en: 'Possistem-Setup-1.6.0.exe · 190 MB',
    az: 'Possistem-Setup-1.6.0.exe · 190 MB',
    ru: 'Possistem-Setup-1.6.0.exe · 190 MB',
  },
  'index.mock.dlCta': { en: 'Download', az: 'Yüklə', ru: 'Скачать' },
  'index.mock.dlReqTitle': { en: 'System requirements', az: 'Sistem tələbləri', ru: 'Системные требования' },
  'index.mock.dlReqOs': {
    en: 'Windows 10 22H2+ / Windows 11 · 64-bit',
    az: 'Windows 10 22H2+ / Windows 11 · 64-bit',
    ru: 'Windows 10 22H2+ / Windows 11 · 64-bit',
  },
  'index.mock.dlReqCpu': {
    en: '2 cores ~2 GHz · i3 / Ryzen 3 recommended',
    az: '2 nüvə ~2 GHz · tövsiyə i3 / Ryzen 3',
    ru: '2 ядра ~2 ГГц · рекомендуется i3 / Ryzen 3',
  },
  'index.mock.dlReqRam': {
    en: '4 GB RAM min · 8 GB comfortable',
    az: 'Minimum 4 GB RAM · rahat 8 GB',
    ru: 'Мин. 4 ГБ RAM · комфортно 8 ГБ',
  },
  'index.mock.dlReqGpu': {
    en: 'NVIDIA not required — Intel/AMD iGPU is enough',
    az: 'NVIDIA lazım deyil — Intel/AMD iGPU kifayətdir',
    ru: 'NVIDIA не нужна — хватит Intel/AMD iGPU',
  },
  'product.tabs.label': { en: 'Product sections', az: 'Məhsul bölmələri', ru: 'Разделы продукта' },
  'product.tabs.program': { en: 'Software', az: 'Proqram', ru: 'Программа' },
  'product.tabs.hardware': { en: 'Hardware', az: 'Avadanlıq', ru: 'Оборудование' },
  'hardware.eyebrow': { en: 'POS hardware', az: 'POS avadanlıqları', ru: 'POS-оборудование' },
  'hardware.meta.description': {
    en: 'Touch POS, receipt printers, cash drawers, scanners and accessories for possistem — for restaurants, retail and more.',
    az: 'possistem üçün sensor POS, printer, pul yeşiyi, skaner və aksesuarlar — restoran, market və digər bizneslər.',
    ru: 'POS, принтеры, ящики, сканеры для possistem — для ресторанов, ритейла и других бизнесов.',
  },
  'hardware.hero.heading': {
    en: 'POS hardware <em>for your checkout desk.</em>',
    az: 'Kassa masanız üçün <em>POS avadanlıqları.</em>',
    ru: 'POS-оборудование <em>для вашей кассы.</em>',
  },
  'hardware.hero.desc': {
    en: 'Real models for restaurants, retail and more — touch POS, printers, drawers, scanners and accessories.',
    az: 'Restoran, market və digər bizneslər üçün real modellər — sensor POS, printer, pul yeşiyi, skaner və aksesuarlar.',
    ru: 'Реальные модели для ресторанов, ритейла и других бизнесов — POS, принтеры, ящики и сканеры.',
  },
  'hardware.title': {
    en: 'Build your checkout setup',
    az: 'Kassa dəstinizi formalaşdırın',
    ru: 'Соберите кассовый комплект',
  },
  'hardware.subtitle': {
    en: 'Touch POS, printers, cash drawer and accessories for restaurants, retail and more — request a quote.',
    az: 'Restoran, market və digər bizneslər üçün sensor POS, printer, pul yeşiyi və aksesuarlar — qiymət sorğusu.',
    ru: 'POS, принтеры и аксессуары для ресторанов, ритейла и других бизнесов — запросите предложение.',
  },
  'hardware.stats.products': { en: 'catalog items', az: 'kataloq modeli', ru: 'моделей в каталоге' },
  'hardware.stats.categories': { en: 'categories', az: 'kateqoriya', ru: 'категорий' },
  'hardware.stats.compatible': { en: 'compatible setup', az: 'uyğun quraşdırma', ru: 'совместимая установка' },
  'hardware.resultsLabel': { en: 'products', az: 'məhsul', ru: 'товаров' },
  'hardware.filtersLabel': { en: 'Hardware categories', az: 'Avadanlıq kateqoriyaları', ru: 'Категории оборудования' },
  'hardware.cta.quote': { en: 'Request a quote', az: 'Qiymət sorğusu', ru: 'Запросить цену' },
  'hardware.cta.order': { en: 'Order', az: 'Sifariş ver', ru: 'Заказать' },
  'hardware.cta.details': { en: 'Details', az: 'Ətraflı', ru: 'Подробнее' },
  'hardware.loading': { en: 'Loading catalog…', az: 'Kataloq yüklənir…', ru: 'Загрузка каталога…' },
  'hardware.loadError': {
    en: 'Could not load the hardware catalog. Please try again.',
    az: 'Avadanlıq kataloqu yüklənmədi. Yenidən cəhd edin.',
    ru: 'Не удалось загрузить каталог. Попробуйте ещё раз.',
  },
  'hardware.detail.notFound': {
    en: 'Product not found.',
    az: 'Məhsul tapılmadı.',
    ru: 'Товар не найден.',
  },
  'hardware.detail.back': { en: 'Back to catalog', az: 'Kataloqa qayıt', ru: 'К каталогу' },
  'hardware.detail.brand': { en: 'Brand', az: 'Brend', ru: 'Бренд' },
  'hardware.detail.sku': { en: 'SKU', az: 'SKU', ru: 'Артикул' },
  'hardware.detail.stock': { en: 'Availability', az: 'Stok', ru: 'Наличие' },
  'hardware.detail.price': { en: 'Price', az: 'Qiymət', ru: 'Цена' },
  'hardware.detail.inStock': { en: 'In stock', az: 'Stokda var', ru: 'В наличии' },
  'hardware.detail.outOfStock': { en: 'Out of stock', az: 'Stokda yoxdur', ru: 'Нет в наличии' },
  'hardware.stock.remaining': { en: 'In stock: {count}', az: 'Stokda: {count}', ru: 'В наличии: {count}' },
  'hardware.stock.units': { en: '{count}', az: '{count} ədəd', ru: '{count} шт.' },
  'hardware.detail.description': { en: 'Description', az: 'Təsvir', ru: 'Описание' },
  'hardware.detail.specs': { en: 'Specifications', az: 'Texniki məlumat', ru: 'Характеристики' },
  'hardware.cta.supplier': { en: 'View supplier', az: 'Təchizatçıya bax', ru: 'Поставщик' },
  'hardware.ctaBlock.eyebrow': { en: 'Need help choosing?', az: 'Seçimdə kömək lazımdır?', ru: 'Нужна помощь с выбором?' },
  'hardware.ctaBlock.title': { en: 'We assemble a compatible bundle for possistem', az: 'possistem üçün uyğun dəsti birlikdə formalaşdırırıq', ru: 'Соберём совместимый комплект для possistem' },
  'hardware.ctaBlock.desc': {
    en: 'Tell us your venue type and we suggest POS, printers and accessories that fit your workflow.',
    az: 'Məkan tipinizi deyin — POS, printer və aksesuarları iş axınınıza uyğun təklif edək.',
    ru: 'Расскажите о формате заведения — подберём POS, принтеры и аксессуары под ваш процесс.',
  },
  'hardware.supplierNote': {
    en: 'Reference supplier:',
    az: 'İstinad təchizatçı:',
    ru: 'Референс-поставщик:',
  },
  'hardware.badge.restaurant': { en: 'Food service', az: 'Qida xidməti', ru: 'Общепит' },
  'hardware.badge.market': { en: 'Retail', az: 'Market', ru: 'Ритейл' },
  'hardware.badge.both': { en: 'All businesses', az: 'Bütün bizneslər', ru: 'Любой бизнес' },
  'hardware.badge.info': { en: 'Info', az: 'Məlumat', ru: 'Инфо' },
  'hardware.badge.featured': { en: 'Popular', az: 'Populyar', ru: 'Популярное' },
  'hardware.cat.all': { en: 'All', az: 'Hamısı', ru: 'Все' },
  'hardware.cat.core': { en: 'POS terminals', az: 'POS terminallar', ru: 'POS-терминалы' },
  'hardware.cat.print': { en: 'Printers', az: 'Printerlər', ru: 'Принтеры' },
  'hardware.cat.cashier': { en: 'Cash drawer', az: 'Pul yeşiyi', ru: 'Денежный ящик' },
  'hardware.cat.scan': { en: 'Scan & scale', az: 'Skaner və tərəzi', ru: 'Сканеры и весы' },
  'hardware.cat.display': { en: 'Displays', az: 'Ekranlar', ru: 'Дисплеи' },
  'hardware.cat.accessories': { en: 'Accessories', az: 'Aksesuarlar', ru: 'Аксессуары' },
  'hardware.starter.eyebrow': { en: 'Starter bundle', az: 'Başlanğıc dəsti', ru: 'Стартовый комплект' },
  'hardware.starter.title': {
    en: 'Recommended checkout bundle',
    az: 'Tövsiyə olunan kassa dəsti',
    ru: 'Рекомендуемый кассовый комплект',
  },
  'hardware.starter.desc': {
    en: 'A practical first bundle for any business starting with possistem — retail, food service and more.',
    az: 'possistem ilə başlayan hər biznes üçün praktik ilk dəst — market, kafe, restoran və digərləri.',
    ru: 'Практичный первый комплект для любого бизнеса с possistem — ритейл, общепит и другие.',
  },
  'hardware.starter.cta': { en: 'Request bundle quote', az: 'Dəst sorğusu göndər', ru: 'Запросить комплект' },
  'hardware.item.touchPosApcProS2.title': {
    en: 'Touch POS — APC PRO S2 15.6", i5, 8GB, 128GB SSD',
    az: 'Touch POS — APC PRO S2 15.6", i5, 8GB, 128GB SSD',
    ru: 'Touch POS — APC PRO S2 15.6", i5, 8GB, 128GB SSD',
  },
  'hardware.item.touchPosApcProS2.desc': {
    en: 'All-in-One 15.6" touch PC with Core i5, 8GB RAM and 128GB SSD for cashier operations.',
    az: 'Core i5, 8GB RAM və 128GB SSD ilə 15.6" sensor All-in-One kassa kompüteri.',
    ru: 'All-in-One 15.6" с Core i5, 8GB RAM и 128GB SSD для кассовых операций.',
  },
  'hardware.item.dualPosApcS1m.title': {
    en: 'Dual Screen Touch POS — APC S1-M 15"+15"',
    az: 'İki ekranlı Touch POS — APC S1-M 15"+15"',
    ru: 'Touch POS с двумя экранами — APC S1-M 15"+15"',
  },
  'hardware.item.dualPosApcS1m.desc': {
    en: 'Dual 15" touch screens for cashier and customer-facing display in one unit.',
    az: 'Kassir və müştəri ekranı üçün bir korpusda iki 15" sensor ekran.',
    ru: 'Два 15" сенсорных экрана для кассира и клиента в одном корпусе.',
  },
  'hardware.item.receiptPrinter806k.title': {
    en: 'Receipt printer — Xprinter XP-Q806K USB + LAN',
    az: 'Çek printeri — Xprinter XP-Q806K USB + LAN',
    ru: 'Чековый принтер — Xprinter XP-Q806K USB + LAN',
  },
  'hardware.item.receiptPrinter806k.desc': {
    en: '80mm thermal receipt printer with USB and LAN for cashier and kitchen tickets.',
    az: 'Kassa və mətbəx çekləri üçün USB və LAN ilə 80mm termal printer.',
    ru: '80mm термопринтер с USB и LAN для кассы и кухни.',
  },
  'hardware.item.labelPrinter428b.title': {
    en: 'Barcode / label printer — Xprinter XP-428B 100mm',
    az: 'Barkod / etiket printeri — Xprinter XP-428B 100mm',
    ru: 'Принтер этикеток — Xprinter XP-428B 100mm',
  },
  'hardware.item.labelPrinter428b.desc': {
    en: '100mm label printer for product tags and barcode labels in retail.',
    az: 'Pərakəndədə məhsul etiketləri və barkodlar üçün 100mm printer.',
    ru: '100mm принтер для этикеток и штрихкодов в ритейле.',
  },
  'hardware.item.cashDrawer405cb.title': {
    en: 'Cash drawer — APC-405CB',
    az: 'Pul yeşiyi — APC-405CB',
    ru: 'Денежный ящик — APC-405CB',
  },
  'hardware.item.cashDrawer405cb.desc': {
    en: 'Metal cash drawer with printer kick for secure cash handling at checkout.',
    az: 'Kassada nağd pul üçün printer kick ilə metal pul yeşiyi.',
    ru: 'Металлический ящик с открытием от принтера для работы с наличными.',
  },
  'hardware.item.scannerSunlux.title': {
    en: '2D barcode scanner — SUNLUX XL3620',
    az: '2D barkod skaner — SUNLUX XL3620',
    ru: '2D сканер штрихкодов — SUNLUX XL3620',
  },
  'hardware.item.scannerSunlux.desc': {
    en: 'Handheld 2D scanner for products, QR codes and inventory workflows.',
    az: 'Məhsul, QR kod və anbar axınları üçün portativ 2D skaner.',
    ru: 'Ручной 2D-сканер для товаров, QR и складских операций.',
  },
  'hardware.item.scaleMercRombi7.title': {
    en: 'Electronic barcode scale — MERC ROMBI-7',
    az: 'Elektron barkod tərəzi — MERC ROMBI-7',
    ru: 'Электронные весы со штрихкодом — MERC ROMBI-7',
  },
  'hardware.item.scaleMercRombi7.desc': {
    en: 'Label-printing scale for weighted products in markets and delis.',
    az: 'Market və deli formatında çəkili məhsullar üçün etiketli tərəzi.',
    ru: 'Весы с печатью этикетки для весовых товаров в магазинах.',
  },
  'hardware.item.terminalChainwayC61.title': {
    en: 'Mobile data terminal — Chainway C61',
    az: 'Mobil data terminal — Chainway C61',
    ru: 'Мобильный терминал сбора данных — Chainway C61',
  },
  'hardware.item.terminalChainwayC61.desc': {
    en: 'Rugged handheld terminal for stock counts, receiving and barcode scanning.',
    az: 'Anbar sayımı, qəbul və barkod oxuma üçün möhkəm portativ terminal.',
    ru: 'Прочный терминал для инвентаризации, приёмки и сканирования.',
  },
  'hardware.item.customerDisplayApex.title': {
    en: 'Customer display — APEX PRM 1520 Display 9.7"',
    az: 'Müştəri ekranı — APEX PRM 1520 Display 9.7"',
    ru: 'Дисплей для клиента — APEX PRM 1520 Display 9.7"',
  },
  'hardware.item.customerDisplayApex.desc': {
    en: '9.7" pole display showing order total and payment amount to guests.',
    az: 'Qonağa sifariş və ödəniş məbləğini göstərən 9.7" pole display.',
    ru: '9.7" дисплей на стойке с суммой заказа для клиента.',
  },
  'hardware.item.priceCheckerOcpc.title': {
    en: 'Price checker — OCOM OCPC-002 Windows',
    az: 'Qiymət yoxlama ekranı — OCOM OCPC-002 Windows',
    ru: 'Прайс-чекер — OCOM OCPC-002 Windows',
  },
  'hardware.item.priceCheckerOcpc.desc': {
    en: 'Windows price verification screen for retail aisles and self-check workflows.',
    az: 'Pərakəndə rəflər və qiymət yoxlama üçün Windows ekranı.',
    ru: 'Windows-экран для проверки цены в торговом зале.',
  },
  'hardware.item.cat6Cable.title': {
    en: 'CAT6 network cable — Biyikci CAT6 UTP',
    az: 'CAT6 şəbəkə kabeli — Biyikci CAT6 UTP',
    ru: 'Сетевой кабель CAT6 — Biyikci CAT6 UTP',
  },
  'hardware.item.cat6Cable.desc': {
    en: 'Reliable UTP cabling for connecting POS, printers and network devices.',
    az: 'POS, printer və şəbəkə cihazlarını birləşdirmək üçün etibarlı UTP kabel.',
    ru: 'Надёжный UTP-кабель для POS, принтеров и сетевых устройств.',
  },
  'hardware.item.thermalPaper80.title': {
    en: '80×80 thermal receipt paper — 80 mm × 80 m',
    az: '80×80 termal çek kağızı — 80 mm × 80 m',
    ru: 'Термобумага 80×80 — 80 mm × 80 m',
  },
  'hardware.item.thermalPaper80.desc': {
    en: 'Standard 80mm thermal rolls for receipt printers at the checkout.',
    az: 'Kassa çek printerləri üçün standart 80mm termal rulon.',
    ru: 'Стандартные 80mm терморулоны для чековых принтеров.',
  },
  'hardware.nav.departments': { en: 'Catalogs', az: 'Kataloqlar', ru: 'Каталоги' },
  'hardware.nav.categories': { en: 'In this catalog', az: 'Bu kataloqda', ru: 'В этом каталоге' },
  'hardware.search.label': { en: 'Search products', az: 'Məhsul axtarışı', ru: 'Поиск товаров' },
  'hardware.search.placeholder': {
    en: 'Search by name, brand or SKU…',
    az: 'Ad, brend və ya SKU ilə axtar…',
    ru: 'Искать по названию, бренду или артикулу…',
  },
  'hardware.empty': {
    en: 'No products match this catalog filter.',
    az: 'Bu filtrə uyğun məhsul tapılmadı.',
    ru: 'По этому фильтру товары не найдены.',
  },
  'hardware.pageTitle': { en: 'Products', az: 'Məhsullar', ru: 'Товары' },
  'hardware.browse.title': { en: 'Products', az: 'Məhsullar', ru: 'Товары' },
  'hardware.browse.open': { en: 'Open catalog', az: 'Kataloqu aç', ru: 'Открыть каталог' },
  'hardware.allProducts': { en: 'All products', az: 'Bütün məhsullar', ru: 'Все товары' },
  'hardware.mobileFilters': { en: 'Catalogs', az: 'Kataloqlar', ru: 'Каталоги' },
  'hardware.page.prev': { en: 'Previous page', az: 'Əvvəlki səhifə', ru: 'Предыдущая страница' },
  'hardware.page.next': { en: 'Next page', az: 'Növbəti səhifə', ru: 'Следующая страница' },
  'hardware.page.label': { en: 'Page', az: 'Səhifə', ru: 'Страница' },
  'hardware.inCategory': { en: 'in', az: 'bölmə', ru: 'в разделе' },
  'cart.title': { en: 'Cart', az: 'Səbət', ru: 'Корзина' },
  'cart.open': { en: 'Open cart', az: 'Səbəti aç', ru: 'Открыть корзину' },
  'cart.close': { en: 'Close', az: 'Bağla', ru: 'Закрыть' },
  'cart.empty': { en: 'Your cart is empty.', az: 'Səbət boşdur.', ru: 'Корзина пуста.' },
  'cart.remove': { en: 'Remove', az: 'Sil', ru: 'Удалить' },
  'cart.increase': { en: 'Increase quantity', az: 'Miqdarı artır', ru: 'Увеличить количество' },
  'cart.decrease': { en: 'Decrease quantity', az: 'Miqdarı azalt', ru: 'Уменьшить количество' },
  'cart.total': { en: 'Total', az: 'Cəmi', ru: 'Итого' },
  'cart.checkout': { en: 'Proceed to payment', az: 'Ödənişə keç', ru: 'Перейти к оплате' },
};

Object.assign(catalog, extras);

export function normalizeLanguage(language: string | null | undefined): Language {
  return SUPPORTED_LANGUAGES.includes(language as Language) ? (language as Language) : 'az';
}

export function t(key: string, language: Language = 'az'): string {
  return catalog[key]?.[language] ?? catalog[key]?.en ?? key;
}

export function localeForLanguage(language: Language): string {
  return ({ en: 'en-US', az: 'az-AZ', ru: 'ru-RU' } as const)[language];
}
