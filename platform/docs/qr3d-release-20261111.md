# QR sifariş və 3D — 11 noyabr 2026

## Sahibkarın istifadə qaydası

1. Restoran POS-da menyunu yayımlayın. Saytda həmin sahibkar hesabı ilə `https://possistem.az/pos/app/qr-3d` ünvanını açın.
2. **QR menyu** tabında restoranı, loqo/üz qabığını və masa kodlarını idarə edin.
3. **3D modellər** tabında yeməyi və onun ölçüsünü seçin. Telefon skan tətbiqindən və ya Blenderdən çıxardığınız GLB faylını yükləyin. En/diametr boşqab da daxil olmaqla santimetrlə yazılır. Sistem modelin ən böyük üfüqi ölçüsünü bu enə uyğunlaşdırır və alt səthini yerə oturdur.
4. Ön baxışda həqiqi yeməklə müqayisə edin, sonra **Yayımla** seçin. 28 sm və 32 sm variantları ayrıca bağlanır. Açıq sm/cm etiketi model eni ilə uyğun gəlməlidir. Ölçü sonradan dəyişərsə, əvvəlki model uyğun variantda göstərilmir.
5. Müştəri QR menyuda yeməyi seçib **3D bax**, uyğun telefonda isə **Masamda göstər** seçir. Modeli olmayan yeməyin şəkli və sifarişi işləməyə davam edir.

Sayt fotoşəkildən avtomatik model yaratmır. Təlimatdakı endirilən pizza faylı sadə həndəsi sınaq modelidir, restoran yeməyinin skanı deyil. Faylın keyfiyyətini sahibkar yoxlamalıdır.

## Fayl və giriş qaydaları

- GLB 2.0, maksimum 10 MiB, 100 min üçbucaq; daxilində yerləşdirilmiş PNG/JPEG teksturalar maksimum 2048 px.
- Xarici URI-lər, animasiya/skin, dəstəklənməyən genişləndirmələr, pozulmuş geometriya qəbul edilmir. Khronos validator və ayrıca məhdud yaddaşlı işçi istifadə edilir.
- Bir sahibkar üçün maksimum 500 model və 500 MiB. İşçi paralelliyi 2, emal vaxtı 15 saniyədir. Diskdə 512 MiB-dan az yer qalanda yeni yükləmə dayandırılır.
- Yükləmə qaralama yaradır. Sahibliyi və restoran parametrlərinə giriş yoxlanılır. Başqa sahibkar modeli oxuya, dəyişə və silə bilməz.
- Qaralama AR ön baxışı üçün 10 dəqiqəlik imzalı, yalnız həmin fayla aid link yaradılır. Yayımlanmış modellər qonaq və telefonun native AR viewer-i üçün açıqdır.
- Model məlumatları `restaurant_qr_models` cədvəlində POS menyusundan ayrı saxlanılır. Köhnə POS-dan təkrar menyu yayımı modelləri silmir. Modellər sifariş qiymətini dəyişmir.
- Kamera yalnız AR əməliyyatında açılır; tətbiq kamera görüntüsünü serverə göndərmir. QR səhifəsində ayrıca Permissions-Policy var. Qalan saytın kamera qadağası saxlanılıb.
- Brauzerdən AR-ə keçməzdən əvvəl mövcud QR sessiyası üçün səbət və seçim saxlanılır. Qayıdışda qiymətlər cari menyudan yenidən hesablanır; sessiyanın bitməsi qüvvədə qalır.

## Yığım və yerləşdirmə

Sayt/API 11.11.2026 tarixində yerləşdirilib. Restoran POS **NEWEST** üçün 1.10.27 mənbə yığımı hazırdır: 141/141 assembly patch, main/preload sintaksis yoxlaması keçib. Yeni POS installer-i və avtomatik yeniləmə kanalı yayımlanmayıb. NEWEST qısayolu bu mənbənin `restoranpos` qovluğuna bağlıdır; yeni parametrlər üçün proqramı adi qaydada yenidən açın.

