# Environment variables and Cloudflare bindings

This is the complete list of variables and bindings used by the Worker code or required for dashboard integration.

## Importance levels

- **Required** — the related core flow does not work without it.
- **Recommended** — production should normally set it.
- **Optional** — has a fallback or is needed only for a specific feature.
- **Alias** — an alternative name also read by the Worker.
- **Dashboard shared** — the value must match or be coordinated with the admin dashboard.

## GitHub

| Name | Type | Required | Dashboard shared | Description |
|---|---|---:|---:|---|
| `GITHUB_TOKEN` | secret | Yes | If dashboard uses GitHub directly | GitHub token with access to Issues in the target repo. Required for create/list/update/close/comment. |
| `GITHUB_OWNER` | var | Yes | If dashboard uses GitHub directly | Repository owner, for example `LihvoDruida`. |
| `GITHUB_REPO` | var | Yes | If dashboard uses GitHub directly | Repository name, for example `lihvodruida.github.io`. |
| `GITHUB_USER_AGENT` | var | No | No | Custom GitHub API User-Agent. Defaults to `guild-applications-worker`. |
| `GUILD_APPLICATIONS_LABEL` | var | Recommended | If dashboard filters GitHub issues directly | Label used for application issues. Default: `guild-application`. |

## Public site / CORS / URLs

| Name | Type | Required | Dashboard shared | Description |
|---|---|---:|---:|---|
| `ALLOWED_ORIGINS` | var | Recommended | Yes | Comma-separated origins allowed to call the Worker. Should include public site and dashboard. |
| `SITE_BASE_URL` | var | Optional | No | Added to the origin allowlist. |
| `PUBLIC_SITE_URL` | var | Optional | No | Added to the origin allowlist. |
| `ADMIN_DASHBOARD_URL` | var | Recommended | Yes | Base dashboard URL. Used for links and default dashboard endpoints. |
| `DASHBOARD_URL` | var | Alias | Yes | Alias for `ADMIN_DASHBOARD_URL`. |

## Discord bot/interactions

| Name | Type | Required | Dashboard shared | Description |
|---|---|---:|---:|---|
| `DISCORD_BOT_TOKEN` | secret | Required for Discord messages/roles/channels | Usually no, unless dashboard also calls Discord directly | Bot token. Required for sending messages, updating roles, kicking members, and reading channels. |
| `DISCORD_PUBLIC_KEY` | secret/var | Required for `/api/discord-interactions` | No | Discord application public key for Ed25519 signature verification. |
| `DISCORD_GUILD_ID` | secret/var | Recommended | Yes | Discord server ID. Used for interactions, stats fallback, and channels endpoint. |
| `DISCORD_CHANNEL_ID` | secret/var | Required for application notifications | Maybe | Channel where the Worker posts new applications. |
| `DISCORD_GUILD_NAME` | var | Optional | Maybe | Guild/server name for embed footers. Default: `Mistblossom Vanguard`. |
| `DISCORD_ALLOWED_ROLES` | var | Optional | Maybe | Comma-separated role IDs allowed to accept/decline applications. Empty means no Worker-side role restriction for moderation buttons. |

## Rules statistics / tokens

| Name | Type | Required | Dashboard shared | Description |
|---|---|---:|---:|---|
| `RULES_STATS` | KV binding | Required for rules stats and raid-rules signups | No | Cloudflare KV namespace binding. Stores `rules:*` and `raid-rules:*`. |
| `DISCORD_RULES_STATS_TOKEN` | secret | Recommended | Yes | Shared token for dashboard reads and relay endpoints. When set, stats endpoints require bearer/token header. |
| `WORKER_STATS_TOKEN` | secret | Optional alias | Yes, if used instead of `DISCORD_RULES_STATS_TOKEN` | Alternative token for stats/message endpoints. |

## Dashboard profile lookup / raid integration

