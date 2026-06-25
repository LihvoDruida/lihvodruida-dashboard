# Environment variables

All secrets must remain server-side. Values with `NEXT_PUBLIC_*` are exposed to the browser, so never put tokens, private keys, or OAuth secrets there.

## Minimal production set

A full production deployment usually needs: `SESSION_SECRET`, `DASHBOARD_URL`, `NEXT_PUBLIC_DASHBOARD_URL`, `DASHBOARD_ALLOWED_HOSTS`, `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_APPLICATIONS_COLLECTION`, `BATTLENET_CLIENT_ID`, `BATTLENET_CLIENT_SECRET`, `WOW_GUILD_NAME`, `RAID_RULES_URL`, `RAID_TIME_ZONE`, `NEXT_PUBLIC_RAID_TIME_ZONE`.

## Shared with Cloudflare Worker

Put values into Worker only when Worker actually owns the corresponding responsibility. If Worker handles Discord interactions, rules buttons, or raid buttons, some values must match between the dashboard and Worker.

| Variable | Status | Purpose | Worker |
|---|---|---|---|
| `DISCORD_PUBLIC_KEY` | required for interactions | Ed25519 Discord interaction signature verification. | Yes, if Worker receives interactions. |
| `DISCORD_BOT_TOKEN` | required for Discord REST | Roles, kicks, nickname sync, embeds, raid messages. | Yes, if Worker performs Discord REST. |
| `DISCORD_GUILD_ID` | required | Discord server id. | Yes, if Worker works with the guild. |
| `DISCORD_RULES_STATS_TOKEN` | optional shared secret | Protects stats/raid Worker endpoints. | Yes, must match. |
| `WORKER_STATS_TOKEN` | optional alias | Alias for shared Worker token. | Yes, must match. |
| `INTERNAL_PROFILE_LOOKUP_TOKEN` | required for lookup | Worker calls `/api/profile/discord-lookup` or raid action endpoint. | Yes, must match. |
| `DISCORD_ROLE_ASSIGN_CONCURRENCY` | optional | Role assignment concurrency. | If Worker assigns roles. |
| `DISCORD_ROLE_ASSIGN_MAX_CONCURRENCY` | optional | Max role assignment concurrency. | If Worker assigns roles. |
| `FIREBASE_PROJECT_ID` | required for applications | Firebase project id. | Yes, if Worker creates/moderates applications. |
| `FIREBASE_CLIENT_EMAIL` | required secret | Service account email. | Yes, if Worker creates/moderates applications. |
| `FIREBASE_PRIVATE_KEY` | required secret | Service account private key. | Yes, if Worker creates/moderates applications. |
| `FIREBASE_APPLICATIONS_COLLECTION` | optional | Firestore application collection, default `guildApplications`. | Yes, if you need a custom collection. |
| `RAID_RULES_URL` | conditional | Raid rules link in responses. | If Worker responds to raid buttons. |
| `RAID_TIME_ZONE` | conditional | Raid timezone. | If Worker builds Discord timestamps. |
| `DASHBOARD_URL` | conditional | Links back to the dashboard. | If Worker shows dashboard links. |

## Full variable list

### Core, session, security

| Variable | Requirement | Description |
|---|---|---|
| `SESSION_SECRET` | required | Secret for signing session cookies, minimum 32 characters. |
| `NEXTAUTH_SECRET` | alias | Legacy fallback for `SESSION_SECRET`. |
| `SESSION_MAX_AGE_SECONDS` | optional | Session lifetime, default 7 days, max 30 days. |
| `DASHBOARD_URL` | required | Canonical server-side dashboard URL. |
| `NEXT_PUBLIC_DASHBOARD_URL` | required | Public dashboard URL for the client. |
| `ADMIN_DASHBOARD_URL` | alias | Alias for raid route redirects. |
| `NEXT_PUBLIC_ADMIN_DASHBOARD_URL` | alias | Public alias for raid route redirects. |
| `NEXTAUTH_URL` | alias | Legacy fallback for dashboard URL. |
| `DASHBOARD_ALLOWED_HOSTS` | required | Comma-separated allowed hostnames. |
| `SECURITY_REQUIRE_CLOUDFLARE` | optional | true requires Cloudflare headers in production. |
| `SECURITY_STRICT_ORIGIN_CHECKS` | optional | Extra origin checks; enable carefully. |
| `SECURITY_HSTS_HEADER` | optional | Custom HSTS value. |
| `DASHBOARD_DEBUG_LOGS` | optional | Verbose dashboard logs. |
| `SECURITY_DEBUG_LOGS` | optional | Verbose security logs. |
| `ADMIN_DASHBOARD_TOKEN` | optional secret | Emergency admin login. Rotate after use. |
| `NODE_ENV` | system | Runtime mode set by the platform. |

