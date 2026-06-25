# Worker functionality overview

This Worker is the server-side integration layer for Mistblossom Vanguard between the public site, GitHub, Discord, the admin dashboard, and Cloudflare KV.

## 1. Guild applications

The Worker accepts applications from the public site through `POST /api/guild-applications` or `POST /`.

### Create flow

1. Validates the request `Origin` against `ALLOWED_ORIGINS`.
2. Reads a JSON body with an approximate 96 KB limit.
3. Rejects the honeypot field `website` if it is filled.
4. Normalizes application fields:
   - `region`;
   - `characterName`;
   - `faction`;
   - `realm`;
   - `className`;
   - `discord`;
   - `battleTag`;
   - `sourceCreator` / `sourcePlatform` / `sourceOther`;
   - `availability`.
5. Validates required fields:
   - `region`;
   - `characterName`;
   - `faction`;
   - `realm`;
   - `availability`.
6. Requires `battleTag` when faction is `horde`.
7. Creates a GitHub Issue in `GITHUB_OWNER/GITHUB_REPO`.
8. Adds labels:
   - `GUILD_APPLICATIONS_LABEL`, default `guild-application`;
   - `status:review`.
9. Sends a Discord embed to `DISCORD_CHANNEL_ID` when `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` are configured.
10. Fetches a Raider.IO profile and adds Mythic+ and raid progression fields to the embed.
11. Adds Discord buttons: `Accept` / `Decline`.
12. Stores a Discord message reference in the GitHub Issue body when possible.

### Async Discord notification

By default, Discord notification is executed through `ctx.waitUntil` so the submitter receives a response quickly after the GitHub Issue is created. This is controlled by `APPLICATION_DISCORD_ASYNC`.

- `APPLICATION_DISCORD_ASYNC=1` or unset — Discord notification is queued in the Worker runtime.
- `APPLICATION_DISCORD_ASYNC=0` — the Worker waits for the Discord notification before responding.

## 2. Application listing

`GET /api/guild-applications` and `GET /` read GitHub Issues with label `GUILD_APPLICATIONS_LABEL`.

Supported behavior:

- GitHub page fetching;
- status filters: `review`, `accepted`, `declined`, `all`;
- aliases: `pending`, `approved`, `rejected`;
- class filter;
- text search via `q`;
- sorting by `created` or `updated`;
- direction `asc` or `desc`;
- diagnostics only when debug is explicitly enabled.

The response returns normalized application items: issue number, status, character, realm, region, faction, class, labels, GitHub URL, and dates.

## 3. Application moderation through Discord buttons

Application embeds contain buttons:

- `guild_application:accepted:<issueNumber>`;
- `guild_application:declined:<issueNumber>`.

When a moderator clicks a button, the Worker:

1. Verifies the Discord request signature with `DISCORD_PUBLIC_KEY`.
2. Checks moderator roles through `DISCORD_ALLOWED_ROLES` if configured.
3. Applies a 2.5 second per-user cooldown.
4. Reads the GitHub Issue.
5. Removes old status labels.
6. Adds `status:accepted` or `status:declined`.
7. Closes the GitHub Issue:
   - accepted → `state_reason: completed`;
   - declined → `state_reason: not_planned`.
8. Adds a GitHub Issue comment with the moderator name.
9. Updates the Discord message color, status, footer, and timestamp.
10. Removes buttons from the public message.

## 4. Discord rules buttons

The Worker supports rules buttons with the `mbv1` prefix.

### Guild rules flow

Guild-rules acceptance is intentionally simple:

1. The public embed contains the `Accept rules` button.
2. The member clicks the button.
3. The Worker immediately assigns one or more configured roles through the Discord API.
4. Dashboard login, profile, Battle.net, main character, and website navigation are not required.
5. The result is returned privately to that member.

The `Decline` button still uses a safety confirmation because the final action kicks the member from the server.

### Rules actions

