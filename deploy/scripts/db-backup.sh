#!/usr/bin/env bash
# Резервна копія бази Mistblossom Vanguard.
#
#   ./deploy/scripts/db-backup.sh [каталог]
#
# За замовчуванням кладе у /srv/mistblossom/backups і лишає останні 14 копій.
# Формат custom (-Fc) обраний свідомо: він стискається, дозволяє відновлювати
# окремі таблиці й не залежить від версії psql на приймачі.

set -euo pipefail

BACKUP_DIR="${1:-/srv/mistblossom/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%F-%H%M)"
FILE="${BACKUP_DIR}/mistblossom-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "→ Знімаємо дамп у ${FILE}"
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-mistblossom}" -d "${POSTGRES_DB:-mistblossom}" -Fc \
  > "$FILE"

# Порожній або обрізаний дамп гірший за його відсутність: він створює
# ілюзію бекапу. Тому одразу перевіряємо, що файл читається.
if ! docker compose exec -T postgres pg_restore --list < "$FILE" > /dev/null 2>&1; then
  echo "✖ Дамп не читається, видаляю: ${FILE}" >&2
  rm -f "$FILE"
  exit 1
fi

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ Готово: ${FILE} (${SIZE})"

echo "→ Прибираємо копії, старші за ${KEEP_DAYS} днів"
find "$BACKUP_DIR" -name 'mistblossom-*.dump' -type f -mtime "+${KEEP_DAYS}" -print -delete
