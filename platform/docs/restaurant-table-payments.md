# Restoran masa hesabının QR ilə ödənilməsi

## Hazırlanan axın

Kassir hesabın **Ödəniş → QR ilə ödə** düyməsini açır. Ekrandakı **dinamik, 30 dəqiqəlik** kod həmin hesab üçündür. Bu, menyu sifarişi üçün çap edilmiş daimi QR-dən ayrıdır. Telefon səhifəsində restoran/masa/sifariş, ümumi məbləğ, ödənilmiş və bankda gözləyən hissə göstərilir.

Qonaq **Hamısını ödə**, **Bərabər böl** və ya **Seçdiyim yeməkləri ödə** seçir. Server dəqiq məbləği əvvəl göstərir, sonra həmin məbləğlə checkout yaradır. Başqa qonağın əməliyyatı məbləği dəyişibsə yeni təsdiq tələb olunur. Epoint-in hosted səhifəsi kartı qəbul edir; POS-da kart nömrəsi/CVV daxil edilmir və saxlanmır.

Kassanın əsas nüvəsi əvvəl məbləği rezerv edir. Bankın doğrulanmış nəticəsi həmin native rezervə tətbiq olunur. Bütün hesab ödənəndə mövcud native bağlanış, stok/kalkulyasiya çıxışı və çek növbəsi işləyir. Qismən ödəniş hesabı açıq saxlayır. QR pəncərəsini bağlamaq ödənişi dayandırmır. Native hesab kilidi tətbiq yenidən açılanda da qalır.

## Restoranın öz merchant hesabı

Yalnız Possistem **superadmini**, admin panelində **Ödənişlər → Restoran ödənişləri** bölməsindən restoranı seçib public/private Epoint açarlarını daxil edir. Sahibkar açarları Possistemə təqdim edir. Gəlir həmin restoranın öz merchant hesabına yönləndirilir; Possistem abunəlik/mağaza merchant açarları istifadə olunmur.

- Private açar PostgreSQL-də AES-256-GCM ilə şifrələnir. Məqsəd və müştəri üzrə ayrılmış açar serverin `SESSION_SECRET` dəyərindən alınır. Bu sirri və server bazasını birlikdə qoruyub bərpa etmək lazımdır. Sessiya sirrinin rotasiyası əvvəl merchant və bill sirlərinin yenidən şifrələnməsini tələb edir.
- Private açar admin GET cavabına, POS-a, QR URL-ə, qonağın səhifəsinə və audit metadatasına qaytarılmır.
- Admin açarları saxlayanda yeni merchant versiyası yaranır. Paneldə göstərilən **yeni callback URL-ni** həmin restoranın Epoint kabinetinə yazın: `/pos/api/billing/table/epoint/callback/<merchant-id>`.
- Köhnə açar versiyası əvvəl başlanmış ödənişlərin callback/status yoxlaması üçün saxlanılır. Köhnə merchantla yeni checkout bağlanır. Hər saxlamadan sonra yeni callback ünvanını yoxlayın.
- Restoran üçün bank/kassa yoxlaması təsdiqi və serverdə `TABLE_QR_PAYMENTS_ENABLED=true` birlikdə tələb olunur. Standart vəziyyət **bağlıdır**. Bu işdə real merchant açarı əlavə edilməyib və canlı tutulma açılmayıb.

## Pulun qorunması

Məbləğlər tam qəpikdir. 10,01 ₼ / 3 pay = 3,34 + 3,34 + 3,33. Endirim/xidmət/əvvəlki depozit qalıq hesab üzrə sətirlərə proporsional bölünür. Eyni yeməyin/payın təkrar rezervi qəbul olunmur. Bir hesabda bərabər və yemək üzrə bölmə qarışdırılmır; qalan hissənin hamısını ödəmək olar.

Hər cəhdin sabit request/intent ID-si və PostgreSQL-də atomik hesab kilidi var. POS-da rezerv/tətbiq idempotentdir. Hosted checkout cavabı və ya uğurlu səhifəyə qayıdış özlüyündə ödənişi təsdiqləmir. Merchant imzası, sifariş, bank əməliyyatı, məbləğ, AZN və verilmiş əməliyyat kodu yoxlanır. Məlum əməliyyatlar server işçisi ilə bankdan da soruşulur.

Bank nəticəsi qeyri-müəyyəndirsə ikinci tutulma yaradılmır. POS oflayndırsa təsdiqlənmiş pul `paid` qalır; cihaz qoşulanda tətbiq təkrarlanır. QR linkinin vaxtı bitəndə bank rezervi avtomatik sərbəst buraxılmır. Bankda gözləyən əməliyyat varkən kassir QR-ni dayandıra, hesabı dəyişə, paralel nağd ödəniş ala və Z bağlanışı edə bilməz.

