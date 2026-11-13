# Restoran POS 1.10.29 — 13 noyabr 2026

Restoranın öz Epoint hesabına yönələn QR masa ödənişləri: hamısı, bərabər pay, seçilən yeməklər. Native rezerv, imzalı cihaz əmrləri, dəqiq məbləğ təsdiqi və idempotent bank nəticəsi daxildir.

Sayt, API, admin və avtomatik yeniləmə lenti yayımlandı. `0061_restaurant_table_payments.sql` tətbiq edildi. Canlı QR tutulmaları systemd-nin əlavə `table-payments.env` faylında **false** saxlanılıb. Restoran merchant açarları/callback və real bank/fiskal qəbul yoxlamasından sonra ayrıca aktivləşdirilir. SUNMI QR başlatması həmin uyğunluq yoxlaması tamamlanana qədər bloklanır.

- Installer: `https://possistem.az/pos-updates/Possistem-Setup-1.10.29.exe`
- Ölçü: 361140797 bayt
- SHA-256: `352d7064a032902bb41e47e22d5945a6b773211cd7c596ff5436292fd8f8f244`
- ZIP: `https://possistem.az/pos-updates/Possistem-Setup-1.10.29-verified.zip`
- Mənbə: GitHub `possistem-src` main; tətbiq mənbəsi 619f439, yükləmə metadatası 69f6cc1.

NSIS CRC yoxlaması keçdi. İctimai ünvandan bütöv EXE endirilərək SHA-256/SHA-512 müqayisə edildi. Yeni və əvvəlki manifest eyni qorunan Ed25519 açarı ilə doğrulandı. Windows Authenticode sertifikatı yoxdur; əvvəlki kanal kimi yeniləmələr Possistem manifest imzası ilə qorunur.

Windows Release binarında QR üzrə 3 sınaq/45 assertion Wine altında keçdi. API/domen 20 sınaq və körpü 5 sınaq əvvəlki tətbiq yoxlamalarında keçib. Fiziki bank terminalı/SUNMI və real kartla sınaq keçirilmiş sayılmır.

Server bərpa nüsxələri:
- `/opt/possistem-pos-control/backups/table-payments-1.10.29-2026-11-13T11-00-15-805Z` — DB dump, əvvəlki API/admin, feature konfiqurasiyası.
- `/opt/possistem-pos-control/backups/website-1.10.29-2026-11-13T11-09-40-632Z` — əvvəlki Next konfiqurasiyası və yığım ünvanı.
- `/var/www/pos-updates/latest.yml.bak-before-1.10.29` — əvvəlki avtomatik yeniləmə lenti.
