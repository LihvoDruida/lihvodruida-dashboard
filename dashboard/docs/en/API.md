# API documentation

Production base URL is usually:

```text
https://dashboard.lihvodruida.pp.ua
```

Local development base URL:

```text
http://localhost:3000
```

## General API rules

- Most endpoints require an active session cookie.
- State-changing endpoints verify trusted origin.
- Sensitive actions are rate-limited.
- Large form/json requests have body size limits.
- Non-cacheable API responses use `no-store` headers.
- Worker-to-dashboard endpoints use a Bearer token.

## Authentication

### `GET /api/auth/discord/start`

Starts Discord OAuth login.

**Access:** public.

**Query:**

| Name | Type | Description |
|---|---:|---|
| `next` | string | Optional path to return to after login. |

**Result:** redirect to Discord OAuth.

---

### `GET /api/auth/discord/callback`

Handles Discord OAuth callback.

**Access:** public callback from Discord.

**Query:**

| Name | Type | Description |
|---|---:|---|
| `code` | string | OAuth code from Discord. |
| `state` | string | CSRF/OAuth state. |

**Result:** creates the session cookie and redirects to the dashboard.

---

### `GET /api/auth/battlenet/start`

Starts Battle.net OAuth for character linking.

**Access:** authenticated user.

**Query:**

| Name | Type | Description |
|---|---:|---|
| `region` | string | Battle.net region, for example `eu`. |

**Result:** redirect to Battle.net OAuth.

---

### `GET /api/auth/battlenet/callback`

Handles Battle.net OAuth callback, scans characters, and stores temporary candidates.

**Access:** authenticated user with profile id.

**Query:**

| Name | Type | Description |
|---|---:|---|
| `code` | string | OAuth code from Battle.net. |
| `state` | string | OAuth state with region/profile id. |

**Result:** redirect to profile with `characterStatus`.

---

### `POST /api/auth/login`

Emergency login using `ADMIN_DASHBOARD_TOKEN`.

**Access:** public, but requires the correct token.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `token` | string | Value of `ADMIN_DASHBOARD_TOKEN`. |

**Result:** admin fallback session cookie.

---

### `POST /api/auth/logout`

Deletes the session cookie.

**Access:** authenticated user.

**Result:** redirect or JSON depending on the client.

---

### `GET /api/auth/logout`

Does not log out. Returns `405`, because logout must be `POST`.

## Applications

### `GET /api/applications`

Returns the Firebase Firestore application list.

**Access:** officer/dashboard for full data and actions, including BattleTag; newcomer mentor for read-only data with BattleTag and source links removed.

**Query:**

| Name | Type | Description |
|---|---:|---|
| `status` | string | `all`, `review`, `accepted`, `declined`. |
| `q` / `search` | string | Application/character search. |
| `class` | string | Class filter. |
| `sort` | string | Sorting option if supported by UI. |

**Response:**

```json
{
  "items": [],
  "counts": {
    "all": 0,
    "review": 0,
    "accepted": 0,
    "declined": 0
  },
  "classOptions": []
}
```

---

### `POST /api/applications/[number]/status`

Changes the status of one application.

**Access:** officer/dashboard.

**Body:** JSON.

| Field | Type | Description |
|---|---:|---|
| `status` | string | `accepted` or `declined`. |

**Behavior:**

- updates Firebase application status fields;
- removes old/legacy status labels;
- adds a moderation comment;
- may close the issue depending on moderation module behavior.

---

### `POST /api/applications/bulk-status`

Changes application statuses in bulk.

**Access:** officer/dashboard.

**Body:** JSON.

```json
{
  "items": [
    { "number": 123, "status": "accepted" }
  ]
}
```

**Limit:** up to 50 applications per request.

## Guild roster

### `POST /api/guild/refresh`

Forces a runtime cache refresh for the guild roster from the Battle.net Guild Roster API and Raider.IO.

**Access:** any authenticated dashboard user who can access `/guild`.

**Body:** none.

**What it does:**

- loads the current guild roster from Battle.net;
- refreshes Raider.IO M+ `ALL`, `DPS`, `HEALER`, `TANK` for each character;
- recalculates average RIO, average item level, max RIO and max item level;
- stores the cache in Firebase or in-memory runtime cache.

