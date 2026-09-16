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
#   *    * * * *  /api/raids/lifecycle        — per-record task queue: close/reminder/Discord cleanup
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
  body_file="/tmp/cron-body"
  : > "$body_file"
  # --max-time тримає задачу в межах хвилини: якщо ендпоїнт завис,
  # наступний тік не має накладатися на попередній. HTTP code не дублюємо:
  # curl при transport failure уже друкує 000 через --write-out.
  set +e
  code=$(curl --silent --show-error --output "$body_file" \
              --write-out '%{http_code}' \
              --max-time 55 \
              --request POST \
              --header "Authorization: Bearer ${TOKEN}" \
              --header "Content-Type: application/json" \
              --data '{"source":"self-hosted-cron"}' \
              "${BASE}${path}")
  curl_status=$?
  set -e
  [ "$curl_status" -eq 0 ] || code="000"

  if [ "$code" = "200" ]; then
    log "OK   ${path}"
  else
    log "FAIL ${path} -> HTTP ${code}: $(head -c 200 "$body_file" 2>/dev/null || true)"
  fi
}

log "старт; база=${BASE}"

# Після рестарту одразу відновлюємо/звіряємо per-raid task queue. Це закриває
# старі рейди, які були створені до появи task scheduler, не чекаючи початку
# наступної години. Після reconciliation цей же виклик обробляє вже due tasks.
call "/api/raids/lifecycle?sweep=1&limit=100"

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

  # Найчутливіша до часу задача завжди йде першою. Звичайний tick читає
  # тільки dueAtMs із task queue; hourly sweep лише ремонтує/звіряє task plan
  # для legacy або пропущених записів і потім обробляє due tasks.
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
