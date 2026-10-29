/**
 * Text handling for the support assistant: folding, an Azerbaijani-first
 * suffix stemmer and the synonym groups that let "yükləyim", "quraşdırım",
 * "install" and "установить" reach the same answer.
 *
 * Queries and knowledge-base phrases go through the same functions, so a stem
 * only has to be consistent, not linguistically perfect.
 */
export type Lang = 'az' | 'en' | 'ru';

export function fold(raw: string): string {
  return raw
    .replace(/[əƏ]/g, 'e')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ё/g, 'е')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9Ѐ-ӿ]+/g, ' ')
    .replace(/(\d)([a-zЀ-ӿ])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

const AZ_SUFFIXES = [
  'lerimizden', 'larimizdan', 'lerinizden', 'larinizdan', 'lerimizde', 'larimizda',
  'mayacaqsiniz', 'meyeceksiniz', 'acaqsiniz', 'eceksiniz', 'yacaqsiniz', 'yeceksiniz',
  'masiniz', 'mesiniz', 'misiniz', 'musunuz', 'sinizmi', 'siniz', 'sunuz', 'aniz', 'eniz', 'niz', 'nuz',
  'lerimiz', 'larimiz', 'leriniz', 'lariniz', 'lerinde', 'larinda', 'lerinden', 'larindan',
  'mayacaq', 'meyecek', 'yacaq', 'yecek', 'acaq', 'ecek', 'acam', 'ecem', 'acag', 'eceg',
  'miram', 'mirem', 'muram', 'murem', 'mirsan', 'mirsen', 'mir', 'mur', 'mamis', 'memis',
  'madim', 'medim', 'madi', 'medi', 'mali', 'meli', 'maliyam', 'meliyem',
  'yiram', 'yirem', 'yuram', 'yurem', 'iram', 'irem', 'uram', 'urem', 'yiq', 'yik', 'yuq', 'yuk',
  'dadir', 'dedir', 'dandir', 'dendir', 'dir', 'dur', 'tir', 'tur',
  'maq', 'mek', 'mag', 'meg', 'mak',
  'imiz', 'umuz', 'iniz', 'unuz', 'leri', 'lari', 'ler', 'lar',
  'dan', 'den', 'tan', 'ten', 'nan', 'nen', 'nin', 'nun', 'yla', 'yle', 'la', 'le',
  'misam', 'misem', 'musam', 'mis', 'mus', 'dim', 'dum', 'tim', 'tum', 'diq', 'dik', 'duq', 'duk',
  'yam', 'yem', 'yum', 'yim', 'sin', 'sun', 'san', 'sen',
  'lik', 'luk', 'siz', 'suz', 'ci', 'cu', 'li', 'lu',
  'da', 'de', 'ta', 'te', 'ya', 'ye', 'na', 'ne', 'ni', 'nu', 'si', 'su', 'mi', 'mu',
  'di', 'du', 'ti', 'tu', 'ma', 'me', 'im', 'um', 'in', 'un', 'iq', 'ik', 'uq', 'uk',
  'ir', 'ur', 'ar', 'er', 'am', 'em',
  'a', 'e', 'i', 'u',
].sort((a, b) => b.length - a.length);

const RU_SUFFIXES = [
  'ировать', 'ировали', 'иться', 'ться', 'ются', 'ется', 'ится', 'ает', 'яет', 'ует', 'ить', 'ать', 'ять', 'еть', 'уть',
  'ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ах', 'ях', 'ов', 'ев', 'ей', 'ой', 'ий', 'ый', 'ая', 'яя',
  'ую', 'юю', 'ое', 'ее', 'ом', 'ем', 'ам', 'ям', 'ть', 'ет', 'ит', 'ут', 'ют', 'ат', 'ят',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
].sort((a, b) => b.length - a.length);

const EN_SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ers', 'ies', 'ied', 'es', 'ed', 'er', 'ly', 's'];

/** Words that look inflected but are roots; stripping them merges unrelated words. */
const KEEP = new Set([
  'program', 'proqram', 'sistem', 'kassa', 'market', 'restoran', 'printer', 'skaner', 'terezi', 'barkod',
  'filial', 'anbar', 'demo', 'paket', 'tarif', 'windows', 'android', 'iphone', 'excel', 'whatsapp',
  'internet', 'offline', 'oflayn', 'online', 'onlayn', 'monitor', 'kamera', 'menyu', 'masa', 'mal', 'mehsul',
  'kart', 'nagd', 'borc', 'aptek', 'geyim', 'topdan', 'kafe', 'qaime', 'resept', 'bonus', 'etiket',
  'vergi', 'lisenziya', 'versiya', 'parol', 'sifre', 'pin', 'telefon', 'portal', 'qiymet', 'satis',
  'hesabat', 'hesab', 'qazanc', 'xerc', 'maas', 'isci', 'kassir', 'novbe', 'sayim', 'cek', 'qebz', 'mac',
]);

/** Known roots; filled with every single-word synonym form once GROUPS exists. */
const ROOTS = new Set(KEEP);

export function stem(word: string): string {
  if (/^\d+$/.test(word) || word.length <= 3) return word;
  if (/[Ѐ-ӿ]/.test(word)) {
    let w = word;
    for (const s of RU_SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 3) { w = w.slice(0, -s.length); break; }
    return w.slice(0, 6);
  }
  if (ROOTS.has(word)) return word;
  let w = word;
  for (let round = 0; round < 4; round += 1) {
    if (ROOTS.has(w)) return w;
    // Prefer the cut that lands on a known root ("hesabatı" → hesabat, not hesab).
    const hit = AZ_SUFFIXES.find((s) => w.endsWith(s) && w.length - s.length >= 3 && ROOTS.has(w.slice(0, -s.length)))
      ?? AZ_SUFFIXES.find((s) => w.endsWith(s) && w.length - s.length >= (s.length <= 2 ? 4 : 3));
    if (!hit) break;
    w = w.slice(0, -hit.length);
  }
  if (w === word) {
    const en = EN_SUFFIXES.find((s) => w.endsWith(s) && ROOTS.has(w.slice(0, -s.length))) ?? EN_SUFFIXES.find((s) => w.endsWith(s) && w.length - s.length >= 4);
    if (en) w = w.slice(0, -en.length);
  }
  return w;
}

/**
 * Synonym groups. The first element names the concept; every listed form is
 * folded and stemmed at load. Multi-word forms match as phrases.
 */
const GROUPS: string[][] = [
  ['@software', 'program', 'proqram', 'programi', 'proqrami', 'programin', 'proqramin', 'software', 'app', 'application', 'программ', 'приложен'],
  ['@install', 'yukleme linki', 'yukleme linkini', 'linkini ver', 'link ver', 'download link', 'ссылка на скачивание', 'yazim program', 'program yazdir', 'program yaz', 'proqram yaz', 'kompyutere yaz', 'kompa yaz', 'yukle', 'yuklemek', 'yukleyim', 'yuklenir', 'yuklenmir', 'yukluyum', 'qur', 'qurmaq', 'qurasdir', 'qurasdirmaq', 'qurasdirma', 'qurulum', 'setup', 'install', 'installation', 'download', 'endir', 'endirmek', 'kocurmek', 'установ', 'скача', 'загруз', 'инсталл'],
  ['@price', 'qiymet', 'qiymeti', 'manat', 'manatdir', 'azn', 'neceye', 'neceyedir', 'neche', 'nece manat', 'ne qeder', 'neqeder', 'pulu', 'deyer', 'tarif', 'price', 'prices', 'cost', 'costs', 'pricing', 'how much', 'цена', 'цены', 'стоим', 'сколько', 'тариф', 'прайс'],
  ['@monthly', 'ayliq', 'aylik', 'her ay', 'monthly', 'per month', 'месяц', 'ежемес'],
  ['@yearly', 'illik', 'her il', 'yearly', 'annual', 'annually', 'годов', 'год'],
  ['@free', 'pulsuz', 'havayi', 'free', 'бесплат'],
  ['@trial', 'sinaq', 'sinamaq', 'sinayim', 'sinayaq', 'test etmek', 'test edim', 'evvelce yoxla', 'evvelce yoxlamaq', 'yoxlayib sonra', 'trial', 'пробн', 'тестов'],
  ['@demo', 'demo', 'демо'],
  ['@discount', 'endirim', 'ucuz', 'ucuzlasdir', 'ucuz eliyersiz', 'cheaper', 'дешевле', 'kampaniya', 'aksiya', 'discount', 'promo', 'скидк', 'акци'],
  ['@pay', 'odenis', 'odeme', 'odemek', 'odeyim', 'odeyirem', 'ode', 'pay', 'payment', 'оплат', 'плат', 'заплат'],
  ['@card', 'kart', 'kartla', 'card', 'visa', 'mastercard', 'карт'],
  ['@cash', 'nagd', 'nagdi', 'kassa hesabi', 'bank hesabi', 'bank hesablari', 'bank', 'hesablar', 'kassa qaligi', 'cash', 'налич'],
  ['@hardware', 'avadanliq', 'avadanlig', 'avadanliga', 'equipment', 'hardware', 'оборудован'],
  ['@print', 'cap', 'cap etmek', 'cap edim', 'cap edir', 'cap olunmur', 'print', 'printing', 'печать', 'печат', 'распечат'],
  ['@printer', 'printer', 'printeri', 'cek printer', 'termal printer', 'printr', 'принтер'],
  ['@receipt', 'cek', 'qebz', 'receipt', 'чек', 'квитан'],
  ['@scanner', 'skaner', 'scanner', 'barkod oxuyucu', 'barkod oxuyan', 'oxuyan', 'oxuyucu', 'сканер'],
  ['@barcode', 'barkod', 'barcode', 'штрих', 'штрихкод'],
  ['@scale', 'terezi', 'scale', 'весы', 'весов'],
  ['@drawer', 'pul qutusu', 'pul yesiyi', 'pul yesik', 'kassa qutusu', 'cash drawer', 'денежный ящик', 'денежн'],
  ['@computer', 'komputer', 'kompyuter', 'komp', 'noutbuk', 'laptop', 'monoblok', 'pc', 'компьютер', 'ноутбук', 'моноблок'],
  ['@pos_hw', 'pos komputer', 'sensor', 'toxunus ekran', 'touch screen', 'сенсор'],
  ['@windows', 'windows 10', 'windows 11', 'windows', 'vindovs', 'win10', 'win11', 'винд'],
  ['@win7', 'windows 7', 'win 7', 'win7', 'vindovs 7', 'windows xp', 'windows 8', 'xp', 'vindovs 7'],
  ['@mac', 'mac', 'apple', 'macbook', 'macos', 'imac', 'linux', 'ubuntu', 'мак', 'линукс'],
  ['@phone', 'telefon', 'mobil', 'smartfon', 'phone', 'mobile', 'smartphone', 'телефон', 'смартфон', 'мобил'],
  ['@android', 'android', 'apk', 'андроид'],
  ['@ios', 'iphone', 'ayfon', 'aypon', 'ios', 'ipad', 'айфон'],
  ['@internet', 'internet', 'interneti', 'offline', 'oflayn', 'sebeke', 'wifi', 'baglanti', 'интернет', 'офлайн', 'сеть'],
  ['@sync', 'sinxron', 'sinxronizasiya', 'sync', 'синхрон'],
  ['@branch', 'filial', 'filiallar', 'obyekt', 'branch', 'branches', 'филиал', 'точк'],
  ['@stock', 'anbar', 'stok', 'qaliq', 'qalig', 'sklad', 'stock', 'inventory', 'warehouse', 'склад', 'остат'],
  ['@product', 'mehsul', 'mal', 'mallar', 'tovar', 'product', 'products', 'item', 'товар', 'продукт'],
  ['@sale', 'satis', 'satmaq', 'satiram', 'satilir', 'satilmaq', 'satir', 'satim', 'cek vurmaq', 'cek vurum', 'sale', 'sales', 'sell', 'selling', 'продаж', 'прода'],
  ['@return', 'qaytar', 'qaytarma', 'qaytarim', 'geri qaytar', 'geri getirdi', 'geri getirib', 'geri verdi', 'iade', 'refund', 'return', 'возврат', 'вернуть'],
  ['@cancel', 'legv', 'sehv cek', 'yanlis cek', 'sehv vurdum', 'sehv vurmusam', 'sil', 'silmek', 'cancel', 'delete', 'void', 'отмен', 'удал'],
  ['@debt', 'borc', 'nisye', 'veresiye', 'kredit', 'debt', 'credit', 'долг', 'кредит'],
  ['@customer', 'musteri', 'alici', 'customer', 'client', 'клиент', 'покупат'],
  ['@supplier', 'tedarukcu', 'techizatci', 'postavsik', 'supplier', 'vendor', 'поставщ'],
  ['@staff', 'isci', 'iscilar', 'isciler', 'kassir', 'personal', 'ofisiant', 'satici', 'staff', 'employee', 'cashier', 'waiter', 'сотрудник', 'кассир', 'официант', 'персонал'],
  ['@role', 'icaze', 'gormesin', 'bilmesin', 'etmesin', 'olmasin', 'qadagan', 'gizlet', 'gizletmek', 'girmesin', 'hide', 'скрыть', 'selahiyyet', 'rol', 'huquq', 'permission', 'role', 'access', 'права', 'доступ', 'роль'],
  ['@report', 'hesabat', 'report', 'reports', 'отчет', 'отчёт'],
  ['@profit', 'qazanc', 'menfeet', 'gelir', 'profit', 'margin', 'прибыл', 'доход', 'марж'],
  ['@expense', 'xerc', 'xercler', 'mexaric', 'expense', 'expenses', 'расход', 'затрат'],
  ['@salary', 'maas', 'emek haqqi', 'salary', 'payroll', 'зарплат'],
  ['@login', 'giris', 'gir', 'gire', 'girmek', 'girmir', 'daxil ol', 'daxil ola', 'login', 'sign in', 'log in', 'войти', 'вход', 'логин'],
  ['@password', 'sifre', 'parol', 'parolu', 'pin', 'password', 'пароль', 'пин'],
  ['@forgot', 'unut', 'unutdum', 'unutmusam', 'itirdim', 'yadimdan cixib', 'forgot', 'forgotten', 'lost', 'забыл', 'потерял'],
  ['@register', 'qeydiyyat', 'hesab yarat', 'hesab acmaq', 'register', 'sign up', 'signup', 'регистрац', 'зарегистр'],
  ['@license', 'lisenziya', 'aktivasiya', 'aktivlesdirme', 'aktiv', 'acar', 'license', 'licence', 'activation', 'activate', 'key', 'лиценз', 'ключ', 'активац'],
  ['@expire', 'bitib', 'bitdi', 'bitir', 'bitecek', 'muddeti', 'expired', 'expire', 'истек', 'закончил'],
  ['@renew', 'uzat', 'uzatmaq', 'yenile abune', 'renew', 'extend', 'продл'],
  ['@subscription', 'abune', 'abunelik', 'subscription', 'подписк'],
  ['@update', 'yenile', 'yenileme', 'yenilenmir', 'versiya', 'update', 'upgrade', 'version', 'обнов', 'верси'],
  ['@backup', 'ehtiyat', 'yedek', 'yedeyi', 'yedekleme', 'backup', 'saxlanir', 'saxlanilir', 'harda saxlanir', 'database', 'база данных', 'berpa', 'restore', 'kopya', 'nusxe', 'резерв', 'восстанов', 'бэкап'],
  ['@dataloss', 'itse', 'itib', 'itdi', 'silinse', 'silindi', 'silinerse', 'xarab olsa', 'yandi', 'yansa', 'yanarsa', 'oğurlansa', 'gedecek', 'itecek', 'lost data'],
  ['@contact', 'elaqe', 'nomre', 'nomreniz', 'zeng', 'contact', 'call', 'phone number', 'связ', 'звон', 'номер', 'контакт'],
  ['@email', 'email', 'e poct', 'mail', 'pochta', 'почта'],
  ['@address', 'unvan', 'unvaniniz', 'yerlesir', 'yerlesirsiniz', 'yerlesirsiz', 'adres', 'haradasiniz', 'haradasiz', 'ofis', 'ofisiniz', 'address', 'office', 'located', 'адрес', 'офис'],
  ['@hours', 'is saati', 'is saatlari', 'saat neceye', 'neceye qeder isleyirsiz', 'bazar gunu isleyirsiz', 'indi aciqsiz', 'aciqsiz', 'qrafik', 'working hours', 'open hours', 'opening hours', 'часы работы', 'график', 'работаете'],
  ['@support', 'destek', 'komek', 'yardim', 'support', 'help', 'поддерж', 'помощ'],
  ['@human', 'operator', 'canli', 'insan', 'live agent', 'emekdas', 'menecer', 'human', 'agent', 'оператор', 'человек', 'менеджер'],
  ['@partner', 'partnyor', 'bayi', 'diler', 'reseller', 'partner', 'dealer', 'дилер', 'партнер', 'партнёр'],
  ['@training', 'telim', 'oyret', 'oyretmek', 'oyrede', 'oyredin', 'oyredersiz', 'oyren', 'oyrenmek', 'kurs', 'training', 'teach', 'обуч'],
  ['@video', 'video', 'youtube', 'видео'],
  ['@onsite', 'gelmek', 'gele', 'gelsin', 'gelersiz', 'gelib', 'gelin', 'gelersiniz', 'gelirsiz', 'gelirsiniz', 'yerinde', 'usta', 'texnik', 'on site', 'onsite', 'visit', 'выезд', 'мастер', 'приехать'],
  ['@remote', 'uzaqdan', 'evden', 'kenardan', 'her yerden', 'from home', 'из дома', 'anydesk', 'teamviewer', 'rustdesk', 'remote', 'удален', 'удалён'],
  ['@restaurant', 'restoran', 'kafe', 'kofe', 'fast food', 'fastfud', 'bar', 'pub', 'cayxana', 'yemekxana', 'pizza', 'doner', 'restaurant', 'cafe', 'ресторан', 'кафе'],
  ['@market', 'market', 'magaza', 'dukan', 'supermarket', 'minimarket', 'shop', 'store', 'retail', 'магазин', 'маркет'],
  ['@pharmacy', 'aptek', 'eczane', 'pharmacy', 'аптек'],
  ['@clothing', 'geyim', 'butik', 'paltar', 'ayaqqabi', 'clothing', 'fashion', 'boutique', 'одежд', 'бутик'],
  ['@wholesale', 'topdan', 'optom', 'wholesale', 'опт'],
  ['@table', 'masa', 'masalar', 'stol', 'zal', 'table', 'tables', 'стол', 'зал'],
  ['@kitchen', 'metbex', 'aspaz', 'kitchen', 'кухн', 'повар'],
  ['@delivery', 'catdirilma', 'kuryer', 'delivery', 'courier', 'доставк', 'курьер'],
  ['@menu', 'menyu', 'menu', 'меню'],
  ['@recipe', 'resept', 'kalkulyasiya', 'texnoloji karta', 'recipe', 'рецепт', 'калькуляц'],
  ['@loyalty', 'bonus', 'kesbek', 'cashback', 'loyalty', 'sadiqlik', 'xal', 'бонус', 'кэшбэк'],
  ['@stocktake', 'inventarizasiya', 'sayim', 'revizya', 'stocktake', 'инвентар', 'ревиз'],
  ['@transfer', 'yerdeyisme', 'mal gondermek', 'mal gonderim', 'o birine', 'diger magazaya', 'basqa filiala', 'transfer', 'перемещ'],
  ['@waste', 'silinme', 'xarab', 'zay', 'spisanie', 'waste', 'write off', 'списан', 'брак'],
  ['@purchase', 'alis', 'mal qebulu', 'mal geldi', 'mal gelib', 'mal getirdiler', 'qebul', 'qaime', 'priyom', 'purchase', 'goods receipt', 'закуп', 'приход', 'накладн'],
  ['@expiry', 'son istifade', 'son kullanma', 'tarixi kecmis', 'muddeti kecmis', 'istifade muddeti', 'kecerlilik', 'srok', 'expiry', 'expiration', 'срок годн'],
  ['@lot', 'partiya', 'seriya', 'seriya nomresi', 'lot', 'batch', 'серия', 'партия'],
  ['@import', 'import', 'excel', 'csv', 'toplu', 'импорт'],
  ['@label', 'etiket', 'qiymet etiketi', 'cennik', 'label', 'этикет', 'ценник'],
  ['@tax', 'vergi', 'edv', 'nka', 'nkm', 'nezaret kassa', 'inteqrasiya vergi', 'e kassa', 'ekassa', 'fiskal', 'kassa aparati', 'tax', 'vat', 'налог', 'ндс', 'фискал'],
  ['@shift', 'novbe', 'kassani bagla', 'kassani baglayim', 'kassa baglamaq', 'gunu bagla', 'gunun sonu', 'gunun sonunda', 'close the till', 'закрыть кассу', 'smena', 'shift', 'смен'],
  ['@notify', 'bildiris', 'push', 'sms', 'notification', 'уведомл'],
  ['@whatsapp', 'whatsapp', 'vatsap', 'wp', 'ватсап'],
  ['@security', 'tehlukesiz', 'mexfi', 'qorunur', 'security', 'secure', 'safe', 'безопас'],
  ['@camera', 'kamera', 'camera', 'dvr', 'videomusahide', 'видеонаблюд', 'камер'],
  ['@problem', 'xeta', 'xetasi', 'problem', 'problemi', 'sehv', 'donur', 'donub', 'ilisir', 'cap etmir', 'xarab olub', 'error', 'broken', 'not working', 'doesnt work', 'fails', 'не работает', 'ошибк', 'не открыв', 'проблем'],
  ['@features', 'funksiya', 'imkan', 'imkanlar', 'xususiyyet', 'ne ise yarayir', 'ne edir', 'features', 'can do', 'возможност', 'функци'],
  ['@about', 'siz kimsiniz', 'sirket', 'haqqinizda', 'about', 'company', 'компани', 'о вас'],
  ['@bot', 'bilirsen', 'bacarirsan', 'kimsen', 'kimsiniz', 'kimsiz', 'sen kimsen', 'robot', 'robotsan', 'bot', 'suni intellekt', 'ai', 'chatgpt', 'бот', 'робот'],
  ['@compat', 'isleyer', 'isleyecek', 'isleyirmi', 'gedermi', 'uygun gelir', 'will it run', 'работает ли', 'пойдет'],
  ['@requirements', 'telebler', 'sistem telebi', 'ram', 'prosessor', 'requirements', 'specs', 'требован'],
  ['@language', 'dilinde', 'dilde', 'rusca', 'ingilisce', 'dil', 'rus dili', 'ingilis', 'azerbaycan dili', 'language', 'язык'],
  ['@owner_view', 'sahibkar', 'nezaret etmek', 'nezaret', 'telefondan izlemek', 'satisi izlemek', 'portal', 'sayt', 'site', 'website', 'сайт', 'panel', 'kabinet', 'owner', 'dashboard', 'кабинет', 'владел'],
  ['@speed', 'yavas', 'yavaslayir', 'gec acilir', 'slow', 'медлен', 'тормоз'],
  ['@many', 'bir nece', 'iki', 'ikinci', 'two', 'second', 'два', 'две', 'второй', 'coxlu', 'cox', 'multiple', 'several', 'несколько'],
  ['@contract', 'muqavile', 'contract', 'договор'],
  ['@buy', 'almaq', 'alim', 'alacam', 'alaram', 'satin al', 'buy', 'купить', 'приобрести'],
];

/** Words that carry little meaning on their own. */
const STOP = new Set([
  'nece', 'ne', 'nedir', 'nedi', 'var', 'varmi', 'vardir', 'mi', 'mu', 'olar', 'olarmi', 'olur', 'olsun', 'mumkun', 'mumkundur',
  'edim', 'ede', 'eden', 'etmek', 'edir', 'edirik', 'edirem', 'edin', 'eliyim', 'elemek', 'bilerem', 'bilerik', 'bilmek', 'biler',
  'ucun', 'ile', 've', 'veya', 'yoxsa', 'bu', 'o', 'men', 'mene', 'menim', 'siz', 'size', 'sizin', 'sen', 'bir', 'hansi', 'harda',
  'haradan', 'hara', 'niye', 'neden', 'zehmet', 'olmasa', 'xahis', 'salam', 'de', 'da', 'ki', 'ise', 'isteyirem', 'lazimdi',
  'lazimdir', 'lazim', 'istifade', 'cox', 'cox sag', 'yeni', 'kohne', 'indi', 'hele', 'etmeliyem', 'etmeli', 'etmel', 'possistem', 'possistemi', 'possistemin', 'possist', 'olmalidir', 'gerek', 'isteyirdim', 'yoxsa', 'please', 'how', 'what', 'is', 'are', 'the', 'a', 'an', 'do', 'does', 'can',
  'i', 'my', 'you', 'your', 'to', 'for', 'of', 'in', 'it', 'on', 'with', 'have', 'there', 'any', 'and', 'or', 'me', 'we',
  'как', 'что', 'где', 'есть', 'ли', 'у', 'вас', 'мне', 'можно', 'я', 'и', 'в', 'на', 'для', 'с', 'это', 'по', 'ваш',
]);

export type Term = { key: string; weight: number; fuzzy?: boolean };

/** Negated verbs ("çıxarmır", "açılmadı", "не", "doesn't") signal a fault, whatever the verb. */
const NEGATED = /^(.{3,}(mir|mur|mirem|muram|mirik|madi|medi|mayib|meyib|mayacaq|meyecek|mayir|meyir|mamis|memis)|не|not|doesnt|dont|cant|wont|cannot)$/;

type Phrase = { words: string[]; concept: string };
const PHRASES: Phrase[] = [];
const WORD_CONCEPT = new Map<string, string>();

for (const [, ...forms] of GROUPS) for (const form of forms) { const w = fold(form); if (w && !w.includes(' ') && w.length >= 3 && !/[Ѐ-ӿ]/.test(w)) ROOTS.add(w); }

for (const [concept, ...forms] of GROUPS) {
  for (const form of forms) {
    const words = fold(form).split(' ').filter(Boolean);
    if (words.length > 1) PHRASES.push({ words, concept: concept! });
    else if (words[0]) {
      const s = stem(words[0]);
      // A stem that is a filler word ("neceye" → "nece") must not carry the concept.
      if (!WORD_CONCEPT.has(s) && !STOP.has(s) && s.length >= 3) WORD_CONCEPT.set(s, concept!);
      if (!WORD_CONCEPT.has(words[0])) WORD_CONCEPT.set(words[0], concept!);
    }
  }
}
PHRASES.sort((a, b) => b.words.length - a.words.length);

/** Damerau-Levenshtein, bounded: anything past 2 edits is "far". */
export function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Turns text into weighted terms: concepts first (phrases, then words), then
 * the stems of everything else. `vocabulary` lets unknown words snap to a
 * known stem one or two keystrokes away.
 */
export function terms(text: string, vocabulary?: Set<string>): Term[] {
  const words = fold(text).split(' ').filter(Boolean);
  const stems = words.map(stem);
  const used = new Array<boolean>(words.length).fill(false);
  const out = new Map<string, Term>();
  const add = (key: string, weight: number, fuzzy = false) => {
    const prev = out.get(key);
    if (!prev || prev.weight < weight) out.set(key, { key, weight, fuzzy });
  };
  const canon = (w: string) => WORD_CONCEPT.get(w) ?? WORD_CONCEPT.get(stem(w)) ?? stem(w);
  const canonical = words.map(canon);
  for (const phrase of PHRASES) {
    for (let i = 0; i + phrase.words.length <= stems.length; i += 1) {
      if (phrase.words.every((w, k) => words[i + k] === w || canonical[i + k] === canon(w))) {
        add(phrase.concept, 1);
        for (let k = 0; k < phrase.words.length; k += 1) used[i + k] = true;
      }
    }
  }
  words.forEach((word, i) => {
    if (used[i]) return;
    const s = stems[i]!;
    const concept = WORD_CONCEPT.get(word) ?? WORD_CONCEPT.get(s) ?? prefixConcept(s);
    if (concept) { add(concept, 1); if (NEGATED.test(word) && concept !== '@problem') add('@problem', 0.8); return; }
    if (NEGATED.test(word)) add('@problem', 0.8);
    if (STOP.has(word) || STOP.has(s)) { add(s, 0.15); return; }
    // Latin keyboards: "qurashdirma", "chek", "aghac".
    const translit = word.replace(/sh/g, 's').replace(/ch/g, 'c').replace(/gh/g, 'g');
    if (translit !== word) {
      const t = WORD_CONCEPT.get(translit) ?? WORD_CONCEPT.get(stem(translit)) ?? prefixConcept(stem(translit));
      if (t) { add(t, 0.9); return; }
    }
    if (vocabulary && !vocabulary.has(s) && s.length >= 4 && !/\d/.test(s)) {
      const near = closest(s, vocabulary);
      if (near) {
        const nearConcept = WORD_CONCEPT.get(near);
        add(nearConcept ?? near, 0.8, true);
        return;
      }
    }
    add(s, /^\d+$/.test(s) ? 0.3 : 1);
  });
  return [...out.values()];
}

/** "quraşdırılmasını" strips to "qurasdir…"; accept a concept form that is its prefix. */
function prefixConcept(s: string): string | undefined {
  if (s.length < 6) return undefined;
  for (let n = s.length - 1; n >= 5; n -= 1) {
    const hit = WORD_CONCEPT.get(s.slice(0, n));
    if (hit) return hit;
  }
  return undefined;
}

function closest(word: string, vocabulary: Set<string>): string | undefined {
  const limit = word.length >= 7 ? 2 : 1;
  let best: string | undefined;
  let bestD = limit + 1;
  let tie = false;
  for (const candidate of vocabulary) {
    if (candidate.startsWith('@') || Math.abs(candidate.length - word.length) > limit || candidate.length < 4) continue;
    const d = editDistance(word, candidate);
    if (d < bestD) { best = candidate; bestD = d; tie = false; } else if (d === bestD) tie = true;
  }
  return best && !tie ? best : undefined;
}

export function knownForms(): string[] {
  return [...WORD_CONCEPT.keys()];
}

export function conceptOf(word: string): string | undefined {
  const f = fold(word);
  return WORD_CONCEPT.get(f) ?? WORD_CONCEPT.get(stem(f));
}

const EN_HINT = /\b(how|what|where|when|which|why|do|does|is|are|can|price|install|trial|free|work|offline|support|hello|thanks|help|my|the)\b/;
const AZ_HINT = /\b(nece|nedir|var|varmi|olar|ucun|men|siz|mene|bu|ne|hansi|haradan|salam|sagol|isteyirem|qiymet|program|proqram|kassa|bugun|dunen)\b/;

/** The text's own language wins; the UI language breaks ties. */
export function detectLanguage(raw: string, ui: Lang): Lang {
  if (/[Ѐ-ӿ]/.test(raw)) return 'ru';
  if (/[əğıöüşç]/i.test(raw)) return 'az';
  const f = fold(raw);
  const en = EN_HINT.test(f), az = AZ_HINT.test(f);
  if (en && !az) return 'en';
  if (az && !en) return 'az';
  return ui === 'ru' ? 'az' : ui;
}
