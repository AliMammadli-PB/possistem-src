# Possistem — təhlükəsizlik yoxlaması və buraxılış, 24.10.2026

Bu hesabat sayt, Node/Fastify API, PostgreSQL, admin/müştəri portalları, Android qabığı və Market/Restoran masaüstü tətbiqlərində bu iş zamanı yoxlanılan sərhədləri təsvir edir. Bu, müstəqil penetrasiya sertifikatı və ya bütün mümkün hücumların mümkünsüzlüyünə zəmanət deyil. Canlı müştərilərin satışları silinməyib, HWID-lər sıfırlanmayıb və real kartdan pul tutulmayıb.

## Əsas suallara cavab

- **Hack oluna bilərmi?** Hər internet sistemi risk daşıyır. Tapılan konkret asılılıq, sessiya və yeniləmə problemləri düzəldildi. “Artıq heç kim hack edə bilməz” nəticəsi verilmir.
- **Tərsinə mühəndislik mümkündürmü?** Bəli. Brauzer JavaScript-i, Electron ASAR və APK təhlil edilə bilər; C++ hissəsinin də təhlili mümkündür. Kodun gizlədilməsi ödəniş və icazə yoxlamasını əvəz etmir. Yerli administrator/root cihaz fayllarını və proqramı dəyişdirə bilər. İmza yoxlaması və server icazələri bu riskin sərhədini azaldır, cihaz sahibindən tam müdafiə yaratmır.
- **Login və abunəni keçmək mümkündürmü?** Yoxlanılan saxta/imzasız token, dəyişdirilmiş ödəniş və müddəti bitmiş birbaşa IPC nümunələri rədd edildi. Başqa naməlum keçidin olmaması sübut edilmir. Hazırda açarsız istifadənin davam etməsi sahibin istədiyi, serverdə ayrıca qeyd edilən sazlama rejimidir; ödənilmiş kimi göstərilmir.
- **Chatdan sayt dəyişdirilə bilərmi?** Baxılan dəstək mesajları React mətn düyünləri kimi göstərilir; mesaj HTML/JavaScript kimi icra edilmir. Yerli qayda köməkçisi admin əməliyyatı icra etmir. Dəstək sorğusu və fayllar üçün autentifikasiya/CSRF/müştəri sahibliyi yoxlanılır. Sosial mühəndisliklə əməkdaşı aldatmaq riski texniki yoxlama ilə tam yox olmur.
- **PHP xəbərdarlığı bizə aiddirmi?** Bu tətbiqin icra zənciri PHP/WordPress deyil, Node/Fastify/Next.js-dir. PHP barədə ümumi mail həmin zəncirin istismar edildiyini göstərmir. Eyni VPS-dəki bütün başqa xidmətlər və əməliyyat sistemi üçün tam audit iddiası yoxdur.

## Tapıntılar və dəyişikliklər

