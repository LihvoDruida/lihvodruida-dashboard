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
- Vercel for the dashboard;
- optional Cloudflare Worker for Discord interactions.

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

## 5. Production deploy on Vercel

1. Import the repo into Vercel.
2. Framework preset: Next.js or Auto-detect.
3. Node.js version in Vercel Project Settings: `24.x`. The repo no longer contains `engines`, `.nvmrc`, `.node-version`, or `packageManager`, so it does not fight the settings Vercel automatically provides.
4. Install Command: leave empty / Auto. Vercel will detect npm from `package-lock.json`.
5. Build Command: leave empty / Auto. Vercel will use the standard `npm run build`, and `prebuild` will run the legacy middleware cleanup automatically.
6. Do not set a manual output directory for Next.js.
7. Add production environment variables.
8. Add domain:

```text
dashboard.lihvodruida.pp.ua
```

9. Check `DASHBOARD_ALLOWED_HOSTS`:

```env
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua
```

10. Check canonical URLs:

```env
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
```

## 6. Cloudflare Access / Zero Trust

Cloudflare Access can be used as an additional external gate.

Recommended setup:

- Protect application: `dashboard.lihvodruida.pp.ua`;
- Session duration: 12–24h;
- Allow only required emails or IdP groups;
- Keep internal Discord-role authorization enabled. Cloudflare Access is an extra layer, not a replacement.

If all production traffic definitely goes through Cloudflare, you can enable:

```env
SECURITY_REQUIRE_CLOUDFLARE=true
```

Do not enable it for Vercel Preview.

## 7. Worker deploy

Worker is needed if Discord interactions, rules buttons, or raid buttons are handled outside Vercel.

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

Vercel deploy intentionally skips `typecheck` and `lint`, so production deployment does not spend minutes on duplicated checks.

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

In Vercel the private key should use escaped newlines:

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