| Name | Type | Required | Dashboard shared | Description |
|---|---|---:|---:|---|
| `INTERNAL_PROFILE_LOOKUP_TOKEN` | secret | Required for raid-rules signup and raid attendance proxy | Yes | Shared server-to-server token between Worker and dashboard. Dashboard endpoint must verify it. |
| `DASHBOARD_PROFILE_LOOKUP_ENDPOINT` | var | Recommended | Yes | Full dashboard endpoint URL for Discord profile lookup. Default is built from `ADMIN_DASHBOARD_URL`: `/api/profile/discord-lookup`. |
| `ADMIN_PROFILE_LOOKUP_ENDPOINT` | var | Alias | Yes | Alias for `DASHBOARD_PROFILE_LOOKUP_ENDPOINT`. |
| `DASHBOARD_RAID_ACTION_ENDPOINT` | var | Recommended for raid announcement buttons | Contract with dashboard | Endpoint for raid attendance action. Supports `{raidId}` placeholder. Default: `/api/raids/<raidId>/discord-action`. |
| `RAID_RULES_URL` | var/secret | Recommended | Yes, if dashboard shows the same link | Discord message/page URL with raid rules. Used in help replies. |
| `DISCORD_RAID_RULES_URL` | var | Alias | Yes, if used in dashboard | Alias for `RAID_RULES_URL`. |
| `NEXT_PUBLIC_RAID_RULES_URL` | var | Alias | Yes, if dashboard exposes it client-side | Alias for `RAID_RULES_URL`; convenient for a Next.js dashboard. |

## Cloudflare Access service auth

Only needed when `admin.lihvodruida.pp.ua` or the profile lookup endpoint is protected by Cloudflare Access.

| Name | Type | Required | Dashboard shared | Description |
|---|---|---:|---:|---|
| `CF_ACCESS_CLIENT_ID` | secret | Required only with Cloudflare Access | Cloudflare Access config | Service Token Client ID. Worker sends `CF-Access-Client-Id`. |
| `CF_ACCESS_CLIENT_SECRET` | secret | Required only with Cloudflare Access | Cloudflare Access config | Service Token Client Secret. Worker sends `CF-Access-Client-Secret`. |
| `CLOUDFLARE_ACCESS_CLIENT_ID` | secret | Alias | Cloudflare Access config | Alias for `CF_ACCESS_CLIENT_ID`. |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | secret | Alias | Cloudflare Access config | Alias for `CF_ACCESS_CLIENT_SECRET`. |

## Debug / behavior

| Name | Type | Required | Dashboard shared | Description |
|---|---|---:|---:|---|
| `ALLOW_DEBUG_QUERY` | var | Recommended | No | Should be `0` in production. If `1`, `?debug=1` / `?diag=1` may show diagnostics. |
| `DEBUG_LOGS` | var | Optional | No | If `1`, the Worker logs more details for GitHub/Discord requests. |
| `DEBUG_RESPONSES` | var | Optional | No | If `1`, the Worker adds diagnostics to responses without query flags. Do not enable in production unless needed. |
| `APPLICATION_DISCORD_ASYNC` | var | Optional | No | `1` or unset — Discord notification via `ctx.waitUntil`; `0` — synchronous. |

## Recommended production set

```env
GITHUB_OWNER=LihvoDruida
GITHUB_REPO=lihvodruida.github.io
GUILD_APPLICATIONS_LABEL=guild-application
ALLOWED_ORIGINS=https://lihvodruida.pp.ua,https://www.lihvodruida.pp.ua,https://admin.lihvodruida.pp.ua
ADMIN_DASHBOARD_URL=https://admin.lihvodruida.pp.ua
DASHBOARD_PROFILE_LOOKUP_ENDPOINT=https://admin.lihvodruida.pp.ua/api/profile/discord-lookup
RAID_RULES_URL=https://discord.com/channels/<guild>/<channel>/<message>
ALLOW_DEBUG_QUERY=0
```

Secrets:

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_GUILD_ID
wrangler secret put DISCORD_CHANNEL_ID
wrangler secret put INTERNAL_PROFILE_LOOKUP_TOKEN
wrangler secret put DISCORD_RULES_STATS_TOKEN
```

KV binding:

```toml
[[kv_namespaces]]
binding = "RULES_STATS"
id = "paste_kv_namespace_id_here"
```

## Important checks

1. `DISCORD_GUILD_ID` must be the same in Worker and dashboard.
2. `INTERNAL_PROFILE_LOOKUP_TOKEN` must match in Worker and dashboard.
3. `DISCORD_RULES_STATS_TOKEN` must match in Worker and dashboard.
4. `ALLOWED_ORIGINS` must contain exact origins, without paths:
   - correct: `https://admin.lihvodruida.pp.ua`;
   - incorrect: `https://admin.lihvodruida.pp.ua/profile`.
5. If Cloudflare Access is enabled, `INTERNAL_PROFILE_LOOKUP_TOKEN` alone is not enough: also configure `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