- Accept rules: the Worker immediately assigns one or more roles through the Discord API.
- Decline rules: after confirmation, the Worker kicks the user from the server.
- Repeated accepts do not duplicate statistics.
- If the user already has all target roles, the Worker says the action is already complete.

### Rules statistics

When the `RULES_STATS` KV binding is configured, the Worker stores:

- `rules:<guildId>:accepted`;
- `rules:<guildId>:declined`;
- `rules:<guildId>:user:<discordId>`;
- `rules:<guildId>:updated_at`.

A single user cannot inflate the counters by clicking repeatedly. If their decision changes, the previous counter is adjusted.

## 5. Raid-rules signup

Raid-rules buttons use the same `/api/discord-interactions` endpoint but a separate KV namespace prefix.

Flow:

1. The user clicks the raid-rules signup button.
2. The Worker opens a confirmation ephemeral panel.
3. After confirmation, the Worker calls the dashboard profile lookup endpoint.
4. The dashboard must confirm that the Discord user is authorized and has a selected main character.
5. If the profile or main character is missing, the Worker returns a private message with buttons for login, profile, raid rules, and optionally the raid page.
6. If verification passes, the Worker writes the signup to KV.

KV keys:

- `raid-rules:<guildId>:user:<discordId>`;
- `raid-rules:<guildId>:updated_at`.

The signup record stores:

- Discord ID;
- Discord label/name;
- dashboard profile id;
- selected main character;
- signup timestamp.

## 6. Raid announcement buttons

The Worker supports custom IDs:

```text
mbv1:raid:<raidId>:going
mbv1:raid:<raidId>:late
mbv1:raid:<raidId>:skipped
```

These buttons do not mutate raid state directly inside the Worker. The Worker proxies the action to the dashboard endpoint:

```text
/api/raids/<raidId>/discord-action
```

or to `DASHBOARD_RAID_ACTION_ENDPOINT` if it is explicitly configured.

The Worker passes to the dashboard:

- action: `going`, `late`, `skipped`;
- Discord user id;
- Discord user label;
- guild id;
- channel id;
- message id;
- source marker `discord-interaction-worker`.

The dashboard returns content/components that the Worker shows to the user as an ephemeral response. If the dashboard reports that authorization or a main character is required, the Worker adds help buttons.

## 7. Relay Discord raid messages

`POST /api/discord-raid-message` lets the dashboard create, edit, or delete Discord raid announcement messages through the Worker.

Supported actions:

- `create`;
- `edit`;
- `delete`.

The endpoint is protected by a bearer/stats token and never enables unrestricted mentions. Role mentions are only allowed through an explicit role ID list.

## 8. Discord channel list

`GET /api/discord-guild-channels` reads the guild and channels through the Discord Bot API.

Only text/news channels are returned:

- `type = 0` — text channel;
- `type = 5` — announcement/news channel.

The Worker also tries to suggest a channel when its name contains `raid`, `рейд`, `анонс`, `announce`, or `оголош`.

## 9. CORS and security

The Worker allows only origins from:

- `ALLOWED_ORIGINS`;
- `SITE_BASE_URL`;
- `PUBLIC_SITE_URL`;
- `ADMIN_DASHBOARD_URL`;
- `DASHBOARD_URL`;
- hardcoded fallbacks `https://lihvodruida.pp.ua` and `https://admin.lihvodruida.pp.ua`.

Stats/message endpoints can additionally require a token:

- `Authorization: Bearer <token>`;
- or `X-Worker-Stats-Token: <token>`.

Debug responses through `?debug=1` or `?diag=1` work only when `ALLOW_DEBUG_QUERY=1`. Production should keep `ALLOW_DEBUG_QUERY=0`.

## 10. Observability

The Worker adds telemetry headers:

- `X-Guild-Worker-Request-Id`;
- `X-Guild-Worker-Duration-Ms`.

Logs pass through a sanitizer that redacts tokens, emails and authorization-like fields.
