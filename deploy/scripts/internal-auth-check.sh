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

# Gateway bridge is a separate critical path from interaction auth. Verify that
# the bot actually received its token/guild config and surface privileged-intent
# failures immediately instead of waiting for the next real recruit.
if docker compose exec -T bot node --input-type=module - <<'NODE'
let gateway = null;
for (let attempt = 0; attempt < 8; attempt += 1) {
  const r = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(5000) });
  if (!r.ok) process.exit(2);
  const data = await r.json();
  gateway = data?.gateway || {};
  if (!gateway.enabled) {
    console.error('Discord Gateway disabled by DISCORD_GATEWAY_ENABLED');
    process.exit(3);
  }
  if (!gateway.configured) {
    console.error('Discord Gateway missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID');
    process.exit(4);
  }
  const error = String(gateway.lastError || '');
  if (/fatal close (4004|4010|4011|4013|4014)|\b4014\b/i.test(error)) {
    console.error(`Discord Gateway fatal: ${error}`);
    process.exit(5);
  }
  if (gateway.ready) break;
  if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 500));
}
console.log(JSON.stringify(gateway));
NODE
then
  ok "bot Gateway: конфігурація newcomer bridge присутня"
else
  fail "bot Gateway не готовий до newcomer events; перевір DISCORD_BOT_TOKEN, DISCORD_GUILD_ID і Server Members Intent"
fi

# Cron uses curl and INTERNAL_CRON_TOKEN; Compose maps it from the same root token.
if docker compose exec -T cron sh -lc \
  'curl --silent --show-error --fail --max-time 5 --header "Authorization: Bearer $INTERNAL_CRON_TOKEN" http://dashboard:3000/api/internal/health >/dev/null'
then
  ok "cron → dashboard: INTERNAL_API_TOKEN прийнято"
else
  fail "cron → dashboard: INTERNAL_CRON_TOKEN не збігається з dashboard"
fi

