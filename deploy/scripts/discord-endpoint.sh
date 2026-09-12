#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

MODE="check"
[ "${1:-}" = "--fix" ] && MODE="fix"

BOLD=$'\033[1m'; GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[1;31m'; RESET=$'\033[0m'
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() { printf '  %s✖%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

env_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 1
  sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" \
    | tail -n1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
}

PUBLIC_URL="$(env_get .env DASHBOARD_PUBLIC_URL || true)"
[ -n "$PUBLIC_URL" ] || PUBLIC_URL="$(env_get dashboard/.env.production NEXT_PUBLIC_DASHBOARD_URL || true)"
[ -n "$PUBLIC_URL" ] || fail "DASHBOARD_PUBLIC_URL не знайдений."
EXPECTED="${PUBLIC_URL%/}/discord/interactions"

if ! docker compose ps --status running bot 2>/dev/null | grep -q bot; then
  fail "bot-контейнер не запущений. Спочатку make up."
fi

printf '%sDiscord Interactions Endpoint%s\n' "$BOLD" "$RESET"
printf '  Очікується: %s\n' "$EXPECTED"

set +e
OUTPUT="$(docker compose exec -T -e EXPECTED_INTERACTIONS_ENDPOINT="$EXPECTED" -e ENDPOINT_MODE="$MODE" bot node --input-type=module - <<'NODE'
const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
const expected = String(process.env.EXPECTED_INTERACTIONS_ENDPOINT || '').trim();
const mode = String(process.env.ENDPOINT_MODE || 'check');
if (!token) {
  console.error(JSON.stringify({ ok:false, error:'DISCORD_BOT_TOKEN missing in bot container' }));
  process.exit(2);
}
const headers = { authorization: `Bot ${token}`, 'content-type': 'application/json' };
const base = 'https://discord.com/api/v10/applications/@me';
try {
  let response = await fetch(base, { headers });
  const currentBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(JSON.stringify({ ok:false, error:`Discord GET ${response.status}`, body: currentBody }));
    process.exit(2);
  }
  const current = String(currentBody.interactions_endpoint_url || '');
  if (current === expected) {
    console.log(JSON.stringify({ ok:true, changed:false, current, expected }));
    process.exit(0);
  }
  if (mode !== 'fix') {
    console.log(JSON.stringify({ ok:false, mismatch:true, current, expected }));
    process.exit(3);
  }
  response = await fetch(base, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ interactions_endpoint_url: expected }),
  });
  const updated = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(JSON.stringify({ ok:false, error:`Discord PATCH ${response.status}`, body: updated, current, expected }));
    process.exit(4);
  }
  const actual = String(updated.interactions_endpoint_url || '');
  console.log(JSON.stringify({ ok: actual === expected, changed:true, current:actual, previous:current, expected }));
  process.exit(actual === expected ? 0 : 5);
} catch (error) {
  console.error(JSON.stringify({ ok:false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(2);
}
NODE
)"
STATUS=$?
set -e

# Parse only non-sensitive endpoint URLs. Token never leaves the container env.
CURRENT="$(printf '%s' "$OUTPUT" | sed -n 's/.*"current":"\([^"]*\)".*/\1/p' | tail -n1)"
PREVIOUS="$(printf '%s' "$OUTPUT" | sed -n 's/.*"previous":"\([^"]*\)".*/\1/p' | tail -n1)"

case "$STATUS" in
  0)
    if [ "$MODE" = "fix" ] && [ -n "$PREVIOUS" ]; then
      ok "endpoint переключено: ${PREVIOUS:-<порожньо>} → ${CURRENT:-$EXPECTED}"
    else
      ok "Discord уже використовує VPS endpoint: ${CURRENT:-$EXPECTED}"
    fi
    ;;
  3)
    warn "Discord зараз використовує ІНШИЙ endpoint: ${CURRENT:-<порожньо>}"
    warn "Це і є причина, чому кнопки можуть потрапляти у старий Vercel/Worker + Firestore."
    printf '  Виправити: make discord-endpoint-fix\n'
    exit 3
    ;;
  *)
    printf '%s\n' "$OUTPUT" >&2
    fail "Не вдалося перевірити/оновити Discord application endpoint."
    ;;
esac
