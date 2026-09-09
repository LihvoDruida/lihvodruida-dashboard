#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Розгортання нової версії панелі на власному сервері.
#
# Запускати з кореня репозиторію на сервері:
#   ./deploy/scripts/deploy.sh
#
# Що робить:
#   1. Забирає свіжий код.
#   2. Перевіряє передумови (start.sh --check).
#   3. Збирає новий образ.
#   4. Піднімає стек по черзі й чекає healthcheck кожного сервісу.
#   5. Якщо панель не піднялась — відкочується на попередній образ.
#
# Крок 5 — головна причина існування скрипта. Без нього `docker compose up -d`
# зупиняє робочу версію і залишає сервіс лежати, якщо новий білд зламаний.
#
# Перший запуск на новому сервері робиться не цим скриптом, а
# ./deploy/scripts/start.sh — там немає git pull і відкочуватись нікуди.
# ---------------------------------------------------------------------------

set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE="docker compose"
SERVICE="dashboard"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
PREVIOUS_TAG="rollback"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m!!\033[0m %s\n' "$*" >&2; exit 1; }

[ -f dashboard/.env.production ] || fail "немає dashboard/.env.production — скопіюй із .env.example і заповни"

log "Позначаємо поточний образ як ${PREVIOUS_TAG} для можливого відкоту"
if docker image inspect "mistblossom/dashboard:latest" >/dev/null 2>&1; then
  docker tag "mistblossom/dashboard:latest" "mistblossom/dashboard:${PREVIOUS_TAG}"
  HAVE_ROLLBACK=1
else
  log "Попереднього образу немає — це перший деплой, відкочуватись нікуди"
  HAVE_ROLLBACK=0
fi

log "Забираємо код"
git pull --ff-only

# Перевірки до збірки: якщо в новій версії зʼявилась обовʼязкова змінна,
# дешевше дізнатись про це зараз, ніж після зупинки робочої версії.
log "Перевіряємо передумови"
./deploy/scripts/start.sh --check

log "Збираємо образ"
$COMPOSE build "$SERVICE"

log "Піднімаємо стек"
# Порядок і очікування готовності — у start.sh; тут лишається тільки
# контроль за панеллю, бо саме її образ ми щойно перезібрали.
$COMPOSE up -d --remove-orphans

log "Чекаємо healthcheck (до ${HEALTH_TIMEOUT}с)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while true; do
  cid=$($COMPOSE ps -q "$SERVICE")
  status=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "starting")

  if [ "$status" = "healthy" ]; then
    log "Готово: сервіс healthy"
    break
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    printf '\n--- останні 50 рядків логу ---\n'
    $COMPOSE logs --tail=50 "$SERVICE" || true
    printf '\n'

    if [ "$HAVE_ROLLBACK" = "1" ]; then
      log "Не піднявся. Відкочуємось на попередній образ"
      docker tag "mistblossom/dashboard:${PREVIOUS_TAG}" "mistblossom/dashboard:latest"
      $COMPOSE up -d --no-build "$SERVICE"
      fail "деплой скасовано, повернули попередню версію"
    fi
    fail "сервіс не став healthy і відкочуватись нікуди"
  fi

  sleep 3
done

log "Прибираємо старі образи"
docker image prune --force --filter "until=168h" >/dev/null

log "Деплой завершено"
$COMPOSE ps
