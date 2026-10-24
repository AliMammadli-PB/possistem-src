# Market POS 1.5.72 — iki aylıq ödəniş üsulu

24.10.2026 tarixli istək: hesabla girişdən sonra ödənilmiş abunəlik yoxdursa ödəniş ekranı; avtomatik aylıq yenilənmə və linklə yalnız bir aylıq ödəniş.

## Davranış

- Market POS-da hesabla girişdən sonra abunəlik yoxlanılır. İlk ödəniş gözlənildikdə və ya müddət bitdikdə ayrıca abunəlik ekranı açılır. Hazırlıq dövründə mövcud istifadə imkanı qorunur. Ödəniş üçün məhdud sessiya ilə girən hesabın POS əməliyyatlarına keçidi yoxdur.
- **Aylıq avtomatik abunə:** bankda kart qeydiyyatı və ayrıca məbləğ/şərt razılığı; ilk təsdiqdən sonra bir ay açılır, sonrakı dövr saxlanmış bank identifikatoru ilə yenilənir. Kart nömrəsi/CVV Possistem-də saxlanılmır.
- **Linklə bir aylıq ödəniş:** Epoint-in həmin müştəri və sifariş üçün yaratdığı bank keçidi; yalnız bir ay açılır. Bu üsulla təsdiqlənmiş checkout başladıldıqda əvvəlki avtomatik razılıqlar geri götürülür və avtomatik yenilənmə bağlanır. Əvvəlcədən ödənilmiş müddət azalmır. Uğursuz bank ödənişi əlavə ay yaratmır.
- Hər iki üsulda ödənilmiş son tarix dəqiq bitəndə yeni satışlar dayandırılır; imzalı lisenziyanın müddəti oflaynda da yoxlanılır. Baxış və ixrac saxlanılır. Açıq tətbiq müddətin bitməsini görüb ödəniş ekranını göstərir; istifadəçi məlumatlarına baxmaq üçün ekranı bağlaya bilər, lakin əməliyyat qatındakı yazma məhdudiyyəti qalır.
- Qəti uğursuz avtomatik tutulmada ödənişə qayıtmaq göstərilir. Qeyri-müəyyən bank cavabında ikinci tutulma yaradılmır. Mövcud 24/72 saatlıq təkrar cəhd qaydası saxlanılır; uğursuz cəhd ödənilmiş müddəti uzatmır.
- Native seçim yalnız etibarlı Possistem ödəniş keçidinə `mode=manual|automatic` əlavə edir. Birdəfəlik giriş tokeni URL-dən təmizlənəndə üsul saxlanılır. Həm saytda, həm portalda üsul/qiymət/şərt dəyişəndə razılıq yenidən alınır.
- Ödəniş üçün məhdud native sessiya ilk ödənişdən sonra **Ödənişi yoxla / Hesaba yenidən giriş** ilə normal girişə keçir. Parol saxlanılmır və giriş sessiyasının səlahiyyəti yalnız renderer bayrağı ilə artırılmır.

## Məbləğ və qeydiyyat

Məbləğ adminin həmin müştərinin Market POS abunəliyinə təyin etdiyi haqqdır; standart 50 AZN ayrıca yeni məhsul qiyməti təyin etmir. Əl ilə və avtomatik üsulların məbləği eyni server qeydindən hesablanır. Müştəri və tətbiq məbləği dəyişmir.

Miqrasiya **0046_subscription_payment_mode.sql** `billing_orders.payment_mode` sahəsini əlavə edir. Köhnə sifarişlər null qalır və köhnə müştərilərin API müqaviləsi pozulmur. Açıq sifarişlərdə üsul fərqi və təkrar sorğu izi yoxlanılır. Avtomatik işçi müştərinin əl ilə ödəniş sifarişini öz tutulması kimi istifadə etmir. Seçim və razılıq dəyişikliyi auditə düşür.

## Canlı imkanın sərhədi

