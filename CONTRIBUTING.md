# Töhfə / Contributing

Bu repo mənbə kodunu göstərmək üçün açıqdır; lisenziya bütün hüquqları saxlayır ([LICENSE](LICENSE)).
Xarici pull request-lər yalnız əvvəlcədən razılaşdırılmış hallarda qəbul olunur.

## Dəyişiklikdən əvvəl

```bash
cd restoranpos
npm ci && (cd ../marketpos && npm ci)
npm run check:versions
node scripts/verify-third-party.mjs
npm run typecheck
npm run lint
npx vitest run
npm run build:desktop        # strict assembly; sonra `git diff --exit-code` təmiz olmalıdır
npm run market:build
```

C++ nüvəsinə toxunursunuzsa əlavə olaraq:

```bash
npm run build:core && TZ=TRT-3 npm run test:core     # qəbz snapshot-ları UTC+3-dədir
npm run market:build:core && npm run market:test:core
bash scripts/static-analysis-cpp.sh
```

CI (`.github/workflows/ci.yml`) eyni yoxlamaları, gitleaks və `npm audit --audit-level=high`-u işlədir.

## Qaydalar

- **Restoran renderer**: `packaged-renderer/assets/index-*.js`-i əllə redaktə etməyin. Yeni
  `scripts/apply-restaurant-<ad>.mjs` yazın (idempotent, marker şərhi ilə, `replaceOnce` —
  tam 1 uyğunluq), onu `scripts/assemble-restaurant.mjs`-dəki `PATCH_ORDER`-ə əlavə edin və
  `npm run build:desktop` ilə yığın. Nəticə faylları da commit olunur.
- **Yeni IPC kanalı** (market): `marketpos/shared/contracts/ipc-contract.json`-a `auth` səviyyəsi
  ilə əlavə edin; `auth: "none"` üçün `why` yazın. Test kontraktı main.cjs ilə tutuşdurur.
- **Üçüncü tərəf C++**: `native/third_party`-ə əl ilə fayl qoymayın; `scripts/fetch-deps.mjs`-də
  URL + SHA-256 əlavə edin, sonra `SHA256SUMS`-u yeniləyin.
- **Versiya**: `package.json`, lock və `native/CMakeLists.txt` eyni versiyada olmalıdır
  (`check:versions`).
- Sirr, `.env`, açar, sertifikat, verilənlər bazası commit etməyin. Server ünvanları və parollar
  yalnız mühit dəyişənlərindən oxunur (`POS_SSH_*`).
- Commit mesajı: nə dəyişdi və niyə, qısa.
