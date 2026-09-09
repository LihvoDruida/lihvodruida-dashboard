#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Зупинка стека Mistblossom Vanguard.
#
#   ./deploy/scripts/stop.sh              зупинити все
#   ./deploy/scripts/stop.sh --keep-db    зупинити все, крім бази
#
# Дані не втрачаються: база лежить у томі pgdata, сертифікати — у
# letsencrypt. `down` прибирає контейнери й мережі, томи лишаються.
# ---------------------------------------------------------------------------

set -euo pipefail
cd "$(dirname "$0")/../.."

GREEN=$'\033[1;32m'; CYAN=$'\033[1;36m'; RESET=$'\033[0m'
step() { printf '\n%s==>%s %s\n' "$CYAN" "$RESET" "$*"; }

if [ "${1:-}" = "--keep-db" ]; then
  # Корисно під час обслуговування: записи зупинені, але база доступна
  # для psql, дампа чи відновлення.
  step "Зупиняю все, крім бази"
  docker compose stop nginx cron bot dashboard
  printf '\n%s✓%s Панель зупинена, база працює.\n\n' "$GREEN" "$RESET"
  exit 0
fi

step "Зупиняю стек"
# Порядок зворотний до запуску: спершу прибираємо вхідний трафік, потім
# сервіси, і тільки наприкінці базу — щоб панель не отримала обрив
# зʼєднання посеред транзакції.
docker compose stop nginx cron bot dashboard postgres || true
docker compose down --remove-orphans

printf '\n%s✓%s Стек зупинено. Дані збережені в томах pgdata і letsencrypt.\n\n' "$GREEN" "$RESET"
