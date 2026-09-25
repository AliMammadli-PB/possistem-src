# possistem — Restaurant POS

Offline-first, touch-screen restaurant POS. Electron + React + TypeScript
front end talks NDJSON to a C++20 sidecar (`restaurant-pos-core.exe`) that owns
a local SQLite database.

Currency: **AZN ₼** (integer qəpik end-to-end). Default UI language: **Azerbaijani**
(tr/en also shipped). Tax 18% / service 10%. Publisher: **possistem**.

## Scope

This folder is the Electron till and its C++ core. The licence/control platform
(API, admin, owner and partner panels) runs on the possistem.az server and is not part
of this repository. See [AGENTS.md](AGENTS.md) for the folder map.

## Requirements

- Node 22+, npm 11+
- CMake ≥ 3.25 (CMake 4.x OK)
- Visual Studio 2022 Build Tools (MSVC) + Windows SDK
- Ninja

The core also cross-compiles on Linux with `mingw-w64` (`g++-mingw-w64-x86-64`);
`scripts/build-core.mjs` picks that toolchain up automatically.

## Development start

```bash
npm install
npm run fetch:assets
npm run build:core
npm run dev
```

`npm run dev` builds a Debug core, runs `scripts/assemble-restaurant.mjs --allow-partial`
(applies the `apply-restaurant-*.mjs` patches, stages `packaged-renderer/` and `out/`), then
starts Electron. On Linux use `scripts/launch-linux.sh`.

The renderer has no TypeScript source in this repo: it is the shipped bundle
`packaged-renderer/assets/index-DAmHwBc4.js`, changed only by the ordered, idempotent patch
scripts listed in `scripts/assemble-restaurant.mjs` (`PATCH_ORDER`). A strict run fails on any
patch that no longer applies; CI re-assembles and fails if the result differs from the commit.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run lint` | ESLint (market Electron main + all build/patch scripts) |
| `npm run typecheck` | TS compile check (restaurant node + web, market) |
| `npm run check:versions` | package.json / lock / CMake / Electron versions agree |
| `node scripts/verify-third-party.mjs` | vendored C++ deps match `native/third_party/SHA256SUMS` |
| `bash scripts/static-analysis-cpp.sh` | clang-tidy over both C++ cores (needs clang, cmake, ninja) |
| `npm run build:core` | Release C++ sidecar → `native/build/restaurant-pos-core.exe` |
| `npm run build:desktop` | Strict assembly: all patches → `packaged-renderer/` → `out/` |
| `npm run build` | typecheck + core + desktop |
| `npm run test` | Catch2 + Vitest + visual asset checks |
| `npm run test:core` / `test:unit` | just Catch2 / just Vitest |
| `npm run package:win` | typecheck → core → renderer → NSIS installer |
| `npm run copy:installer` | Copy the built installer to the Desktop |
| `npm run clean` | Kill orphan core processes |

## Windows packaging

```bash
npm run package:win
```

Produces (output dir is versioned — see `electron-builder.yml`
`directories.output`):

```text
release-1.3.15/
├── MilionerPOS-Setup-1.3.15.exe
├── win-unpacked/
│   ├── Milioner POS.exe
│   └── resources/
│       ├── app.asar
│       └── native/win32-x64/restaurant-pos-core.exe
└── latest.yml   (when publish is configured)
```

The installer stays in the release directory — tills receive it through the
update feed. Run `npm run copy:installer` if you want it on the Desktop.

**A version bump is three files**, and they must agree:

1. `package.json` → `version`
2. `native/CMakeLists.txt` → `project(... VERSION x.y.z)`
3. `electron-builder.yml` → `directories.output: release-x.y.z`

### Production layout (after install)

```text
C:\Program Files\Milioner POS\
├── Milioner POS.exe
└── resources\
    ├── app.asar
    └── native\
        ├── win32-x64\restaurant-pos-core.exe
        ├── migrations\
        └── seed\

