#!/usr/bin/env bash
# Build one service at a time, preserving the existing images on failure.
set -euo pipefail
cd "$(dirname "$0")/../.."

export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"
export COMPOSE_PARALLEL_LIMIT=1
if [ "$#" -eq 0 ]; then set -- dashboard bot; fi
for service in "$@"; do
  case "$service" in
    dashboard|bot) ;;
    *) printf 'Невідомий сервіс збірки: %s\n' "$service" >&2; exit 2 ;;
  esac
done

for service in "$@"; do
  printf '\n== Збірка %s ==\n' "$service"
  if docker compose build "$service"; then
    continue
  else
    build_status=$?
    printf '\nЗбірка %s не завершена (код %s). Перевіряю мережу хоста…\n' "$service" "$build_status" >&2
    bash deploy/scripts/network-check.sh || true
    printf '\nПісля виправлення мережі повторіть команду збірки. Документація: docs/BUILD_NETWORK.md\n' >&2
    exit "$build_status"
  fi
done