- Miqrasiya: `0057_qr_3d.sql` — əlavə cədvəl, mövcud menyu/satış məlumatı dəyişdirilmir.
- Aktiv API: `/opt/possistem-pos-control/.commerce-20261111/apps/api/dist` (yerləşdirmə zamanı systemd ExecStart-dan yoxlanılıb).
- Tam baza və dəyişən konfiqurasiya yedəyi: `/opt/possistem-pos-control/backups/qr3d-2026-11-11T14-38-01-147Z`.
- Əvvəlki owner paneli: `/opt/possistem-pos-control/apps/owner-web/dist.before-qr3d-2026-11-11T14-38-01-147Z`.
- Əvvəlki Next yığımı: `/var/www/possistem/.next.before-qr3d-2026-11-11T14-38-01-147Z`.
- NGINX-də yalnız `/pos/api/customer/qr3d` prefiksi üçün 11 MiB yükləmə limiti əlavə edilib. Prefiksin sonunda `/` yoxdur: kök siyahı sorğusunun yanlış 301 yönləndirməsinin qarşısı alınır.

Model faylları `QR_MODEL_DIR` varsa orada, əks halda `supportUploadDir/qr-models` altında saxlanılır. **Bərpa üçün həm PostgreSQL bazası, həm də bu fayl qovluğu lazımdır.** Tək SQL yedəyi GLB baytlarını ehtiva etmir. İstismar yedəyinə bu qovluq da daxil edilməlidir. Fayl silinməsi dərhal tətbiq olunur; əvvəlki yedək varsa, yalnız audit/sahiblik yoxlaması ilə bərpa edin.

Cari serverdə qovluq `/var/lib/possistem-pos-control/support-uploads/qr-models`, sahibi `possistem-pos:possistem-pos`, rejimi `0700`-dır. API istifadəçisinin yazma və validator paketini oxuma icazəsi ayrıca yoxlanılıb. Fayllar `0600` ilə yaradılır və yalnız yoxlanan API ünvanlarından verilir.

Geri qaytarma: əvvəlki sayt/panel qovluqları və aktiv API-nin yedəklənmiş app.js/qr-orders.js faylları birlikdə bərpa edilməlidir; sonra yalnız Possistem API/website prosesləri yenidən başladılır. Əlavə model cədvəlini silmək tələb olunmur. Sonrakı real əməliyyatlar varsa, tam baza dump-ını kor-koranə qaytarmayın.

## Yoxlama nəticələri və sərhədləri

- GLB/geometriya üçün 3 test keçib.
- Ayrı PostgreSQL sınaq bazasında 10 model inteqrasiya testi və əvvəlki 13 QR sifariş testi keçib. Canlı müştərinin menyusu, sifarişi və balansı test üçün dəyişdirilməyib.
- Chromium **158.0.8127.18**, 390/768/1536 px: sahibkar yükləmə/ön baxış/yayım/təlimat, həqiqi WebGL render, 32 sm model ölçüsü, gec yükləmə, AR-dən qayıdış zamanı seçim/səbət, WebGL xətası, sessiyanın bitməsi yoxlanılıb.
- Canlı domen Chromium-da paneldən girişə yönləndirir, səhifə JavaScript xətası vermir; sahibkar API-si sessiyasız 401, nümunə GLB 200 və `glTF` başlığı verir. Origin yoxlamasında sağlam API/baza, saxta model üçün 404 və QR-ə məxsus kamera siyasəti təsdiqlənib. Baş səhifədə kamera qadağası qalır.
- Android/iPhone-un native AR çağırışı brauzer testində imitasiya edilib. **Fiziki iPhone/Safari və ARCore Android/Chrome üzərində masa görünüşü, kamera icazəsi və həqiqi USDZ çevrilməsi hələ təsdiqlənməyib.** Bunlar desktop WebGL nəticəsi ilə əvəz edilmir.
- Yeni native cihaz inteqrasiyası yoxdur; fiziki bank/SUNMI sınağı bu dəyişikliyin yoxlanılmış nəticəsi kimi təqdim edilmir.

İlk real yeməyin modelini yüklədikdən sonra QR kodu həm iPhone, həm Android-də açın: həqiqi boşqab ölçüsü, masa səthi, kamera icazəsi, AR-dən səbətə qayıdış və zəif bağlantını yoxlayın. Uyğunsuz modeldə **Dayandır** düyməsi ilə yalnız onun 3D yayımını bağlamaq mümkündür.
