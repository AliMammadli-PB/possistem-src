# Epoint və fərdi aylıq abunəliklər — 24.10.2026

## Hazır olanlar

- Node/Fastify + PostgreSQL ödəniş adapteri, imzalı callback, məbləğ/əməliyyat yoxlaması, tarixçə və audit.
- Market və Restoran üçün müştəriyə ayrıca aylıq haqq. Yeni müştəridə ilk təsdiqlənmiş ödəniş tələb olunur; mövcud müştərilər yalnız admin qoşanda aylıq sistemə keçir.
- İlk ödənişdən təqvim ayı; ayın sonu uyğunlaşdırılır. Erkən ödəniş cari müddətə bir ay əlavə edir, gec ödəniş bank təsdiqindən başlayır.
- Saxlanmış kart tokeni AES-256-GCM ilə qorunur. Ayrı avtomatik tutulma razılığı və onun ləğvi; qiymət dəyişəndə yeni razılıq tələb olunur. Kart/PAN/CVV saxlanılmır.
- 30 saniyəlik server işçisi; yalnız qəti uğursuz nəticə üçün 24 və 72 saatlıq təkrar cəhd. Nəticəsi qeyri-müəyyən əməliyyat ikinci dəfə tutulmur; mövcud bank nömrəsi ilə status dəqiqləşdirilir.
- Adminin təsdiqlədiyi müsbət qiymət olmayan məhsul ödənişə buraxılmır. Əvvəlki kataloq qiymətləri arxivlənir, satış qiymətinə çevrilmir. Bu buraxılışda heç bir real qiymət və aylıq haqq təyin edilməyib.
- Səbət → hesab → server qiymət təklifi → şərtlərin qəbulu → Epoint. Stok 15 dəqiqə rezerv edilir; gec təsdiqdə stok yoxdursa admin həllinə düşür, mənfi stok yaranmır.
- Özü götürmə; çatdırılma haqqı qurulanadək çatdırılma bağlıdır. Tam geri qaytarma orijinal Epoint əməliyyatına ayrıca təsdiqlə göndərilir. Fiziki qaytarma stokuna avtomatik əlavə edilmir.
- Admin: Abunəliklər, Ödənişlər, Sifarişlər, Ödəniş parametrləri. Müştəri: Abunəlik və ödənişlər. Köhnə tarif/paket səhifələri məhsullara yönləndirilir; köhnə lisenziya funksiyaları saxlanılır.
- Market 1.5.69 / Restoran 1.9.11: təhlükəsiz birdəfəlik brauzer keçidi ilə ödəniş; müddət əsas əməliyyat qatında yoxlanılır. Ödənilmiş tarix üçün yeni cihaz imzalı lisenziya heartbeat-də alınır. Yeni, yalnız ödəniş sessiyası ilə girən hesab ilk ödənişdən sonra bir dəfə çıxıb yenidən daxil olmalıdır; bu sessiya biznes API-lərinə giriş vermir.

## Epoint kabinetində daxil ediləcək ünvanlar

| Xana | Dəyər |
|---|---|
| Veb sayt | `https://possistem.az` |
| Uğurlu əməliyyat | `https://possistem.az/odenis/ugurlu/` |
| Uğursuz əməliyyat | `https://possistem.az/odenis/ugursuz/` |
| Nəticənin göndərilməsi | `https://possistem.az/pos/api/billing/epoint/callback` |

1. Merchant müqaviləsi, VÖEN və bank məlumatlarını tamamlayın. API, Card Storage və recurring icazələrini Epoint ilə ayrıca təsdiqləyin.
2. Public/private açarları chatda və GitHub-da paylaşmayın. Serverin `/var/lib/possistem-pos-control/.env` qorunan faylına `EPOINT_PUBLIC_KEY` və `EPOINT_PRIVATE_KEY` yazılmalıdır. Token şifrələmə açarı serverdə hazırlanıb, ayrıca qorunmalı və ehtiyatı saxlanılmalıdır.
3. Admin → Ödəniş parametrləri: satıcının hüquqi adı/VÖEN/ünvan/telefonu, abunəlik, məxfilik, çatdırılma və qaytarma mətnlərini yazın. Müqavilə mətnini dəyişəndə yeni versiya verin; əvvəlki versiyalar saxlanılır. Özünüz götürmə ünvanını doldurun; çatdırılma haqqı boşdursa çatdırılma açılmır.
4. Admin → Abunəliklər: müştərini və proqramı seçin, ayrı aylıq haqqı yazın. Mövcud müddət qalır; müddətsiz lisenziyaya qoşulmada ilk ödəniş tarixi ayrıca seçilməlidir. Müştəri yaradılarkən proqram üzrə aylıq haqq tələb olunur; əlavə POS eyni proqramın mövcud abunəliyinə qoşulur.
5. Admin → Məhsullar: satılacaq məhsulun qiymətini və stokunu özünüz təsdiqləyin. Köhnə idxal qiyməti istifadə edilmir.
6. Epoint-in verdiyi sınaq imkanları, kiçik real ödəniş, status yoxlaması, tam geri qaytarma və yeni kartla təkrarlanan ödəniş yoxlanılmalıdır. Yalnız bundan sonra serverdə `EPOINT_LIVE_VERIFIED=true`, API restart və admin panelində onlayn ödəniş/recurring açılmalıdır. Bank açarları hələ verilmədiyi üçün bu mərhələ tamamlanmayıb və funksiyalar bağlıdır.

