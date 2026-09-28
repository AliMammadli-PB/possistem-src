# Arxitektura / Architecture

İki məhsul eyni quruluşu paylaşır: oflayn işləyən Windows kassası, Electron qabığı və yerli SQLite
bazasına tək sahib olan C++20 nüvə prosesi.

```
┌──────────── Electron ────────────┐
│ renderer (UI, etibarsız)          │  contextIsolation, sandbox, nodeIntegration=false
│        │ window.pos / window.market (preload, dar API)
│ preload│ ipcRenderer.invoke
│        ▼                          │
│ main (etibarlı sərhəd)            │  sessiya, rol, menecer PIN-i, lisenziya, avadanlıq,
│        │ NDJSON stdio              │  LAN sync, uzaq əmrlər, safeStorage
└────────┼──────────────────────────┘
         ▼
  C++ nüvə (*-core.exe)  ── SQLite (WAL) ── yeganə yazıçı; icazələri ikinci dəfə yoxlayır
```

| | Restoran POS (`restoranpos/`) | Market POS (`marketpos/`) | Geyim POS (`geyimpos/`) | Aptek POS (`aptekpos/`) | Topdan POS (`topdanpos/`) |
|---|---|---|---|---|---|
| Main | `index.js` (paketlənmiş, yamaqlanmış) → `out/main/index.js` | `electron/main.cjs` + modullar | Market ilə eyni (fork) | Geyim ilə eyni (fork) | Aptek ilə eyni (fork) |
| Preload | `out/preload/index.js` → `window.pos` (`pos:*` kanalları) | `electron/preload.cjs` → `window.market` | eyni kanallar (`market:*`) | eyni kanallar (`market:*`) | eyni kanallar (`market:*`) |
| Renderer | `packaged-renderer/` (paket bundle + yamaqlar) | `src/` (React + Vite) | `src/` (React + Vite, geyim ekranları) | `src/` (React + Vite, dərman siyahısı, resept, seriya) | `src/` (React + Vite, qaimə: alıcı, sətirlər, nisyə; müştərilər və borclar) |
| Nüvə | `native/` → `restaurant-pos-core.exe` | `native/` → `market-pos-core.exe` | `native/` → `geyim-pos-core.exe` (+ `011_apparel.sql`) | `native/` → `aptek-pos-core.exe` (+ `011_pharmacy.sql`, FEFO) | `native/` → `topdan-pos-core.exe` (+ `013_wholesale.sql`: 3 qiymət səviyyəsi alıcıya görə nüvədə) |
| Lisenziya | `restaurant` | `market` | açar `geyim`; lisenziya market ailəsindəndir (`features.vertical = 'geyim'`), yeniləmə kanalı `possistem.az/geyimpos/updates/` | açar `aptek`; `features.vertical = 'aptek'`, kanal `possistem.az/aptekpos/updates/` | açar `topdan`; `features.vertical = 'topdan'`, kanal `possistem.az/topdanpos/updates/` |

## Etibar sərhədləri

1. **Renderer → main.** Renderer-in göndərdiyi heç nəyə etibar edilmir. Market-də hər IPC kanalı
   `marketpos/shared/contracts/ipc-contract.json`-da auth səviyyəsi ilə qeyd olunub (`none`,
   `session`, `roles:…`, `core:…`); `restoranpos/tests/unit/market-ipc-contract.test.ts` bunu
   `main.cjs` ilə tutuşdurur. İstifadəçi kimliyi renderer-dən deyil, main-dəki sessiyadan gəlir
   (`staff-auth.cjs`: `createSessionStore`, 12 saat boş / 24 saat mütləq müddət).
2. **Main → nüvə.** Main hər çağırışa sessiyadakı `actorId`, rol və (lazım olsa) yoxlanmış menecer
   təsdiqini qoyur (`core-payload.cjs: authorizeCorePayload`). Nüvə icazəni yenidən yoxlayır;
   `success:false` gələrsə main avadanlığa toxunmur (məs. pul qutusu:
   `drawer-auth.cjs: openDrawerAuthorized`). Supervisor mesaj ölçüsünü (8 MiB) və gözləyən
   sorğuları (200) məhdudlaşdırır, protokol pozuntusunda nüvəni öldürür.
