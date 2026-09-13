#!/usr/bin/env bash
# Read-only production host/security audit for Mistblossom Vanguard.
set -euo pipefail

cd "$(dirname "$0")/../.."

GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[1;31m'; RESET=$'\033[0m'
PASS=0; WARN=0; FAIL=0
pass(){ printf '%s[OK]%s %s\n' "$GREEN" "$RESET" "$*"; PASS=$((PASS+1)); }
warn(){ printf '%s[WARN]%s %s\n' "$YELLOW" "$RESET" "$*"; WARN=$((WARN+1)); }
fail(){ printf '%s[FAIL]%s %s\n' "$RED" "$RESET" "$*"; FAIL=$((FAIL+1)); }

mode_of(){ stat -c '%a' "$1" 2>/dev/null || echo '?'; }
env_get(){ local file="$1" key="$2"; [ -f "$file" ] || return 1; sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" | tail -n1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'; }

printf 'Mistblossom host security audit — %s\n\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Secrets and backup confidentiality.
for f in .env dashboard/.env.production bot/.env.production; do
  if [ ! -f "$f" ]; then fail "Missing secret/config file: $f"; continue; fi
  m="$(mode_of "$f")"
  case "$m" in 600|400) pass "$f permissions: $m" ;; *) fail "$f permissions are $m; expected 600 or 400" ;; esac
done

backup_dir="${BACKUP_DIR:-./backups}"
if [ -d "$backup_dir" ]; then
  dm="$(mode_of "$backup_dir")"
  case "$dm" in 700) pass "backup directory permissions: $dm" ;; *) fail "backup directory $backup_dir permissions are $dm; expected 700" ;; esac
  bad_backup="$(find "$backup_dir" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sha256' \) -perm /077 -print -quit 2>/dev/null || true)"
  [ -z "$bad_backup" ] && pass 'backup files are private' || fail "backup file is group/world accessible: $bad_backup"
else
  warn "backup directory does not exist yet: $backup_dir"
fi

cf="$(env_get .env SECURITY_REQUIRE_CLOUDFLARE || true)"; cf="${cf:-strict}"
origin="$(env_get .env SECURITY_STRICT_ORIGIN_CHECKS || true)"; origin="${origin:-true}"
[ "$cf" = strict ] && pass 'Cloudflare requirement is strict' || fail "SECURITY_REQUIRE_CLOUDFLARE=$cf (expected strict)"
case "${origin,,}" in true|1|yes|on) pass 'strict Origin/Referer checks enabled' ;; *) fail "SECURITY_STRICT_ORIGIN_CHECKS=$origin (expected true)" ;; esac

# Containers must not publish private application/database ports.
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  for spec in 'dashboard 3000' 'bot 8080' 'postgres 5432'; do
    set -- $spec
    out="$(docker compose port "$1" "$2" 2>/dev/null || true)"
    [ -z "$out" ] && pass "$1:$2 is not published to the host" || fail "$1:$2 is publicly published: $out"
  done
else
  warn 'docker compose unavailable; container port audit skipped'
fi

# Host listeners. Localhost-only listeners are fine; public listeners outside SSH/HTTP(S) need review.
if command -v ss >/dev/null 2>&1; then
  unexpected="$(ss -H -lnt 2>/dev/null | awk '{ addr=$4; n=split(addr,a,":"); port=a[n]+0; if (port!=22 && port!=80 && port!=443 && addr !~ /^127\.0\.0\.1:/ && addr !~ /^\[?::1\]?:/) print addr }' || true)"
  [ -z "$unexpected" ] && pass 'no unexpected public TCP listeners detected' || warn "review additional listeners: $(echo "$unexpected" | tr '\n' ' ')"
else
  warn 'ss unavailable; listener audit skipped'
fi

# Firewall / intrusion prevention / unattended security updates.
if command -v ufw >/dev/null 2>&1; then
  ufw_text="$(ufw status 2>/dev/null || true)"
  grep -q '^Status: active' <<<"$ufw_text" && pass 'UFW firewall is active' || warn 'UFW firewall is not active'
  if grep -Eq '^(80|443)/tcp[[:space:]]+ALLOW[[:space:]]+Anywhere' <<<"$ufw_text"; then
    fail 'UFW allows direct public HTTP/HTTPS; production origin should accept those ports only from Cloudflare CIDRs'
  elif grep -q '^Status: active' <<<"$ufw_text"; then
    pass 'UFW has no generic public 80/443 allow rule'
  fi
else
  warn 'UFW is not installed'
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active --quiet fail2ban 2>/dev/null && pass 'fail2ban is active' || warn 'fail2ban is not active'
  systemctl is-enabled --quiet unattended-upgrades 2>/dev/null && pass 'unattended-upgrades is enabled' || warn 'unattended-upgrades is not enabled'
fi

# SSH effective policy. Password login is considered a high-risk finding because the VPS is internet-facing.
if command -v sshd >/dev/null 2>&1; then
  ssh_cfg="$(sshd -T 2>/dev/null || true)"
  if [ -n "$ssh_cfg" ]; then
    grep -qi '^permitrootlogin no$' <<<"$ssh_cfg" && pass 'SSH root login disabled' || fail 'SSH PermitRootLogin is not no'
    grep -qi '^passwordauthentication no$' <<<"$ssh_cfg" && pass 'SSH password authentication disabled' || fail 'SSH PasswordAuthentication is not no'
    grep -qi '^kbdinteractiveauthentication no$' <<<"$ssh_cfg" && pass 'SSH keyboard-interactive authentication disabled' || fail 'SSH KbdInteractiveAuthentication is not no'
    grep -qi '^pubkeyauthentication yes$' <<<"$ssh_cfg" && pass 'SSH public-key authentication enabled' || fail 'SSH PubkeyAuthentication is not yes'
  else
    warn 'could not read effective sshd configuration (run with sudo for a complete audit)'
  fi
else
  warn 'sshd command unavailable; SSH audit skipped'
fi

home_dir="${HOME:-}"
if [ -n "$home_dir" ] && [ -s "$home_dir/.ssh/authorized_keys" ]; then
  pass "authorized_keys exists for $(id -un)"
else
  warn "no non-empty $home_dir/.ssh/authorized_keys; do not disable SSH passwords until key login is verified"
fi

if [ -f /var/run/reboot-required ]; then warn 'system reboot is required for installed updates'; else pass 'no pending reboot marker'; fi

# Application DB using the bootstrap POSTGRES_USER is functional but gives the web app excessive DB privileges.
db_user="$(env_get .env POSTGRES_USER || true)"; db_user="${db_user:-mistblossom}"
app_url="$(env_get dashboard/.env.production DATABASE_URL || true)"
if [ -n "$app_url" ] && [[ "$app_url" == *"://${db_user}:"* ]]; then
  warn "application DATABASE_URL uses POSTGRES_USER '$db_user'; migrate to a dedicated non-superuser app role for least privilege"
else
  pass 'application DB identity is separated from the bootstrap POSTGRES_USER (or could not be matched)'
fi

if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
  warn 'current user belongs to docker group; docker access is effectively root-equivalent — protect this account/SSH key accordingly'
fi

printf '\nSummary: %d OK · %d WARN · %d FAIL\n' "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
