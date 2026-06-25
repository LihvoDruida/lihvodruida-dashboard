# API reference

Base URL у production залежить від домену Worker, наприклад:

```text
https://guild-applications.melles-android.workers.dev
```

Усі JSON-відповіді мають `Content-Type: application/json; charset=utf-8`, крім Discord interaction signature errors і `OPTIONS`.

## CORS

Worker відповідає на `OPTIONS` для всіх routes.

Allowed headers:

```text
Content-Type, Authorization, X-Worker-Stats-Token
```

Allowed methods:

```text
GET, POST, OPTIONS
```

Allowed origin обчислюється з `ALLOWED_ORIGINS` та fallback URL. Якщо request має `Origin`, якого немає в allowlist, Worker повертає `403` або `Access-Control-Allow-Origin: null` залежно від endpoint.

---

## `GET /` і `GET /api/guild-applications`

Читає список заявок із GitHub Issues.

### Query params

| Param | Type | Default | Опис |
|---|---:|---:|---|
| `limit` | number | `24` | Кількість issues на GitHub page. Мінімум `1`, максимум `100`. |
| `sort` | string | `created` | `created` або `updated`. |
| `direction` | string | `desc` | `asc` або `desc`. |
| `status` | string | `all` | `all`, `review`, `accepted`, `declined`. Aliases: `pending`, `approved`, `rejected`. |
| `class` | string | empty | Exact class filter після нормалізації в lowercase. |
| `q` | string | empty | Пошук по title, summary, character, realm, region, faction, class. |
| `pages` | number | `1` або `3` | Скільки GitHub pages читати. Якщо status filter заданий — default `3`. Максимум `5`. |
| `debug` / `diag` | `1` | off | Повертає diagnostics тільки якщо `ALLOW_DEBUG_QUERY=1` або `DEBUG_RESPONSES=1`. |

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

| Status | Причина |
|---:|---|
| `400` | Некоректний `status`. |
| `500` | Не налаштовані `GITHUB_TOKEN`, `GITHUB_OWNER` або `GITHUB_REPO`. |
| `502` | GitHub API повернув помилку. |

---

## `POST /` і `POST /api/guild-applications`

