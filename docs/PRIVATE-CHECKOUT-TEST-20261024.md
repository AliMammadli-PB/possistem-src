# Hesaba məxsus test məhsulu — 24.10.2026

İstək: `ali.mammadli@possistem.az` ilə giriş edəndə Məhsullarda bir test məhsulu görünsün və Epoint açarları olmadan axın sınaqdan keçirilsin.

Bu ünvan mövcud **admin** hesabıdır. Hesabın parolu dəyişdirilməyib, eyni email ilə ayrıca müştəri hesabı yaradılmayıb.

## İstifadə

1. Mövcud admin hesabınızla daxil olun.
2. [Məhsullar → Sınaq](https://possistem.az/mehsul/avadanliq/?q=S%C4%B1naq) səhifəsini açın.
3. **Sınaq məhsulu — şəxsi kart ödənişi** kartında **Test sifarişi yarat** seçin. Birbaşa keçid: [Kartla ödəniş sınağı](https://possistem.az/odenis/sinaq/).
4. Real yoxlama üçün **Epoint ilə real kart ödənişi** bölməsində 1 AZN tutulacağını təsdiqləyin və **Kartla 1,00 ₼ ödə** seçin. Epoint fakturasından bankın kart səhifəsinə keçin.
5. Pulsuz sınaqlar üçün **Pulsuz simulyasiya və əvvəlki sınaqlar** bölməsini açın. Bu bölmə real pul tutmur və son 10 simulyasiyanı göstərir.

## Real kart ödənişi — sonrakı yoxlama

İstifadəçinin CAPTCHA yoxlamasından sonra Epoint kabinetinə yenidən daxil olundu. API dəyişiklikləri hələ moderasiyadadır; kabinet yalnız açıq açarı göstərir, serverdə məxfi açar yoxdur. Bununla belə **Link ilə Ödəniş** işləyir. Kabinetdə yalnız 1 AZN-lik, birdəfəlik şəxsi yoxlama fakturası **291546** yaradıldı. SMS/email göndərilmədi. Girişsiz fakturada Possistem və 1.00 AZN təsdiqləndi; **Ödəniş** düyməsi `https://ecomm.pashabank.az` bank domenində kart formasını açdı. Kart daxil edilmədi və pul tutulmadı.

Faktura URL-i repo və açıq kataloqa yazılmır; qorunan server konfiqurasiyasındakı `EPOINT_PRIVATE_TEST_PAYMENT_URL` vasitəsilə yalnız icazəli hesabın checkout context-inə qaytarılır. Yalnız HTTPS, dəqiq `epoint.az` hostu və `/az/inv/p/<token>` yolu qəbul olunur; credentials, başqa port, query və fragment rədd edilir. Epoint fakturası özü paylaşılabilən linkdir: linki bilən şəxs bank səhifəsini aça bilər. Saytdakı görünmə məhdudiyyəti bank səhifəsində hesab yoxlaması demək deyil.

Bu real faktura **sabit 1 AZN**-dir; simulyasiya miqdarı ona təsir etmir. Məhsulun nominal qiyməti dəyişərsə faktura seçimi gizlənir. Quraşdırılmış faktura öz-özünə yenisi ilə əvəz olunmur. Bir dəfə ödəmisinizsə, təkrar ödəməyin; nəticə Epoint kabinetində yoxlanılmalıdır.

API imzalı callback/status yoxlaması hələ hazır açarlarla işləmədiyindən bu hosted ödəniş sayt sifarişini və abunəliyi avtomatik təsdiqləmir. Simulyasiya `paid` statusuna çevrilmir. API onlayn satış və recurring parametrləri bağlı, POS istifadəsi əvvəlki qaydada qalır. Avtomatik inteqrasiya üçün Epoint məxfi açarı və ayrıca real ödəniş/status/geri qaytarma yoxlaması lazımdır.

Kart rekvizitləri yalnız bank səhifəsində daxil edilir. **Pulsuz simulyasiya** üçün nominal qiymət 1 AZN/ədəd, real tutulma 0 AZN-dir.

## Sərhədlər

- Görünmə qərarı request body/query-dəki email ilə verilmir. Serverin doğruladığı aktiv admin/müştəri kimliyinin email-i və məhsulun DB icazəsi yoxlanılır. Məcburi ilk şifrə dəyişikliyi tələbi keçilmir.
- Anonim və digər hesablar kataloqda məhsulu almır; birbaşa məhsul və test context sorğuları 404 alır. Cavablar private/no-store və cookie/session üzrə Vary ilə verilir. Hesab dəyişəndə kataloq yenidən yüklənir.
- POST ayrıca CSRF, strict schema, 1–10 miqdar limiti və 20/dəqiqə limitinə tabedir. Məbləği server hesablayır; client amount/real mode göndərə bilmir.
- Sorğu açarı actor-a bağlanır. Paralel/təkrar klik bir sınaq qeydi yaradır; fərqli body ilə həmin açarın təkrarı 409 qaytarır.
- Sınaqlar yalnız `billing_test_products` və `billing_test_orders` cədvəllərindədir. Statuslar `simulated_success` / `simulated_failure` olur; `paid` yazılmır. Real sifariş, ödəniş cəhdi, stok rezervi və abunəlik müddəti yaradılmır/dəyişmir.
- Test SKU real quote/checkout yoluna göndəriləndə, hətta daxildə saxta quote yaradılmış olsa belə, bloklanır. Simulator Epoint adapterini çağırmır və gələcəkdə açarlar qoşulsa da real karta keçmir.

## Yoxlama və yayım

- API və Next production build-ləri keçdi. API build əmri platform qovluğunda `pnpm --filter @milioner/api build`-dir.
- Ayrı PostgreSQL bazasında **27 test** keçdi. Yeni 3 ssenari: anonim/digər hesab/saxta email ilə görünmə; CSRF/idempotency və maliyyə təcridi; test SKU-nun real checkout-a keçirilməsinin rəddi.
- Canlı saytda qısamüddətli, ayrıca admin yoxlama sessiyası ilə kataloq görünməsi, uğurlu və uğursuz simulyasiya, çıxışdan sonra girişin bağlanması yoxlanıldı. Sessiya sonra silindi; mövcud istifadəçi sessiyaları dəyişdirilmədi. İki nümunə sınaq qeydi şəxsi tarixçədə saxlanıldı.
- Chromium 151.0.7922.34: 360/390/1366 px, əsas JavaScript xətası və səhifə overflow-u yoxdur. Kart məlumatı xanası yoxdur.
- Miqrasiya `0044_private_checkout_test.sql` tətbiq olundu. Əvvəlki DB ehtiyatı: `/opt/possistem-pos-control/backups/private-checkout-test-20261024/database.dump` (root 0600). Əvvəlki Next yığımı `/var/www/possistem/.private-test-20261024/.next` altında saxlanılıb.
- Sayt/API yayımlandı; POS və APK üçün yeni binary tələb olunmur.

Sınağı sonradan bağlamaq üçün yalnız `billing_test_products` daxilində bu məhsulun `enabled` sahəsini false etmək kifayətdir. Real ödəniş parametrlərini dəyişmək lazım deyil.

## Hosted faktura əlavəsinin yoxlanması

- API və Next production build-ləri yerli və serverdə keçdi; ayrıca PostgreSQL bazasında **28 test** keçdi. Yeni yoxlama faktura URL-inin host/yol məhdudiyyətlərini, yalnız icazəli context-dən görünməsini və yanlış URL-in gizlənməsini əhatə edir.
- Chromium 151 ilə canlı səhifədə anonim 404, Ali hesabına real fakturanın göstərilməsi, ayrıca məbləğ təsdiqi olmadan düymənin bağlı olması, təsdiqdən sonra dəqiq Epoint fakturasına keçid, çıxışdan sonra 404 və 360/390/1366 px görünüşləri yoxlanıldı. Bank tutulması/3DS və geri qaytarma həyata keçirilməyib.
- Şəkillər: `artifacts/epoint-real-payment-20261024/` (iş sahəsinin kökündə). Yeni DB miqrasiyası tələb olunmur.
- API əvvəlki yığımı və qorunan env ehtiyatı `/opt/possistem-pos-control/backups/hosted-payment-20261024/`, əvvəlki Next yığımı `/var/www/possistem/.hosted-payment-20261024/.next` altındadır.
- Bu seçimi bağlamaq üçün env-dən `EPOINT_PRIVATE_TEST_PAYMENT_URL` silinib API yenidən başladılır; faktura ayrıca Epoint kabinetindən ləğv edilə bilər. Simulyasiya isə əvvəlki kimi ayrıca qalır.
