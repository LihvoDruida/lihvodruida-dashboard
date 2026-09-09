# Lihvo Druida Dashboard

Production dashboard and integration workspace for **Lihvo Druida / Mistblossom Vanguard**.

Canonical dashboard domain:

```text
https://dashboard.lihvodruida.pp.ua
```

The old `admin` route naming is kept only as legacy redirect compatibility. New code, environment variables, OAuth callbacks, Worker endpoints and documentation should use `dashboard` naming and `dashboard.lihvodruida.pp.ua`.

## Repository structure

| Path | Purpose |
|---|---|
| [`dashboard/`](dashboard/) | Next.js dashboard panel: profiles, raids, applications, Discord tools, logs, rules, content and guild roster. |
| [`bot/`](bot/) | Discord bot service: signature verification, instant ACK, routing interactions to the dashboard. Runs on our own server. |
| [`shared/`](shared/) | `@mistblossom/discord-contract`: shared `custom_id` parsing and component validation used by both the dashboard and the bot. |
| [`dashboard/docs/`](dashboard/docs/) | Internal dashboard documentation: functionality, API, environment variables and deployment. |
| [`deploy/`](deploy/) | Self-hosting artifacts: nginx, systemd units, cron and database backup scripts. |

## Main documents

### Dashboard

- [`dashboard/README.uk.md`](dashboard/README.uk.md) — Ukrainian dashboard overview, quick start and production variables.
- [`dashboard/README.md`](dashboard/README.md) — English dashboard overview.
- [`dashboard/docs/ua/FUNCTIONALITY.md`](dashboard/docs/ua/FUNCTIONALITY.md) — what the dashboard does and how the main modules behave.
- [`dashboard/docs/ua/API.md`](dashboard/docs/ua/API.md) — dashboard API routes and contracts.
- [`dashboard/docs/ua/ENVIRONMENT_VARIABLES.md`](dashboard/docs/ua/ENVIRONMENT_VARIABLES.md) — dashboard environment variables for local development and `.env.production`.
- [`dashboard/docs/ua/DEPLOYMENT.md`](dashboard/docs/ua/DEPLOYMENT.md) — service setup, OAuth callbacks and production checks.
- [`dashboard/docs/ua/SELF_HOSTING.md`](dashboard/docs/ua/SELF_HOSTING.md) — full self-hosting guide: Docker stack, Nginx, TLS, scheduled jobs, backups and rollback.
- [`dashboard/docs/ua/DASHBOARD_DOMAIN_AND_GITHUB_MOVE.md`](dashboard/docs/ua/DASHBOARD_DOMAIN_AND_GITHUB_MOVE.md) — changing the canonical domain: DNS, Nginx, TLS, env, OAuth and Worker endpoints.

### Worker

## Local dashboard start

```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

## Local bot development

```bash
cd bot
cp .env.example .env
npm install
npm start          # http://localhost:8080
npm test           # signature + contract tests
```

Do not commit real secrets from `.env.local`, `.env.production` or `bot/.env`.

## Required production direction

Use these names for new deployment settings:

```env
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua
```

Legacy `ADMIN_DASHBOARD_URL` aliases may remain only while old deployments still read them. They must point to the same `https://dashboard.lihvodruida.pp.ua` value.

## License

This project is proprietary. See [`LICENSE`](LICENSE).
