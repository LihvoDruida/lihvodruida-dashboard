#!/usr/bin/env bash
# Відновлення бази з дампа.
#
#   ./deploy/scripts/db-restore.sh backups/mistblossom-2026-09-08-0400.dump
#
# УВАГА: перезаписує поточні дані. Скрипт спершу зупиняє панель, щоб
# відновлення не змагалося з живими записами, і піднімає її назад у кінці.

set -euo pipefail

DUMP="${1:?вкажіть файл дампа}"
[ -f "$DUMP" ] || { echo "✖ Немає файлу: $DUMP" >&2; exit 1; }

read -r -p "Це перезапише базу з ${DUMP}. Продовжити? [y/N] " answer
[ "$answer" = "y" ] || { echo "Скасовано."; exit 0; }

echo "→ Зупиняємо панель"
docker compose stop dashboard cron

echo "→ Відновлюємо"
docker compose exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-mistblossom}" -d "${POSTGRES_DB:-mistblossom}" \
  --clean --if-exists --no-owner < "$DUMP"

echo "→ Піднімаємо панель"
docker compose start dashboard cron

echo "✓ Готово. Перевірте: curl -fsS http://localhost/api/health"
