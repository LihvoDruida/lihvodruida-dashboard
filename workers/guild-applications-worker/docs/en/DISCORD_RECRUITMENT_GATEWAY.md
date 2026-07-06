# Discord Recruitment Gateway Advisor

This integration moves the Discord message listener to Cloudflare Worker. Vercel no longer keeps a cron job or WebSocket alive. A Cloudflare Durable Object connects to Discord Gateway, listens for `MESSAGE_CREATE`, and relays the message to the dashboard endpoint:

```text
POST https://dashboard.lihvodruida.pp.ua/api/discord/recruitment-advice/message
```

The dashboard remains responsible for analyzing the guild roster, Raider.IO, missing classes/specs, raid utility and generating the final reply. The Worker only listens to Discord and reliably delivers the event.

## Flow

```text
Discord MESSAGE_CREATE
        ↓
Cloudflare Durable Object DiscordRecruitmentGateway
        ↓
POST /api/discord/recruitment-advice/message on dashboard
        ↓
roster / RIO / utility / deficit analysis
        ↓
reply in the same Discord channel_id or thread_id
```

## Required Discord Developer Portal settings

Enable the bot intents:

```text
Message Content Intent — required
```

Default Gateway intents sent by the Worker:

```text
GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT = 33281
```

## Cloudflare secrets

In `workers/guild-applications-worker`, add production secrets:

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_GUILD_ID
wrangler secret put DISCORD_RECRUITMENT_ADVICE_SECRET
```

`DISCORD_RECRUITMENT_ADVICE_SECRET` must match the dashboard value on Vercel.

If the dashboard is protected by Cloudflare Access, also add:

```bash
wrangler secret put CF_ACCESS_CLIENT_ID
wrangler secret put CF_ACCESS_CLIENT_SECRET
```

## Vercel/dashboard env

The dashboard needs:

```env
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_RECRUITMENT_ADVICE_ENABLED=true
DISCORD_RECRUITMENT_ADVICE_SECRET=same_secret_as_worker
```

## Start

After deployment, the Worker starts the Gateway from the existing Cloudflare cron `*/10 * * * *`. This is not a Vercel cron, so the Vercel Hobby cron limitation does not apply.

Status check:

```bash
curl -H "Authorization: Bearer $WORKER_STATS_TOKEN" \
  "https://guild-applications-worker.<account>.workers.dev/api/discord-recruitment-gateway?action=status"
```

Manual start/reconnect:

```bash
curl -X POST -H "Authorization: Bearer $WORKER_STATS_TOKEN" \
  "https://guild-applications-worker.<account>.workers.dev/api/discord-recruitment-gateway?action=start"

curl -X POST -H "Authorization: Bearer $WORKER_STATS_TOKEN" \
  "https://guild-applications-worker.<account>.workers.dev/api/discord-recruitment-gateway?action=reconnect"
```


## Startup backfill

Discord Gateway only delivers live `MESSAGE_CREATE` events. The Worker also calls the dashboard scan for the last 48 hours after the gateway starts/reconnects, so messages sent before the Durable Object connected can still receive an automatic answer.

Config:

```env
DISCORD_RECRUITMENT_BACKFILL_ENABLED=1
DISCORD_RECRUITMENT_BACKFILL_MIN_INTERVAL_MS=1800000
DISCORD_RECRUITMENT_BACKFILL_LIMIT=4
DASHBOARD_RECRUITMENT_ADVICE_SCAN_ENDPOINT=https://dashboard.lihvodruida.pp.ua/api/discord/recruitment-advice?limit=4
```
