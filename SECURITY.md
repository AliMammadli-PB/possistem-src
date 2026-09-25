# Təhlükəsizlik / Security

## Zəifliyi bildirmək

Zəiflikləri **açıq issue kimi yazmayın**. GitHub-ın özəl kanalından istifadə edin:
repo → **Security** → **Report a vulnerability** (private security advisory).

Please do not open public issues for vulnerabilities. Use GitHub private vulnerability
reporting: **Security → Report a vulnerability**.

Bildirişdə olsun: təsirlənən məhsul (Restoran POS / Market POS) və versiya, addımlar, gözlənilən və
faktiki nəticə, mümkünsə sübut (PoC). 3 iş günü ərzində cavab veririk; düzəliş buraxılana qədər
detalları açıqlamayın.

## Əhatə

| Daxildir | Daxil deyil |
|---|---|
| Electron main/preload (IPC, lisenziya, sessiya, avadanlıq) | possistem.az serveri (ayrıca bildirin, eyni kanal) |
| C++ nüvə (SQLite, NDJSON protokolu) | Üçüncü tərəf kitabxanalardakı məlum CVE-lər (upstream-ə) |
| LAN sinxronizasiyası, uzaq əmrlər | Fiziki giriş olan kompüterdə administrator hüquqları |

## Dəstəklənən versiyalar

Yalnız ən son buraxılış (Restoran POS 1.7.x, Market POS 1.4.x) təhlükəsizlik düzəlişləri alır.

## Təhlükəsizlik modeli qısaca

Ətraflı: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#təhlükəsizlik-modeli).

- Lisenziya və uzaq əmrlər Ed25519 ilə imzalanır; kassa yalnız etibarlı açar ID-lərini qəbul edir.
- İlk girişdə standart PIN dəyişdirilməlidir; standart PIN-li hesab təsdiq verə bilməz.
- Menecer PIN-i, pul qutusu, geri qaytarma kimi əməliyyatlar main prosesdə və nüvədə yoxlanılır,
  renderer-ə etibar edilmir.
- Windows-da həssas vəziyyət yalnız `safeStorage` (DPAPI) ilə şifrəli saxlanılır.
- LAN mübadiləsi X25519 + AES-256-GCM ilə şifrələnir; peer yalnız server imzalı lisenziya sübutu ilə qəbul olunur.
