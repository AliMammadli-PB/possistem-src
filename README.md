# possistem — Restoran POS + Market POS

Mənbə kodu: iki oflayn işləyən Windows kassa proqramı. Hər ikisi Electron qabığıdır və yerli
SQLite bazasına sahib olan C++20 nüvə (`*-core.exe`) ilə NDJSON üzərindən danışır.

| Qovluq | Məhsul | Quruluş |
|---|---|---|
| [`restoranpos/`](restoranpos) | Restoran POS | Electron + C++ nüvə (`native/`, 112 fayl, testlərlə). Renderer paketlənmiş bundle-dır (`index-DAmHwBc4.js`) və `scripts/apply-restaurant-*.mjs` yamaqları ilə dəyişdirilir. |
| [`marketpos/`](marketpos) | Market POS | Electron + React/Vite (`src/`) + C++ nüvə (`native/`). |

Sayt, lisenziya/idarəetmə API-si və admin/partnyor panelləri possistem.az serverində işləyir və bu
repoya daxil deyil.

## Build (Linux, Windows üçün cross-compile)

Tələblər: Node 22+, npm, CMake ≥ 3.25, Ninja, `g++-mingw-w64-x86-64`; testlər üçün `wine`.
C++ asılılıqları `restoranpos/native/third_party/`-dədir (market nüvəsi simlink ilə eyni qovluğu
istifadə edir), şəbəkə tələb olunmur.

```bash
cd restoranpos
npm ci                        # restoran + ortaq alətlər
(cd ../marketpos && npm ci)   # market UI asılılıqları

npm run build:core            # native/build/restaurant-pos-core.exe
TZ=TRT-3 npm run test:core     # qəbz snapshot-ları UTC+3
npm run market:build:core     # ../marketpos/native/build/market-pos-core.exe
npm run market:test:core

npm run check:versions        # versiyalar uyğundur
node scripts/verify-third-party.mjs   # vendored C++ SHA-256 yoxlaması
npm run typecheck             # restoran (node + web) və market
npm run lint                  # ESLint
npx vitest run                # unit testlər
npm run build:desktop         # restoran: yamaqlar → packaged-renderer/ → out/ (strict)
npm run market:build          # market renderer → ../marketpos/dist
bash scripts/static-analysis-cpp.sh   # clang-tidy (clang, cmake, ninja lazımdır)
```

Sənədlər: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (etibar sərhədləri, təhlükəsizlik modeli,
buraxılış, possistem.az-dakı canlı demonun WebAssembly quruluşu), [SECURITY.md](SECURITY.md) (zəifliyi özəl bildirmək), [CONTRIBUTING.md](CONTRIBUTING.md).

Restoranı Linux-da işə salmaq: `scripts/launch-linux.sh` yamaqları tətbiq edir, `packaged-renderer/`
və `out/`-u yığır, sonra Electron-u açır. Restoran renderer-in TypeScript mənbəyi yoxdur: paketlənmiş bundle yalnız
`scripts/apply-restaurant-*.mjs` yamaqları ilə dəyişdirilir (bax: ARCHITECTURE). Windows quraşdırıcısı: `npm run package:win`
(imzalama sertifikatı tələb olunur).

## Daxil olmayanlar

`node_modules`, build nəticələri və quraşdırıcılar, yerli bazalar, `.env`, açarlar və imza
sertifikatları, server deploy skriptləri.

Lisenziya: [LICENSE](LICENSE) — bütün hüquqlar qorunur.
