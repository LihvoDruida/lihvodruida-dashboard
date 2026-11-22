#!/bin/sh
# Docker healthcheck cron-контейнера: диспетчер (calendar-minute loop) і цикл
# member-cleanup мають оновлювати heartbeat не рідше ніж раз на 3 хвилини.
state_dir="${CRON_STATE_DIR:-/tmp/mistblossom-cron}"
max_age="${CRON_HEARTBEAT_MAX_AGE:-180}"
now=$(date +%s)
for name in dispatcher cleanup; do
  beat=$(cat "$state_dir/$name.alive" 2>/dev/null || echo 0)
  case "$beat" in ''|*[!0-9]*) beat=0 ;; esac
  if [ $((now - beat)) -ge "$max_age" ]; then
    echo "heartbeat $name застарів"
    exit 1
  fi
done
exit 0