| Sahə | Risk / əvvəlki vəziyyət | Tətbiq edilən tədbir |
|---|---|---|
| Sayt asılılıqları | Köhnə Next/Sharp və digər istehsal asılılıqları üçün yayımlanmış kritik/yüksək bildirişlər | Next **15.5.28**, Sharp **0.35.5**; SVG optimallaşdırılması bağlı. Sayt və API-də şəkil emalı yeniləndi, emal piksel limiti əlavə edildi. Paket bildirişi təsdiqləndi; canlı RCE istismarı aparılmadı. |
| API asılılıqları | Auditdə kritik/yüksək və digər köhnə asılılıqlar | Fastify **5.12.6**, Drizzle **0.45.2**, Baileys **6.7.22**, Nodemailer **10.1.4** və uyğun tranzitiv paketlər. React Router **7.18.2**, Zod **4.6.6**. |
| JSON/IPC iş həcmi | Uyğunluq üçün saxlanmış Zod v3 API-si böyük kolleksiyalarda gec validasiya edə bilər | Schema-dan əvvəl dərinlik, element sayı, kolleksiya uzunluğu və ümumi mətn/byte büdcəsi. Təkcə paket versiyasının dəyişməsi bu müdafiə sayılmır. HTTP JSON limiti 1 MiB; fayllar ayrıca multipart qaydaları ilə idarə olunur. |
| Tenant sessiyaları | Proses yaddaşındakı çıxış qeydi restartdan sonra itə bilərdi; hesab/şifrə dəyişikliyinin tokenlərə təsiri yetərli deyildi | Hər bearer sorğusunda aktiv hesab, şifrə epoch-u və DB-də davamlı ləğv qeydi yoxlanılır. Şifrə dəyişəndə cookie sessiyaları da silinir. Yalnız doğrulanmış token çıxış cədvəlinə yazılır; vaxtı keçmiş qeydlər təmizlənir. |
| Müştəri qeydiyyatı | Birbaşa köhnə API ilə özünə hesab yaratmaq imkanı | Register, qeydiyyat OTP-si və email-yoxlama yolu serverdə **403 REGISTRATION_DISABLED** qaytarır. Portal qeydiyyat marşrutu girişə yönəlir; admin hesab yaradır. |
| İlk admin şifrəsi | Məcburi şifrə dəyişikliyi ekranını UI-dən keçmək riski | Məcburi dəyişmə zamanı admin API girişi me/logout/change-password ilə məhdudlaşır. |
| Android parol körpüsü | Yenidən istifadə edilən parolun JavaScript-ə qaytarılması | Kotlin WebMessage login/parol körpüsü çıxarıldı; əvvəlki saxlanmış qeyd startup-da təmizlənir. Canlı admin JS-i köhnə APK-lara da parol göndərmir. HTTP sessiyası saxlanılır. |
| Android naviqasiya/endirmə | WebView yönləndirməsində etibarsız səhifə və cookie sızması riski | Əsas səhifə başlananda HTTPS panel siyasəti təkrar yoxlanılır; xarici səhifə ayrıca açılır. Sənəd endirməsində avtomatik redirect bağlıdır, cookie yalnız etibarlı eyni origin-ə göndərilir. SSL xətası ləğv edilir; file/content/mixed access bağlıdır. |
| Masaüstü IPC | Origin-i sadə sətir prefiksi ilə yoxlamaq düzgün host sərhədi deyil | Protokol, host, port, credential-sız URL və əsas WebContents birlikdə yoxlanılır. Rollar və icazələr native/main qatında qalır. |
| Windows yeniləməsi | Təkcə yayımlanan hash-i dəyişdirə bilən hücumçu feed-i də dəyişə bilər | Ayrıca **Ed25519** imzalı versiya manifesti, tətbiq/versiya/fayl/ölçü/SHA-512 uyğunluğu və quraşdırmadan əvvəl tam fayl hash-i. İmzasız/dəyişdirilmiş yeniləmə rədd edilir. |
| Proxy və limitlər | Cloudflare ünvanı müştəri ünvanı kimi görünürdü; ortaq rate-limit səhv bölünürdü | Yalnız rəsmi Cloudflare şəbəkələri real-IP üçün etibarlıdır. Nginx X-Forwarded-For-u təsdiqlənmiş ünvanla əvəz edir. Saxta müştəri XFF-i ilə yoxlama keçdi. |
| HTTP başlıqları | Yetərsiz iframe/base/object və brauzer davranışı sərhədləri | `frame-ancestors self`, `base-uri self`, `object-src none`, nosniff, strict referrer və camera/mic/geolocation məhdudiyyəti. Host üçün HSTS; subdomain/preload vədi verilmir. Tam nonce əsaslı script CSP əlavə edilməyib. |
| Səhv/keş cavabları | Daxili xətaların detallarının cavaba çıxması və autentifikasiyalı keş riski | 500 cavabı requestId ilə ümumiləşdirilir, detallı xəta server logundadır; autentifikasiyalı cavablar private/no-store olur. |
| Electron icra mühərriki | 43.7.5-dən sonra yeni düzəlişlər çıxıb | Yekun Market/Restoran yığımları **43.8.3** istifadə edir. 45.0.0 ən yeni major olsa da bu buraxılışda 43 xəttinin cari düzəlişi seçilib. |

Son `npm audit --omit=dev` / `pnpm audit --prod` nəticələrində sayt, platform və iki POS paketinin istehsal asılılıqları üçün **0 bildiriş** alındı. Bu, bütün kodda 0 zəiflik demək deyil; dev alətləri, bank, OS və cihazın özünün bütün risklərini əhatə etmir.

