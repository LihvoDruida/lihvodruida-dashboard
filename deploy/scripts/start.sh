#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Запуск стека Mistblossom Vanguard.
#
#   ./deploy/scripts/start.sh            звичайний запуск
#   ./deploy/scripts/start.sh --build    зі збіркою образів
#   ./deploy/scripts/start.sh --check    тільки перевірки, нічого не запускати
#   ./deploy/scripts/start.sh --restart  повний перезапуск (down + up)
#
# Навіщо це замість `docker compose up -d`.
#
# Compose піднімає все майже одночасно і не розрізняє «контейнер запустився»
# та «сервіс працює». Наслідок: панель стартує раніше за базу, падає на
# першому ж запиті й іде в перезапуск; nginx піднімається без сертифіката;
# бот працює, але з чужим ключем — і жодна з цих ситуацій не видно у виводі
# `up -d`, вона проявиться через годину як «нічого не працює».
#
# Скрипт робить три речі, яких Compose не робить:
#   1. Перевіряє передумови ДО запуску (розділ «Перевірки»).
#   2. Піднімає сервіси по черзі, дочікуючись готовності кожного.
#   3. Після запуску перевіряє, що система справді відповідає.
# ---------------------------------------------------------------------------

set -euo pipefail

cd "$(dirname "$0")/../.."

BUILD=0
CHECK_ONLY=0
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --build)   BUILD=1 ;;
    --check)   CHECK_ONLY=1 ;;
    --restart) RESTART=1 ;;
    -h|--help) sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Невідомий аргумент: $arg" >&2; exit 2 ;;
  esac
done

# --- Вивід ------------------------------------------------------------------
BOLD=$'\033[1m'; RED=$'\033[1;31m'; GREEN=$'\033[1;32m'
YELLOW=$'\033[1;33m'; CYAN=$'\033[1;36m'; RESET=$'\033[0m'

