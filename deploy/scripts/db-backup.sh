#!/usr/bin/env bash
# Резервна копія бази Mistblossom Vanguard.
#
#   ./deploy/scripts/db-backup.sh [каталог]
#
# За замовчуванням кладе у /srv/mistblossom/backups і зберігає копії
# BACKUP_KEEP_DAYS днів (14 за замовчуванням). Дампи й checksum-и доступні
# лише власнику файлів: база може містити Discord IDs, профілі та аудити.

set -euo pipefail
umask 077

BACKUP_DIR="${1:-/srv/mistblossom/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%F-%H%M%S)"
FILE="${BACKUP_DIR}/mistblossom-${STAMP}.dump"
CHECKSUM="${FILE}.sha256"
LOCK_FILE="${BACKUP_DIR}/.backup.lock"

case "$KEEP_DAYS" in
  ''|*[!0-9]*) echo "✖ BACKUP_KEEP_DAYS має бути цілим числом." >&2; exit 1 ;;
esac
if [ "$KEEP_DAYS" -lt 1 ] || [ "$KEEP_DAYS" -gt 3650 ]; then
  echo "✖ BACKUP_KEEP_DAYS має бути в межах 1..3650." >&2
  exit 1
fi

install -d -m 700 "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Не дозволяємо двом timer/manual backup одночасно писати різні неповні дампи.
exec 9>"$LOCK_FILE"
chmod 600 "$LOCK_FILE"
if ! flock -n 9; then
  echo "✖ Інший backup уже виконується." >&2
  exit 1
fi

TMP="$(mktemp "${BACKUP_DIR}/.mistblossom-${STAMP}.XXXXXX.tmp")"
trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"

echo "→ Знімаємо дамп у ${FILE}"
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-mistblossom}" -d "${POSTGRES_DB:-mistblossom}" -Fc \
  > "$TMP"

# Порожній або обрізаний дамп гірший за його відсутність: він створює
# ілюзію бекапу. Валідуємо custom-format до атомарного publish.
if [ ! -s "$TMP" ] || ! docker compose exec -T postgres pg_restore --list < "$TMP" > /dev/null 2>&1; then
  echo "✖ Дамп не читається; готовий backup не створено." >&2
  exit 1
fi

mv -f "$TMP" "$FILE"
trap - EXIT
chmod 600 "$FILE"
(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$FILE")" > "$(basename "$CHECKSUM")"
)
chmod 600 "$CHECKSUM"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ Готово: ${FILE} (${SIZE})"
echo "✓ SHA-256: ${CHECKSUM}"

echo "→ Прибираємо копії, старші за ${KEEP_DAYS} днів"
find "$BACKUP_DIR" -maxdepth 1 -name 'mistblossom-*.dump' -type f -mtime "+${KEEP_DAYS}" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'mistblossom-*.dump.sha256' -type f -mtime "+${KEEP_DAYS}" -print -delete
