#!/usr/bin/env bash
# `make health`: стан healthcheck кожного довгоживучого сервісу.
# Код виходу 1, якщо хоч один сервіс не healthy.
set -uo pipefail
cd "$(dirname "$0")/../.."

status=0
for service in postgres dashboard bot nginx cron; do
  cid="$(docker compose ps -q "$service" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    state="missing"
  else
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
  fi
  printf '%-10s %s\n' "$service" "$state"
  [ "$state" = "healthy" ] || status=1
done
exit "$status"
