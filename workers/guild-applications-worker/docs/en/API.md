# API reference

The production base URL depends on the Worker domain, for example:

```text
https://guild-applications.melles-android.workers.dev
```

All JSON responses use `Content-Type: application/json; charset=utf-8`, except Discord interaction signature errors and `OPTIONS` responses.

## CORS

The Worker responds to `OPTIONS` for all routes.

Allowed headers:

```text
Content-Type, Authorization, X-Worker-Stats-Token
```

Allowed methods:

```text
GET, POST, OPTIONS
```

The allowed origin is computed from `ALLOWED_ORIGINS` and fallback URLs. If a request has an `Origin` that is not allowlisted, the Worker returns `403` or `Access-Control-Allow-Origin: null`, depending on the endpoint.

---

## `GET /` and `GET /api/guild-applications`

Reads guild applications from GitHub Issues.

### Query params

| Param | Type | Default | Description |
|---|---:|---:|---|
| `limit` | number | `24` | Number of issues per GitHub page. Minimum `1`, maximum `100`. |
| `sort` | string | `created` | `created` or `updated`. |
| `direction` | string | `desc` | `asc` or `desc`. |
| `status` | string | `all` | `all`, `review`, `accepted`, `declined`. Aliases: `pending`, `approved`, `rejected`. |
| `class` | string | empty | Exact class filter after lowercasing. |
| `q` | string | empty | Searches title, summary, character, realm, region, faction, class. |
| `pages` | number | `1` or `3` | Number of GitHub pages to fetch. If a status filter is provided, default is `3`. Maximum `5`. |
| `debug` / `diag` | `1` | off | Returns diagnostics only when `ALLOW_DEBUG_QUERY=1` or `DEBUG_RESPONSES=1`. |

### Response `200`

```json
{
  "items": [
    {
      "number": 123,
      "title": "Заявка до гільдії: Khayen",
      "state": "open",
      "status_key": "review",
      "status_text": "На розгляді",
      "html_url": "https://github.com/.../issues/123",
      "created_at": "2026-05-03T00:00:00Z",
      "updated_at": "2026-05-03T00:00:00Z",
      "closed_at": null,
      "summary": "Khayen • Terokkar • eu • Alliance • Druid",
      "character_name": "Khayen",
      "realm": "Terokkar",
      "region": "eu",
      "faction": "Alliance",
      "class_name": "Druid",
      "labels": ["guild-application", "status:review"]
    }
  ],
  "total": 1,
  "meta": {
    "total_before_filters": 1,
    "total_after_filters": 1,
    "status_counts": { "review": 1 },
    "state_counts": { "open": 1 }
  }
}
```

### Errors

| Status | Reason |
|---:|---|
| `400` | Invalid `status`. |
| `500` | `GITHUB_TOKEN`, `GITHUB_OWNER` or `GITHUB_REPO` is not configured. |
| `502` | GitHub API returned an error. |

---

## `POST /` and `POST /api/guild-applications`

Creates an application, GitHub Issue, and optionally a Discord notification.

### Body

```json
{
  "region": "eu",
  "characterName": "Khayen",
  "faction": "Alliance",
  "realm": "Terokkar",
  "className": "Druid",
  "discord": "Dmytro",
  "battleTag": "Example#1234",
  "sourceCreator": "TikTok",
  "sourcePlatform": "Discord",
  "sourceOther": "",
  "source": "fallback source",
  "availability": "Evenings after 20:00",
  "website": ""
}
```

### Required fields

- `region`;
- `characterName`;
- `faction`;
- `realm`;
- `availability`.

If `faction` equals `horde` after lowercasing, `battleTag` is also required.

### Source validation

If `sourceCreator` is provided:

- `sourceCreator = "Інше"` → `sourceOther` is required;
- any other value → `sourcePlatform` is required.

### Response `201`

```json
{
  "ok": true,
  "number": 123,
  "html_url": "https://github.com/.../issues/123",
  "state": "open",
  "status_text": "На розгляді",
  "title": "Заявка до гільдії: Khayen",
  "discord": {
    "queued": true,
    "async": true
  }
}
```

