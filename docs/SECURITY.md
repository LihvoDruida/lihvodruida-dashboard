# Mistblossom Vanguard — security baseline and incident playbook

This document describes the production security assumptions enforced by the repository. The controls are defense-in-depth; none of them replaces OS patching, key hygiene, backups, or Cloudflare/OVH protections.

## Production trust boundaries

- Public browser traffic enters through Cloudflare and then nginx. nginx derives the trusted Cloudflare marker from the actual TCP peer, overwrites spoofable forwarding/geo headers, and rejects direct non-Cloudflare HTTPS peers.
- `dashboard`, `bot`, `cron`, and PostgreSQL are private Docker services. Dashboard, bot, and PostgreSQL must not publish their application/database ports on the host.
- Bot/cron internal calls use `INTERNAL_API_TOKEN`; route handlers verify the bearer token even when the request came from the private Docker hostname.
- Privileged browser mutations require an authenticated session/permission and same-origin provenance. Discord interactions require an Ed25519 signature and bounded request age/body size.
- PostgreSQL is the durable source of dashboard state. Backups are custom-format dumps stored with mode `0600`, accompanied by SHA-256 checksums.

## Required production settings

The effective root `.env` defaults are intentionally fail-closed:

```env
SECURITY_REQUIRE_CLOUDFLARE=strict
SECURITY_STRICT_ORIGIN_CHECKS=true
NEXT_SECURITY_VERSION=16.3.5
REACT_SECURITY_VERSION=19.2.8
SHARP_SECURITY_VERSION=0.35.4
```

`make up` rejects explicit insecure overrides. Real `.env` files are automatically tightened to mode `0600` during deploy preflight.

## Dependency security overlay

The lock file remains the reproducible baseline. The Docker dependency stage overlays approved patched versions of Next.js, React/React DOM and Sharp **before** `build:ci`; `security:runtime` verifies the installed packages and refuses the build if a known-vulnerable floor is present. Do not serve a plain local `npm ci` install without the approved overlay.

Container base images are version-pinned where security/reproducibility matters. Avoid changing an image to `latest`.

## Host audit

Run after deployment and after OS/network changes:

```bash
make security-audit
```

The read-only audit checks secret/backup permissions, direct container port publication, host listeners, Cloudflare/Origin settings, firewall/fail2ban/update state, effective SSH policy, pending reboot, and DB least-privilege warnings.

### SSH hardening

The production host should use key-only SSH. Never disable password login until key login has been tested in a second terminal. After that validation:

```bash
sudo CONFIRM_SSH_KEY_WORKS=1 ./deploy/scripts/harden-host.sh --apply
```

The helper disables root/password/keyboard-interactive SSH, enables fail2ban and unattended security updates, and configures UFW so HTTP/HTTPS are accepted only from the Cloudflare CIDRs listed in `deploy/nginx/nginx.conf`. Re-run the helper after intentionally updating that CIDR list. Keep the original SSH session open until a fresh key-only login succeeds.

Membership in the `docker` group is effectively root-equivalent. Protect that account and private key accordingly.

## Backup and restore

Create a backup before security-sensitive schema/config changes:

```bash
make backup
```

Backups are serialized with `flock`, written atomically through a private temporary file, validated with `pg_restore --list`, and checksummed. Restore verifies the sidecar checksum (when present), validates the archive before downtime and restarts dashboard/cron even if restore fails.

Keep an off-host encrypted copy. A local backup does not protect against VPS loss or account compromise.

## Secret rotation

Rotate immediately if a secret may have appeared in logs, screenshots, shell history, Git, CI artifacts, a leaked archive, or an unauthorized session. Relevant credentials include:

- `SESSION_SECRET` (rotating logs out all dashboard sessions);
- `INTERNAL_API_TOKEN`;
- Discord bot token, OAuth client secret and application credentials;
- GitHub content/API token;
- Battle.net client secret;
- emergency `ADMIN_DASHBOARD_TOKEN` (normally leave empty);
- PostgreSQL password (change the database role first, then update env files).

Do not merely change `POSTGRES_PASSWORD` in `.env` on an existing volume; that does not update the already-created PostgreSQL role.

## Incident response

If compromise is suspected:

1. Preserve logs and take a database backup/snapshot before destructive cleanup when safe to do so.
2. Revoke/rotate external tokens first (Discord/GitHub/OAuth), then internal/session secrets.
3. Terminate unauthorized sessions and disable emergency token login.
4. Inspect `docker compose ps`, `docker compose logs`, `journalctl`, SSH auth logs, `ss -lntup`, crontabs/systemd timers, authorized keys, and recently changed files.
5. Rebuild containers from a known-good commit; do not trust a possibly modified running filesystem.
6. Restore data only from a checksum-verified backup known to predate compromise.
7. If root/SSH/Docker access was compromised, rebuild the VPS from a clean image rather than attempting to “clean” it in place.

## Residual risks / operator actions

- The web application currently uses the bootstrap PostgreSQL identity unless you migrate `DATABASE_URL` to a dedicated least-privilege role. `make security-audit` warns when it detects this. Do that migration deliberately with a tested rollback; do not strip privileges from the production role blindly.
- Cloudflare protects HTTP(S), not SSH. SSH key-only auth, firewalling and fail2ban remain required.
- Local backups alone are insufficient. Maintain encrypted off-host backups and test restore periodically.