### Discord OAuth, roles, bot

| Variable | Requirement | Description |
|---|---|---|
| `DISCORD_OAUTH_CLIENT_ID` | required | Discord OAuth client id. |
| `DISCORD_OAUTH_CLIENT_SECRET` | required secret | Discord OAuth client secret. |
| `DISCORD_CLIENT_ID` | alias | Legacy alias for client id. |
| `DISCORD_CLIENT_SECRET` | alias secret | Legacy alias for client secret. |
| `DISCORD_GUILD_ID` | required | Discord server id. |
| `DISCORD_GUILD_NAME` | optional | Fallback guild/server name. |
| `DISCORD_LIVE_ACCESS_SYNC_SECONDS` | optional | Live Discord role refresh interval for signed-in users. Requires `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID`. Elevated sessions downgrade to member if Discord is temporarily unavailable. Default: `90`. |
| `DISCORD_ROLES_CACHE_SECONDS` | optional | Cache TTL for Discord role-name lookups used in profile access previews. Default: `300`. |
| `DISCORD_ALLOW_GUILD_MEMBERS` | optional | If true and no member roles are set, any guild member can get member access. |
| `DISCORD_BOT_TOKEN` | required for Discord actions | Bot token for Discord REST. Also used for auth ban/member checks; the bot must be able to read guild bans. |
| `DISCORD_CHANNEL_ID` | optional | Default channel for older/default publish flows. |
| `DISCORD_PUBLIC_KEY` | required for interactions | Discord application public key. |
| `DISCORD_INTERACTIONS_ENDPOINT` | required when using Worker | Worker interactions base URL. |
| `DISCORD_RULES_STATS_ENDPOINT` | optional | Worker endpoint for guild rules stats. |
| `DISCORD_RAID_RULES_STATS_ENDPOINT` | optional | Worker endpoint for raid rules stats. |
| `DISCORD_RAID_RULES_SIGNUPS_ENDPOINT` | optional | Worker endpoint for raid rules signups. |
| `DISCORD_RULES_STATS_TOKEN` | optional shared secret | Shared token between dashboard and Worker. |
| `WORKER_STATS_TOKEN` | optional shared alias | Shared token alias. |
| `DISCORD_RAID_MESSAGE_ENDPOINT` | optional | Worker endpoint for publishing/updating raid messages. |
| `DISCORD_GUILD_CHANNELS_ENDPOINT` | optional | Worker endpoint for reading text channels. The dashboard passes `guild_id`; if the endpoint is unavailable, the dashboard falls back to `DISCORD_CHANNEL_ID` or a manual channel ID in the raid form. |
| `DISCORD_CHANNELS_CACHE_SECONDS` | optional | Discord channel list cache TTL. Default: `300`. |
| `DISCORD_ROLE_ASSIGN_CONCURRENCY` | optional | Discord role assignment concurrency. |
| `DISCORD_ROLE_ASSIGN_MAX_CONCURRENCY` | optional | Max Discord role assignment concurrency. |

### GitHub content and Firebase applications

