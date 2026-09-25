# Windows till — sistem tələbləri (possistem)

Elektron kassa: **Electron + Chromium UI** + **C++20 SQLite core** (`restaurant-pos-core`). Offline işləyir; şəbəkə yalnız lisenziya, sync, yeniləmə və WhatsApp üçündür.

**NVIDIA ayrıca video kartı lazım deyil.** Intel və ya AMD inteqrasiya olunmuş qrafika kifayətdir.

## Minimum (kiçik restoran / 1 kassa)

| Komponent | Tələb |
|---|---|
| **OS** | Windows 10 64-bit (22H2+) və ya Windows 11 64-bit |
| **CPU** | 2 nüvə, ~2.0 GHz (Intel Celeron / Pentium Gold, AMD Athlon) |
| **RAM** | **4 GB** (OS + till; 4 GB-da digər ağır proqram açıq olmamalıdır) |
| **Disk** | **SSD** tövsiyə; ən azı **2 GB** boş yer (quraşdırma ~200–400 MB + DB + loglar) |
| **Ekran** | 1366×768 və ya daha yüksək; toxunma ekranı dəstəklənir |
| **GPU** | **NVIDIA məcburi deyil.** Intel UHD / AMD Radeon inteqrasiya olunmuş qrafika kifayətdir |
| **USB** | ESC/POS kassə printeri üçün 1× USB (və ya şəbəkə printer) |
| **Şəbəkə** | Offline işləyir; aktivasiya / yeniləmə / owner sync üçün internet |

## Tövsiyə olunan (gündəlik istehsal till)

| Komponent | Tələb |
|---|---|
| **OS** | Windows 11 64-bit |
| **CPU** | 4 nüvə (Intel Core i3 / AMD Ryzen 3 və ya daha güclü) |
| **RAM** | **8 GB** |
| **Disk** | **SSD 128 GB+** (DB, backup, loglar üçün rahatdır) |
| **Ekran** | 1920×1080, 15–22″ toxunma və ya monitor |
| **GPU** | İnteqrasiya olunmuş (UHD / Radeon Graphics) — kifayətdir |
| **NVIDIA** | **Lazım deyil.** Oyun/CUDA kartı performans vermir; overlay/driver konfliktləri bəzən Chromium-u çətinləşdirə bilər |

## Güclü / multi-rol PC (kassa + ofis eyni maşında)

| Komponent | Tələb |
|---|---|
| **CPU** | Core i5 / Ryzen 5 |
| **RAM** | **16 GB** |
| **Disk** | SSD 256 GB+ |
| **GPU** | Yenə də inteqrasiya olunmuş kifayətdir; ayrıca NVIDIA yalnız digər proqramlar üçündür |

## Nə üçün NVIDIA lazım deyil?

- UI Chromium compositing + 2D kassa interfeysidir (masa planı, menyu, çek).
- Ağır 3D / CUDA / ML işləmir.
- GPU olmadan da açılır (proqram software rasterizerə düşə bilər).
- Əgər NVIDIA varsa: **Game Mode** və GeForce Experience **overlay**-i söndürmək daha sabitdir.

## Realistik yaddaş istifadəsi (təxmini)

| Proses | Tipik RAM |
|---|---|
| Electron UI (possistem) | ~250–500 MB |
| `restaurant-pos-core` | ~50–150 MB |
| Windows + digər | dəyişkən |
| **Cəmi rahat iş** | **4 GB minimum, 8 GB rahat** |

## Digər periferiya

- ESC/POS USB və ya şəbəkə printer (58/80 mm)
- İstəyə görə müştəri ekranı / ikinci monitor (OS display)
- Stabil UPS (elektrik kəsiləndə DB korlanmasın)

## Quraşdırma qeydi

- Installer: `Possistem-Setup-*.exe` (NSIS), avtomatik yeniləmə **yalnız Windows** till üçündür.
- Data yolu: `%APPDATA%\Maison Aurelia POS\` (tarixi ad; silməyin).
- Antivirus: till qovluğunu və `%APPDATA%\Maison Aurelia POS\` istisna etmək tövsiyə olunur.

Müştəri panelində eyni cədvəl: **Yükləmələr** (`/pos/app/downloads`) və quraşdırma onboarding addımı.