## 50 ₼ abunəlik və açarsız istifadə

- Aktiv, ləğv edilməmiş mövcud Market/Restoran lisenziyaları üzrə müştəri + proqram abunəliyi DB-də **5000 qəpik/ay** ilə yaradıldı/yeniləndi. Eyni proqramın kassaları/filialları eyni abunəliyə bağlanır. Hesabı və ya lisenziyanı uyduraraq artıran miqrasiya yoxdur; bazada hazırda bir uyğun aktiv Market abunəliyi var, Restoran üçün mövcud uyğun hesab yoxdur.
- Bu qiymət Market üçün ayrıca, Restoran üçün ayrıca aylıq haqqdır. Adminin yaratdığı yeni müştəridə ilkin dəyər 50 ₼-dir; server qiymətini müştəri dəyişə bilmir.
- Həqiqi ilk ödəniş qeydi olmayan hesaba portal və yeni POS “Abunə olun — 50 ₼/ay” məlumatını göstərir. Keçmiş lisenziya müddəti bank ödənişi kimi saxtalaşdırılmır.
- **Epoint private key yoxdur; real ödəniş/recurring və məcburi bağlama hazırda bağlıdır.** Public key təkbaşına pul qəbul etmir. UI uğurlu ödəniş uydurmur, mümkün olmayan ödəmə düyməsi bağlıdır.
- İstifadə davam edir. Bu sazlama rejimində server qısa, yenilənən **7 günlük imzalı istifadə lease-i** verə bilir; bu, `paidUntil` və ya ödəniş əməliyyatı deyil. Davamlı oflayn istifadədə lease bitəndə internetlə yenilənmə lazımdır. Ləğv/deaktiv hesab açılmır.
- Məcburi abunə bağlanmasını açmaq üçün həm doğrulanmış bank konfiqurasiyası, həm ödənişlərin aktivləşdirilməsi, həm adminin ayrıca **Ödənilməyibsə yeni satışı bağla** seçimi tələb olunur. Bunlar istifadəçi tərəfindən təsdiqlənməyənədək açılmayıb.
- Saxta callback imzası, merchant/məbləğ uyğunsuzluğu, təkrar callback və paralel ödəmə ayrıca sınaqdan keçirilib. Müştərinin “uğurlu” səhifəyə getməsi lisenziya açmır.

## Market POS iş sahəsi

Parametrlər və İdarə Əməliyyatlar kataloquna keçirildi. Kataloqdan bölmələr tam səhifədə açılır, iş vərəqləri `×` ilə bağlanır və vərəq sətri gizlədilir. Açıq modul Satışa keçəndə mount vəziyyətini saxlayır. “Yeni məhsul” ayrıca vərəqdir; yazma native `CREATE_PRODUCT` icazəsinə tabedir. Filial seçimi saxlanılıb; uzaq filial görünüşündə yerli Parametrlər kimi modullar göstərilmir.

Satışda real salafan/paket və çox satılan məhsullardan sürətli düymələr var. Siyahıdan məhsul seçib əlavə etmək mümkündür; seçilənlər cihazda saxlanılır, maksimum 12. Bir klik normal səbət `onAdd` yoluna gedir; qalıq və yekun satış yoxlamasını keçmir. Mövcud olmayan məhsul və qiymət uydurulmur. Kateqoriya panelini gizlətmək mümkündür.

## Aparılan yoxlamalar