Ödəniş tarixçəsi olan müştəri silinəndə hesab arxivlənir: giriş, lisenziya və avtomatik yenilənmə bağlanır; sifarişlər və maliyyə auditi saxlanılır.

## Qeyri-müəyyən nəticə

Bank nömrəsi varsa admin “Bankdan yoxla” seçir. Nömrə heç alınmayıbsa ikinci dəfə tutulma edilmir. Epoint ilə sifarişin əlaqəsi yoxlanılmalıdır; API sifariş əlaqəsini təsdiqləməyən təsadüfi uğurlu bank əməliyyatını hesaba bağlamır. Geri qaytarma sorğusunun `success` cavabı təkbaşına kifayət sayılmır: orijinal əməliyyatın statusu `returned` olmalıdır.

## Yoxlama və real məhdudiyyətlər

- 18 sınaq: real, ayrıca PostgreSQL bazasında; bank transportu fixture-dir. Callback imzası, saxta məbləğ, müştəri təcridi, təkrar/paralel çağırış, restart sonrası qeyri-müəyyənlik, qiymət/razılıq, retry, stok yarışı, gec təsdiq, aysonu, HTTP icazə sərhədləri və hesab bağlanarkən ödəniş tarixçəsinin qorunması.
- Market: 3 ödəniş siyasəti sınağı, o cümlədən həqiqi sidecar transportunda müddəti bitmiş birbaşa IPC çağırışının yazılmadan rədd edilməsi. Mövcud lisenziya yenilənmə yoxlaması keçib.
- Restoran: Wine üzərində Windows C++ core-da `[billing]` — 1 sınaq / 7 assertion; `[payment]` — 10 sınaq / 58 assertion. İmza/yenilənmə/ləğv üçün 18 JS sınağı keçib.
- Chromium 151.0.7922.34: 360, 390, 768, 1366, 1920 px; alış, müştəri abunəliyi, admin abunəlikləri və parametrlər — 20 görünüş. TypeScript və bütün sayt/panel/app yığımları keçib.
- Həqiqi Epoint/bank, kartdan real tutulma, fiziki kassada oflayn ödənişdən sonra açılma və Android qurğusunda sınaq aparılmayıb. Bunlar uğurlu kimi təqdim edilmir.
- Windows sertifikatı yoxdur; quraşdırıcılar mövcud buraxılışlar kimi Authenticode imzasızdır. OS/SmartScreen xəbərdarlığı göstərə bilər.

## Mənbə və bərpa

Mənbə: `AliMammadli-PB/possistem-src`, `main` — `platform/`, `website/`, `marketpos/`, `restoranpos/`. Keçmiş `restoranpos/control-plane` nüsxələri tarixi istinaddır.

Server ehtiyatı: `/opt/possistem-pos-control/backups/epoint-20261024`. Əvvəlki API/panel yığımları `.epoint-release-20261024` qovluğunda da saxlanılıb. Saytın əvvəlki yığımı `.next-before-epoint-20261024` ilə saxlanılır. Yeniləmə feed-lərinin əvvəlki `latest.yml` faylları versiya üzrə qorunur. Miqrasiya əlavə cədvəllər yaradır; rollback zamanı maliyyə tarixçəsini silməyin.

Rəsmi mənbələr: [Epoint qoşulma](https://developer.epoint.az/az), [callback](https://developer.epoint.az/az/callbacks), [status](https://developer.epoint.az/az/status/get-status), [recurring izahı](https://epoint.az/az/faq).
