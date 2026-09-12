#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

BOLD=$'\033[1m'; GREEN=$'\033[1;32m'; RED=$'\033[1;31m'; RESET=$'\033[0m'
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
fail() { printf '  %s✖%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

printf '%sInternal API auth%s\n' "$BOLD" "$RESET"

# Bot has Node already; verify exactly the token that runtime dashboardClient/logger use.
if docker compose exec -T bot node --input-type=module - <<'NODE'
const token = String(process.env.INTERNAL_API_TOKEN || '').trim();
if (!token) process.exit(2);
const r = await fetch('http://dashboard:3000/api/internal/health', {
  headers: { authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(5000),
});
if (!r.ok) {
  console.error(await r.text().catch(() => `HTTP ${r.status}`));
  process.exit(3);
}
const data = await r.json();
if (!data?.ok) process.exit(4);
console.log(JSON.stringify(data));
NODE
then
  ok "bot → dashboard: INTERNAL_API_TOKEN прийнято"
else
  fail "bot → dashboard: INTERNAL_API_TOKEN не збігається"
fi

# Cron uses curl and INTERNAL_CRON_TOKEN; Compose maps it from the same root token.
if docker compose exec -T cron sh -lc \
  'curl --silent --show-error --fail --max-time 5 --header "Authorization: Bearer $INTERNAL_CRON_TOKEN" http://dashboard:3000/api/internal/health >/dev/null'
then
  ok "cron → dashboard: INTERNAL_API_TOKEN прийнято"
else
  fail "cron → dashboard: INTERNAL_CRON_TOKEN не збігається з dashboard"
fi