step() { printf '\n%s==>%s %s%s%s\n' "$CYAN" "$RESET" "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() { printf '\n%s✖%s %s\n\n' "$RED" "$RESET" "$*" >&2; exit 1; }

PROBLEMS=0
problem() { printf '  %s✖%s %s\n' "$RED" "$RESET" "$*" >&2; PROBLEMS=$((PROBLEMS + 1)); }

COMPOSE="docker compose"

# ---------------------------------------------------------------------------
# 0. Права на скрипти
#
# Біт виконання губиться при перенесенні файлів через Windows, SFTP або при
# розпакуванні деякими архіваторами. Симптом — `Permission denied` на
# сусідньому скрипті посеред розгортання. Оскільки цей файл уже виконується,
# полагодити сусідів дешевше, ніж вимагати від людини памʼятати про chmod.
# ---------------------------------------------------------------------------
for script in "$(dirname "$0")"/*.sh; do
  [ -x "$script" ] || chmod +x "$script" 2>/dev/null || true
done

# ---------------------------------------------------------------------------
# 1. Інструменти
# ---------------------------------------------------------------------------
step "Перевіряю інструменти"

command -v docker >/dev/null 2>&1 || fail "docker не встановлений. Див. docs/DEPLOYMENT.md, розділ 2."
docker info >/dev/null 2>&1 || fail "docker недоступний. Демон не запущений або користувача немає в групі docker (потрібен перелогін після usermod)."
docker compose version >/dev/null 2>&1 || fail "немає плагіна docker compose. Версія з репозиторію Ubuntu не має підкоманди compose — ставте docker-compose-plugin."

ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"
ok "compose $($COMPOSE version --short 2>/dev/null || echo '?')"

# ---------------------------------------------------------------------------
# 2. Файли конфігурації
# ---------------------------------------------------------------------------
step "Перевіряю файли конфігурації"

for f in docker-compose.yml .env dashboard/.env.production bot/.env.production; do
  if [ -f "$f" ]; then
    ok "$f"
  else
    problem "немає $f"
  fi
done

# Секрети не мають бути читабельними для всіх: у compose і скриптах вони
# передаються у відкритому вигляді, тож права на файл — єдиний захист.
for f in .env dashboard/.env.production bot/.env.production; do
  [ -f "$f" ] || continue
  perms="$(stat -c '%a' "$f")"
  case "$perms" in
    600|400) ;;
    *) warn "$f має права $perms — виправте: chmod 600 $f" ;;
  esac
done

[ "$PROBLEMS" -eq 0 ] || fail "Заповніть відсутні файли з шаблонів (.env.example) і запустіть знову."

# ---------------------------------------------------------------------------
# 3. Обовʼязкові змінні
# ---------------------------------------------------------------------------
step "Перевіряю обовʼязкові змінні"

# Читаємо .env-файли без експорту в поточну оболонку: значення можуть містити
# пробіли, лапки й символи, які зламали б `source`.
env_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 1
  sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" \
    | tail -n1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
}

require_var() {
  local file="$1" key="$2"
  local value; value="$(env_get "$file" "$key" || true)"
  if [ -z "$value" ]; then
    problem "$key не заданий у $file"
  else
    ok "$key"
  fi
}

require_var .env DASHBOARD_PUBLIC_URL
require_var .env POSTGRES_PASSWORD
require_var .env DISCORD_PUBLIC_KEY
require_var .env INTERNAL_API_TOKEN

require_var dashboard/.env.production DATABASE_URL
require_var dashboard/.env.production SESSION_SECRET
require_var dashboard/.env.production DISCORD_BOT_TOKEN
require_var dashboard/.env.production DISCORD_GUILD_ID

require_var bot/.env.production DISCORD_PUBLIC_KEY
require_var bot/.env.production INTERNAL_API_TOKEN

# --- Значення, які мусять збігатися між сервісами --------------------------
# Розбіжність тут не дає помилки при старті: панель і бот піднімуться, а
# Discord мовчки відповідатиме «Дія не вдалася». Дешевше зловити зараз.
compare_var() {
  local key="$1"
  local a; a="$(env_get dashboard/.env.production "$key" || true)"
  local b; b="$(env_get bot/.env.production "$key" || true)"
  [ -n "$a" ] && [ -n "$b" ] || return 0
  if [ "$a" = "$b" ]; then
    ok "$key збігається в панелі й боті"
  else
    problem "$key РІЗНИЙ у dashboard/.env.production і bot/.env.production"
  fi
}

compare_var DISCORD_PUBLIC_KEY
compare_var DISCORD_GUILD_ID
compare_var INTERNAL_API_TOKEN
compare_var DISCORD_BOT_TOKEN

# --- Типова помилка з хостом бази ------------------------------------------
DB_URL="$(env_get dashboard/.env.production DATABASE_URL || true)"
case "$DB_URL" in
  *@localhost:*|*@127.0.0.1:*)
    problem "DATABASE_URL вказує на localhost. У контейнері це сам контейнер панелі, а не база. Потрібен хост postgres."
    ;;
esac

[ "$PROBLEMS" -eq 0 ] || fail "Виправте змінні оточення. Опис — docs/CONFIGURATION.md."

# ---------------------------------------------------------------------------
# 4. Сертифікат і диск
# ---------------------------------------------------------------------------
step "Перевіряю сертифікат і ресурси"

DOMAIN="$(env_get .env DASHBOARD_PUBLIC_URL | sed 's~^https\?://~~; s~/.*$~~')"
ok "домен: $DOMAIN"

if docker volume inspect mistblossom_letsencrypt >/dev/null 2>&1; then
  if docker run --rm -v mistblossom_letsencrypt:/etc/letsencrypt alpine \
       test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" 2>/dev/null; then
    ok "сертифікат для $DOMAIN на місці"
  else
    # Nginx не стартує без файлу сертифіката взагалі, тому це блокує запуск.
    problem "немає сертифіката для $DOMAIN. Створіть тимчасовий самопідписаний — docs/DEPLOYMENT.md, розділ 5."
  fi
else
  problem "немає тому mistblossom_letsencrypt. Nginx не підніметься. Див. docs/DEPLOYMENT.md, розділ 5."
fi

AVAIL_MB="$(df -Pm . | awk 'NR==2 {print $4}')"
if [ "${AVAIL_MB:-0}" -lt 2048 ]; then
  problem "на диску лише ${AVAIL_MB} МБ. Збірка Next.js потребує кількох гігабайтів."
elif [ "${AVAIL_MB:-0}" -lt 5120 ]; then
  warn "на диску ${AVAIL_MB} МБ — малувато для збірки образів"
else
  ok "вільно на диску: ${AVAIL_MB} МБ"
fi

if [ "$BUILD" -eq 1 ]; then
  TOTAL_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  SWAP_MB="$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  if [ "$((TOTAL_MB + SWAP_MB))" -lt 2048 ]; then
    warn "RAM+swap = $((TOTAL_MB + SWAP_MB)) МБ. Збірка Next.js може впасти з OOM — див. docs/DEPLOYMENT.md, розділ 9."
  fi
fi

# ---------------------------------------------------------------------------
# 5. Конфігурація Compose
# ---------------------------------------------------------------------------
step "Перевіряю docker-compose.yml"
$COMPOSE config --quiet || fail "docker-compose.yml некоректний (див. вивід вище)"
ok "конфігурація валідна"

if [ "$PROBLEMS" -gt 0 ]; then
  fail "Знайдено проблем: $PROBLEMS. Запуск скасовано."
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  printf '\n%s✓%s Усі перевірки пройдені. Запуск не виконувався (--check).\n\n' "$GREEN" "$RESET"
  exit 0
fi

# ---------------------------------------------------------------------------
# 6. Запуск
# ---------------------------------------------------------------------------

# Чекає, поки сервіс стане healthy. Саме healthy, а не «запущений»: різниця
# між цими двома станами — та година, за яку панель встигає нарестартуватись.
wait_healthy() {
  local service="$1" timeout="${2:-120}" waited=0 cid state
  printf '  очікую %s' "$service"
  while [ "$waited" -lt "$timeout" ]; do
    cid="$($COMPOSE ps -q "$service" 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo "")"
      case "$state" in
        healthy|running)
          printf '\n'; ok "$service: $state"; return 0 ;;
        exited|dead)
          printf '\n'
          $COMPOSE logs --tail=40 "$service" || true
          fail "$service зупинився під час запуску" ;;
      esac
    fi
    printf '.'
    sleep 2
    waited=$((waited + 2))
  done
  printf '\n'
  $COMPOSE logs --tail=40 "$service" || true
  fail "$service не став готовим за ${timeout} с"
}

if [ "$RESTART" -eq 1 ]; then
  step "Зупиняю стек"
  $COMPOSE down --remove-orphans
  ok "зупинено"
fi

UP_ARGS="-d --remove-orphans"
[ "$BUILD" -eq 1 ] && UP_ARGS="$UP_ARGS --build"

# Порядок навмисний і відповідає залежностям даних:
#   postgres → dashboard → bot → nginx → cron
# Кожен наступний сервіс має сенс тільки коли попередній справді працює.

step "1/5 База даних"
# shellcheck disable=SC2086
$COMPOSE up $UP_ARGS postgres
wait_healthy postgres 90

step "Схема бази"
# db-init ідемпотентний (IF NOT EXISTS / OR REPLACE), тому виконується на
# кожному запуску: це дешевше, ніж памʼятати про нього після оновлення.
if $COMPOSE run --rm --no-deps \
     -e DATABASE_URL="$DB_URL" \
     dashboard node scripts/db-init.mjs 2>/dev/null; then
  ok "схему застосовано"
else
  warn "не вдалося застосувати схему автоматично — виконайте вручну:"
  warn "  DATABASE_URL='...' npm --prefix dashboard run db:init"
fi

step "2/5 Панель"
# shellcheck disable=SC2086
$COMPOSE up $UP_ARGS dashboard
wait_healthy dashboard 180

step "3/5 Discord-бот"
# shellcheck disable=SC2086
$COMPOSE up $UP_ARGS bot
wait_healthy bot 60

step "4/5 Nginx"
# shellcheck disable=SC2086
$COMPOSE up $UP_ARGS nginx
wait_healthy nginx 60

step "5/5 Планові задачі"
# shellcheck disable=SC2086
$COMPOSE up $UP_ARGS cron
ok "cron запущено"

# ---------------------------------------------------------------------------
# 7. Перевірка після запуску
# ---------------------------------------------------------------------------
step "Перевіряю, що система відповідає"

if $COMPOSE exec -T dashboard node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
  ok "панель відповідає"
else
  problem "панель не відповідає на /api/health"
fi

if $COMPOSE exec -T bot node -e \
    "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
  ok "бот відповідає"
else
  problem "бот не відповідає на /healthz"
fi

if curl -fsS -o /dev/null --max-time 15 "https://$DOMAIN/api/health" 2>/dev/null; then
  ok "https://$DOMAIN/api/health доступний ззовні"
else
  # Не помилка: одразу після запуску це часто DNS, Cloudflare або ще не
  # виданий сертифікат — усе поза межами відповідальності цього скрипта.
  warn "https://$DOMAIN/api/health недоступний ззовні"
  warn "перевірте DNS, режим проксі Cloudflare і сертифікат — docs/DEPLOYMENT.md, розділ 4"
fi

printf '\n'
$COMPOSE ps

if [ "$PROBLEMS" -gt 0 ]; then
  printf '\n%s!%s Стек запущений, але %s перевірок не пройдено. Логи: docker compose logs -f\n\n' \
    "$YELLOW" "$RESET" "$PROBLEMS"
  exit 1
fi

printf '\n%s✓%s Стек запущено: %shttps://%s%s\n\n' "$GREEN" "$RESET" "$BOLD" "$DOMAIN" "$RESET"