When Discord notification is executed synchronously, `discord` may contain:

```json
{
  "ok": true,
  "message_id": "123456789012345678",
  "channel_id": "123456789012345678",
  "raider_io": { "ok": true }
}
```

### Errors

| Status | Reason |
|---:|---|
| `400` | Invalid JSON, honeypot, validation error. |
| `403` | Origin is not allowed. |
| `413` | Body is too large. |
| `500` | GitHub/Discord/Internal error. |

---

## `POST /api/discord-interactions`

Single Discord Interaction Endpoint for buttons.

### Auth

The Discord request must include valid headers:

```text
X-Signature-Ed25519
X-Signature-Timestamp
```

The Worker verifies the signature with `DISCORD_PUBLIC_KEY`. Timestamp skew greater than 5 minutes is rejected.

### Supported interaction types

| Type | Description |
|---:|---|
| `1` | Discord ping. The Worker responds with `{ "type": 1 }`. |
| `3` | Message component interaction. |

Other types return an ephemeral `This interaction type is not supported` message in Ukrainian.

### Supported custom IDs

| Custom ID | Description |
|---|---|
| `guild_application:accepted:<issueNumber>` | Accept application, update labels, close Issue, update Discord message. |
| `guild_application:declined:<issueNumber>` | Decline application, update labels, close Issue, update Discord message. |
| `mbv1:a:<base36RoleId>[.<base36RoleId>]` | Public guild-rules accept button: immediately assigns the configured roles without dashboard login/profile checks. |
| `mbv1:c:d` | Public rules decline button: opens a private confirmation panel. |
| `mbv1:c:a:<base36RoleId>[.<base36RoleId>]` | Legacy guild-rules accept button: also immediately assigns roles without a confirmation panel. |
| `mbv1:d` | Final private decline button: kicks the user. |
| `mbv1:r:c:s` | Public raid-rules signup button: opens a confirmation panel. |
| `mbv1:r:s` | Final raid-rules signup: verifies dashboard profile + main character and stores signup. |
| `mbv1:raid:<raidId>:going` | Join a raid through dashboard proxy. |
| `mbv1:raid:<raidId>:late` | Mark late through dashboard proxy. |
| `mbv1:raid:<raidId>:skipped` | Skip a raid through dashboard proxy. |

### Notes

- Application moderation buttons can be restricted by `DISCORD_ALLOWED_ROLES`.
- Rules buttons are intended for regular members and do not use `DISCORD_ALLOWED_ROLES`.
- All interaction actions use a short per-user cooldown.

---

## `GET /api/discord-rules-stats`

Reads normal guild rules statistics.

### Auth

If `DISCORD_RULES_STATS_TOKEN` or `WORKER_STATS_TOKEN` is configured, the endpoint requires one of:

```text
Authorization: Bearer <token>
X-Worker-Stats-Token: <token>
```

### Query params

| Param | Description |
|---|---|
| `guild_id` | Discord guild id. If omitted, the Worker uses `DISCORD_GUILD_ID`. If both are missing, it aggregates all `rules:*` counters. |
| `type` / `rules_type` | If `raid` or `raid-rules`, the Worker returns raid-rules stats instead of guild rules stats. |

### Response `200`

```json
{
  "configured": true,
  "guild_id": "123456789012345678",
  "scope": "guild",
  "rules_type": "guild",
  "namespace": "rules",
  "accepted": 10,
  "declined": 1,
  "total": 11,
  "updated_at": "2026-05-03T00:00:00.000Z",
  "source": "kv",
  "counted_from": "user-records"
}
```

---

## `GET /api/discord-raid-rules-stats`

Reads raid-rules signup statistics.

### Auth

Same token auth as `/api/discord-rules-stats`.

### Query params

| Param | Description |
|---|---|
| `guild_id` | Discord guild id. If omitted, the Worker uses `DISCORD_GUILD_ID`. |

### Response `200`

```json
{
  "configured": true,
  "guild_id": "123456789012345678",
  "scope": "guild",
  "rules_type": "raid",
  "namespace": "raid-rules",
  "signed": 15,
  "total": 15,
  "updated_at": "2026-05-03T00:00:00.000Z",
  "source": "kv"
}
```

