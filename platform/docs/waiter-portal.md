# Sahibkarın yaratdığı ofisiant girişləri

Sahibkar: `https://possistem.az/pos/app/ofisiantlar`

Ofisiant: `https://possistem.az/pos/app/ofisiant`

## İstifadə

1. Sahibkar mövcud müştəri hesabı ilə daxil olur və Restoran POS seçir.
2. **Ofisiant girişləri** bölməsində şirkət üçün sabit giriş adı seçir. Məsələn, `nobel`.
3. Ad/soyad, `terlan` kimi istifadəçi adı, ən azı 10 simvolluq parol və kassa/filial seçir.
4. Nəticə `terlan@nobel.pos` olur. Bu daxili giriş adıdır, e-poçt qutusu deyil.
5. Kassa internetə qoşulu və yeni bağlantını dəstəkləyən POS açıq olmalıdır. Bağlantı alınmayıbsa **Kassaya qoş** təkrar yoxlayır; ikinci hesab yaratmaq lazım deyil.
6. Ofisiant telefondan daxil olur, masanı və məhsulları seçir, ölçü/əlavələri və qeydi yazır, **Kassaya və mətbəxə göndər** seçir.
7. Sahibkar hesabın girişini bağlaya və parolunu dəyişə bilər. Hər iki dəyişiklik köhnə telefon sessiyalarını dərhal ləğv edir.

Ofisiant kart ödənişi, endirim, anbar düzəlişi və növbə bağlanması həyata keçirmir. Ödənişi kassir qəbul edir. Açıq kassa/növbə və aktiv POS istifadə hüququ nüvədə yoxlanılır.

## Texniki sərhədlər

- Ayrı HttpOnly/SameSite sessiyası və CSRF; sahibkar/admin sessiyasını əvəz etmir.
- Hər hesab sahibkar, cihaz və yerli `waiter` işçisinə bağlıdır.
- `waiter.portal` imzalı növbə ilə yalnız əvvəlcədən müəyyən edilmiş əməliyyatları çağırır. Telefon SQL, IPC metodu, administrator və ya cihaz seçə bilmir.
- Sifarişin UUID-si PostgreSQL və POS qəbzində saxlanılır. Təkrar klik, status yoxlaması və server restartı ikinci məhsul dəsti yaratmır.
- Qəbul ilə mətbəxə göndəriş ayrı təsdiqlənir. Göndəriş yarımçıq qalarsa eyni sifariş tamamlanır.
- Təsdiqi alınmayan sifariş avtomatik təkrar göndərilmir. Səhifə yenilənsə həmin sifariş nömrəsi saxlanır; istifadəçi statusunu yoxlayır.
- Kassa qəbul etmədiyini faktiki təsdiqləyərsə **Sifarişi yenidən hazırla** ilə cari menyudan yenidən seçmək mümkündür.
- Kassa və internet əlçatmaz olduqda oflayn sifariş növbəsi yaradılmır. Köhnə məlumat bağlantı xəbərdarlığı ilə göstərilir.

## Yoxlama

- Yerli POS nüvəsi: 424 test, 3562 assertion; ofisiant üçün əlavə 3 test/36 assertion.
- `restoranpos/waiter/qa-native.mjs`: müvəqqəti SQLite bazası və həqiqi nüvə ilə hesab, masa, məhsul, açıq növbə, 2 məhsullu sifariş, mətbəx statusu, təkrar sorğu və dəyişdirilmiş qiymət yoxlanır.
- `restoranpos/waiter/portal.test.cjs`: imza sonrası kontekst, sabit əməliyyatlar və işçi/administrator ayrılığı.
- `platform/apps/api/src/routes/waiter.integration.test.ts`: ayrıca PostgreSQL test bazasında tenant, parol, CSRF, sessiyanın ləğvi, paralel sorğular və qəbul edilməmiş sifarişin təsdiqi.
- `platform/apps/owner-web/scripts/qa-waiter-web.cjs`: Chromium ilə 390/768/1366/1536 px, səbət, ölçü seçimi, status, oflayn vəziyyət, sahibkarın hesab yaratması və bağlaması. API cavabları brauzer testində fixture-dir; həqiqi nüvə ayrıca yoxlanır.

Fiziki telefon, restoranın real printeri və canlı müəssisədə eyni vaxtlı işçi qəbul sınağı ayrıca aparılmalıdır. Testlər müştərinin real satış/menyu məlumatlarını dəyişdirmir. Bu iş POS installerini və avtomatik yeniləmə lentini yayımlamır; mövcud kassalara bağlantı üçün bir dəfə uyğun POS yeniləməsi lazımdır.
