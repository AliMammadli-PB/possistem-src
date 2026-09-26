#!/usr/bin/env bash
# clang-tidy over the first-party C++ of both native cores (vendored
# native/third_party is excluded). Any finding fails the run.
#
#   bash scripts/static-analysis-cpp.sh
#
# Needs cmake, ninja, clang and clang-tidy on the host; the cores are only
# configured here (for compile_commands.json), never built.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CHECKS='-*,clang-analyzer-core.*,clang-analyzer-cplusplus.*,clang-analyzer-deadcode.*,clang-analyzer-security.*,clang-analyzer-unix.*,bugprone-use-after-move,bugprone-dangling-handle,bugprone-infinite-loop,bugprone-undefined-memory-manipulation,bugprone-sizeof-expression,bugprone-string-constructor,bugprone-suspicious-string-compare,bugprone-integer-division,bugprone-unused-return-value,bugprone-exception-escape'

status=0
for product in restoranpos marketpos geyimpos; do
  src="$ROOT/$product/native"
  build="$WORK/$product"
  cmake -S "$src" -B "$build" -G Ninja -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
    -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ >/dev/null
  echo "== clang-tidy: $product"
  if ! find "$src/core/src" -name '*.cpp' -print0 | xargs -0 -P "$(nproc)" -n 1 \
      clang-tidy -p "$build" --quiet --checks="$CHECKS" --warnings-as-errors='*' \
      --header-filter="^$src/core/.*" 2>/dev/null; then
    status=1
  fi
done
exit $status