---

## `GET /api/discord-raid-rules-signups`

Returns the raid-rules signup list.

### Auth

Same token auth as `/api/discord-rules-stats`.

### Query params

| Param | Description |
|---|---|
| `guild_id` | Discord guild id. If omitted, the Worker uses `DISCORD_GUILD_ID`. |

### Response `200`

```json
{
  "configured": true,
  "guild_id": "123456789012345678",
  "rules_type": "raid",
  "namespace": "raid-rules",
  "total": 1,
  "updated_at": "2026-05-03T00:00:00.000Z",
  "stats": {
    "signed": 1,
    "total": 1
  },
  "signups": [
    {
      "discordId": "123456789012345678",
      "discordName": "Dmytro",
      "profileId": "profile-id",
      "mainCharacter": {
        "key": "eu-terokkar-khayen",
        "name": "Khayen",
        "realmName": "Terokkar",
        "realmSlug": "terokkar",
        "region": "eu",
        "className": "Druid",
        "profileUrl": "https://raider.io/characters/eu/terokkar/Khayen"
      },
      "signedAt": "2026-05-03T00:00:00.000Z"
    }
  ],
  "source": "kv"
}
```

---

## `POST /api/discord-raid-message`

Dashboard endpoint for creating, editing, or deleting Discord raid announcement messages through the Worker.

### Auth

Requires one of these tokens:

- `DISCORD_RULES_STATS_TOKEN`;
- `INTERNAL_PROFILE_LOOKUP_TOKEN`;
- `WORKER_STATS_TOKEN`.

Send it through:

```text
Authorization: Bearer <token>
X-Worker-Stats-Token: <token>
```

### Body for `create`

```json
{
  "action": "create",
  "channelId": "123456789012345678",
  "content": "Optional message content",
  "embed": {
    "title": "Raid title",
    "description": "Raid description",
    "color": 3913053,
    "fields": []
  },
  "components": [],
  "mentionRoleIds": ["123456789012345678"]
}
```

### Body for `edit`

```json
{
  "action": "edit",
  "channelId": "123456789012345678",
  "messageId": "123456789012345678",
  "content": "Updated content",
  "embed": {
    "title": "Updated raid title"
  },
  "components": []
}
```

### Body for `delete`

```json
{
  "action": "delete",
  "channelId": "123456789012345678",
  "messageId": "123456789012345678"
}
```

### Mention safety

The Worker never enables `@everyone`, `@here`, or unrestricted user mentions. Role mentions pass only through:

- `mentionRoleIds`;
- `mention_role_ids`;
- `allowed_mentions.roles`.

---

## `GET /api/discord-guild-channels`

Returns Discord text/news channels for the dashboard. You can pass `?guild_id=<id>`; if `DISCORD_GUILD_ID` is not set in the Worker, the endpoint uses that query value. If Discord API is temporarily unavailable but `DISCORD_RAID_CHANNEL_ID` or `DISCORD_CHANNEL_ID` is configured, the endpoint returns the fallback channel with a `warning` field instead of hard-failing.

### Auth

Same auth as `/api/discord-raid-message`.

### Response `200`

```json
{
  "ok": true,
  "guild": {
    "id": "123456789012345678",
    "name": "Mistblossom Vanguard",
    "rules_channel_id": "123456789012345678"
  },
  "channels": [
    {
      "id": "123456789012345678",
      "name": "raid-announcements",
      "type": 0,
      "position": 10,
      "parent_id": null
    }
  ],
  "suggestedChannelId": "123456789012345678",
  "suggestedRulesChannelId": "123456789012345678",
  "warning": null
}
```

---

## Common error shape

Most API errors return:

```json
{
  "error": "Message"
}
```

Some dashboard/Discord relay endpoints can return:

```json
{
  "ok": false,
  "error": "Message"
}
```

Unhandled errors include `request_id`:

```json
{
  "error": "Внутрішня помилка сервера.",
  "request_id": "..."
}
```
