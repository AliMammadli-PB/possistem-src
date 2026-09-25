#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELECTRON="$ROOT/node_modules/.bin/electron"
CORE_WRAPPER="$ROOT/native/build/restaurant-pos-core"
CORE_EXE="$ROOT/native/build/restaurant-pos-core.exe"
STAGE="$ROOT/packaged-renderer"

export POS_CORE_PATH="$CORE_WRAPPER"
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-x11}"
export WINEPREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/possistem/wine"
export WINEDEBUG=-all
mkdir -p "$WINEPREFIX"

if [[ ! -x "$ELECTRON" ]]; then
  echo "electron yok: $ELECTRON" >&2
  exit 2
fi
if [[ ! -f "$CORE_EXE" ]]; then
  echo "restaurant-pos-core.exe yok: $CORE_EXE" >&2
  exit 2
fi
chmod +x "$CORE_WRAPPER" 2>/dev/null || true

cd "$ROOT"
if [[ "${POS_REBUILD_ON_LAUNCH:-1}" == "1" ]]; then
  # Apply patches: one broken needle must not block opening the till.
  run_apply() {
    local script="$1"
    if ! node "scripts/$script"; then
      echo "[launch] WARN: scripts/$script failed — continuing" >&2
    fi
  }
  run_apply apply-restaurant-ux.mjs
  run_apply apply-restaurant-brand.mjs
  run_apply apply-restaurant-shell.mjs
  run_apply apply-restaurant-layout.mjs
  run_apply apply-restaurant-login.mjs
  run_apply apply-restaurant-pin.mjs
  run_apply apply-restaurant-ops.mjs
  run_apply apply-restaurant-catalog.mjs
  run_apply apply-restaurant-fix.mjs
  run_apply apply-restaurant-pin-only.mjs
  run_apply apply-restaurant-claude-login.mjs
  run_apply apply-restaurant-table-photos.mjs
  run_apply apply-restaurant-admin-links.mjs
  run_apply apply-restaurant-logo.mjs
  run_apply apply-restaurant-roles.mjs
  run_apply apply-restaurant-admin-ia.mjs
  run_apply apply-restaurant-table-bill.mjs
  run_apply apply-restaurant-no-whatsapp.mjs
  run_apply apply-restaurant-operations.mjs
  run_apply apply-restaurant-operations-v3.mjs
  run_apply apply-restaurant-branch.mjs
  run_apply apply-restaurant-contract.mjs
  run_apply apply-restaurant-perm-az.mjs
  run_apply apply-restaurant-staff-role.mjs
  run_apply apply-restaurant-ops-doors.mjs
  run_apply apply-restaurant-role-home.mjs
  run_apply apply-restaurant-ops-header.mjs
  run_apply apply-restaurant-stock-ui.mjs
  run_apply apply-restaurant-ops-tabsync.mjs
  run_apply apply-restaurant-supply-ui.mjs
  run_apply apply-restaurant-settings-ui.mjs
  run_apply apply-restaurant-admin-refresh.mjs
  run_apply apply-restaurant-settings-design.mjs
  run_apply apply-restaurant-settings-pro.mjs
  run_apply apply-restaurant-settings-form.mjs
  run_apply apply-restaurant-settings-exact.mjs
  run_apply apply-restaurant-settings-space.mjs
  run_apply apply-restaurant-settings-legibility.mjs
  run_apply apply-restaurant-settings-receipt.mjs
  run_apply apply-restaurant-settings-receipt-brand.mjs
  run_apply apply-restaurant-touch-receipt.mjs
  run_apply apply-restaurant-destination-refresh.mjs
  run_apply apply-restaurant-printer-discovery.mjs
  run_apply apply-restaurant-refund-code.mjs
  run_apply apply-restaurant-cash-kinds.mjs
  run_apply apply-restaurant-printer-roles.mjs
  run_apply apply-restaurant-printer-roles-v2.mjs
  run_apply apply-restaurant-warehouse-slip.mjs
  run_apply apply-restaurant-printer-setup.mjs
  run_apply apply-restaurant-costing.mjs
  run_apply apply-restaurant-recipe-editor.mjs
  run_apply apply-restaurant-recipe-editor-v2.mjs
  run_apply apply-restaurant-receipt-panel.mjs
  run_apply apply-restaurant-license-area-tabs.mjs
  run_apply apply-restaurant-sidebar-access.mjs
  run_apply apply-restaurant-live-access.mjs
  run_apply apply-restaurant-lan.mjs
  run_apply apply-restaurant-locked-visible.mjs
  run_apply apply-restaurant-locked-pages.mjs
  run_apply apply-restaurant-license-refresh.mjs
  run_apply apply-restaurant-license-revoke.mjs
  run_apply apply-restaurant-buildstamp.mjs

  mkdir -p "$STAGE/assets/brands" "$STAGE/assets/backgrounds"
  cp -f "$ROOT/index.js" "$STAGE/index.js"
  cp -f "$ROOT/index.html" "$STAGE/index.html"
  cp -f "$ROOT/possistem-system.css" "$STAGE/possistem-system.css"
  cp -f "$ROOT/index-DAmHwBc4.js" "$STAGE/assets/index-BsrHjfOR.js"
  cp -f "$ROOT/assets/brands/logo.png" "$STAGE/assets/brands/logo.png"
  cp -f "$ROOT/assets/backgrounds/login-bg.png" "$STAGE/assets/backgrounds/login-bg.png"
  cp -f "$ROOT/assets/backgrounds/login-bg.png" "$STAGE/assets/login-bg-Dobpt4ta.png"

  mkdir -p out/main out/preload out/renderer
  cp -f "$ROOT/index.js" out/main/index.js
  rsync -a --delete --exclude 'index.js' "$STAGE/" out/renderer/
  rm -f out/renderer/index.js out/renderer/assets/index-Wq1QJL_s.js
fi
exec "$ELECTRON" . --no-sandbox --ozone-platform=x11 "$@"
