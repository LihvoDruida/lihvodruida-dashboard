# Deployment guide

This is a production-oriented deployment guide for the `guild-applications-worker` Cloudflare Worker.

## 1. Prerequisites

You need:

- Cloudflare account;
- Wrangler installed;
- GitHub token with access to repository Issues;
- Discord Developer Application + Bot;
- Discord server ID, bot token, application public key;
- admin dashboard URL;
- shared server-to-server tokens for dashboard integration.

Install Wrangler:

```bash
npm install -g wrangler
wrangler login
```

Open the Worker directory:

```bash
cd workers/guild-applications-worker
```

## 2. GitHub token

The token must have access to Issues in `GITHUB_OWNER/GITHUB_REPO`.

For a fine-grained token, you normally need:

- Repository access: target repo;
- Issues: Read and write;
- Metadata: Read.

Add the secret:

```bash
wrangler secret put GITHUB_TOKEN
```

## 3. Discord application and bot

In Discord Developer Portal:

1. Create an Application or open the existing bot.
2. Copy `Public Key` → `DISCORD_PUBLIC_KEY`.
3. Enable Bot and copy its token → `DISCORD_BOT_TOKEN`.
4. Set the Interactions Endpoint URL to:

```text
https://<worker-domain>/api/discord-interactions
```

5. Invite the bot to the server with permissions:
   - Send Messages;
   - Embed Links;
   - Read Message History;
   - Manage Roles;
   - Kick Members.

For role assignment, the bot role must be higher than the roles it assigns.

Secrets:

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_GUILD_ID
wrangler secret put DISCORD_CHANNEL_ID
```

`DISCORD_CHANNEL_ID` is needed for new application notifications. If omitted, applications will still be created in GitHub, but Discord notification will be skipped.

## 4. Cloudflare KV for rules

Create a KV namespace:

```bash
wrangler kv namespace create RULES_STATS
```

Wrangler will return an id. Add it to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RULES_STATS"
id = "paste_kv_namespace_id_here"
```

This binding is needed for:

- normal rules accept/decline statistics;
- raid-rules signup list.

Without KV, the Worker will not crash, but stats/signups will return `configured: false`.

## 5. Configure vars in `wrangler.toml`

Example production vars:

```toml
[vars]
GITHUB_OWNER = "LihvoDruida"
GITHUB_REPO = "lihvodruida.github.io"
GUILD_APPLICATIONS_LABEL = "guild-application"
ALLOWED_ORIGINS = "https://lihvodruida.pp.ua,https://www.lihvodruida.pp.ua,https://admin.lihvodruida.pp.ua"
DISCORD_ALLOWED_ROLES = ""
ADMIN_DASHBOARD_URL = "https://admin.lihvodruida.pp.ua"
DASHBOARD_PROFILE_LOOKUP_ENDPOINT = "https://admin.lihvodruida.pp.ua/api/profile/discord-lookup"
RAID_RULES_URL = "https://discord.com/channels/<guild>/<channel>/<message>"
ALLOW_DEBUG_QUERY = "0"
```

For local development, use `.dev.vars` based on `.dev.vars.example`.

## 6. Shared tokens with dashboard

Generate strong random values for:

- `INTERNAL_PROFILE_LOOKUP_TOKEN`;
- `DISCORD_RULES_STATS_TOKEN`.

Add them to the Worker:

```bash
wrangler secret put INTERNAL_PROFILE_LOOKUP_TOKEN
wrangler secret put DISCORD_RULES_STATS_TOKEN
```

Add the same values to the dashboard environment.

The dashboard should use `DISCORD_RULES_STATS_TOKEN` when reading/calling:

```text
/api/discord-rules-stats
/api/discord-raid-rules-stats
/api/discord-raid-rules-signups
/api/discord-raid-message
/api/discord-guild-channels
```

## 7. Cloudflare Access for dashboard

If `admin.lihvodruida.pp.ua` is protected by Cloudflare Access:

1. Create a Cloudflare Access Service Token.
2. Add a policy that allows this Service Token to access:

```text
https://admin.lihvodruida.pp.ua/api/profile/discord-lookup
https://admin.lihvodruida.pp.ua/api/raids/*/discord-action
```

3. Add secrets to the Worker:

```bash
wrangler secret put CF_ACCESS_CLIENT_ID
wrangler secret put CF_ACCESS_CLIENT_SECRET
```

`INTERNAL_PROFILE_LOOKUP_TOKEN` is still required. Cloudflare Access lets the request reach the dashboard, while the dashboard token protects the API route itself.

## 8. Deploy

```bash
wrangler deploy
```

After deployment, test:

```bash
curl https://<worker-domain>/api/guild-applications
```

If GitHub vars/secrets are missing, an application-unavailable error is expected.

## 9. Test stats endpoint

If `DISCORD_RULES_STATS_TOKEN` is configured:

```bash
curl \
  -H "Authorization: Bearer <token>" \
  "https://<worker-domain>/api/discord-rules-stats?guild_id=<guildId>"
```

Expected response even before clicks:

```json
{
  "configured": true,
  "guild_id": "<guildId>",
  "rules_type": "guild",
  "namespace": "rules",
  "accepted": 0,
  "declined": 0,
  "total": 0,
  "source": "kv"
}
```

## 10. Test Discord interactions

In Discord Developer Portal, save the Interaction Endpoint URL. Discord will send a ping. If the Worker verifies the signature correctly, the URL will be accepted.

If Discord rejects the endpoint:

- check `DISCORD_PUBLIC_KEY`;
- check that the route is exactly `/api/discord-interactions`;
- check that the Worker is deployed;
- inspect Cloudflare Worker logs.

## 11. Test application create

Test request:

```bash
curl -X POST "https://<worker-domain>/api/guild-applications" \
  -H "Content-Type: application/json" \
  -H "Origin: https://lihvodruida.pp.ua" \
  --data '{
    "region":"eu",
    "characterName":"Khayen",
    "faction":"Alliance",
    "realm":"Terokkar",
    "className":"Druid",
    "discord":"Dmytro",
    "battleTag":"",
    "sourceCreator":"Discord",
    "sourcePlatform":"Discord",
    "availability":"Evenings after 20:00",
    "website":""
  }'
```

Expected result:

- GitHub Issue is created;
- Issue has labels `guild-application`, `status:review`;
- Discord notification is created if `DISCORD_CHANNEL_ID` and bot token are correct;
- response contains `ok: true`.

## 12. Production hardening checklist

- `ALLOW_DEBUG_QUERY=0`.
- `DEBUG_RESPONSES` is unset or `0`.
- `ALLOWED_ORIGINS` contains only required origins.
- `DISCORD_RULES_STATS_TOKEN` is set and matches dashboard.
- `INTERNAL_PROFILE_LOOKUP_TOKEN` is set and matches dashboard.
- Bot role is higher than roles it assigns.
- `RULES_STATS` KV binding is active.
- Cloudflare Access Service Token is configured if dashboard is protected.
- Discord Interaction Endpoint URL points to the deployed Worker.

## 13. Rollback

Cloudflare Workers keeps deployments. If needed:

```bash
wrangler deployments list
wrangler rollback
```

Before rollback, verify that the problem is not caused by secrets/vars. Rolling back code will not fix incorrect environment configuration.