Yayım zamanı `EPOINT_PRIVATE_KEY` qurulmayıb; `EPOINT_LIVE_VERIFIED`, onlayn API ödənişləri, məcburi bloklama və recurring hələ bağlıdır. Buna görə bütün müştəriləri indi məcburi ödənişə bağlamaq və real aylıq tutulmanı açmaq mümkün deyil. Hazırlıq istifadəsi davam edir; olmayan bank təsdiqi ödənilmiş müddətə çevrilmir.

Şəxsi **1 AZN statik sınaq linki** ayrıca qalır. Bu link aylıq abunəlik üçün avtomatik təsdiq mənbəyi deyil və 50 AZN aylıq haqqı əvəz etmir.

Canlı aylıq ödənişi açmaq üçün Epoint API məxfi açarı serverin qorunan konfiqurasiyasına yerləşdirilməli, Card Storage/recurring aktivliyi təsdiqlənməli, bank ödənişi/status/geri qaytarma və saxlanmış kart yenilənməsi yoxlanılmalıdır. Bundan sonra adminin ödəniş parametrlərində API, recurring və məcburi abunəlik aktivləşdirilir. Müştəriyə uyğun aylıq məbləğ və lisenziya əlaqəsi admin panelindən təyin olunur.

## Yoxlamalar

- API və PostgreSQL: **34 sınaq**. Yeni ssenarilər: avtomatikdən əl ilə üsula keçəndə razılıqların bağlanması və hazır müddətin qalması; üsul/razılıq uyğunsuzluğu və eyni sorğuda üsulun dəyişdirilməsinin rəddi; uğursuz avtomatik yenilənmənin müddət yaratmaması və bərpa vəziyyəti.
- Market POS: **8 təhlükəsizlik yoxlaması**, o cümlədən faktiki IPC handoff handler-ində üsulun yoxlanması, etibarlı domenə keçid, dəqiq müddət sərhədi, birbaşa IPC ilə yazmanın bloklanması və imzalı yeniləmə yoxlamaları.
- Chromium **151.0.7922.34**: native React komponenti fixture ilə ödənişsiz/bitmiş/uğursuz vəziyyətlər, hər iki bridge seçimi, 360/390/768/1366 px; sayt və portal komponentlərində 390/1366 px, hər iki checkout payload-u və seçimdən sonra razılığın sıfırlanması.
- Yayımlanmış saytın bank nəqliyyatı yalnız brauzerdə fixture ilə əvəzlənərək native birdəfəlik handoff tokeninin silinməsi, seçilmiş üsulun qalması və hər iki POST yoxlanıldı. Bu yoxlamalar real kartdan pul tutmayıb.
- Yeni APK/Restoran POS binary buraxılışı tələb olunmur. Paylaşılan API-nin köhnə müştərilər üçün `saveCard` müqaviləsi qorunur. Windows cihazında quraşdırma, real Card Storage və avtomatik aylıq tutulma fiziki cihaz/bank yoxlaması kimi təqdim edilmir.

## Yayım və bərpa

Mənbə: `main-source/marketpos`, GitHub `AliMammadli-PB/possistem-src` main. Windows buraxılışı **1.5.72**; quraşdırıcı və portable hazırlanıb. Ed25519 yeniləmə manifesti ayrıca qorunan açarla imzalanır; Windows Authenticode sertifikatı hazırda yoxdur.

Server DB və əvvəlki API/portal yığımları `/opt/possistem-pos-control/backups/subscription-modes-20261024/`; əvvəlki portal `/opt/possistem-pos-control/apps/owner-web/.subscription-modes-20261024/`; əvvəlki Next yığımı `/var/www/possistem/.subscription-modes-20261024/.next` altındadır. Köhnə feed yayımlayıcı tərəfindən saxlanılır. Sınaq şəkilləri iş sahəsinin `artifacts/subscription-modes-20261024/` qovluğundadır.
