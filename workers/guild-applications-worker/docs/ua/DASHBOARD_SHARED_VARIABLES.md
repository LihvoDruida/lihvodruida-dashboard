# Dashboard shared variables checklist

Цей файл — окремий список змінних і endpoint contracts, які мають бути узгоджені між Worker і admin dashboard.

## Обов’язково спільні

| Worker variable | Dashboard side | Має збігатися? | Навіщо |
|---|---|---:|---|
| `ADMIN_DASHBOARD_URL` | `NEXTAUTH_URL` / dashboard public base URL | Yes | Worker будує login/profile/raid links і default dashboard API URLs. |
| `DISCORD_GUILD_ID` | dashboard Discord guild/server id | Yes | Stats, profile lookup, raid actions і Discord channels мають працювати з тим самим сервером. |
| `INTERNAL_PROFILE_LOOKUP_TOKEN` | dashboard secret for `/api/profile/discord-lookup` and raid action endpoints | Yes | Server-to-server auth між Worker і dashboard. |
| `DISCORD_RULES_STATS_TOKEN` | dashboard secret used for reading Worker stats and calling relay endpoints | Yes | Dashboard читає protected Worker endpoints. |
| `ALLOWED_ORIGINS` | dashboard origin | Worker must include dashboard origin | Інакше dashboard requests до Worker будуть заблоковані CORS/origin check. |
| `RAID_RULES_URL` / `NEXT_PUBLIC_RAID_RULES_URL` | dashboard raid rules URL | Should match | Щоб Worker replies і dashboard UI вели на одні й ті самі правила рейду. |

## Worker → Dashboard endpoints

Ці endpoint-и мають існувати в dashboard і приймати server-to-server token.

| Worker config | Default URL | Method | Призначення |
|---|---|---:|---|
| `DASHBOARD_PROFILE_LOOKUP_ENDPOINT` | `${ADMIN_DASHBOARD_URL}/api/profile/discord-lookup` | `GET` | Перевірити Discord user, profile і selected main character. |
| `DASHBOARD_RAID_ACTION_ENDPOINT` | `${ADMIN_DASHBOARD_URL}/api/raids/{raidId}/discord-action` | `POST` | Обробити raid buttons `going`, `late`, `skipped`. |

### Dashboard profile lookup contract

Worker викликає:

```text
GET /api/profile/discord-lookup?discord_id=<discordUserId>
Authorization: Bearer <INTERNAL_PROFILE_LOOKUP_TOKEN>
```

Якщо Cloudflare Access увімкнений, Worker також додає:

```text
CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>
CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>
```

Dashboard має повернути JSON із `found: true` і main character, наприклад:

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

Worker вважає main usable, якщо є `mainCharacter.name` і `mainCharacter.realmName` або `mainCharacter.realmSlug`.

### Dashboard raid action contract

Worker викликає:

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

Dashboard має повертати:

```json
{
  "ok": true,
  "content": "✅ Запис оновлено.",
  "components": [],
  "warning": "⚠️ Мінімальний item level нижчий за вимогу.",
  "blockedByMinItemLevel": false,
  "blockedByMaxPlayers": false,
  "requiresProfile": false,
  "requiresMainCharacter": false
}
```

Worker використовує `warning`, `blockedByMinItemLevel`, `blockedByMaxPlayers`, `requiresProfile`, `requiresMainCharacter`, `needsProfile`, `blockedByProfile` для правильного ephemeral response.

## Dashboard → Worker endpoints

Dashboard має знати Worker base URL і викликати ці endpoints.

| Dashboard env suggestion | Worker endpoint | Method | Token |
|---|---|---:|---|
| `DISCORD_RULES_STATS_ENDPOINT` | `/api/discord-rules-stats` | `GET` | `DISCORD_RULES_STATS_TOKEN` |
| `DISCORD_RAID_RULES_STATS_ENDPOINT` | `/api/discord-raid-rules-stats` | `GET` | `DISCORD_RULES_STATS_TOKEN` |
| `DISCORD_RAID_RULES_SIGNUPS_ENDPOINT` | `/api/discord-raid-rules-signups` | `GET` | `DISCORD_RULES_STATS_TOKEN` |
| `DISCORD_RAID_MESSAGE_ENDPOINT` або Worker base + route | `/api/discord-raid-message` | `POST` | `DISCORD_RULES_STATS_TOKEN` або `INTERNAL_PROFILE_LOOKUP_TOKEN` |
| `DISCORD_GUILD_CHANNELS_ENDPOINT` або Worker base + route | `/api/discord-guild-channels` | `GET` | `DISCORD_RULES_STATS_TOKEN` або `INTERNAL_PROFILE_LOOKUP_TOKEN` |

Ці dashboard env names не всі читаються Worker-кодом напряму. Це рекомендовані назви для dashboard, щоб не хардкодити Worker URLs.

## Мінімальний спільний `.env` для dashboard

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

## Типові помилки

1. **Stats показує нулі** — dashboard не передає `guild_id`, а Worker записав дані під конкретним guild id. Рішення: передавати `guild_id` або задати `DISCORD_GUILD_ID` у Worker.
2. **401 на stats endpoints** — token у dashboard не збігається з `DISCORD_RULES_STATS_TOKEN` / `WORKER_STATS_TOKEN` у Worker.
3. **Profile lookup повертає HTML Cloudflare Access page** — не задані `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` або Service Token не дозволений Access policy.
4. **Raid signup не зараховується** — dashboard profile lookup не повертає usable `mainCharacter`.
5. **CORS блок** — `ALLOWED_ORIGINS` не містить точний origin dashboard.
