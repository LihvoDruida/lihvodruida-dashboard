#!/usr/bin/env bash
# Explicit host hardening helper. It intentionally refuses to change SSH until
# the operator confirms a working key-based login in a second terminal.
set -euo pipefail

if [ "${1:-}" != "--apply" ]; then
  cat <<'TXT'
Usage: sudo CONFIRM_SSH_KEY_WORKS=1 ./deploy/scripts/harden-host.sh --apply

Before running:
  1. Add your public key to ~/.ssh/authorized_keys.
  2. Open a SECOND terminal and verify you can log in using that key.
  3. Only then set CONFIRM_SSH_KEY_WORKS=1 and run this command.

The script disables SSH passwords/root login, enables UFW, fail2ban and
unattended security updates. It does not alter Docker/application secrets.
TXT
  exit 2
fi
[ "${EUID:-$(id -u)}" -eq 0 ] || { echo 'Run as root via sudo.' >&2; exit 1; }
[ "${CONFIRM_SSH_KEY_WORKS:-0}" = 1 ] || { echo 'Refusing: verify key login in a second terminal, then set CONFIRM_SSH_KEY_WORKS=1.' >&2; exit 1; }

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
target_user="${SUDO_USER:-ubuntu}"
home_dir="$(getent passwd "$target_user" | cut -d: -f6)"
[ -n "$home_dir" ] && [ -s "$home_dir/.ssh/authorized_keys" ] || { echo "Refusing: $target_user has no non-empty authorized_keys." >&2; exit 1; }
chmod 700 "$home_dir/.ssh"
chmod 600 "$home_dir/.ssh/authorized_keys"
chown -R "$target_user:$target_user" "$home_dir/.ssh"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ufw fail2ban unattended-upgrades

# OpenSSH uses the first obtained value for many global options. Ubuntu cloud
# images commonly ship 50-cloud-init.conf with PasswordAuthentication yes, so a
# 99-* drop-in can be too late. Use 00-* and verify the effective config before
# reloading. Keep a backup of an older Mistblossom drop-in for rollback only.
install -d -m 755 /etc/ssh/sshd_config.d
if [ -f /etc/ssh/sshd_config.d/99-mistblossom-hardening.conf ]; then
  mv -f /etc/ssh/sshd_config.d/99-mistblossom-hardening.conf \
    /etc/ssh/sshd_config.d/99-mistblossom-hardening.conf.disabled
fi
cat >/etc/ssh/sshd_config.d/00-mistblossom-hardening.conf <<CFG
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
MaxAuthTries 4
LoginGraceTime 30
AllowUsers $target_user
CFG
chmod 600 /etc/ssh/sshd_config.d/00-mistblossom-hardening.conf

sshd -t
ssh_effective="$(sshd -T)"
for expected in \
  'permitrootlogin no' \
  'passwordauthentication no' \
  'kbdinteractiveauthentication no' \
  'pubkeyauthentication yes'; do
  if ! grep -Fqi "$expected" <<<"$ssh_effective"; then
    echo "Refusing to reload sshd: effective config does not contain '$expected'." >&2
    echo 'Conflicting active SSH directives:' >&2
    grep -RniE '^[[:space:]]*(PermitRootLogin|PasswordAuthentication|KbdInteractiveAuthentication|ChallengeResponseAuthentication|PubkeyAuthentication|Include)[[:space:]]+' \
      /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null >&2 || true
    exit 1
  fi
done
systemctl reload ssh || systemctl reload sshd

ufw default deny incoming
ufw default allow outgoing
ufw limit OpenSSH

# Remove only generic public web allows that bypass Cloudflare. Source-specific
# Cloudflare rules are not matched by these generic delete specifications.
for spec in '80/tcp' '443/tcp' '80' '443'; do
  ufw --force delete allow "$spec" >/dev/null 2>&1 || true
done
for profile in 'Nginx Full' 'Nginx HTTP' 'Nginx HTTPS'; do
  ufw --force delete allow "$profile" >/dev/null 2>&1 || true
done

# The site is intentionally Cloudflare-only. Reuse the exact CIDRs from the
# nginx geo trust block so the host firewall and application edge cannot drift.
mapfile -t cloudflare_ranges < <(awk '
  /geo \$realip_remote_addr \$mistblossom_from_cloudflare/ { inside=1; next }
  inside && /^[[:space:]]*}/ { exit }
  inside && $2 == "1;" { print $1 }
' "$repo_root/deploy/nginx/nginx.conf")
[ "${#cloudflare_ranges[@]}" -ge 20 ] || { echo 'Refusing: could not extract the expected Cloudflare CIDR list from nginx.conf.' >&2; exit 1; }
for cidr in "${cloudflare_ranges[@]}"; do
  ufw allow proto tcp from "$cidr" to any port 80 comment 'Cloudflare HTTP'
  ufw allow proto tcp from "$cidr" to any port 443 comment 'Cloudflare HTTPS'
done
ufw --force enable

# Verify there is no remaining generic public HTTP/HTTPS rule. Check the common
# explicit-port forms and UFW's Nginx application profiles.
ufw_text="$(ufw status)"
if grep -Eq '^(80|443)(/tcp)?[[:space:]]+ALLOW[[:space:]]+(IN[[:space:]]+)?Anywhere' <<<"$ufw_text" \
  || grep -Eq '^Nginx (Full|HTTP|HTTPS)[[:space:]]+ALLOW[[:space:]]+(IN[[:space:]]+)?Anywhere' <<<"$ufw_text"; then
  echo 'Refusing to report success: a generic public HTTP/HTTPS UFW rule still exists.' >&2
  ufw status numbered >&2 || true
  exit 1
fi

cat >/etc/fail2ban/jail.d/mistblossom-sshd.local <<'CFG'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 1d
CFG
systemctl enable --now fail2ban
systemctl restart fail2ban

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CFG'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CFG
systemctl enable --now unattended-upgrades.service 2>/dev/null || true

echo 'Host hardening applied and verified. KEEP THIS SSH SESSION OPEN and test a fresh key-only login now.'
