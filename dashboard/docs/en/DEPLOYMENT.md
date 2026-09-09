# Deployment guide

## 1. What this is

Mistblossom Vanguard Dashboard is a private guild administration panel. It handles:

- Discord login and role-based access;
- Firebase Firestore applications;
- member profiles;
- Battle.net characters;
- Discord server nickname format;
- raids, rosters, and Discord signup buttons;
- Discord embed/rules editor;
- website content;
- integration status.

## 2. Stack

- Next.js 16 App Router;
- React 19;
- TypeScript;
- Firebase Admin SDK / Firestore;
- GitHub REST API;
- Discord OAuth + Bot API;
- Battle.net OAuth + WoW Profile API;
- your own Docker host (Nginx + Next.js standalone) for the dashboard;
- bot service container for Discord interactions.

## 3. Service preparation

### Discord

1. Create a Discord Application.
2. Add OAuth2 redirect:

```text
https://dashboard.lihvodruida.pp.ua/api/auth/discord/callback
```

3. Create a bot and invite it to the server.
4. Grant bot permissions:
   - View Channels;
   - Send Messages;
   - Embed Links;
   - Read Message History;
   - Manage Roles;
   - Manage Nicknames;
   - Kick Members if the rules “Decline” button is enabled.
5. The bot role must be higher than roles it assigns and higher than users it should rename.
6. The bot cannot rename the server owner. This is a Discord hierarchy limitation.

### Discord Interaction Endpoint

If interactions are handled by Worker:

```text
https://<worker-domain>/api/discord-interactions
```

If interactions are handled by the Next.js fallback:

```text
https://dashboard.lihvodruida.pp.ua/api/discord/interactions
```

The runtime that receives interactions must have `DISCORD_PUBLIC_KEY`.

### Battle.net

1. Create a Battle.net Developer Application.
2. Add redirect URI:

```text
https://dashboard.lihvodruida.pp.ua/api/auth/battlenet/callback
```

3. Fill `BATTLENET_CLIENT_ID` and `BATTLENET_CLIENT_SECRET`.
4. For Mistblossom Vanguard, a typical setup is:

```env
BATTLENET_ENABLED_REGIONS=eu
BATTLENET_DEFAULT_REGION=eu
BATTLENET_LOCALE=en_GB
WOW_GUILD_NAME=Mistblossom Vanguard
```

### GitHub

You need a token with:

- Firestore application collection read/write;
- Contents read/write if content admin is used.

Variables:

```env
GITHUB_OWNER=LihvoDruida
GITHUB_REPO=lihvodruida.github.io
GITHUB_TOKEN=...
GUILD_APPLICATIONS_LABEL=guild-application
GITHUB_CONTENT_BRANCH=main
```

### Firebase

1. Create a Firebase project.
2. Enable Firestore.
3. Create a Service Account key.
4. Set:

```env
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## 4. Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

For local testing, keep this disabled:

```env
SECURITY_REQUIRE_CLOUDFLARE=false
```

## 5. Production deploy on your own server

Full step-by-step guide: [`SELF_HOSTING.md`](SELF_HOSTING.md). Short version for
an already prepared server:

```bash
cd /srv/mistblossom
git pull
cp dashboard/.env.example dashboard/.env.production   # once, then just edit
nano dashboard/.env.production
./deploy/scripts/deploy.sh
```

`deploy.sh` builds the image, brings the stack up and waits for `/api/health`.
If the new image fails to come up, the script rolls back to the previous one, so
a bad deploy does not leave the dashboard down.

### Required environment

`.env.production` is read by the container at start. The exception is
`NEXT_PUBLIC_DASHBOARD_URL`: Next bakes it into the client bundle at build time,
so it is passed as a build arg via `DASHBOARD_PUBLIC_URL` in the `.env` file next
to `docker-compose.yml`.

```env
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua
```

The domain must match in all three. `DASHBOARD_ALLOWED_HOSTS` validates the
`Host` header of every POST: with a foreign domain there, every dashboard form
starts returning 403.

### Domain and TLS

An A record (and AAAA if you have IPv6) pointing at the server. The Let's Encrypt
certificate is issued by the `certbot` service from the same compose stack, and
Nginx serves the ACME challenge from `/.well-known/acme-challenge/`. Renewal runs
from the `mistblossom-certbot.timer` systemd timer.

### Scheduled jobs

Instead of managed cron jobs there is a `cron` container in the stack. It calls
the same endpoints over the internal network with
`Authorization: Bearer $CRON_SECRET`:

| Schedule | Endpoint | Purpose |
|----------|----------|---------|
| `*/10 * * * *` | `/api/raids/lifecycle` | publish and close raids |
| `*/5 * * * *` | `/api/polls/close-due` | auto-close raid polls |
| `0 4 * * *` (Kyiv) | `/api/dashboard/profiles/orphan-cleanup/apply` | account cleanup |

`CRON_SECRET` must match the value in `.env.production`; it is verified by
`verifyInternalBearerToken`.

## 6. Cloudflare Access / Zero Trust

Cloudflare Access can be used as an additional external gate.

Recommended setup:

- Protect application: `dashboard.lihvodruida.pp.ua`;
- Session duration: 12–24h;
- Allow only required emails or IdP groups;
- Keep internal Discord-role authorization enabled. Cloudflare Access is an extra layer, not a replacement.

If all production traffic definitely goes through Cloudflare, you can enable:

```env
SECURITY_REQUIRE_CLOUDFLARE=strict
```

Do not enable it on a staging host without Cloudflare: the dashboard will start rejecting every request.

## 7. Worker deploy

The Worker handles Discord interactions, rules buttons and raid buttons. It stays on Cloudflare: it sits in front of Discord, it is free, and moving it to your own server buys nothing.

Worker should have matching shared secrets:

```env
DISCORD_PUBLIC_KEY=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_RULES_STATS_TOKEN=...
WORKER_STATS_TOKEN=...
INTERNAL_PROFILE_LOOKUP_TOKEN=...
```

For Firebase application moderation, also add:

```env
GITHUB_OWNER=...
GITHUB_REPO=...
GITHUB_TOKEN=...
GUILD_APPLICATIONS_LABEL=...
```

If Worker calls dashboard lookup:

```http
GET https://dashboard.lihvodruida.pp.ua/api/profile/discord-lookup?discord_id=...
Authorization: Bearer <INTERNAL_PROFILE_LOOKUP_TOKEN>
```

## 8. Local checks before merge

For full local/CI validation, run:

```bash
npm run verify
npm run build:ci
```

The image build intentionally skips `typecheck` and `lint` (`ignoreBuildErrors: true` in `next.config.mjs`), so a deploy does not spend minutes on checks CI already ran. The strict gate is `npm run build:ci`.

## 9. Post-deploy checklist

### Login

- Open `/login`.
- Log in with Discord.
- Check role: member/moderator/admin.
- Verify that a member does not see admin sections.

### Profile

- Open `/profile`.
- Connect Battle.net.
- Add a character.
- Select main character.
- Set raid role preference.
- Set preferred name.
- Check Discord nickname preview.

### Raids

- Create a test raid.
- Save draft.
- Publish to Discord.
- Press a Discord signup button.
- Verify that only that raid message is updated.
- Verify live sync on the raid page.

### Applications

- Check application list.
- Check live filters.
- Accept/decline a test application.
- Verify GitHub labels.

### Discord editor

- Create a test embed.
- Load an existing message link.
- Check Desktop/Mobile preview.
- Check Discord limits.

### Integrations

- Open the dashboard.
- Check “System status”.
- Discord, Battle.net, GitHub, and Firebase should be `ok` or show a clear warning.

## 9. Commands

```bash
npm run dev        # local dev
npm run build      # production build
npm run start      # start built app
npm run typecheck  # TypeScript check
npm run lint       # lint, if next lint is available in the used Next.js version
```

## 10. Common issues

### Discord login does not work

Check:

- `DISCORD_OAUTH_CLIENT_ID`;
- `DISCORD_OAUTH_CLIENT_SECRET`;
- redirect URI in Discord Developer Portal;
- `DASHBOARD_URL`;
- `DASHBOARD_ALLOWED_HOSTS`.

### Bot does not change nickname

Possible reasons:

- bot lacks `Manage Nicknames`;
- bot role is lower than the user's role;
- user is the server owner;
- wrong `DISCORD_GUILD_ID`;
- wrong `DISCORD_BOT_TOKEN`.

### Battle.net does not show characters

Check:

- Battle.net redirect URI;
- `BATTLENET_ENABLED_REGIONS`;
- `WOW_GUILD_NAME`;
- whether the character is actually in the guild;
- locale/realm filter.

### Firebase private key error

In `.env.production` the private key must be a single line with escaped newlines (the code converts `\\n` back to real ones):

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Worker cannot call dashboard

Make sure the token matches:

```env
INTERNAL_PROFILE_LOOKUP_TOKEN=...
```

and Worker sends:

```http
Authorization: Bearer <token>
```