| Variable | Requirement | Description |
|---|---|---|
| `GITHUB_OWNER` | required | GitHub owner/org. |
| `GITHUB_REPO` | required | GitHub repository. |
| `GITHUB_TOKEN` | required secret | Token for GitHub Pages content management. |
| `FIREBASE_APPLICATIONS_COLLECTION` | optional | Firestore collection for new applications, default `guildApplications`. |
| `GITHUB_CONTENT_BRANCH` | required for content | Branch for news/guides/images. |
| `GITHUB_BRANCH` | alias | Fallback alias for content branch. |
| `NEXT_PUBLIC_SITE_BASE_URL` | required for previews | Public website URL. |
| `SITE_BASE_URL` | required server-side | Server-side website URL. |
| `GITHUB_STATUS_CLEANUP_CONCURRENCY` | optional | Concurrency for status label cleanup. |
| `APPLICATION_BULK_STATUS_CONCURRENCY` | optional | Bulk application moderation concurrency. |
| `APPLICATION_BULK_STATUS_MAX_CONCURRENCY` | optional | Max bulk moderation concurrency. |

### Firebase profiles/raids/applications

| Variable | Requirement | Description |
|---|---|---|
| `FIREBASE_PROJECT_ID` | required | Firebase project id. |
| `FIREBASE_CLIENT_EMAIL` | required secret | Service account email. |
| `FIREBASE_PRIVATE_KEY` | required secret | Service account private key, usually with `\\n`. |
| `PROFILE_ID_SECRET` | optional secret | Secret for stable profile ids, falls back to `SESSION_SECRET`. |

### Battle.net / WoW

| Variable | Requirement | Description |
|---|---|---|
| `BATTLENET_CLIENT_ID` | required | Battle.net OAuth client id. |
| `BATTLENET_CLIENT_SECRET` | required secret | Battle.net OAuth client secret. |
| `BATTLE_NET_CLIENT_ID` | alias | Legacy alias. |
| `BATTLE_NET_CLIENT_SECRET` | alias secret | Legacy alias. |
| `BLIZZARD_CLIENT_ID` | alias | Legacy alias. |
| `BLIZZARD_CLIENT_SECRET` | alias secret | Legacy alias. |
| `BATTLENET_LOCALE` | optional | WoW API locale, for example `en_GB`. |
| `BATTLE_NET_LOCALE` | alias | Legacy alias. |
| `BLIZZARD_LOCALE` | alias | Legacy alias. |
| `BATTLENET_ENABLED_REGIONS` | required | UI regions, usually `eu` for this guild. |
| `BATTLENET_REGIONS` | alias | Fallback alias. |
| `BATTLENET_DEFAULT_REGION` | optional | Default region. |
| `BATTLE_NET_DEFAULT_REGION` | alias | Legacy alias. |
| `WOW_REGION` | alias | Legacy fallback region. |
| `BATTLENET_REQUEST_TIMEOUT_MS` | optional | Battle.net API timeout. |
| `BATTLENET_SCAN_CONCURRENCY` | optional | Scan concurrency, `0` means adaptive. |
| `BATTLENET_SCAN_MAX_CONCURRENCY` | optional | Max scan concurrency. |
| `BATTLENET_CANDIDATE_TTL_MINUTES` | optional | Temporary Battle.net candidate lifetime after OAuth. Defaults to `3` minutes. |
| `BATTLENET_SIGNUP_REFRESH_CONCURRENCY` | optional | Auto refresh concurrency before raid signup. |
| `BATTLENET_SIGNUP_REFRESH_REST_LIMIT` | optional | How many alts to refresh after the main before raid signup. |
| `WOW_GUILD_NAME` | required | Guild name used to filter characters. |
| `WOW_GUILD_REALM` | optional | Strict realm filter. |
| `BATTLENET_ALLOWED_GUILD_NAME` | alias | Legacy alias for `WOW_GUILD_NAME`. |
| `BATTLENET_ALLOWED_GUILD_REALM` | alias | Legacy alias for `WOW_GUILD_REALM`. |
| `GUILD_ROSTER_REGION` | optional | Region for the live guild roster page `/guild`, falls back to `WOW_REGION`. |
| `GUILD_ROSTER_REALM` | optional | Realm slug for the Battle.net Guild Roster API, falls back to `WOW_REALM` / `WOW_GUILD_REALM`. |
| `GUILD_ROSTER_NAME` | optional | Guild name for the live roster, falls back to `WOW_GUILD_NAME`. |
| `GUILD_ROSTER_CACHE_TTL_SECONDS` | optional | Guild roster cache TTL in Firebase/in-memory, default 1800 seconds. |
| `GUILD_ROSTER_REFRESH_CONCURRENCY` | optional | Raider.IO character refresh concurrency for `/guild`. |
| `PROFILE_CHARACTER_LINK_CACHE_SECONDS` | optional | Cache TTL for character -> owner profile links on `/guild`. Duplicates are intentionally unlinked. Default: `120`. |
| `GUILD_ROSTER_MEMBER_LIMIT` | optional | Max characters per roster refresh. |

