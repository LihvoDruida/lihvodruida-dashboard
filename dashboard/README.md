# Mistblossom Vanguard Dashboard

Private dashboard panel for the **Mistblossom Vanguard** guild: applications, profiles, Battle.net characters, raids, Discord messages, rules, website content, and integration status.

## Features

- Discord login with role-based access: member, newcomer mentor, officer, guildmaster.
- Member profiles with Battle.net characters.
- Main character and raid role preference.
- Discord server nickname standardization: `Name [Main, Alt1, Alt2]`.
- Character data auto-refresh before raid signup.
- Raid announcements with Discord signup buttons.
- Live raid page updates without manual refresh.
- Guild applications through Firebase Firestore.
- Dynamic application filters without full page reload.
- Discord embed/rules editor with live preview, limits, and mobile/desktop preview.
- Content management for website news and guides.
- Compact status panel for Discord, Battle.net, GitHub, and Firebase.

## Stack

- Next.js 15 App Router;
- React 19;
- TypeScript;
- Firebase Admin SDK / Firestore;
- GitHub REST API;
- Discord OAuth + Bot API;
- Battle.net OAuth + WoW Profile API;
- Vercel;
- Cloudflare Worker if interactions are moved outside the dashboard.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

## Production

```bash
npm run verify
npm run build
npm run start
```

`npm run verify` runs TypeScript typecheck and ESLint through the modern ESLint CLI.

For Vercel, use the standard Next.js deployment. Do not set a manual output directory.

## Main environment variables

A production deployment usually needs:

```env
SESSION_SECRET=
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua

DISCORD_OAUTH_CLIENT_ID=
DISCORD_OAUTH_CLIENT_SECRET=
DISCORD_GUILD_ID=
# Access groups are configured in Firebase from /dashboard/groups.
# System group IDs: admin=1, moderator=2, mentor=3, member=99. Only 1, 2 and 99 have fixed IDs.
DISCORD_LIVE_ACCESS_SYNC_SECONDS=90
DISCORD_ROLES_CACHE_SECONDS=300
DISCORD_BOT_TOKEN=

GITHUB_OWNER=LihvoDruida
GITHUB_REPO=lihvodruida.github.io
GITHUB_TOKEN=
GUILD_APPLICATIONS_LABEL=guild-application

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

BATTLENET_CLIENT_ID=
BATTLENET_CLIENT_SECRET=
BATTLENET_ENABLED_REGIONS=eu
WOW_GUILD_NAME=Mistblossom Vanguard

RAID_RULES_URL=
RAID_IMAGES_BRANCH=live
RAID_IMAGES_DIRECTORY=assets/img/raids-img
RAID_IMAGES_PUBLIC_BASE_URL=https://lihvodruida.pp.ua
RAID_TIME_ZONE=Europe/Kyiv
NEXT_PUBLIC_RAID_TIME_ZONE=Europe/Kyiv
```

See the full environment documentation for all variables and Worker sharing notes.

## Documentation

- [Functionality overview](docs/en/FUNCTIONALITY.md)
- [API documentation](docs/en/API.md)
- [Environment variables](docs/en/ENVIRONMENT_VARIABLES.md)
- [Deployment guide](docs/en/DEPLOYMENT.md)
- [Admin to dashboard domain and GitHub move](docs/ua/DASHBOARD_DOMAIN_AND_GITHUB_MOVE.md)
- [Український README](README.uk.md)

## Access roles

- **Member:** profile, characters, raids, signup, rules.
- **Newcomer mentor:** all member rights plus read-only applications without BattleTag/source links. Admins and moderators keep full application data, including BattleTag.
- Live role sync requires `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`; if Discord is temporarily unavailable, admin/moderator/mentor sessions are downgraded to member until the next successful check.
- Discord auth now checks guild membership, server bans, and duplicate character ownership before allowing login. Live session refresh also removes the Firebase profile when the user has left the server. The bot needs access to read guild bans.
- **Officer:** applications, profiles, raids, rosters, moderation, Discord embeds.
- **Guildmaster:** full access, rules, content, system status.

## Important notes

- The bot cannot change the Discord server owner's nickname.
- To change a nickname, the bot role must be higher than the user's highest role.
- If Discord interactions are handled by Worker, the Discord Developer Portal Interaction Endpoint must point to Worker.
- If Worker calls the dashboard, shared tokens must match.
- In Vercel, `FIREBASE_PRIVATE_KEY` is usually stored with escaped `\n`.

## Guild roster `/guild`

The `/guild` page is available to every authenticated dashboard role: member, newcomer mentor, moderator, and admin. Character cards link to the owner profile only when the character is uniquely associated with one profile; duplicate ownership is intentionally left unlinked.
It displays a live guild roster from the Battle.net Guild Roster API and Raider.IO: `ALL`, `DPS`, `HEALER`, `TANK` RIO, item level, class, spec, role, faction, and Raider.IO profile links.

The dashboard no longer depends on `scripts/update_guild.py` or generated files for this page. Runtime code fetches the roster server-side, stores the result in Firebase cache, and falls back to short in-memory cache when Firebase is not configured.

Main variables:

```env
GUILD_ROSTER_REGION=eu
GUILD_ROSTER_REALM=terokkar
GUILD_ROSTER_NAME=Mistblossom Vanguard
GUILD_ROSTER_CACHE_TTL_SECONDS=1800
PROFILE_CHARACTER_LINK_CACHE_SECONDS=120
GUILD_ROSTER_REFRESH_CONCURRENCY=6
GUILD_ROSTER_MEMBER_LIMIT=500
RAIDERIO_ACCESS_KEY=
```

`BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` or `BATTLENET_CLIENT_ID` / `BATTLENET_CLIENT_SECRET` are required for the Battle.net application token. The “Refresh roster” button calls `/api/guild/refresh` and rebuilds the cache from Battle.net + Raider.IO.

## Discord role gate for auth and rules registration

`/dashboard` → `Management` has an **Authorization and registration** card. Select the Discord role required to sign in to the dashboard or complete rules registration.

The policy is stored in Firebase:

```text
/dashboardSettings/authAccessPolicy
```

Env fallback:

```env
AUTH_ACCESS_RESTRICTIONS_ENABLED=true
AUTH_ACCESS_REQUIRE_CONFIGURED_ROLE=true
AUTH_ACCESS_ALLOW_SERVER_OWNER=true
AUTH_ACCESS_ALLOW_EMERGENCY_TOKEN_LOGIN=false
AUTH_ACCESS_REQUIRED_ROLE_IDS=
```

The safe default is strict mode: `AUTH_ACCESS_REQUIRE_CONFIGURED_ROLE=true`. If no role is selected, only the Discord server owner can pass OAuth when owner bypass is enabled. `AUTH_ACCESS_ALLOW_EMERGENCY_TOKEN_LOGIN=false` keeps the legacy token login from bypassing Discord membership and role checks.
