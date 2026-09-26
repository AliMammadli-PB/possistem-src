#!/usr/bin/env bash
# Refresh this repo from the working trees (restoranpos, marketpos, geyimpos).
# Builds, installers, dependencies, local databases and secrets stay out.
set -euo pipefail
SRC="/home/panda/Desktop/possistem(restoranpos)"
HERE="$(cd "$(dirname "$0")" && pwd)"
COMMON=(
  --exclude=node_modules --exclude=dist/ --exclude='release/' --exclude='release-*/'
  --exclude=logs/ --exclude='*.log'
  --exclude='native/build/' --exclude='native/build-*/'
  --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' --exclude='*.sqlite*'
  --include='.env.example' --exclude='.env' --exclude='.env.*' --exclude='.claude/'
  --exclude='*.pem' --exclude='*.key' --exclude='*.p12' --exclude='*.pfx' --exclude='id_*'
  --exclude='*.exe' --exclude='*.dll' --exclude='*.node' --exclude='*.asar' --exclude='*.blockmap'
  --exclude='*.tsbuildinfo' --exclude='*.orig' --exclude='*.pre-*' --exclude='*.bak-*'
  --exclude='.impeccable/' --exclude='graft/' --exclude='resources/rustdesk/' --exclude='test-results/'
  --exclude='demo-web/dist/'
)
rsync -a --delete --delete-excluded "${COMMON[@]}" \
  --exclude=/control --exclude=/ops/ --exclude=/artifacts/ --exclude='/sayt test/' --exclude=/chat.md \
  --exclude=/control-plane/ --exclude=/control.empty-stub/ \
  --include=/out/ --include='/out/preload/***' --exclude='/out/*' \
  "$SRC/restoranpos/" "$HERE/restoranpos/"
rsync -a --delete --delete-excluded "${COMMON[@]}" \
  --exclude=/recovered-1.4.4/ --exclude=/recovered-source-1.4.x/ --exclude=/out/ \
  "$SRC/marketpos/" "$HERE/marketpos/"
rsync -a --delete --delete-excluded "${COMMON[@]}" \
  "$SRC/geyimpos/" "$HERE/geyimpos/"
du -sh "$HERE/restoranpos" "$HERE/marketpos" "$HERE/geyimpos"
