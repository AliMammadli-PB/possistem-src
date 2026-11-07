# Restaurant POS assistant

Release 1.10.21 connects the website and desktop to the same server-owned online assistant. The desktop bundles **online.mjs**, **local-tools.mjs**, **setup-tools.mjs** and clipboard/UI code. It does not bundle language interpretation, conversation state machines or knowledge-base answers.

Canonical server workflows live in `../../platform/apps/api/src/lib/assistant/runtime/`. The old local conversation/stock/setup module names re-export those owners for acceptance-test compatibility. Main process transport in `online-client.cjs` uses the existing authenticated tenant/device/staff scope; no credential is exposed to the renderer.

`../scripts/apply-restaurant-support.mjs` is the persistent owner patch: it installs the registered IPC/preload bridge, copies the main-process connector and bundles only the thin renderer client. Do not hand-edit the generated renderer or out/main to change assistant answers. Publish training under Admin → Dəstək idarəetməsi → Köməkçi · Təlimlər; deploy API code for existing workflow changes. New native features still need an application update.

Checks: `node --test support/*.test.mjs`; `node scripts/qa-central-assistant.cjs`; `node scripts/qa-assistant-admin.cjs`; `REQUIRE_PROTECTED_ASSISTANT=1 node scripts/qa-assistant-setup-native.mjs`. The latter uses an isolated SQLite database and the actual Windows core. The frontend acceptance checks use explicit test fixtures. Nothing is queued for later execution while offline.
