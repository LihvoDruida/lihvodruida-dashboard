#!/bin/sh
# ---------------------------------------------------------------------------
# Планові задачі панелі.
#
# На Vercel це були Cron Jobs у vercel.json. Тут — простий цикл у контейнері,
# який стукає у ті самі HTTP-ендпоїнти внутрішньою мережею.
#
# Чому не системний cron у контейнері: busybox crond у образі curl немає,
# а тягнути окремий образ заради кількох задач надлишково. Цикл із перевіркою
# хвилини робить те саме і легко читається в логах.
#
# Задачі та розклад (кожна має незалежного worker із дедлайном і backoff):
#   */2  * * * *  /api/guild/sync             — Battle.net + Raider.IO + raid progress у БД
#   *    * * * *  /api/raids/lifecycle        — per-record task queue: close/reminder/Discord cleanup
#   */5  * * * *  /api/polls/close-due?force=1 — scheduled-публікація + автозакриття/повтор
#   */30 * * * *  /api/dashboard/logs/maintenance — retention/budget журналу
#   */15 * * * *  /api/dashboard/profiles/orphan-cleanup — scheduler перевірки/очищення акаунтів
#   adaptive     /api/dashboard/discord/member-cleanup/automation — 10s під час роботи, 60s у спокої
#   *    * * * *  /api/dashboard/discord/onboarding/automation — welcome DM для нових Discord-учасників
#   */15 * * * *  /api/dashboard/discord/nicknames/automation — перевірка ніків + DM/fallback-попередження
#   *    * * * *  /api/dashboard/discord/applications/automation — відновлення доставки заявок у Discord
#   *    * * * *  /api/dashboard/discord/profile-nicknames/automation — лише готова черга змін профілю
# ---------------------------------------------------------------------------

# Без `-e`: збій однієї задачі (або `date`/`sleep`) не має зупиняти весь
# планувальник. Кожен worker сам веде backoff і логування.
set -u

BASE="${DASHBOARD_INTERNAL_URL:-http://dashboard:3000}"
# Єдиний service-to-service токен. Compose передає сюди кореневий
# INTERNAL_API_TOKEN, який dashboard приймає на всіх internal routes.
TOKEN="${INTERNAL_CRON_TOKEN:?INTERNAL_CRON_TOKEN не заданий (очікується INTERNAL_API_TOKEN)}"

log() {
  echo "[cron $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

call() {
  path="$1"
  case "$path" in
    /api/raids/lifecycle*) interval=60; key=raid-lifecycle ;;
    /api/dashboard/discord/onboarding/automation) interval=60; key=onboarding ;;
    /api/dashboard/discord/member-cleanup/automation) interval=10; key=member-cleanup ;;
    /api/polls/close-due*) interval=300; key=polls ;;
    /api/guild/sync) interval=120; key=guild-sync ;;
    /api/dashboard/logs/maintenance) interval=1800; key=log-maintenance ;;
    /api/dashboard/profiles/orphan-cleanup) interval=900; key=account-cleanup ;;
    /api/dashboard/discord/nicknames/automation) interval=900; key=nicknames ;;
    /api/dashboard/discord/profile-nicknames/automation) interval=60; key=profile-nicknames ;;
    /api/dashboard/discord/applications/automation) interval=60; key=application-deliveries ;;
    *) log "невідома задача: $path"; return 1 ;;
  esac
  # Independent workers retain deadlines and backoff; no automatic curl replay.
  # Подвійний fork: worker одразу переходить до init (tini, `init: true` у
  # compose), який його і прибирає. Диспетчер не накопичує zombie-процеси
  # під pids_limit, навіть якщо shell не реапить фонові задачі сам.
  ( /bin/sh "${CRON_WORKER_PATH:-/opt/cron/run-job.sh}" "$path" "$interval" "$key" & ) || log "не вдалося запустити $key"
}

# `sleep` у фоні + `wait`: SIGTERM від `docker stop` обробляється одразу,
# а не після хвилинного сну (інакше Docker добиває контейнер SIGKILL).
nap() {
  sleep "$1" &
  wait $! 2>/dev/null || true
}

