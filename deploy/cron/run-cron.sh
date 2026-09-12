#!/bin/sh
# ---------------------------------------------------------------------------
# Планові задачі панелі.
#
# На Vercel це були Cron Jobs у vercel.json. Тут — простий цикл у контейнері,
# який стукає у ті самі HTTP-ендпоїнти внутрішньою мережею.
#
# Чому не системний cron у контейнері: busybox crond у образі curl немає,
# а тягнути окремий образ заради трьох задач надлишково. Цикл із перевіркою
# хвилини робить те саме і легко читається в логах.
#
# Задачі та розклад:
#   */2  * * * *  /api/guild/sync             — Battle.net + Raider.IO + raid progress у БД
#   */10 * * * *  /api/raids/lifecycle        — публікація й закриття рейдів
#   */5  * * * *  /api/polls/close-due        — автозакриття рейд-пулів
#   */30 * * * *  /api/dashboard/logs/maintenance — retention/budget журналу
#   0    4 * * *  /api/dashboard/profiles/orphan-cleanup/apply — чистка акаунтів
# ---------------------------------------------------------------------------

set -eu

BASE="${DASHBOARD_INTERNAL_URL:-http://dashboard:3000}"
# Той самий CRON_SECRET, який перевіряє verifyInternalBearerToken
# у /api/raids/lifecycle і /api/polls/close-due.
TOKEN="${INTERNAL_CRON_TOKEN:?INTERNAL_CRON_TOKEN не заданий (це значення CRON_SECRET)}"

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

while true; do
  minute=$(date -u +%-M)
  hour=$(date -u +%-H)

  # Власний VPS дозволяє тримати склад актуальним без browser-driven sync.
  # Endpoint сам застосовує TTL, короткі батчі та Raider.IO cooldown.
  [ $((minute % 2)) -eq 0 ] && call "/api/guild/sync"
  [ $((minute % 10)) -eq 0 ] && call "/api/raids/lifecycle"
  [ $((minute % 5)) -eq 0 ] && call "/api/polls/close-due"
  [ $((minute % 30)) -eq 0 ] && call "/api/dashboard/logs/maintenance"

  # 04:00 за Києвом. Контейнер живе в UTC, тому рахуємо від TZ явно.
  kyiv_hour=$(TZ=Europe/Kyiv date +%-H)
  kyiv_minute=$(TZ=Europe/Kyiv date +%-M)
  if [ "$kyiv_hour" = "4" ] && [ "$kyiv_minute" = "0" ]; then
    call "/api/dashboard/profiles/orphan-cleanup/apply"
  fi

  # Спимо до початку наступної хвилини, а не рівно 60 секунд:
  # інакше дрейф поступово зсуває задачі повз потрібну хвилину.
  sleep $((60 - $(date +%-S)))
done