3. **Kassa → server.** Lisenziya və uzaq əmrlər serverdə Ed25519 ilə imzalanır. Kassa yalnız
   quraşdırmada tanınan açar ID-lərini qəbul edir (market: `TRUSTED_LICENSE_KEY_IDS`,
   restoran: `_PS_TRUSTED_LICENSE_KEYS`) və ilk aktivləşdirmədə açarı pinləyir. Əmr yalnız bu
   müştəri və bu cihaz üçün imzalanıbsa, vaxtı keçməyibsə və əvvəl icra olunmayıbsa işləyir;
   imzalanmış nüsxə icra olunur, xarici sahələr yox (`command-auth.cjs`,
   `apply-restaurant-command-signature.mjs`).
4. **Kassa ↔ kassa (LAN).** Market kassaları multicast ilə bir-birini tapır; mübadilə
   `/v2/exchange` üzərindən X25519 + HKDF + AES-256-GCM ilə şifrələnir (`lan-crypto.cjs`). Peer
   yalnız serverin imzaladığı, bu müştəri və onun cihaz açarı üçün verilmiş aktiv lisenziya
   sübutunu göstərəndə qəbul olunur; şifrələmə açarı həmin cihaz açarı ilə imzalanmış beacon-un
   içindədir, dəyişdirilə və ya silinə bilməz. Beacon 15 s-dən köhnədirsə və ya əvvəlkindən yeni
   deyilsə atılır.

## Təhlükəsizlik modeli

| Təhdid | Qarşı tədbir |
|---|---|
| Kassir renderer-də JS icra edib menecer əməliyyatı edir | Rol və menecer PIN-i main-də + nüvədə; PIN yoxlayan ayrıca IPC yoxdur (oracle yoxdur) |
| PIN-i təxmin etmək | Giriş və menecer təsdiqi: 5 səhvdən sonra kilid, hər dəfə ikiqat artır (market `createAttemptLimiter`, restoran `Context::requireManagerApproval` + kassa kilidi) |
| Standart PIN-lərlə giriş | İlk girişdə PIN dəyişmə məcburidir (restoran nüvəsi `E_PIN_CHANGE_REQUIRED` qaytarır, sessiya yalnız yeni PIN ilə açılır); standart PIN-li hesab təsdiq verə bilmir |
| Saxta approverId / actorId=system | Main payload-u özü qurur; renderer-dən gələn kimlik sahələri atılır |
| Lisenziya faylını saxtalaşdırmaq | Aktivləşmə, yeniləmə və oflayn idxalda imza yoxlanılır; e2e bypass yalnız paketlənməmiş rejimdə |
| Diskdən sirr oğurlamaq | Windows paketində `safeStorage` məcburidir; şifrələmə yoxdursa yazmır; pozulmuş fayl `.corrupt-*` olur |
| Saxta uzaq əmr / təkrar | İmza + cihaz + müştəri + TTL (15 dəq) + təkrar siyahısı |
| LAN-da dinləmə / saxta peer | Şifrəli zərf; peer kimliyi server imzalı lisenziya sübutu ilə |
| Saxta ödəniş/fiskal cavabı istehsalda | Mock terminal/fiskal yalnız paketlənməmiş build-də (`hardware-policy.cjs`) |
| Təchizat zənciri | Vendored C++ `SHA256SUMS` ilə yoxlanılır; `fetch-deps.mjs` hash uyğun gəlmədikdə dayanır; npm lock + audit; ASAR bütövlük yoxlaması |

Açıq məhdudiyyətlər: fiziki administrator girişi olan kompüterdə yerli baza və proses yaddaşı
qorunmur; lisenziya açarı ilk aktivləşmədə pinlənir (TOFU) — buraxılışa daxil edilmiş etibarlı açar
ID siyahısı bu ilk addımı məhdudlaşdırır.

## İlk işə salma

Paket standart işçi hesabları ilə gəlir (yalnız ilk giriş üçün). Hər biri ilk girişdə yeni PIN
təyin etməlidir; bu edilməyənə qədər hesab heç bir təsdiq verə bilməz. Brauzer rejimində demo
giriş yalnız `vite dev`-də var.

## Build və buraxılış

