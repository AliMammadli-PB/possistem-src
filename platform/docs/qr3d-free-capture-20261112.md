# Pulsuz telefon çəkilişindən 3D qaralama

Ödənişli AI/API yoxdur. Sayt şəxsi foto dəstini saxlayır, bu kompüterdə Meshroom 2023.3/AliceVision və Blender emal edir. Mövcud server, RTX 3050 6 GB və elektrik istifadə olunur. Kompüter sönükdürsə sifariş növbədədir. Bir şəkildən görünməyən tərəflər uydurulmur.

## Sahibkarın addımları

1. Telefonda https://possistem.az/pos/app/qr-3d?tab=scan açın və sahibkar hesabına daxil olun. Restoran menyusu əvvəl POS-dan yayımlanmalıdır.
2. **Telefonla skan** → modelin adını yazın, həqiqi diametr və emal razılığı → **Çəkiliş yarat**. Menyuya bağlama model hazır olandan sonra seçilir.
3. Yeməyi sabit, tutqun, teksturalı səthə qoyun. Yumşaq sabit işıq, əsas 1× kamera, eyni telefon və obyektiv. İnsan/sənəd çəkməyin. Telefonu yeməyin ətrafında gəzdirin; yeməyi fırlatmayın. Obyekt bütün kadrlarda tam görünsün. Yan və üst bucaqlardan 48–72 şəkil məsləhətdir; sistem 24–96 qəbul edir. Say bucaq/keyfiyyət zəmanəti deyil. Parlaq/şəffaf qab və etiket əks olunması modeli poza bilər.
4. Kameranı açın → avtomatik çəkiliş və ya ayrı şəkillər. Fayldan JPG/PNG/WebP də seçilə bilər. İcazə rədd edilərsə brauzerin sayt kamera icazəsini açın. iPhone-da Safari və HTTPS istifadə edin. Təkrar eyni şəkil sayılmır; EXIF silinir, JPEG 1920 px-ə endirilir.
5. **3D hazırlamaq üçün göndər**. Səhifəni bağlamaq işi ləğv etmir. Emal hazır olduqda **Modelə 360° / AR bax**. Nəticə avtomatik yayımlanmır. Səth, arxa hissə, tekstura və sm ölçünü yoxlayın. Yararsız qaralamanı silin/yeni çəkiliş edin; lazım olsa biz Blenderdə təmizləyirik.
6. Yaxşı nəticədə **Yayımla**. Müştərinin QR menyusunda uyğun variantda **3D bax → Masamda göstər**. iPhone Quick Look və uyğun Android AR ayrıca fiziki telefonda yoxlanmalıdır.

## Əməliyyat və təhlükəsizlik

- `0058_qr_scans.sql`: sahibkar/menyu bağları, ayrıca fotolar, status, idempotent model nəticəsi və qısa emal icarəsi. Normal GLB validatoru eynidir: 10 MiB/100k üçbucaq/2048 px/daxili resurs.
- Foto sahibkarın autentifikasiyası ilə oxunur; ictimai menyuda foto dəsti yoxdur. QR müştərisi çəkiliş yarada bilmir. Operator kompüteri yalnız ayrıca emal açarı ilə növbə/konkret işə giriş alır; admin girişi deyil.
- Açar `~/.local/share/possistem/photogrammetry/worker.json`, 0600. Server `.env` yalnız `QR_SCAN_WORKER_KEY_SHA256` saxlayır. Açarı Git-ə yazmayın. Rotasiya: yeni təsadüfi açar → server hash → xidmətlərin restartı. Köhnə açar dərhal keçərsiz olur.
- `systemctl --user status possistem-qr-scans.service`; `journalctl --user -u possistem-qr-scans.service -n 40`. Avtomatik başlayır, eyni vaxtda bir iş. Hesab sistemdən çıxanda user xidməti dayana bilər; kompüter açılıb hesaba daxil olunanda davam edir. POS installerindən asılı deyil.
- İş qovluğu `~/.local/share/possistem/photogrammetry/jobs/<uuid>`; özəl meshroom/blender logları. 90 dəqiqə həddi, 30 san heartbeat, 10 dəq server icarəsi. İcarə itəndə proses dayandırılır. Server 3 uğursuz cəhddən sonra yeni çəkiliş tələb edir. Qəti nəticə əvvəlcədən draft kimi yoxlanır, təkrar nəticə ikinci model yaratmır.
- Server şəkilləri son dəyişiklikdən 7 gün sonra saatlıq təmizləyir. Yerli fotolar iş bitəndə silinir; EXR/tekstura/cache daxil olmaqla iş qovluğu 7 gün sonra silinir. Yayımlanmış model ayrıca qalır. Ləğv cari emal icazəsini ləğv edir və server fotolarını silir.
- Müştəri başına 3 aktiv və gündə 10 çəkiliş. Normallaşmış foto <=2 MiB, ümumi server foto limiti 2 GiB, boş disk minimum512 MiB. Limit olduqda açıq mesaj göstərilir.
- Operator iş nəticəsini kor-koranə yayımlamamalıdır: avtomatik fon/səth təmizləmə hər yeməkdə mükəmməl deyil. Hazır modelin yoxluğu mövcud QR sifarişi pozmur.

