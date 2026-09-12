#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

BOLD=$'\033[1m'; CYAN=$'\033[1;36m'; RESET=$'\033[0m'
step() { printf '\n%s==>%s %s%s%s\n' "$CYAN" "$RESET" "$BOLD" "$*" "$RESET"; }

step "Стан контейнерів"
docker compose ps postgres dashboard bot

step "Дані, до яких привʼязані Discord-кнопки"
docker compose exec -T dashboard node dashboard/scripts/discord-storage-diagnose.mjs

step "Останні Discord/storage події (без секретів)"
docker compose logs --since=20m --tail=500 dashboard bot 2>&1 \
  | grep -Eai 'discord|interaction|authoritative|recovered|raid|poll|roster|postgres|storage|circuit|error|warn' \
  | tail -n 160 || true
