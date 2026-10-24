#!/usr/bin/env bash
# PNG → WebP + public sync for hardware catalog images.
set -euo pipefail

ROOT="/var/www/possistem"
SRC="$ROOT/assets/hardware"
DST="$ROOT/public/assets/hardware"

mkdir -p "$DST"

shopt -s nullglob
pngs=("$SRC"/*.png)

if [ ${#pngs[@]} -eq 0 ]; then
  echo "No PNG files in $SRC"
  echo "Add transparent PNGs from ChatGPT, then re-run."
  exit 0
fi

for png in "${pngs[@]}"; do
  base="$(basename "$png" .png)"
  webp="$SRC/${base}.webp"
  if command -v cwebp >/dev/null 2>&1; then
    cwebp -q 85 "$png" -o "$webp"
    echo "✓ $base.webp"
  elif command -v magick >/dev/null 2>&1; then
    magick "$png" -quality 85 "$webp"
    echo "✓ $base.webp (imagemagick)"
  elif command -v convert >/dev/null 2>&1; then
    convert "$png" -quality 85 "$webp"
    echo "✓ $base.webp (convert)"
  else
    cp "$png" "$DST/${base}.png"
    echo "⚠ cwebp not found — copied PNG only: $base.png"
    continue
  fi
  cp "$webp" "$DST/${base}.webp"
done

echo "Done. Update ASSET_VERSION in src/lib/assets.ts if needed."
