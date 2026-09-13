#!/usr/bin/env bash
# Безпечне відновлення бази з custom-format pg_dump.
#
#   ./deploy/scripts/db-restore.sh backups/mistblossom-2026-09-08-040000.dump

set -euo pipefail
umask 077

DUMP="${1:?вкажіть файл дампа}"
[ -f "$DUMP" ] || { echo "✖ Немає файлу: $DUMP" >&2; exit 1; }
[ ! -L "$DUMP" ] || { echo "✖ Симлінки як backup не приймаються: $DUMP" >&2; exit 1; }

# Якщо backup має sidecar checksum, перевіряємо його до зупинки застосунку.
if [ -f "${DUMP}.sha256" ]; then
  echo "→ Перевіряємо SHA-256"
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "${DUMP}.sha256")")
fi

# Перевірка формату до downtime. Це також відсікає випадково підставлений
# текстовий/порожній файл.
if ! docker compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null 2>&1; then
  echo "✖ Файл не є валідним custom-format pg_dump." >&2
  exit 1
fi

read -r -p "Це перезапише базу з ${DUMP}. Продовжити? [y/N] " answer
[ "$answer" = "y" ] || { echo "Скасовано."; exit 0; }

stopped=0
restart_services() {
  if [ "$stopped" -eq 1 ]; then
    echo "→ Повертаємо dashboard і cron"
    docker compose start dashboard cron >/dev/null || true
  fi
}
trap restart_services EXIT INT TERM

echo "→ Зупиняємо панель і cron"
docker compose stop dashboard cron
stopped=1

echo "→ Відновлюємо"
docker compose exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-mistblossom}" -d "${POSTGRES_DB:-mistblossom}" \
  --clean --if-exists --no-owner --no-privileges --exit-on-error < "$DUMP"

echo "→ Піднімаємо панель"
docker compose start dashboard cron
stopped=0
trap - EXIT INT TERM

echo "✓ Готово. Перевірте: docker compose ps && make internal-check"
