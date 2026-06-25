# Environment variables і Cloudflare bindings

Це повний список змінних і bindings, які використовуються Worker-кодом або потрібні для інтеграції з dashboard.

## Рівні важливості

- **Required** — без цього відповідний core flow не працює.
- **Recommended** — production краще налаштувати.
- **Optional** — має fallback або потрібне тільки для частини функціоналу.
- **Alias** — альтернативна назва, яку Worker теж читає.
- **Dashboard shared** — значення має збігатися або бути узгодженим із admin dashboard.

## GitHub

| Name | Type | Required | Dashboard shared | Опис |
|---|---|---:|---:|---|
| `GITHUB_TOKEN` | secret | Yes | If dashboard uses GitHub directly | GitHub token з доступом до Issues потрібного repo. Потрібен для create/list/update/close/comment. |
| `GITHUB_OWNER` | var | Yes | If dashboard uses GitHub directly | Власник repo, наприклад `LihvoDruida`. |
| `GITHUB_REPO` | var | Yes | If dashboard uses GitHub directly | Назва repo, наприклад `lihvodruida.github.io`. |
| `GITHUB_USER_AGENT` | var | No | No | Custom User-Agent для GitHub API. Якщо не задано, Worker використовує `guild-applications-worker`. |
| `GUILD_APPLICATIONS_LABEL` | var | Recommended | If dashboard filters GitHub issues directly | Label для заявок. Default: `guild-application`. |

## Public site / CORS / URLs

| Name | Type | Required | Dashboard shared | Опис |
|---|---|---:|---:|---|
| `ALLOWED_ORIGINS` | var | Recommended | Yes | Comma-separated origins, які можуть викликати Worker. Має включати public site і dashboard. |
| `SITE_BASE_URL` | var | Optional | No | Додається до allowlist origins. |
| `PUBLIC_SITE_URL` | var | Optional | No | Додається до allowlist origins. |
| `ADMIN_DASHBOARD_URL` | var | Recommended | Yes | Базовий URL dashboard. Використовується для links і default dashboard endpoints. |
| `DASHBOARD_URL` | var | Alias | Yes | Alias для `ADMIN_DASHBOARD_URL`. |

## Discord bot/interactions

| Name | Type | Required | Dashboard shared | Опис |
|---|---|---:|---:|---|
| `DISCORD_BOT_TOKEN` | secret | Required for Discord messages/roles/channels | Usually no, unless dashboard also calls Discord directly | Bot token. Потрібен для sending messages, updating roles, kicking members, reading channels. |
| `DISCORD_PUBLIC_KEY` | secret/var | Required for `/api/discord-interactions` | No | Public key Discord application для Ed25519 signature verification. |
| `DISCORD_GUILD_ID` | secret/var | Recommended | Yes | Discord server ID. Використовується для interactions, stats fallback, channels endpoint. |
| `DISCORD_CHANNEL_ID` | secret/var | Required for application notifications | Maybe | Канал, куди Worker постить нові заявки. |
| `DISCORD_GUILD_NAME` | var | Optional | Maybe | Назва гільдії/server для footer embeds. Default: `Mistblossom Vanguard`. |
| `DISCORD_ALLOWED_ROLES` | var | Optional | Maybe | Comma-separated role IDs, яким дозволено accept/decline заявки. Якщо пусто — Worker не обмежує moderation buttons по ролях. |

## Rules statistics / tokens

| Name | Type | Required | Dashboard shared | Опис |
|---|---|---:|---:|---|
| `RULES_STATS` | KV binding | Required for rules stats and raid-rules signups | No | Cloudflare KV namespace binding. Зберігає `rules:*` і `raid-rules:*`. |
| `DISCORD_RULES_STATS_TOKEN` | secret | Recommended | Yes | Shared token для dashboard reads і relay endpoints. Коли заданий, stats endpoints вимагають bearer/token header. |
| `WORKER_STATS_TOKEN` | secret | Optional alias | Yes, if used instead of `DISCORD_RULES_STATS_TOKEN` | Альтернативний token для stats/message endpoints. |

## Dashboard profile lookup / raid integration