**Response:**

```json
{
  "ok": true,
  "memberCount": 120,
  "updatedAt": "2026-05-04T00:00:00.000Z",
  "source": "Battle.net Guild Roster API + Raider.IO Character API • cache",
  "error": null
}
```

---

## Profile

### `POST /api/profile/name`

Saves the profile `Name` field.

**Access:** profile owner.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `preferredName` | string | Name used for Discord nickname format. |

**Result:** redirect to profile with `characterStatus=profile_name_saved` or an error status.

---

### `POST /api/profile/discord-nickname`

Applies the Discord server nickname in the `Name [Main, Alt1, Alt2]` format.

**Access:** profile owner.

**Requirements:**

- user logged in with Discord;
- profile exists;
- preferred name is set;
- Discord bot token is configured;
- bot has `Manage Nicknames`;
- bot role is higher than the user's highest role.

**Special case:** the bot cannot rename the server owner. The owner should use the copy-only flow in the UI.

---

### `POST /api/profile/raid-role`

Saves a manual raid role or returns the profile to Auto mode.

**Access:** profile owner.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `raidRole` | string | `auto`, `tank`, `healer`, `dps`. |

---

### `POST /api/profile/characters/add`

Adds one character from the temporary Battle.net candidate list stored on the Firebase profile.

**Access:** profile owner.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `characterKey` | string | Stable character key. |

---

### `POST /api/profile/characters/bulk-add`

Adds several characters from the temporary Battle.net candidate list stored on the Firebase profile.

**Access:** profile owner.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `characterKey` | string[] | One or more character keys. |

---

### `POST /api/profile/characters/main`

Sets the main character.

**Access:** profile owner.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `characterKey` | string | Saved character key. |

**Side effect:** if a manual raid role was attached to the old main character, it is cleared.

---

### `POST /api/profile/characters/remove`

Removes a character from the profile.

**Access:** profile owner.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `characterKey` | string | Saved character key. |

---

### `GET /api/profile/discord-lookup`

Private server-to-server lookup for Worker or bot flows.

**Access:** Bearer token only.

**Headers:**

```http
Authorization: Bearer <INTERNAL_PROFILE_LOOKUP_TOKEN>
```

**Query:**

| Name | Type | Description |
|---|---:|---|
| `discord_id` | string | Discord user id. |

**Response:**

```json
{
  "found": true,
  "profileId": "id...",
  "displayName": "Name",
  "mainCharacter": {},
  "hasMainCharacter": true,
  "characterCount": 3
}
```

## Raids

### `POST /api/raids`

Creates or updates a raid in the dashboard without necessarily publishing it to Discord.

**Access:** officer/dashboard.

**Body:** form data.

Common fields:

| Field | Type | Description |
|---|---:|---|
| `raidId` | string | If present, updates an existing raid. |
| `title` | string | Raid title. |
| `difficulty` | string | `normal`, `heroic`, `mythic`. |
| `date` | string | Raid date. |
| `time` | string | Raid time. |
| `description` | string | Markdown description. |
| `channelId` | string | Discord channel id. |
| `consumables` | string | `own` or `guild`. |
| `lootMode` | string | Loot mode. |
| `minItemLevel` | number | Minimum item level. |
| `maxPlayers` | number | Signup limit. |

---

### `POST /api/raids/publish`

Saves the raid and publishes or updates the Discord message.

**Access:** officer/dashboard.

**Body:** form data, same as `/api/raids`.

**Result:** redirect with toast about created or updated Discord message.

---

### `POST /api/raids/[raidId]/attendance`

Updates the current user's raid attendance.

**Access:** authenticated user.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `action` | string | `going`, `late`, `skipped`. |

**JSON mode:** if `x-dashboard-action: live` or `Accept: application/json` is sent, the endpoint returns JSON instead of redirect.

**JSON response:**

```json
{
  "ok": true,
  "toast": {
    "tone": "success",
    "title": "Attendance updated",
    "message": "..."
  },
  "raid": { "id": "..." },
  "revision": "..."
}
```

---

### `POST /api/raids/[raidId]/discord-action`

Private endpoint for a Cloudflare Worker or Discord interaction handler that signs a user up from a Discord button.