- **24 API/billing testi**: ayrıca PostgreSQL bazası yaradılıb sonda silinir. İmza, merchant/məbləğ, tenant ayrılığı, stok yarışı, gec/repeated callback, restart, retry, razılıq, tarixçə, qeydiyyat bloklaması, şifrə/çıxış/deaktiv sessiya, JSON büdcəsi və açarsız lease. Bank adapteri fixture-dir.
- **6 Market JS təhlükəsizlik testi**: müddət/read-only siyasəti, real sidecar transportunda yazmadan əvvəl rədd, payment URL siyasəti, imzalı yeniləmə və fayl dəyişdirilməsi, IPC büdcəsi. Native permission yoxlaması saxlanılıb.
- Restoran Windows C++ core-u **Wine** üzərində: `[billing]` 1 test / 7 assertion; `[payment]` 10 test / 58 assertion. Sonrakı versiya dəyişikliyi yalnız versiya sabiti/Electron qabığıdır.
- Chromium **151.0.7922.34**: 360/390/768/1366/1920 px-də checkout, müştəri abunəliyi, admin abunəlikləri və parametrlər — **20 fixture görünüşü**; əsas JS xətası və səhifə overflow-u yoxdur. Bu, hər canlı maliyyə əməliyyatının icrası deyil.
- Market iş sahəsinin 1366 px fixture sınağı: modul/vərəq açma-bağlama, modul/Satış arasında draft qorunması, real formanın native adapterə bir məhsul göndərməsi, sürətli səbət əlavəsi. Bu sınaq fiziki kassanın tam E2E yoxlaması deyil.
- Android: üç release APK yığılıb. Admin/customer/support üçün hərəsində **12 JVM testi**, cəmi 36; köhnə APK-larla imza sertifikatları eynidir. Parol körpüsünün olmaması instrumentation testi compile edilib, cihazda bu buraxılış üçün icra edilməyib.
- Canlı register/check-email 403; yanlış bank callback-i açarsız konfiqurasiyada 503. Üç APK CDN-dən yenidən endirilib ölçü/SHA-256 yoxlanıb. Nginx config testi və API xidmətinin aktivliyi yoxlanıb.
- Restoran/Market Windows paketləri və TypeScript, API, iki portal və Next build-ləri keçir. ASAR-da yeni imza/IPC modulları və versiyalar yoxlanır. Mənbədə gizli yeniləmə açarı saxlanılmır.

## Buraxılışlar və mənbələr

