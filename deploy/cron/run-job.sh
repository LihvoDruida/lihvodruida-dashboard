#!/bin/sh
# One independent worker per task. Only a task's own previous run can delay it.
set -eu
path="$1"
interval="$2"
key="$3"
BASE="${DASHBOARD_INTERNAL_URL:-http://dashboard:3000}"
TOKEN="${INTERNAL_CRON_TOKEN:?INTERNAL_CRON_TOKEN не заданий}"
state_dir="${CRON_STATE_DIR:-/tmp/mistblossom-cron}"
mkdir -p "$state_dir"
lock="$state_dir/$key.lock"
if ! mkdir "$lock" 2>/dev/null; then
  # Workers always remove their lock in EXIT; recover SIGKILL after curl's bound.
  modified=$(cat "$lock/started" 2>/dev/null || echo 0)
  if [ "$modified" -gt 0 ] && [ $(($(date +%s) - modified)) -gt 180 ]; then
    rm -rf "$lock"
    mkdir "$lock" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
date +%s > "$lock/started"
trap 'rm -rf "$lock"' EXIT
trap 'exit 0' INT TERM
now=$(date +%s)
due=$(cat "$state_dir/$key.next" 2>/dev/null || echo 0)
[ "$now" -ge "$due" ] || exit 0
# Hourly recovery is based on a persisted deadline, so a busy exact-hour tick
# cannot silently skip the full raid task queue reconciliation (dueAtMs).
if [ "$key" = "raid-lifecycle" ]; then
  sweep_due=$(cat "$state_dir/$key.sweep" 2>/dev/null || echo 0)
  if [ "$now" -ge "$sweep_due" ]; then path="/api/raids/lifecycle?sweep=1&limit=100"; fi
fi
body_file="$lock/body"
: > "$body_file"
set +e
code=$(curl --silent --show-error --output "$body_file" --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 55 --request POST \
  --header "Authorization: Bearer ${TOKEN}" --header "Content-Type: application/json" \
  --data '{"source":"self-hosted-cron"}' "${BASE}${path}")
curl_status=$?
set -e
[ "$curl_status" -eq 0 ] || code="000"
stamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
if [ "$code" = "200" ]; then
  echo "[cron $stamp] OK   $path"
  echo 0 > "$state_dir/$key.failures"
  echo $((now + interval)) > "$state_dir/$key.next"
  case "$path" in *sweep=1*) echo $((now + 3600)) > "$state_dir/$key.sweep" ;; esac
else
  failures=$(cat "$state_dir/$key.failures" 2>/dev/null || echo 0)
  failures=$((failures + 1))
  [ "$failures" -le 5 ] || failures=5
  delay=$((30 * (1 << failures)))
  [ "$delay" -le 900 ] || delay=900
  echo "$failures" > "$state_dir/$key.failures"
  echo $((now + delay)) > "$state_dir/$key.next"
  echo "[cron $stamp] FAIL $path -> HTTP $code; повтор через ${delay}s: $(head -c 200 "$body_file" 2>/dev/null || true)"
fi
