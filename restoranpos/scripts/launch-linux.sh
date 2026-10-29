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
  # Use the same fail-closed assembly as packaging so a partial patch cannot
  # silently open an older PIN screen. The tested desktop shortcut skips rebuild.
  node scripts/assemble-restaurant.mjs
fi
exec "$ELECTRON" . --no-sandbox --ozone-platform=x11 "$@"