1. `npm run check:versions`, `node scripts/verify-third-party.mjs`.
2. Nüvələr: `npm run build:core`, `npm run market:build:core` (MinGW, Windows üçün).
3. Restoran: `npm run build:desktop` = `scripts/assemble-restaurant.mjs` — 64 yamağı sabit
   sırada tətbiq edir, `packaged-renderer/` və `out/`-u yığır, nəticəni yoxlayır. Strict rejim hər
   hansı yamaq tətbiq olunmazsa dayanır. Nəticə deterministikdir (build möhürü = versiya + yamaqların
   hash-i), CI yenidən yığıb commit ilə fərqi yoxlayır.
4. Market: `npm run market:build`.
5. Paket: `npm run package:win` / `npm run market:package:win` (electron-builder, Electron 43.7.5,
   ASAR bütövlük yoxlaması). Kod imzalama sertifikatı yalnız buraxılış kompüterindədir.
6. CI SBOM (CycloneDX) yaradır; buraxılışla birlikdə saxlanılır.

**Açar rotasiyası.** Yeni server açarı yaradıldıqda əvvəlcə onun ID-si kassalardakı etibarlı
siyahıya əlavə olunub buraxılış edilir (köhnə ilə yanaşı), kassalar yeniləndikdən sonra server yeni
açarla imzalamağa keçir, sonrakı buraxılışda köhnə ID çıxarılır. Test/dev üçün:
`MARKET_POS_EXPECTED_KEY_ID`, `POS_TRUSTED_LICENSE_KEYS` (`keyId:hex,...`).

## Restoran renderer-in mənbəyi

Restoran UI-nin TypeScript mənbəyi bu repoda **yoxdur** — məhsul paketlənmiş bundle
(`index-DAmHwBc4.js`) üzərində davam etdirilir. Bütün UI dəyişiklikləri oxunaqlı, nəzərdən keçirilə
bilən `scripts/apply-restaurant-*.mjs` fayllarındadır; hər biri dəqiq bir uyğunluq tələb edir və
marker ilə idempotentdir. `tests/disabled-no-renderer-source/` köhnə mənbəyə bağlı testləri saxlayır.

## Canlı demo (possistem.az)

Saytdakı demo proqramın özüdür, surət deyil: real renderer və real C++ nüvə WebAssembly-yə
kompilyasiya olunub brauzerdə işləyir. Electron main-in yerinə kiçik bir körpü dayanır.

| | Restoran | Market |
|---|---|---|
| Nüvə (WASM) | `native/wasm/demo_core.cpp` → `pos_core_wasm` | `native/wasm/demo_core.cpp` → `market_core_wasm` |
| Körpü | `demo-web/bridge.template.js` (preload olduğu kimi daxil edilir) | `demo-web/bridge.template.js` (preload + `core-payload.cjs`) |
| Demo məlumatı | `demo-web/seed.js` — hər açılışda real API ilə | renderer-in öz ilk açılış idxalı |
| Paket | `node demo-web/build.mjs <out> <wasm-build>` | eyni |

Brauzerdə thread yoxdur, ona görə nüvələr sinxron rejimdə işləyir (`StdioServer::useInlineMode` +
`processFrame`, market: `processLine`). Baza yaddaşdadır və hər ziyarətdə sıfırdan qurulur. Körpü yalnız
main-in öz işini görür (lisenziya/tenant statusu, işçi sessiyası, `authorizeCorePayload`); qalan hər şey
nüvənin eyni qaydaları ilə cavablanır. Printer, fayl saxlama, yeniləmə kimi masaüstü funksiyaları
"Demo versiyada bu funksiya işləmir" qaytarır.

```bash
source ~/.cache/emsdk/emsdk_env.sh
emcmake cmake -S restoranpos/native -B restoranpos/native/build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build restoranpos/native/build-wasm --target pos_core_wasm
emcmake cmake -S marketpos/native -B marketpos/native/build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build marketpos/native/build-wasm --target market_core_wasm
(cd restoranpos && npm run build:desktop && npm run market:build)
node restoranpos/demo-web/build.mjs <sayt>/public/pos-demo-app/restoran
node marketpos/demo-web/build.mjs <sayt>/public/pos-demo-app/market
```

Demo PIN-ləri: restoran Admin 1234, Elvin 2222, Nigar 3333; market Müdir 1234, Kassir 2222,
Anbar 3333, Baş kassir 4444.

## Server

possistem.az (lisenziya API, admin/partnyor panelləri, sayt) ayrıca deploy olunur və bu repoya daxil
deyil. Kassa ilə əlaqəsi: aktivləşmə, heartbeat, owner-sync, imzalı lisenziya və əmrlər.
