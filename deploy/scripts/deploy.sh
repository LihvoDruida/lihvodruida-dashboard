#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Атомарний деплой Mistblossom Vanguard.
#
#   make deploy
#
# Оновлює і dashboard, і bot: ці два образи мають спільний Discord-contract,
# тому деплой тільки одного сервісу може залишити несумісну пару версій.
# Перед оновленням поточні образи позначаються rollback-тегами. Якщо новий
# dashboard або bot не стає healthy, обидва доступні попередні образи
# повертаються разом.
# ---------------------------------------------------------------------------

set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE="docker compose"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
ROLLBACK_TAG="rollback"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m!!\033[0m %s\n' "$*" >&2; exit 1; }

env_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 1
  sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" \
    | tail -n1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
}

[ -f .env ] || fail "немає .env — скопіюй із .env.example і заповни"
[ -f dashboard/.env.production ] || fail "немає dashboard/.env.production — скопіюй із dashboard/.env.example і заповни"
[ -f bot/.env.production ] || fail "немає bot/.env.production — скопіюй із bot/.env.example і заповни"

IMAGE_TAG="$(env_get .env IMAGE_TAG || true)"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DASHBOARD_IMAGE="mistblossom/dashboard:${IMAGE_TAG}"
BOT_IMAGE="mistblossom/bot:${IMAGE_TAG}"

HAVE_DASHBOARD_ROLLBACK=0
HAVE_BOT_ROLLBACK=0

log "Позначаємо поточні образи для можливого відкоту"
if docker image inspect "$DASHBOARD_IMAGE" >/dev/null 2>&1; then
  docker tag "$DASHBOARD_IMAGE" "mistblossom/dashboard:${ROLLBACK_TAG}"
  HAVE_DASHBOARD_ROLLBACK=1
else
  warn "Попереднього dashboard image немає — для нього відкочуватись нікуди"
fi
if docker image inspect "$BOT_IMAGE" >/dev/null 2>&1; then
  docker tag "$BOT_IMAGE" "mistblossom/bot:${ROLLBACK_TAG}"
  HAVE_BOT_ROLLBACK=1
else
  warn "Попереднього bot image немає — для нього відкочуватись нікуди"
fi

log "Забираємо код"
git pull --ff-only

log "Перевіряємо передумови"
./deploy/scripts/start.sh --check

log "Збираємо dashboard + bot"
$COMPOSE build dashboard bot

log "Піднімаємо стек без повторної збірки"
$COMPOSE up -d --remove-orphans --no-build

service_health() {
  local service="$1"
  local cid state
  cid="$($COMPOSE ps -q "$service" 2>/dev/null || true)"
  [ -n "$cid" ] || { printf 'missing'; return; }
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
  printf '%s' "${state:-unknown}"
}

wait_service() {
  local service="$1" timeout="${2:-120}" waited=0 state
  printf '  очікую %s' "$service"
  while [ "$waited" -lt "$timeout" ]; do
    state="$(service_health "$service")"
    case "$state" in
      healthy|running)
        printf '\n'; log "$service: $state"; return 0 ;;
      exited|dead)
        printf '\n'; return 1 ;;
    esac
    printf '.'
    sleep 3
    waited=$((waited + 3))
  done
  printf '\n'
  return 1
}

rollback() {
  warn "Новий стек не пройшов healthcheck. Повертаємо доступні попередні образи."
  local restored=0
  if [ "$HAVE_DASHBOARD_ROLLBACK" -eq 1 ]; then
    docker tag "mistblossom/dashboard:${ROLLBACK_TAG}" "$DASHBOARD_IMAGE"
    restored=1
  fi
  if [ "$HAVE_BOT_ROLLBACK" -eq 1 ]; then
    docker tag "mistblossom/bot:${ROLLBACK_TAG}" "$BOT_IMAGE"
    restored=1
  fi
  if [ "$restored" -eq 1 ]; then
    $COMPOSE up -d --no-build dashboard bot || true
    $COMPOSE ps dashboard bot || true
  else
    warn "Жодного попереднього образу немає — автоматичний rollback неможливий."
  fi
}

if ! wait_service dashboard "$HEALTH_TIMEOUT"; then
  $COMPOSE logs --tail=80 dashboard || true
  rollback
  fail "dashboard не став healthy — деплой скасовано"
fi

if ! wait_service bot "$HEALTH_TIMEOUT"; then
  $COMPOSE logs --tail=80 bot dashboard || true
  rollback
  fail "bot не став healthy — деплой скасовано"
fi

# nginx і cron не мають власного healthcheck; перевіряємо, що вони принаймні
# працюють після оновлення. PostgreSQL перевірив start.sh --check/compose deps.
for service in nginx cron; do
  state="$(service_health "$service")"
  case "$state" in
    healthy|running) log "$service: $state" ;;
    *)
      $COMPOSE logs --tail=50 "$service" || true
      rollback
      fail "$service не працює після деплою (state=$state)"
      ;;
  esac
done

log "Прибираємо старі невикористовувані образи"
docker image prune --force --filter "until=168h" >/dev/null

log "Деплой завершено"
$COMPOSE ps