**Access:** Bearer token.

**Headers:**

```http
Authorization: Bearer <INTERNAL_PROFILE_LOOKUP_TOKEN or DISCORD_RULES_STATS_TOKEN or WORKER_STATS_TOKEN>
```

**Body:** JSON.

| Field | Type | Description |
|---|---:|---|
| `action` | string | `going`, `late`, `skipped`. |
| `userId` / `user_id` | string | Discord user id. |
| `userName` / `user_name` | string | Discord display name. |
| `channelId` / `channel_id` | string | Discord channel id of the source message. |
| `messageId` / `message_id` | string | Discord message id. |

**Important:** updates only the exact raid Discord message that changed.

---

### `GET /api/raids/[raidId]/snapshot`

Returns a live raid snapshot for polling.

**Access:** authenticated user. Unpublished raids require officer/dashboard.

**Response:**

```json
{
  "ok": true,
  "id": "...",
  "title": "...",
  "status": "published",
  "closed": false,
  "revision": "...",
  "updatedAt": "...",
  "roster": 10,
  "capacity": 20,
  "late": 1,
  "skipped": 2
}
```

---

### `POST /api/raids/[raidId]/close`

Closes a raid.

**Access:** officer/dashboard.

---

### `POST /api/raids/[raidId]/delete`

Deletes a raid.

**Access:** officer/dashboard.

## Discord

### `GET /api/discord/embeds/message`

Loads an existing Discord message for editing.

**Access:** officer/dashboard; rules messages are admin-only.

**Query:**

| Name | Type | Description |
|---|---:|---|
| `message` / `url` / `link` | string | Discord message link. |
| `mode` | string | `general` or `rules`. |

---

### `POST /api/discord/embeds/publish`

Publishes or edits a Discord embed.

**Access:** officer/dashboard; rules mode is admin-only.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `mode` | string | `general` or `rules`. |
| `ruleType` | string | `guild` or `raid`, rules only. |
| `action` | string | `publish` or `edit`. |
| `channelId` | string | Discord channel id. |
| `messageLink` | string | Required for editing. |
| `content` | string | Text above the embed. |
| `embedJson` | string | Embed JSON. |
| `roleIds` | string[] | Roles for mentions or rules accept. |
| `returnTo` | string | Return path after action. |

---

### `POST /api/discord/interactions`

Discord interaction endpoint for buttons.

**Access:** Discord only, verified with Ed25519 signature and `DISCORD_PUBLIC_KEY`.

**Supports:**

- Discord ping;
- direct guild-rules accept without dashboard login/profile checks;
- guild-rules decline confirmation;
- raid rules signup confirmation;
- raid attendance buttons `mbv1:raid:<raidId>:going|late|skipped`.

If a Cloudflare Worker handles interactions, this endpoint can remain as fallback.

## Content

### `POST /api/content/create`

Creates a news post or guide in the GitHub repository.

**Access:** admin.

**Body:** multipart form data.

| Field | Type | Description |
|---|---:|---|
| `kind` | string | `news` or `guides`. |
| `title` | string | Title. |
| `description` | string | SEO/preview description. |
| `body` | string | Markdown content. |
| `categories` | string | Categories. |
| `tags` | string | Tags. |
| `slug` | string | Slug. |
| `image` | File | Optional image. |

---

### `POST /api/content/update`

Updates an existing news post or guide.

**Access:** admin.

**Body:** multipart form data. Same fields as create, plus `path`, `date`, `lastModifiedAt`, `existingImage`, `removeImage`.

---

### `POST /api/content/delete`

Deletes a managed content file.

**Access:** admin.

**Body:** form data.

| Field | Type | Description |
|---|---:|---|
| `path` | string | Path to the news/guides markdown file. |

## Integrations

### `GET /api/integrations/status`

Returns compact integration status.

**Access:** officer/dashboard.

**Response:**

```json
{
  "checkedAt": "2026-05-01T00:00:00.000Z",
  "items": [
    {
      "key": "discord",
      "label": "Discord",
      "state": "ok",
      "message": "working",
      "checkedAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

Possible `state` values:

- `ok`;
- `warning`;
- `error`;
- `unconfigured`.
