#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
OUT_DIR="${SERVER_STATS_DIR:-$ROOT_DIR/runtime/server-stats}"
OUT_FILE="$OUT_DIR/docker-system-df.jsonl"
TMP_FILE="$OUT_FILE.tmp.$$"

mkdir -p "$OUT_DIR"
trap 'rm -f "$TMP_FILE"' EXIT INT TERM

printf '{"sampledAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TMP_FILE"
if docker system df --format '{{json .}}' >> "$TMP_FILE" 2>/dev/null; then
  mv "$TMP_FILE" "$OUT_FILE"
  chmod 0644 "$OUT_FILE" 2>/dev/null || true
  trap - EXIT INT TERM
  exit 0
fi

rm -f "$TMP_FILE"
exit 1