## Proqramlar və təkrar sınaq

Meshroom: https://github.com/alicevision/Meshroom/releases/tag/v2023.3.0 (MPL-2.0). Blender: https://www.blender.org/ (GPL). Burada kommersiya skan API-si və ya pullu AI hesabı istifadə olunmur.

`node platform/scripts/photogrammetry/worker.mjs --process <photos> --work <private-folder> --output <draft.glb>` — növbəsiz yerli emal. `node platform/scripts/photogrammetry/install-worker.mjs` — hazır engine və qorunan config ilə user xidmətini quraşdırır.

İnteqrasiya testləri yalnız `QR_SCAN_TEST_DATABASE_URL` daxilində `qr_test` adlı ayrılmış bazada işləyir. `node platform/apps/owner-web/scripts/qa-qr-scans.cjs` — brauzerdə kamera simulyasiyası, icazə rəddi, upload retry, minimum say, emal növbəsi və ekran ölçüləri.

Fiziki telefonla çəkilmiş real dəstin keyfiyyət testi və masada AR yerləşdirməsi ayrıca tələb olunur. Sintetik foto dəsti ilə pipeline sınağı bu yoxlamanın əvəzi deyil.

## 12 noyabr sınaq nəticəsi

- Ayrı PostgreSQL bazasında 7 API ssenarisi keçdi: sahibkar ayrılığı/razılıq/ölçü; özəl foto/normalizasiya/təkrar; minimum say/kvota/dondurulma; paralel iş və icarə; nəticənin bir dəfə yaradılması və qaralama qalması; ləğv; köhnə icarə və menyu dəyişikliyi.
- Chromium 158.0.8127.18: 390, 768, 1536 px; kamera simulyasiyası, icazə rəddi, şəkli yenidən göndərmə, minimum24, növbə, kameranın bağlanması, üfüqi daşmanın olmaması. Safari fiziki kamera testi əvəz olunmur.
- Mövcud pizza GLB-dən Blenderdə 48 nəzarət fotoşəkli çəkildi. Foto dəsti Meshroom-da həqiqətən emal olundu; 48 kamera/53,401 SfM nöqtəsi. Bu real telefon fotosu deyil. İlk zəif sınaq çıxarışı istifadə edilmədi.
- Düzəlişlər: ölçüyə görə depth detallılığı (<=1200px:1, böyüklər:2), AliceVision OBJ/SfM koordinat çevrilməsi, RANSAC ilə dayaq səthi, ayrı mesh qırıntılarının təmizlənməsi, mobil poliqon həddi. LSCM səhvi səbəbindən Basic unwrap və PNG tekstura istifadə olunur. Blender `--python-exit-code 1`; uğursuz çıxarış əvvəlki faylı nəticə kimi qaytara bilməz (ayrıca mənfi test).
- Yekun validator nəticəsi: 55,227 üçbucaq, 2 tekstura, 6,500,640 bayt, 28 × 4.16 × 27.45 sm. 360° baxışda 0/90/180 bucaqdan göstərildi, həqiqi USDZ ZIP 23,106,210 bayt hazırlandı. Kameranın fiziki masaya yerləşdirməsi yoxlanılmayıb.
- İlkin API/owner yayımı və DB yedəyi: `/opt/possistem-pos-control/backups/qr-scans-2026-11-12T04-54-19-484Z`. Əlavə bərpa nöqtəsi yekun yayım logundadır. Köhnə POS installer/feed dəyişmir.

Yekun API/owner bərpa nöqtəsi: `/opt/possistem-pos-control/backups/qr-scans-2026-11-12T05-11-32-992Z`. Sahibkarın “Necə hazırlayım?” tabına faktiki foto-emal nümunəsi (`qr3d-scan-demo.glb`) əlavə olundu. Mövcud QR/3D regressiyası faktiki emal modeli ilə yenidən keçdi: 390/768/1536px, düzgün variant ölçüsü, səbət/AR-dən qayıdış, WebGL ehtiyatı və real USDZ/Quick Look blob keçidi (iPhone imkanı simulyasiya olunub).

Birbaşa tab keçidləri: `?tab=scan`, `?tab=models`, `?tab=guide`. Tab dəyişəndə URL yenilənir; cihaz və sahibkar yoxlama parametrləri saxlanılır. Üç ekran ölçüsündə birbaşa skan tabının açılması sınaqdan keçdi.

Adla menyusuz yaratma və 20 saniyəlik çəkiliş yeniliyi: [qr3d-scan-library-20261112.md](./qr3d-scan-library-20261112.md). Yekun bərpa nöqtəsi `/opt/possistem-pos-control/backups/qr-scan-library-2026-11-12T06-05-48-400Z`.
