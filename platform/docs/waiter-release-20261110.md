# Ofisiant portalı — 10 noyabr 2026

Sayt və API yerləşdirildi. POS installerinə, versiyasına və yeniləmə lentinə bu işdə dəyişiklik verilmədi. Yerli NEWEST 140/140 assembly addımı ilə hazırlandı və açıldı.

## Yoxlamalar

- Native: 424 test / 3562 assertion uğurlu; ofisiant hallarının 3 testi / 36 assertion daxil olmaqla.
- Native bridge: ayrıca müvəqqəti SQLite bazasında masa, məhsul, açıq növbə, sifariş, mətbəx statusu, təkrar qəbul və qiymət dəyişdirmə cəhdi yoxlandı.
- Node bridge: 3 test uğurlu.
- API: ayrıca PostgreSQL bazasında 8 inteqrasiya testi uğurlu. Sınaq bazası sonra silindi.
- Brauzer: Chromium 158.0.8127.18, 390/768/1366/1536 px. Sahibkar hesab yaratdı/bağladı; ofisiant ölçü seçdi, səbəti hesabladı, göndərdi, səhifəni yeniləyib təkrar göndərmədən statusu yoxladı; qəbul edilmədiyi təsdiqlənən sifariş yenidən hazırlana bildi.
- Həqiqi açıq URL: `https://possistem.az/pos/app/ofisiant` Chromium-da HTTP 200 və giriş forması göründü.
- Origin smoke: hər iki portal səhifəsi 200; API health 200/database up; girişsiz waiter session və owner waiter list 401; səhv parolla waiter login 401; şəxsi cavablar `no-store`.
- API/owner-web TypeScript və Vite build uğurlu. Mövcud ExcelJS ölçü xəbərdarlığı qalır.
- Assembly təkrar çalışdırıldı; imzalı əmrin tək dispatcher-i, helper funksiyası və bridge faylı saxlandı. Main JS syntax check uğurlu.

## Yerləşdirmə və bərpa

Aktiv systemd ExecStart ayrıca workspace-dən işləyir:
`/opt/possistem-pos-control/.workspace-20261110-chat18/apps/api/dist`.

Bu aktiv qovluğa və standart `/opt/possistem-pos-control/apps/api/dist` mənbə yığımına yalnız waiter route/service və qeydiyyat/CSRF əlavəsi tətbiq olundu. Digər işləyən API modulları bütövlükdə əvəz edilmədi.

- Tam PostgreSQL və əvvəlki owner portal ehtiyatı: `/opt/possistem-pos-control/backups/waiter-2026-11-10T17-50-56-027Z`
- Aktiv API app/auth ehtiyatı: `/opt/possistem-pos-control/backups/waiter-live-2026-11-10T17-52-49-944Z`
- Əvvəlki portal: `/opt/possistem-pos-control/apps/owner-web/dist.before-waiter-2026-11-10T17-50-56-027Z`
- Yeni əlavə miqrasiya: `0056_web_waiters.sql`, `_migrations` daxilində qeyd edildi.

Bərpa zamanı aktiv API qovluğundakı app/auth faylları və owner portal əvvəlki nüsxələrdən qaytarılıb yalnız API xidməti yenidən başladılır. Yeni cədvəllər silinmir; sonradan yaradılmış ofisiant/sifariş məlumatları itirilməməlidir. Tam DB bərpası ayrıca qiymətləndirilməlidir.

Canlı müəssisələrdə sınaq satışı, hesab yaradılması və menyu dəyişikliyi edilmədi. Fiziki telefon və restoran printerində qəbul sınağı hələ aparılmayıb. Köhnə quraşdırılmış POS-lar bu native bağlantı üçün bir dəfə uyğun tətbiq yeniləməsi tələb edir.