Epoint-də açılmış, amma tamamlanmamış ödəniş uzun müddət `new/pending` qalarsa onu bank/kabinet tərəfdə dəqiqləşdirmək lazımdır. Bu versiya bank təsdiqi olmadan rezervi məcburi silmir. Nömrəsi alınmayan əməliyyat admin panelində dəqiq Epoint nömrəsi ilə yoxlanıla bilər; sifariş ID-si və məbləğ uyğunluğu tələb olunur. Geri qaytarılmış/gec uğurlu ziddiyyətli nəticə `review` olur.

QR kart qaytarması POS-un adi terminal/nağd qaytarması ilə edilmir. Restoranın Epoint kabinetində qaytarma və ayrıca POS uzlaşdırması tələb olunur; avtomatik QR refund bu mərhələyə daxil deyil. Native və UI səhv terminal qaytarmasını bloklayır.

## Native sərhədi və SUNMI

Server yalnız `hold/apply/release` əməliyyatını imzalanmış cihaz növbəsi ilə göndərir. Hesab/cihaz/vaxt yoxlanır; əlavə olaraq hər native əməliyyat həmin bill-in 256 bitlik sirri ilə HMAC-SHA256 təsdiqi daşıyır. SQL/JavaScript və sərbəst IPC metodu qəbul edilmir. Başlatma və dayandırma `payment.take` icazəsi tələb edir. Başlatma aktiv lisenziya və açıq kassa qaydalarını da saxlayır.

**Aktiv SUNMI fiskal kassasında başlatma bloklanır.** Hazırkı fiskal inteqrasiya bir satışa bir kart RRN-i bağlayır. Bir neçə qonağın kart əməliyyatını eyni fiskal çekdə uyğunlaşdırma fiziki bank/SUNMI yoxlaması tamamlanmadan açılmır. Bank, real Windows kassa və fiziki mobil cihaz qəbul sınaqları keçirilmiş sayılmır.

## Fayllar və tətbiq

- PostgreSQL: `migrations/0061_restaurant_table_payments.sql` (yalnız yeni cədvəllər).
- Server: `apps/api/src/lib/table-payments`, `apps/api/src/routes/table-payments.ts`.
- Admin: `apps/admin-web/src/components/RestaurantPaymentSettings.tsx`.
- Qonaq: `website/src/app/qr/hesab/[token]`, `website/src/components/qr/TableBillPayment.tsx`.
- Native: `restoranpos/native/core/src/handlers/QrPaymentHandlers.inc`.
- Electron: `restoranpos/qr-payments`, `scripts/apply-restaurant-table-payments.mjs`; assemble siyahısına daxildir.

1.10.29 installer, sayt/API və admin yayımı 13 noyabr 2026-da tamamlandı. Canlı QR kart tutulmaları ayrıca bağlı saxlanılır. Aktivləşdirmə üçün systemd əlavə EnvironmentFile faylı `/var/lib/possistem-pos-control/table-payments.env` içindəki `TABLE_QR_PAYMENTS_ENABLED` bayrağı və restoranın təsdiqlənmiş merchant sazlaması birlikdə tələb olunur. Canlı tətbiq sırası: yedək → 0061 miqrasiyası → API/admin/website → yerli POS sınağı → restoranın merchant açarları/callback → uyğun kassada kiçik real ödəniş və qaytarma uzlaşdırması → həmin restoran üçün aktivlik. Eyni anda bütün restoranlarda açmayın.

## Yoxlama dəlilləri

`platform/artifacts/table-payments` daxilində server, domen, Electron körpüsü və brauzer logları/şəkilləri saxlanılır. PostgreSQL sınaqları ayrıca `possistem_qr_test_table_payments` bazasında, saxta bank transportu ilə aparılır; real pul tutulmur. Native sınaqları ayrı müvəqqəti SQLite bazası yaradır.

### Bu işdə alınan nəticələr

- Domen + PostgreSQL/API: 20 sınaq keçdi; məbləğ, paralellik, tenant ayrılığı, callback, restart, oflayn POS və işçi növbəsinin ədalətli təkrarı daxil.
- Electron əsas proses körpüsü: 5 sınaq keçdi.
- Native Linux: QR/refund üzrə 21 sınaq, 154 assertion keçdi. Əlavə tam 425 sınaqdan 424-ü Linux-da keçdi; qalanı Windows rasteri tələb edir. Həmin raster sınağı ayrıca Windows binarı/Wine ilə 87 assertion keçdi.
- Windows binarı/Wine: QR üzrə 3 sınaq, 45 assertion keçdi; fiziki Windows kassası deyil.
- Chromium 158.0.8127.18: telefon səhifəsi 360/390/768/1366 px, POS dialoqu 390/768/1536 px. Üfüqi daşma, pay seçimi, məbləğ təsdiqi, gözləmə və reload bərpası yoxlanıldı.
- API, admin və Next production yığımları keçdi; 142/142 desktop assembly patch tətbiq edildi.

Yoxlanılmayanlar: fiziki iPhone/Safari və Android ilə real kart ödənişi; bank merchant imkanlarının aktivliyi; fiziki Windows/bank/SUNMI fiskal uyğunluğu. Canlı aktivlik buna görə bağlı saxlanılıb.
