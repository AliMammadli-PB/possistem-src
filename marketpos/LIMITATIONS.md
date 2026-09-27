# Etmədiklərim və məhdudiyyətlər + axtarış nəticəsi

Son yenilənmə: 2026-09-24

## Axtarış (PC + GitHub + VPS + Claude history)

| Mənbə | Nəticə |
|-------|--------|
| Bütün disk (`find` + sudo) | `SyncHandlers*` / `sync.bootstrap` **C++ faylı yox** (silinmiş ağac) |
| GitHub `AliMammadli-PB/possistem` | Yalnız **1.3.0** snapshot (12 sen); sync handler **yox**, heç vaxt push olunmayıb |
| Digər köhnə GitHub repoları | Eyni — köhnə market-pos, sync yox |
| VPS (`pos` /opt) | Yalnız control API + market web dist; C++ mənbə **yox** |
| Trash / Timeshift | Bərpa edilə bilən market-pos ağacı **yox** |
| **Claude Code file-history** | **TAPILDI** — 1.4.x sync C++ + electron (17–18 sen sessiyaları) |

## Bərpa olunan yer

`marketpos/recovered-source-1.4.x/` — ətraflı siyahı: `RECOVERY_MANIFEST.md`

Əsas tapıntılar:
- `native/core/src/Application.cpp` — `sync.configure|prune|getServerVector|setServerVector|setPeerVector|status|export|apply|ack|bootstrap`
- `native/core/src/RetailOps.cpp` + `RetailOps.hpp` — sync helper-lər
- `electron/sync-service.cjs` — LAN multicast + bulud dövrü
- `database/migrations/006_sync_resilience.sql` (+ 007, 008)
- `scripts/test-market-sync-resilience.mjs`

Installer-dən əvvəl bərpa: `marketpos/recovered-1.4.4/` (binar + electron, C++ **yox**).

## Hələ açıq məhdudiyyətlər

Bağlananlar (24 sentyabr, 1.4.7): canlı ağaca graft, kompüterlər arası ortaq baza
(sync-service + test S1), itmiş 004/005 migrasiyaları.

1. **1.4 renderer səhifələri** (`auth/AuthGate`, `pages/DashboardPage` və s.) bərpa
   olunmayıb — hazırkı `App.tsx` işlədilir; 1.4-ün dəstək/kömək ekranları yoxdur.
2. **Portal «Yeni məhsul» → market kassası** — canlı serverin market heartbeat-i
   portal anbar əmrlərini ötürmür (`control-plane/apply-multi-pc.mjs` hələ deploy
   edilməyib).
3. **Canlı 2-PC LAN testi** — iki nüvə arasında sinxron test edilib; iki real
   Windows PC-də multicast kəşfi sınanmayıb.

## Qısa nəticə

Əvvəl «C++ sync itib» deyilirdi — **mənbə GitHub/diskdə yox idi**, amma **Claude file-history-də qalıb və indi `recovered-source-1.4.x`-ə çıxarılıb**.