%APPDATA%\Maison Aurelia POS\  (legacy data path kept for seamless upgrades)
├── data\tenants\<customerId>\pos.db
├── backups\<customerId>\
├── catalog-assets\<customerId>\
├── config\
└── logs\
```

One PC may serve several restaurants over its life (replacement licence, demo,
second venue), so everything a restaurant owns is filed under its customer id.
Databases from older builds are adopted into the right tenant folder on first
run — see [`apps/desktop/src/main/paths.ts`](apps/desktop/src/main/paths.ts).

Database and logs are **never** under Program Files.

### C++ sidecar path

- Dev: `<repo>/native/build/restaurant-pos-core.exe`
- Prod: `<install>/resources/native/win32-x64/restaurant-pos-core.exe`

## Seeded staff (PIN = code)

| Code | PIN | Role | Name |
|------|-----|------|------|
| 9001 | 9001 | administrator | Admin |

Only the administrator is seeded; waiters are created in-app by the admin.
9001 is public, so it cannot open a session: the first sign-in with it asks for a
new PIN (twice) and signs in with that. An account still on 9001 never approves
manager actions.

## Auto updater

Production builds check:

```text
https://possistem.az/pos-updates/
```

Publish a new build:

```bash
# bump the three version files, then:
npm run package:win
POS_SSH_USER=server POS_SSH_PASS='…' npm run publish:updates
node scripts/sync-release-db.mjs      # register the row the app reads
```

Host layout:

```text
https://possistem.az/pos-updates/latest.yml
https://possistem.az/pos-updates/Possistem-Setup-x.y.z.exe
https://possistem.az/pos-source/   # optional source archive
```

`latest.yml` carries `version`, `path`, `sha512` (**base64**) and `size`; the
`releases` row in the control database must name the same version, otherwise
in-app "Yeniləmə yoxla" and the installer disagree. Step-by-step playbooks live
in [`docs/releases/`](docs/releases).

Override the feed with `UPDATE_URL` / `UPDATE_PROVIDER` if needed.

## WhatsApp alert bot

**Parametrlər → WhatsApp bildiriş botu** (manager / administrator only) links the
restaurant's own WhatsApp by QR; X and Z reports then go to the number saved
there. The Baileys session runs on the control API, one per customer, so alerts
survive the till being switched off.

The app authenticates with its activated device (`deviceId` + fingerprint), so a
control server **must be running the current build** for in-app pairing —
otherwise the app falls back to the tenant-token routes used by `/pos/app`:

```bash
POS_SSH_PASS='…' node control/scripts/update-control.mjs
```

See [docs/superpowers/specs/2026-08-06-pos-whatsapp-pairing.md](docs/superpowers/specs/2026-08-06-pos-whatsapp-pairing.md).

## Code signing

If present, electron-builder uses:

```text
CSC_LINK / CSC_KEY_PASSWORD
WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD
```

Without a certificate the installer is **unsigned**. Windows SmartScreen may
warn on first launch — expected until a real EV/OV certificate is attached.

## Clean production test

1. `npm run package:win`
2. Run `release-<version>\MilionerPOS-Setup-<version>.exe`
3. Launch from Start Menu / Desktop shortcut
4. Login `9001`, then choose a new PIN when asked
5. Confirm `%APPDATA%\Maison Aurelia POS\data\tenants\…\pos.db` exists
6. Confirm no black console window for the core
7. Quit — Task Manager should show no leftover `restaurant-pos-core.exe`

## Architecture notes

- Money is `int64` minor units everywhere. Formatting only in the renderer.
- NDJSON framing; core stdout is protocol-only; logs go to stderr + rotating files.
- Session held in Electron main (mirrored in C++ for authz).
- Idempotency keys minted in the renderer at intent time.
- `shared/contracts/protocol.json` and `database/migrations/*.sql` are the
  sources of truth; the TypeScript and C++ counterparts are generated at build
  time and must not be hand-edited.
- Every mutation writes to the append-only `audit_logs` table; the local
  history page is **Parametrlər → Audit** (`audit.view` permission).

## Known limitations

- Installer is unsigned without `CSC_LINK`.
- Auto-update requires publish credentials (see above).
- Card terminal and physical printer are adapter-mocked.

## License

UNLICENSED — proprietary.
