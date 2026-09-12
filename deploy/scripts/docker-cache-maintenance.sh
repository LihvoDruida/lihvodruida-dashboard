#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
KEEP_STORAGE="${BUILD_CACHE_KEEP_STORAGE:-6GB}"
MAX_AGE="${BUILD_CACHE_MAX_AGE:-168h}"

printf '\n== Docker BuildKit cache maintenance ==\n'
printf 'Target cache: %s · fallback age: %s\n' "$KEEP_STORAGE" "$MAX_AGE"

docker builder prune -af --keep-storage "$KEEP_STORAGE" >/dev/null 2>&1 \
  || docker builder prune -af --filter "until=$MAX_AGE" >/dev/null 2>&1 \
  || true

docker image prune -f >/dev/null 2>&1 || true

"$ROOT_DIR/deploy/scripts/docker-stats-snapshot.sh" || true

docker system df || true
