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
# Задачі та розклад:
#   */2  * * * *  /api/guild/sync             — Battle.net + Raider.IO + raid progress у БД
#   *    * * * *  /api/raids/lifecycle        — дедлайни, 15-хв нагадування, Discord cleanup
#   */5  * * * *  /api/polls/close-due?force=1 — scheduled-публікація + автозакриття/повтор
#   */30 * * * *  /api/dashboard/logs/maintenance — retention/budget журналу
#   */15 * * * *  /api/dashboard/profiles/orphan-cleanup — scheduler перевірки/очищення акаунтів
#   */15 * * * *  /api/dashboard/discord/nicknames/automation — перевірка ніків + DM/fallback-попередження
# ---------------------------------------------------------------------------

set -eu

BASE="${DASHBOARD_INTERNAL_URL:-http://dashboard:3000}"
# Єдиний service-to-service токен. Compose передає сюди кореневий
# INTERNAL_API_TOKEN, який dashboard приймає на всіх internal routes.
TOKEN="${INTERNAL_CRON_TOKEN:?INTERNAL_CRON_TOKEN не заданий (очікується INTERNAL_API_TOKEN)}"

log() {
  echo "[cron $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

call() {
  path="$1"
  # --max-time тримає задачу в межах хвилини: якщо ендпоїнт завис,
  # наступний тік не має накладатися на попередній.
  code=$(curl --silent --show-error --output /tmp/cron-body \
              --write-out '%{http_code}' \
              --max-time 55 \
              --request POST \
              --header "Authorization: Bearer ${TOKEN}" \
              --header "Content-Type: application/json" \
              --data '{"source":"self-hosted-cron"}' \
              "${BASE}${path}" || echo "000")

  if [ "$code" = "200" ]; then
    log "OK   ${path}"
  else
    log "FAIL ${path} -> HTTP ${code}: $(head -c 200 /tmp/cron-body 2>/dev/null || true)"
  fi
}

log "старт; база=${BASE}"

# Запамʼятовуємо саме календарну хвилину, а не просто робимо sleep 60.
# Якщо повільна другорядна задача перетнула межу хвилини, цикл одразу
# виконає новий tick замість того, щоб проспати його до наступної межі.
last_tick=""

while true; do
  tick=$(date -u '+%Y%m%d%H%M')
  if [ "$tick" = "$last_tick" ]; then
    sleep $((60 - $(date -u +%-S)))
    continue
  fi
  last_tick="$tick"
  minute=$(date -u +%-M)

  # Найчутливіша до часу задача завжди йде першою. Так guild sync або
  # maintenance не можуть затримати закриття запису чи 15-хв reminder.
  # На початку години full sweep теж спершу бере near-date window і
  # пріоритезує актуальні close/reminder події над старим cleanup backlog.
  if [ "$minute" -eq 0 ]; then
    call "/api/raids/lifecycle?sweep=1&limit=100"
  else
    call "/api/raids/lifecycle"
  fi

  [ $((minute % 5)) -eq 0 ] && call "/api/polls/close-due?force=1"

  # Власний VPS дозволяє тримати склад актуальним без browser-driven sync.
  # Це важлива, але не секундно-критична задача, тому запускається після raid lifecycle.
  [ $((minute % 2)) -eq 0 ] && call "/api/guild/sync"

  [ $((minute % 30)) -eq 0 ] && call "/api/dashboard/logs/maintenance"

  # Scheduler акаунтів сам читає збережені налаштування і вирішує,
  # чи настав час dry-run перевірки або реального очищення.
  [ $((minute % 15)) -eq 0 ] && call "/api/dashboard/profiles/orphan-cleanup"
  [ $((minute % 15)) -eq 0 ] && call "/api/dashboard/discord/nicknames/automation"

  # Якщо задачі завершилися в тій самій хвилині — спимо до наступної межі.
  # Якщо вони вже перейшли в нову хвилину — не спимо: наступна ітерація
  # одразу обробить пропущений tick (last_tick відрізнятиметься).
  current_tick=$(date -u '+%Y%m%d%H%M')
  if [ "$current_tick" = "$last_tick" ]; then
    sleep $((60 - $(date -u +%-S)))
  fi
done
