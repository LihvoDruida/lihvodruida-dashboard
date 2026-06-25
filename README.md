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
| [`workers/guild-applications-worker/`](workers/guild-applications-worker/) | Cloudflare Worker for guild applications, Discord interactions, raid/rules buttons, stats, Worker-side cache and scheduled raid lifecycle calls. |
| [`dashboard/docs/`](dashboard/docs/) | Internal dashboard documentation: functionality, API, environment variables and deployment. |
| [`workers/guild-applications-worker/docs/`](workers/guild-applications-worker/docs/) | Internal Worker documentation: endpoints, variables, bindings, dashboard contracts and deployment. |

## Main documents

### Dashboard

- [`dashboard/README.uk.md`](dashboard/README.uk.md) — Ukrainian dashboard overview, quick start and production variables.
- [`dashboard/README.md`](dashboard/README.md) — English dashboard overview.
- [`dashboard/docs/ua/FUNCTIONALITY.md`](dashboard/docs/ua/FUNCTIONALITY.md) — what the dashboard does and how the main modules behave.
- [`dashboard/docs/ua/API.md`](dashboard/docs/ua/API.md) — dashboard API routes and contracts.
- [`dashboard/docs/ua/ENVIRONMENT_VARIABLES.md`](dashboard/docs/ua/ENVIRONMENT_VARIABLES.md) — dashboard environment variables for Vercel/local development.
- [`dashboard/docs/ua/DEPLOYMENT.md`](dashboard/docs/ua/DEPLOYMENT.md) — deployment checklist for Vercel, OAuth callbacks and production checks.
- [`dashboard/docs/ua/DASHBOARD_DOMAIN_AND_GITHUB_MOVE.md`](dashboard/docs/ua/DASHBOARD_DOMAIN_AND_GITHUB_MOVE.md) — migration guide for `admin` → `dashboard` naming, DNS, Vercel domains and reconnecting a new GitHub repository without creating a new Vercel project.

### Worker

- [`workers/guild-applications-worker/README.ua.md`](workers/guild-applications-worker/README.ua.md) — Ukrainian Worker overview and quick deployment notes.
- [`workers/guild-applications-worker/README.md`](workers/guild-applications-worker/README.md) — English Worker overview.
- [`workers/guild-applications-worker/docs/ua/FUNCTIONALITY.md`](workers/guild-applications-worker/docs/ua/FUNCTIONALITY.md) — Worker feature map and processing flows.
- [`workers/guild-applications-worker/docs/ua/API.md`](workers/guild-applications-worker/docs/ua/API.md) — Worker routes and request/response behavior.
- [`workers/guild-applications-worker/docs/ua/VARIABLES.md`](workers/guild-applications-worker/docs/ua/VARIABLES.md) — Cloudflare Worker variables, secrets and KV bindings.
- [`workers/guild-applications-worker/docs/ua/DASHBOARD_SHARED_VARIABLES.md`](workers/guild-applications-worker/docs/ua/DASHBOARD_SHARED_VARIABLES.md) — exact values and endpoint contracts that must match between Dashboard and Worker.
- [`workers/guild-applications-worker/docs/ua/DEPLOYMENT.md`](workers/guild-applications-worker/docs/ua/DEPLOYMENT.md) — Worker deployment checklist.

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

## Local Worker development

```bash
cd workers/guild-applications-worker
cp .dev.vars.example .dev.vars
wrangler dev
```

Do not commit real secrets from `.env.local`, `.dev.vars`, Vercel, Cloudflare or Discord.

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