# Heartbeat для docker healthcheck: файл оновлюється на кожному tick.
STATE_DIR="${CRON_STATE_DIR:-/tmp/mistblossom-cron}"
mkdir -p "$STATE_DIR" 2>/dev/null || true
beat() {
  date +%s > "$STATE_DIR/$1.alive" 2>/dev/null || true
}

start_cleanup_loop() {
  (
    while true; do
      beat cleanup
      call "/api/dashboard/discord/member-cleanup/automation"
      sleep 10
    done
  ) &
  cleanup_pid=$!
}

log "старт; база=${BASE}"

# Після рестарту одразу відновлюємо/звіряємо per-raid task queue. Це закриває
# старі рейди, які були створені до появи task scheduler, не чекаючи початку
# наступної години. Після reconciliation цей же виклик обробляє вже due tasks.
call "/api/raids/lifecycle?sweep=1&limit=100"

# Cleanup progresses independently of calendar-minute jobs. Its HTTP response
# sets the worker deadline: 10s with queued work, 60s when idle. The worker's
# lock and persisted backoff still prevent overlaps and retry storms.
start_cleanup_loop
trap 'kill "$cleanup_pid" 2>/dev/null; exit 0' INT TERM

# Запамʼятовуємо саме календарну хвилину, а не просто робимо sleep 60.
# Якщо повільна другорядна задача перетнула межу хвилини, цикл одразу
# виконає новий tick замість того, щоб проспати його до наступної межі.
last_tick=""

while true; do
  tick=$(date -u '+%Y%m%d%H%M')
  if [ "$tick" = "$last_tick" ]; then
    nap $((60 - $(date -u +%-S)))
    continue
  fi
  last_tick="$tick"
  minute=$(date -u +%-M)
  minute=${minute:-1}
  beat dispatcher
  # Самонагляд: якщо цикл cleanup загинув, піднімаємо його знову, а не
  # чекаємо ручного рестарту контейнера.
  if ! kill -0 "$cleanup_pid" 2>/dev/null; then
    log "цикл member-cleanup зупинився — перезапуск"
    start_cleanup_loop
  fi

  # Новий учасник має отримати приватний onboarding максимально швидко.
  # Endpoint сам тримає baseline/ідемпотентний стан, тому повторний tick не
  # дублює DM і не запускає повторну первинну перевірку ніку.
  call "/api/dashboard/discord/onboarding/automation"
  call "/api/dashboard/discord/profile-nicknames/automation"
  call "/api/dashboard/discord/applications/automation"
  # Найчутливіша до часу рейдова задача. Звичайний tick читає тільки dueAtMs
  # із task queue; hourly sweep лише ремонтує/звіряє task plan для legacy або
  # пропущених записів і потім обробляє due tasks.
  if [ "$minute" -eq 0 ]; then
    call "/api/raids/lifecycle?sweep=1&limit=100"
  else
    call "/api/raids/lifecycle"
  fi

  call "/api/polls/close-due?force=1"

  # Власний VPS дозволяє тримати склад актуальним без browser-driven sync.
  # Це важлива, але не секундно-критична задача, тому запускається після raid lifecycle.
  call "/api/guild/sync"

  call "/api/dashboard/logs/maintenance"

  # Scheduler акаунтів сам читає збережені налаштування і вирішує,
  # чи настав час dry-run перевірки або реального очищення.
  call "/api/dashboard/profiles/orphan-cleanup"
  call "/api/dashboard/discord/nicknames/automation"

  # Якщо задачі завершилися в тій самій хвилині — спимо до наступної межі.
  # Якщо вони вже перейшли в нову хвилину — не спимо: наступна ітерація
  # одразу обробить пропущений tick (last_tick відрізнятиметься).
  current_tick=$(date -u '+%Y%m%d%H%M')
  if [ "$current_tick" = "$last_tick" ]; then
    nap $((60 - $(date -u +%-S)))
  fi
done
