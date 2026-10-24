# Hesaba məxsus test məhsulu — 24.10.2026

İstək: `ali.mammadli@possistem.az` ilə giriş edəndə Məhsullarda bir test məhsulu görünsün və Epoint açarları olmadan axın sınaqdan keçirilsin.

Bu ünvan mövcud **admin** hesabıdır. Hesabın parolu dəyişdirilməyib, eyni email ilə ayrıca müştəri hesabı yaradılmayıb.

## İstifadə

1. Mövcud admin hesabınızla daxil olun.
2. [Məhsullar → Sınaq](https://possistem.az/mehsul/avadanliq/?q=S%C4%B1naq) səhifəsini açın.
3. **Sınaq məhsulu — real ödəniş deyil** kartında **Test sifarişi yarat** seçin.
4. Miqdarı seçin, simulyasiya təsdiqini işarələyin; **Uğurlu sınağı yoxla** və ya **Uğursuz sınağı yoxla** düyməsini basın.
5. Nəticə və son 10 şəxsi sınaq həmin səhifədə görünür. Birbaşa keçid: [Test sifarişi](https://possistem.az/odenis/sinaq/).

Göstərilən nominal qiymət **1 AZN/ədəd**, real tutulma **0 AZN**-dir. Kart rekvizitləri alınmır. Bu, real bank ödənişini və Epoint-in merchant yoxlamasını əvəz etmir; real ödəniş üçün işlək merchant konfiqurasiyası və public/private açarlar lazımdır. Mövcud real ödəniş/recurring parametrləri bağlı saxlanılıb.

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
