# Restoran POS 1.10.28 — 11.11.2026

Yayımlanıb: `https://possistem.az/pos-updates/Possistem-Setup-1.10.28.exe`. Stabil yeniləmə kanalı `https://possistem.az/pos-updates/latest.yml` versiya 1.10.28 göstərir; saytın `/download/pos/` səhifəsi eyni linki götürür.

- QR sifariş və 3D: PNG ikon, sahibkarın saytdakı panelinə hesab/cihaz üzrə keçid.
- İş masasının ağ qısayol ikonu ayrıca fayldır. Proqramın executable/taskbar ikonu mavidir. Windows NSIS mövcud desktop linkini ağ ikonla yeniləyir, Start menyusu/proqram ikonu dəyişmir. Linux NEWEST və tətbiq siyahısı da ayrı ağ/mavi ikonlardan istifadə edir.
- Package, lock, CMake və Windows buildVersion 1.10.28-dir. Electron 43.8.3 saxlanılıb.
- Paketdəki native nüvənin SHA-256 izi yeni yığılan exe ilə eynidir. ASAR daxilində versiya, QR IPC, PNG, taskbar ikonu və ayrıca desktop resursu yoxlanılıb.

## Yoxlamalar

- Typecheck keçib; desktop assembly 141/141 patch.
- Restorana aid 22 unit faylı: 146 test keçib.
- QR runtime: 6 test keçib.
- Windows native nüvə Wine altında: 424 test, 3562 assertion keçib. Bu nəticə fiziki bank terminalı/printer/AR cihaz sınağı sayılmır.
- NSIS `7z t`: bütövlük yoxlaması keçib.
- İmzalı updater manifesti yayımlanıb; server installer SHA-512-ni tutuşdurduqdan sonra feed atomik dəyişib. Əvvəlki feed `latest.yml.bak-before-1.10.28` altında saxlanılıb, əvvəlki installer silinməyib.
- Canlı domen: 1.10.28 feed, installer Range/206 və `MZ` başlığı, yükləmə səhifəsinin yeni linki brauzerdən yoxlanılıb.

Tam çoxməhsullu unit komandasının ilkin nəticəsi 23 uğursuz test və ayrıca test yükləmə xətaları idi. Restoran LAN testində köhnə kod bloku sərhədi və modul həll etmə yolu, filial testində isə mənbə əvəzinə hazır tətbiqin dependency closure-u düzəldilib; sonra Restoran dəsti tam keçib. Qalan Market POS test uyğunsuzluqları bu Restoran buraxılışında həll edilmiş kimi göstərilmir. Market POS yayımlanmayıb.

Windows Authenticode sertifikatı mövcud deyil; quraşdırıcı əvvəlki kanaldakı kimi Windows sertifikatı olmadan yığılıb. Updater-in Ed25519 manifest imzası ayrıca mexanizmdir və Authenticode kimi təqdim edilmir. Qorunan updater private key-i repoya/serverə göndərilməyib.

## Sayt düzəlişi: GLB specular materialı

Sahibkarın `/home/panda/Downloads/pizza.glb` faylı `KHR_materials_specular` səbəbi ilə rədd edilirdi. Bu standart material əlavəsinə icazə əlavə olunub; xarici URI, animasiya/sıxılma və digər əvvəlki məhdudiyyətlər qorunub. GLB yoxlayıcısında etibarlı specular və yanlış parametr üçün ayrıca test var: ümumilikdə 4 GLB testi keçir.

Real fayl: 9 391 304 bayt, 49 288 üçbucaq, 4 daxili tekstura (1024/2048 px). 28 sm enə uyğunlaşdırıldıqdan sonra 28 × 4,21 × 28 sm olur. Yerli Chromium-da həqiqi render, cari serverin məhdud işçisində API istifadəçisi ilə faktiki emal uğurla yoxlanılıb. Canlı müştəri menyusuna test modeli bağlanmayıb. Müvəqqəti yoxlama faylı serverdən silinib.

QR sahibkar panelinin tünd mövzusunda ağ kart/solğun mətn ziddiyyəti ayrıca düzəldilib. 1536 px tünd mövzuda səth və mətnin hesablanmış rəngləri, 390/768/1536 px-də həqiqi GLB renderi yoxlanılıb. Bu düzəliş server/paneldədir və növbəti model üçün ayrıca POS buraxılışı tələb etmir.

Specular/panel geri dönüş nüsxəsi: `/opt/possistem-pos-control/backups/qr3d-specular-2026-11-11T15-34-03-574Z`; əvvəlki panel qovluğu həmin `release.json` faylında qeyd edilib. GLB emalı hər sorğuda yeni worker açdığı üçün API-ni dayandırmadan yeni yoxlama tətbiq olunub.

## iPhone / Safari kamera axını

AR özəlliyi custom elementə boş sətir əvəzinə həqiqi `true` boolean ilə verilir. React 19-da boş sətirin custom elementin boolean property-sinə yazılması AR-ni söndürə bilirdi. Həm React 18 sahibkar panelində, həm React 19 qonaq menyusunda faktiki `modelViewer.ar === true` yoxlanılır.

iPhone/iPad-də GLB yükləndikdən sonra `prepareUSDZ()` həqiqi USDZ yaradır. Hazırlanma statusu göstərilir, nəticə hazır olmadan AR düyməsi açılmır. Düymənin istifadəçi klikində `rel="ar"`, şəkil uşağı və `.usdz` endirmə adı olan keçid sinxron açılır. Blob baxış bağlananadək saxlanılır, sonra buraxılır. Ölçünün dəyişməməsi üçün `allowsContentScaling=0` verilir. Xəta halında adi 3D qalır və AR-ni yenidən hazırlamaq mümkündür. Kamera görüntüsü serverə ötürülmür.

Real pizza faylından 23 661 516 bayt USDZ ZIP yaranması və faktiki Quick Look blob keçidi yoxlanılıb. Brauzer testində yalnız iPhone/Quick Look imkan aşkarlanması imitasiya edilib; GLB renderi və USDZ çevrilməsi həqiqidir. Fiziki kameranın masa səthini izləməsi hələ cihazda yoxlanmalıdır. Sahibkar iPhone/Safari istifadə etdiyini bildirib; ona native Apple pəncərəsində **AR** seçmək göstərilib.

Sayt və sahibkar paneli üçün bu dəyişiklik ayrıca yayımlanır, POS installer-i yenidən yığılmır. Rəsmi əsas: https://developer.apple.com/quick-look-gallery/ və https://modelviewer.dev/examples/augmentedreality/ .