| Name | Type | Required | Dashboard shared | Опис |
|---|---|---:|---:|---|
| `INTERNAL_PROFILE_LOOKUP_TOKEN` | secret | Required for raid-rules signup and raid attendance proxy | Yes | Shared server-to-server token між Worker і dashboard. Dashboard endpoint має перевіряти цей token. |
| `DASHBOARD_PROFILE_LOOKUP_ENDPOINT` | var | Recommended | Yes | Повний URL dashboard endpoint для Discord profile lookup. Default будується з `ADMIN_DASHBOARD_URL`: `/api/profile/discord-lookup`. |
| `ADMIN_PROFILE_LOOKUP_ENDPOINT` | var | Alias | Yes | Alias для `DASHBOARD_PROFILE_LOOKUP_ENDPOINT`. |
| `DASHBOARD_RAID_ACTION_ENDPOINT` | var | Recommended for raid announcement buttons | Contract with dashboard | Endpoint для raid attendance action. Підтримує placeholder `{raidId}`. Default: `/api/raids/<raidId>/discord-action`. |
| `RAID_RULES_URL` | var/secret | Recommended | Yes, if dashboard also shows the same link | URL Discord message/page з правилами рейду. Використовується в help replies. |
| `DISCORD_RAID_RULES_URL` | var | Alias | Yes, if used in dashboard | Alias для `RAID_RULES_URL`. |
| `NEXT_PUBLIC_RAID_RULES_URL` | var | Alias | Yes, if dashboard exposes it client-side | Alias для `RAID_RULES_URL`; назва зручна для Next.js dashboard. |

## Cloudflare Access service auth

Потрібно тільки якщо `admin.lihvodruida.pp.ua` або profile lookup endpoint захищений Cloudflare Access.

| Name | Type | Required | Dashboard shared | Опис |
|---|---|---:|---:|---|
| `CF_ACCESS_CLIENT_ID` | secret | Required only with Cloudflare Access | Cloudflare Access config | Service Token Client ID. Worker надсилає header `CF-Access-Client-Id`. |
| `CF_ACCESS_CLIENT_SECRET` | secret | Required only with Cloudflare Access | Cloudflare Access config | Service Token Client Secret. Worker надсилає header `CF-Access-Client-Secret`. |
| `CLOUDFLARE_ACCESS_CLIENT_ID` | secret | Alias | Cloudflare Access config | Alias для `CF_ACCESS_CLIENT_ID`. |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | secret | Alias | Cloudflare Access config | Alias для `CF_ACCESS_CLIENT_SECRET`. |

## Debug / behavior

| Name | Type | Required | Dashboard shared | Опис |
|---|---|---:|---:|---|
| `ALLOW_DEBUG_QUERY` | var | Recommended | No | Має бути `0` у production. Якщо `1`, `?debug=1` / `?diag=1` можуть показувати diagnostics. |
| `DEBUG_LOGS` | var | Optional | No | Якщо `1`, Worker логує більше деталей для GitHub/Discord requests. |
| `DEBUG_RESPONSES` | var | Optional | No | Якщо `1`, Worker додає diagnostics у відповіді без query flag. Не вмикати в production без потреби. |
| `APPLICATION_DISCORD_ASYNC` | var | Optional | No | `1` або unset — Discord notification через `ctx.waitUntil`; `0` — синхронно. |

## Рекомендований production набір

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

## Важливі перевірки

1. `DISCORD_GUILD_ID` має бути однаковим у Worker і dashboard.
2. `INTERNAL_PROFILE_LOOKUP_TOKEN` має збігатися в Worker і dashboard.
3. `DISCORD_RULES_STATS_TOKEN` має збігатися в Worker і dashboard.
4. `ALLOWED_ORIGINS` має містити точні origins, без path:
   - правильно: `https://admin.lihvodruida.pp.ua`;
   - неправильно: `https://admin.lihvodruida.pp.ua/profile`.
5. Якщо Cloudflare Access увімкнений, одного `INTERNAL_PROFILE_LOOKUP_TOKEN` недостатньо: потрібні ще `CF_ACCESS_CLIENT_ID` і `CF_ACCESS_CLIENT_SECRET`.
