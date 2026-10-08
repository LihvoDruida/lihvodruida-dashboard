#!/usr/bin/env bash
# Read-only VPS DNS/HTTPS diagnosis. Does not change resolvers or restart Docker.
set -euo pipefail

for tool in getent timeout curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Потрібен інструмент: %s\n' "$tool" >&2
    exit 2
  fi
done

failures=0
printf '\n== DNS та HTTPS хоста VPS (окремий BuildKit builder може мати свою мережу) ==\n'
for endpoint in \
  'auth.docker.io|https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull|200' \
  'registry-1.docker.io|https://registry-1.docker.io/v2/|401' \
  'registry.npmjs.org|https://registry.npmjs.org/|200' \
  'deb.debian.org|https://deb.debian.org/debian/|200'; do
  IFS='|' read -r host url expected <<< "$endpoint"
  if ! timeout 8 getent ahosts "$host" >/dev/null 2>&1; then
    printf 'FAIL DNS: %s — перевірте systemd-resolved і DNS провайдера.\n' "$host" >&2
    failures=$((failures + 1))
    continue
  fi
  printf 'OK DNS: %s\n' "$host"
  if status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 5 --max-time 12 "$url"); then
    if [ "$status" = "$expected" ]; then
      printf 'OK HTTPS: %s (HTTP %s)\n' "$host" "$status"
    else
      printf 'FAIL HTTPS: %s (HTTP %s, очікується %s)\n' "$host" "$status" "$expected" >&2
      failures=$((failures + 1))
    fi
  else
    printf 'FAIL HTTPS: %s — перевірте вихідну мережу, proxy, TLS та час VPS.\n' "$host" >&2
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  printf '\nПомилки мережі: %s. Інструкція: docs/BUILD_NETWORK.md\n' "$failures" >&2
  exit 1
fi
printf '\nDNS/HTTPS хоста доступні; це не перевірка завантаження Docker layers чи npm-пакетів.\n'