- [Market POS 1.5.71](https://possistem.az/marketpos/updates/MarketPos-Setup-1.5.71.exe)
- [Restoran POS 1.9.14](https://possistem.az/pos-updates/Possistem-Setup-1.9.14.exe)
- [Müştəri Android 1.0.5](https://possistem.az/downloads/android/customer/1.0.5/possistem-customer-1.0.5.apk)
- [Admin Android 1.0.5](https://possistem.az/downloads/android/admin/1.0.5/possistem-admin-1.0.5.apk)
- [Dəstək Android 1.0.5](https://possistem.az/downloads/android/support/1.0.5/possistem-support-1.0.5.apk)

Əsas mənbə: özəl `AliMammadli-PB/possistem-src`, `main`: `platform/`, `website/`, `marketpos/`, `restoranpos/`. Android: özəl `AliMammadli-PB/possistem-admin-android`, `main`. Köhnə pilot `1.5.63` linki cari buraxılış deyil. 1.9.12 aralıq buraxılışı saxlanılır; 1.9.13 yekun feed-ə keçirilməyib. Son Electron yeniləməsi 1.9.14 ilə verilir, əvvəlki fayllar dəyişdirilmir. Yeni yayım skripti build receipt, fayl hash-i və Electron versiyası uyğun gəlməyəndə yayımı saxlayır. Son canlı yoxlamada Market feed-in köhnə `v` qovluğunun 0644 olması tapıldı: 0755 düzəldildi, publisher bunu özü qurur və feed-i dəyişmədən əvvəl imzalı manifestin ictimai HTTPS ünvanını yoxlayır.

Windows quraşdırıcıları üçün **Authenticode sertifikatı yoxdur**. Yeni daxili Ed25519 yeniləmə imzası Windows sertifikatı deyil. İlk quraşdırma HTTPS mənbəyinə etibar edir və SmartScreen xəbərdarlığı verə bilər. Köhnə tətbiq yeni imza yoxlamasını yalnız yeniləndikdən sonra əldə edir. APK-lar mövcud Android açarı ilə imzalanıb; Android quraşdırma təsdiqi tələb olunur.

## Server yerləşdirməsi və bərpa

- API-nin yeni, bütöv dependency/runtime ağacı: `/opt/possistem-pos-control/.security-build-20261024`. `possistem-pos-control` xidmətində `30-security-release.conf` ExecStart drop-in-i buraya baxır. Köhnə WorkingDirectory/env/signing/upload sahələri qorunub.
- Miqrasiya: `0043_security_subscription_rollout.sql`; DB dump: `/opt/possistem-pos-control/backups/security-20261024/database.dump`, root 0600. Müştəri/satış/ödəniş tarixçələri saxlanılıb.
- Əvvəlki API dist/runtime əsas ağacda qalır. Panellərin əvvəlki dist-ləri `.security-panel-final/{admin,owner}` və əvvəlki mərhələ ağaclarında saxlanır. Köhnə hash-li asset-lər yeni dist-ə də daşınıb.
- Saytın əvvəlki `.next` və `node_modules` ağacları `/var/www/possistem/.next-before-security-20261024` və `node_modules-before-security-20261024` altında qalır.
- Nginx ehtiyatları: yuxarıdakı backup qovluğunda. APK-lar `/var/www/possistem-downloads/android/` altında, əvvəlki feed-lər ayrıca saxlanır. Windows əvvəlki feed-i `latest.yml.bak-before-<version>` kimi saxlanır.
- API rollback-i uyğun köhnə runtime ilə edilməlidir: drop-in çıxarılıb daemon-reload/restart; UI/site yığımları uyğun komplektlə dəyişdirilir. **Maliyyə cədvəlləri/məlumatları rollback üçün silinmir.**

## Sahibin edəcəyi işlər

1. Yeni Windows və Android versiyalarını cihazlarda quraşdırın; bir kassada ehtiyat götürüb anbar/satış/qaytarma/çap və yeniləmə axınını yoxlayın. Real SUNMI/fiskal aparat və müxtəlif Android istehsalçılarının fon-batareya davranışı burada sınaqdan keçirilməyib.
2. Epoint moderasiyasını, merchant/bank müqaviləsini və private key verilməsini tamamlayın. Private key bu hesabatdan və public key-dən əldə edilmir, Epoint-in kabineti/qoşulma prosesi verməlidir. Açarı chat/GitHub-a göndərməyin; qorunan server konfiqurasiyasına daxil edin. Əvvəlki söhbətdə paylaşılmış Epoint hesab parolunu dəyişin.
3. Admin → Ödəniş parametrləri: hüquqi satıcı məlumatı, şərtlər və götürmə/çatdırılmanı təsdiqləyin. Bankla sınaq, kiçik real ödəniş/status/refund yoxlanmadan `EPOINT_LIVE_VERIFIED` və məcburi abunə rejimini açmayın. Hazırkı 50 ₼ yazılıb, pul tutulmayıb.
4. Yerli **Windows yeniləmə imza açarını** `/home/panda/.local/share/possistem/windows-update-signing.pem` və Android-in əvvəlki imza açarını şifrəli, ayrıca offline ehtiyatda saxlayın. Private açarlar repo və website serverinə köçürülməyib. Gələcək Windows yayımı həmin açar olmadan bilərəkdən dayanır.
5. Rəsmi Windows Authenticode sertifikatı əldə ediləndə quraşdırıcılara OS imzası əlavə edin. İlkin quraşdırma xəbərdarlığını yalnız manifest imzası aradan qaldırmır.
6. Server/DB ehtiyatını başqa təhlükəsiz məkanda da saxlayın; cihaz/OS/WebView yeniləmələrini davam etdirin. Tam müstəqil pentest və bütün VPS xidmətləri auditini ayrıca mərhələ kimi aparmaq lazımdır.

## İstinad edilən rəsmi mənbələr

- [Next.js SVG/Image Optimization RCE, düzələn 15.5.28](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
- [Next.js Server Actions DoS](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
- [Next.js sentyabr təhlükəsizlik yeniləməsi](https://nextjs.org/blog/september-2026-security-release)
- [Electron 43.8.3 rəsmi buraxılışı](https://releases.electronjs.org/release/v43.8.3)
- [Electron təhlükəsizlik qaydaları](https://www.electronjs.org/docs/latest/tutorial/security)
- [OWASP — etibarsız WebView məzmunu](https://mas.owasp.org/MASWE/MASVS-PLATFORM/MASWE-0035/)
- [Cloudflare real IP qaydası](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/), [IPv4](https://www.cloudflare.com/ips-v4), [IPv6](https://www.cloudflare.com/ips-v6)
- [Epoint qoşulma](https://developer.epoint.az/az), [callback qaydası](https://developer.epoint.az/az/callbacks)
