# Dashboard shared variables checklist

This file is a separate checklist of variables and endpoint contracts that must be coordinated between the Worker and the admin dashboard.

## Required shared values

| Worker variable | Dashboard side | Must match? | Why |
|---|---|---:|---|
| `ADMIN_DASHBOARD_URL` | `NEXTAUTH_URL` / dashboard public base URL | Yes | The Worker builds login/profile/raid links and default dashboard API URLs from it. |
| `DISCORD_GUILD_ID` | dashboard Discord guild/server id | Yes | Stats, profile lookup, raid actions and Discord channels must target the same server. |
| `INTERNAL_PROFILE_LOOKUP_TOKEN` | dashboard secret for `/api/profile/discord-lookup` and raid action endpoints | Yes | Server-to-server auth between Worker and dashboard. |
| `DISCORD_RULES_STATS_TOKEN` | dashboard secret used for reading Worker stats and calling relay endpoints | Yes | Dashboard reads protected Worker endpoints. |
| `ALLOWED_ORIGINS` | dashboard origin | Worker must include dashboard origin | Otherwise dashboard requests to the Worker will fail CORS/origin checks. |
| `RAID_RULES_URL` / `NEXT_PUBLIC_RAID_RULES_URL` | dashboard raid rules URL | Should match | Worker replies and dashboard UI should point to the same raid-rules message/page. |

## Worker → Dashboard endpoints

These endpoints must exist in the dashboard and accept server-to-server auth.

| Worker config | Default URL | Method | Purpose |
|---|---|---:|---|
| `DASHBOARD_PROFILE_LOOKUP_ENDPOINT` | `${ADMIN_DASHBOARD_URL}/api/profile/discord-lookup` | `GET` | Verify Discord user, profile and selected main character. |
| `DASHBOARD_RAID_ACTION_ENDPOINT` | `${ADMIN_DASHBOARD_URL}/api/raids/{raidId}/discord-action` | `POST` | Handle raid buttons `going`, `late`, `skipped`. |

### Dashboard profile lookup contract

The Worker calls:

```text
GET /api/profile/discord-lookup?discord_id=<discordUserId>
Authorization: Bearer <INTERNAL_PROFILE_LOOKUP_TOKEN>
```

If Cloudflare Access is enabled, the Worker also adds:

```text
CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>
CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>
```

The dashboard should return JSON with `found: true` and a main character, for example:

```json
{
  "found": true,
  "profileId": "profile-id",
  "displayName": "Dmytro",
  "mainCharacter": {
    "key": "eu-terokkar-khayen",
    "name": "Khayen",
    "realmName": "Terokkar",
    "realmSlug": "terokkar",
    "region": "eu",
    "className": "Druid",
    "profileUrl": "https://raider.io/characters/eu/terokkar/Khayen"
  }
}
```

The Worker treats a main character as usable when `mainCharacter.name` exists and either `mainCharacter.realmName` or `mainCharacter.realmSlug` exists.

### Dashboard raid action contract

The Worker calls:

```text
POST /api/raids/<raidId>/discord-action
Authorization: Bearer <token>
X-Worker-Stats-Token: <token>
Content-Type: application/json
```

Body:

```json
{
  "action": "going",
  "userId": "123456789012345678",
  "userName": "Dmytro",
  "guildId": "123456789012345678",
  "channelId": "123456789012345678",
  "messageId": "123456789012345678",
  "source": "discord-interaction-worker"
}
```

The dashboard should return:

```json
{
  "ok": true,
  "content": "✅ Signup updated.",
  "components": [],
  "warning": "⚠️ Minimum item level is below requirement.",
  "blockedByMinItemLevel": false,
  "blockedByMaxPlayers": false,
  "requiresProfile": false,
  "requiresMainCharacter": false
}
```

The Worker uses `warning`, `blockedByMinItemLevel`, `blockedByMaxPlayers`, `requiresProfile`, `requiresMainCharacter`, `needsProfile`, and `blockedByProfile` to build the correct ephemeral response.

## Dashboard → Worker endpoints

The dashboard should know the Worker base URL and call these endpoints.

| Suggested dashboard env | Worker endpoint | Method | Token |
|---|---|---:|---|
| `DISCORD_RULES_STATS_ENDPOINT` | `/api/discord-rules-stats` | `GET` | `DISCORD_RULES_STATS_TOKEN` |
| `DISCORD_RAID_RULES_STATS_ENDPOINT` | `/api/discord-raid-rules-stats` | `GET` | `DISCORD_RULES_STATS_TOKEN` |
| `DISCORD_RAID_RULES_SIGNUPS_ENDPOINT` | `/api/discord-raid-rules-signups` | `GET` | `DISCORD_RULES_STATS_TOKEN` |
| `DISCORD_RAID_MESSAGE_ENDPOINT` or Worker base + route | `/api/discord-raid-message` | `POST` | `DISCORD_RULES_STATS_TOKEN` or `INTERNAL_PROFILE_LOOKUP_TOKEN` |
| `DISCORD_GUILD_CHANNELS_ENDPOINT` or Worker base + route | `/api/discord-guild-channels` | `GET` | `DISCORD_RULES_STATS_TOKEN` or `INTERNAL_PROFILE_LOOKUP_TOKEN` |

Not all of these dashboard env names are read by the Worker directly. They are recommended dashboard-side names to avoid hardcoded Worker URLs.

## Minimal shared dashboard `.env`

```env
NEXTAUTH_URL=https://admin.lihvodruida.pp.ua
DISCORD_GUILD_ID=<same-as-worker>
INTERNAL_PROFILE_LOOKUP_TOKEN=<same-as-worker>
DISCORD_RULES_STATS_TOKEN=<same-as-worker>
NEXT_PUBLIC_RAID_RULES_URL=https://discord.com/channels/<guild>/<channel>/<message>

DISCORD_RULES_STATS_ENDPOINT=https://guild-applications.melles-android.workers.dev/api/discord-rules-stats
DISCORD_RAID_RULES_STATS_ENDPOINT=https://guild-applications.melles-android.workers.dev/api/discord-raid-rules-stats
DISCORD_RAID_RULES_SIGNUPS_ENDPOINT=https://guild-applications.melles-android.workers.dev/api/discord-raid-rules-signups
DISCORD_RAID_MESSAGE_ENDPOINT=https://guild-applications.melles-android.workers.dev/api/discord-raid-message
DISCORD_GUILD_CHANNELS_ENDPOINT=https://guild-applications.melles-android.workers.dev/api/discord-guild-channels
```

## Common mistakes

1. **Stats show zero** — the dashboard does not pass `guild_id`, while the Worker stored data under a specific guild id. Fix: pass `guild_id` or set `DISCORD_GUILD_ID` in the Worker.
2. **401 on stats endpoints** — dashboard token does not match `DISCORD_RULES_STATS_TOKEN` / `WORKER_STATS_TOKEN` in the Worker.
3. **Profile lookup returns an HTML Cloudflare Access page** — `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` are missing, or the Service Token is not allowed by the Access policy.
4. **Raid signup is not accepted** — dashboard profile lookup does not return a usable `mainCharacter`.
5. **CORS block** — `ALLOWED_ORIGINS` does not include the exact dashboard origin.