Створює заявку, GitHub Issue і, якщо Discord налаштований, Discord notification.

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
  "availability": "Вечорами після 20:00",
  "website": ""
}
```

### Required fields

- `region`;
- `characterName`;
- `faction`;
- `realm`;
- `availability`.

Якщо `faction` дорівнює `horde` у lowercase, `battleTag` також required.

### Source validation

Якщо переданий `sourceCreator`:

- `sourceCreator = "Інше"` → required `sourceOther`;
- будь-яке інше значення → required `sourcePlatform`.

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

Якщо Discord notification виконується синхронно, `discord` може містити:

```json
{
  "ok": true,
  "message_id": "123456789012345678",
  "channel_id": "123456789012345678",
  "raider_io": { "ok": true }
}
```

### Errors

| Status | Причина |
|---:|---|
| `400` | Invalid JSON, honeypot, validation error. |
| `403` | Origin не дозволений. |
| `413` | Body завеликий. |
| `500` | GitHub/Discord/Internal error. |

---

## `POST /api/discord-interactions`

Єдиний Discord Interaction Endpoint для кнопок.

### Auth

Discord request має мати валідні headers:

```text
X-Signature-Ed25519
X-Signature-Timestamp
```

Worker перевіряє signature через `DISCORD_PUBLIC_KEY`. Timestamp із різницею більше 5 хвилин відхиляється.

### Supported interaction types

| Type | Опис |
|---:|---|
| `1` | Discord ping. Worker відповідає `{ "type": 1 }`. |
| `3` | Message component interaction. |

Інші types повертають ephemeral повідомлення `Цей тип взаємодії не підтримується.`

### Supported custom IDs

| Custom ID | Опис |
|---|---|
| `guild_application:accepted:<issueNumber>` | Прийняти заявку, оновити labels, закрити Issue, оновити Discord message. |
| `guild_application:declined:<issueNumber>` | Відхилити заявку, оновити labels, закрити Issue, оновити Discord message. |
| `mbv1:a:<base36RoleId>[.<base36RoleId>]` | Public guild-rules accept button: одразу видає задані ролі без dashboard login/profile. |
| `mbv1:c:d` | Public rules decline button: відкриває приватне confirmation-підтвердження перед kick. |
| `mbv1:c:a:<base36RoleId>[.<base36RoleId>]` | Legacy guild-rules accept button: теж одразу видає задані ролі без confirmation panel. |
| `mbv1:d` | Final private decline button: kick user. |
| `mbv1:r:c:s` | Public raid-rules signup button: відкриває confirmation panel. |
| `mbv1:r:s` | Final raid-rules signup: перевіряє dashboard profile + main character і записує signup. |
| `mbv1:raid:<raidId>:going` | Записатися на рейд через dashboard proxy. |
| `mbv1:raid:<raidId>:late` | Позначити запізнення через dashboard proxy. |
| `mbv1:raid:<raidId>:skipped` | Пропустити рейд через dashboard proxy. |

### Notes

- Application moderation buttons can be restricted by `DISCORD_ALLOWED_ROLES`.
- Rules buttons are for regular members and do not use `DISCORD_ALLOWED_ROLES`.
- All interaction actions use a short per-user cooldown.

---

## `GET /api/discord-rules-stats`

Читає статистику звичайних правил.

### Auth

Якщо заданий `DISCORD_RULES_STATS_TOKEN` або `WORKER_STATS_TOKEN`, endpoint вимагає один із headers:

```text
Authorization: Bearer <token>
X-Worker-Stats-Token: <token>
```

### Query params

| Param | Опис |
|---|---|
| `guild_id` | Discord guild id. Якщо не заданий, Worker бере `DISCORD_GUILD_ID`. Якщо і він відсутній, агрегує всі `rules:*` counters. |
| `type` / `rules_type` | Якщо `raid` або `raid-rules`, Worker повертає raid-rules stats замість guild rules stats. |

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

Читає статистику підписів на правила рейду.

### Auth

Такий самий token auth, як у `/api/discord-rules-stats`.

### Query params

| Param | Опис |
|---|---|
| `guild_id` | Discord guild id. Якщо не заданий, Worker бере `DISCORD_GUILD_ID`. |

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

Повертає список підписантів правил рейду.

### Auth

Такий самий token auth, як у `/api/discord-rules-stats`.

### Query params

| Param | Опис |
|---|---|
| `guild_id` | Discord guild id. Якщо не заданий, Worker бере `DISCORD_GUILD_ID`. |

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

Endpoint для dashboard, який створює, редагує або видаляє Discord raid announcement message через Worker.

### Auth

Вимагає один із tokens:

- `DISCORD_RULES_STATS_TOKEN`;
- `INTERNAL_PROFILE_LOOKUP_TOKEN`;
- `WORKER_STATS_TOKEN`.

Передавати можна через:

```text
Authorization: Bearer <token>
X-Worker-Stats-Token: <token>
```

### Body для `create`

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

### Body для `edit`

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

### Body для `delete`

```json
{
  "action": "delete",
  "channelId": "123456789012345678",
  "messageId": "123456789012345678"
}
```

### Mention safety

Worker не дозволяє `@everyone`, `@here` або unrestricted user mentions. Role mentions проходять тільки через:

- `mentionRoleIds`;
- `mention_role_ids`;
- `allowed_mentions.roles`.

---

## `GET /api/discord-guild-channels`

Повертає список Discord text/news channels для dashboard. Можна передати `?guild_id=<id>`; якщо `DISCORD_GUILD_ID` у Worker не заданий, endpoint використає цей параметр. Якщо Discord API тимчасово недоступний, але заданий `DISCORD_RAID_CHANNEL_ID` або `DISCORD_CHANNEL_ID`, endpoint поверне fallback-канал із полем `warning` замість жорсткої помилки.

### Auth

Той самий auth, що в `/api/discord-raid-message`.

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

Більшість API errors повертаються так:

```json
{
  "error": "Message"
}
```

Деякі dashboard/Discord relay endpoints можуть повертати:

```json
{
  "ok": false,
  "error": "Message"
}
```

Unhandled errors мають `request_id`:

```json
{
  "error": "Внутрішня помилка сервера.",
  "request_id": "..."
}
```