### Raider.IO and performance

| Variable | Requirement | Description |
|---|---|---|
| `RAIDERIO_ACCESS_KEY` | optional secret | Raider.IO access key for more stable live roster and application enrichment. |
| `RAIDERIO_ENABLED` | optional | Enables Raider.IO enrichment. |
| `RAIDERIO_CONCURRENCY` | optional | Legacy/general Raider.IO concurrency. |
| `RAIDERIO_LOOKUP_CONCURRENCY` | optional | Adaptive lookup concurrency. |
| `RAIDERIO_LOOKUP_MAX_CONCURRENCY` | optional | Max lookup concurrency. |
| `DASHBOARD_MAX_CONCURRENCY` | optional | Global adaptive concurrency cap. |
| `CONTENT_READ_CONCURRENCY` | optional | Content read concurrency. |
| `CONTENT_READ_MAX_CONCURRENCY` | optional | Max content read concurrency. |


### Raids

| Variable | Requirement | Description |
|---|---|---|
| `RAID_ANNOUNCEMENTS_ENABLED` | optional | Raid announcement feature flag. |
| `RAID_RULES_URL` | required | Discord link to raid rules. |
| `NEXT_PUBLIC_RAID_RULES_URL` | alias public | Public alias for raid rules. |
| `DISCORD_RAID_RULES_URL` | alias | Legacy alias for raid rules. |
| `RAID_TIME_ZONE` | required | Raid timezone, for example `Europe/Kyiv`. |
| `RAID_LIFECYCLE_SECRET` | optional | Bearer token for `/api/raids/lifecycle` cron/manual job. Falls back to `CRON_SECRET` or `INTERNAL_API_TOKEN`. |
| `RAID_DISCORD_DELETE_AFTER_START_HOURS` | optional | Hours after raid start before the raid is auto-closed and Discord buttons are disabled. Default `4`. |
| `RAID_DISCORD_DELETE_AFTER_CLOSE_MINUTES` | optional | Minutes after close before the Discord announcement can be deleted. The raid record remains in the dashboard archive. Default `60`. |
| `NEXT_PUBLIC_RAID_TIME_ZONE` | required public | Public timezone for UI. |
| Raid autoclose | built-in | A raid is automatically considered closed at the scheduled start time using `RAID_TIME_ZONE`; there is no post-start grace delay. |
| `RAID_LIST_CACHE_TTL_MS` | optional | Raid list cache TTL. |
| `RAID_ITEM_CACHE_TTL_MS` | optional | Single raid cache TTL. |

## Practical rules

1. Add secrets only to Vercel/Worker environment variables. Do not commit them.
2. Generate `DISCORD_RULES_STATS_TOKEN`, `WORKER_STATS_TOKEN`, and `INTERNAL_PROFILE_LOOKUP_TOKEN` separately. Do not reuse OAuth secrets.
3. If Worker handles interactions, the Discord Developer Portal Interaction Endpoint should point to Worker, not Vercel.
4. If Vercel route `/api/discord/interactions` is used as fallback, Vercel must have `DISCORD_PUBLIC_KEY`.
5. For Firebase private key in Vercel, keep escaped `\\n`; the code converts them to real newlines.

> Access role IDs are no longer configured in env. Manage dashboard groups, a single Discord role ID and permissions in Firebase from `/dashboard/groups`.

