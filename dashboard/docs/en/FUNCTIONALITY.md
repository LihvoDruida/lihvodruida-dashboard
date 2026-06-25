# Mistblossom Vanguard Dashboard — functionality overview

## 1. Summary

The Dashboard is a private administration panel for the **Mistblossom Vanguard** guild. It combines member profiles, Battle.net characters, Discord server names, guild applications, raid announcements, Discord embeds, rules, and website content management.

The project uses **Next.js App Router** as a server-side application. Profiles and raids are stored in **Firebase Firestore**, guild applications are read and moderated through **Firebase Firestore**, and Discord actions are performed through Discord Bot API or a Cloudflare Worker.

## 2. Roles

### Member

A member sees only what is relevant to them:

- own profile;
- own Battle.net characters;
- main character selection;
- raid role preference;
- raids and raid signup;
- rules.

A member does not see:

- other users' applications;
- other users' profiles;
- technical status blocks;
- Discord admin tools;
- content admin tools;
- moderation buttons.

### Officer

An officer can work with:

- guild applications;
- member profiles;
- raids;
- raid rosters;
- general Discord embed messages;
- application moderation actions.

Some guildmaster-only actions, such as rules management, may still be hidden from officers.

### Guildmaster / Admin

An admin can see and manage everything:

- applications;
- profiles;
- raids;
- Discord embed editor;
- rules;
- rules statistics;
- website content;
- integration status panels;
- full staff-only details.

## Guild roster

The `/guild` page is available to members, newcomer mentors, officers, and admins. It shows a live guild roster without pre-generated files:

- character list from the Battle.net Guild Roster API;
- Raider.IO M+ ratings for `ALL`, `DPS`, `HEALER`, `TANK`;
- item level, class, spec, role, faction, realm, and avatar;
- header statistics: average RIO, average item level, max RIO/item level;
- “Armor type” and “Average guild RIO” statistic blocks;
- filters for RIO, item level, class, spec, role, faction, and text search.

Refreshes run through the runtime endpoint `/api/guild/refresh`. The result is cached in Firebase Firestore or in in-memory cache when Firebase is not configured. Character-to-profile links are cached with `PROFILE_CHARACTER_LINK_CACHE_SECONDS` and are omitted when the same character appears in multiple profiles.

## 3. Authentication

### Discord login

Discord OAuth is the primary login method.

After login, the system:

1. validates the Discord user id;
2. fetches the user's guild roles;
3. resolves dashboard access from Firebase groups configured on `/dashboard/groups`; Discord role ID are stored on the groups, not in env;
4. creates a signed server-side session cookie;
5. creates or updates the Firebase profile.

### Emergency token login

`ADMIN_DASHBOARD_TOKEN` is available as an emergency admin fallback. Keep it secret and rotate it after use.

### GitHub OAuth

GitHub OAuth routes exist as a fallback, but the current access model is centered around Discord.

## 4. Member profile

The profile is the main member-facing area.

### Stored profile data

- Discord provider id;
- display name;
- avatar;
- stable profile id;
- preferred real/display name;
- Battle.net sync state;
- saved characters;
- main character;
- raid role preference;
- last synchronized Discord server nickname.

### `Name` field

A member can set a preferred name used for the Discord server nickname.

Nickname format:

```text
Name [Main, Alt1, Alt2]
```

Example:

```text
Dmytro [Khayen, Krouli, Sebas]
```

Rules:

- the first character inside brackets is always the main character;
- up to 3 characters are shown;
- if the Discord 32-character nickname limit is exceeded, the system shortens the character list while keeping the main character first;
- the bot cannot rename the server owner because of Discord hierarchy restrictions, so the owner gets a copy-only flow.

### Discord nickname sync

After saving the preferred name, the user can apply the server nickname.

The system:

1. builds a nickname plan;
2. checks the current server nickname;
3. shows the “Current on server” block when it does not match the expected format;
4. calls Discord API for regular members;
5. lets the server owner copy the prepared nickname manually.

## 5. Battle.net characters

Battle.net OAuth is used to fetch the user's characters.

### Main flow

1. The member connects Battle.net.
2. The system redirects to Battle.net OAuth.
3. The callback exchanges the code for a token.
4. The system scans the account's characters.
5. Characters are filtered by `WOW_GUILD_NAME`.
6. Candidates are stored temporarily on the Firebase profile with the `BATTLENET_CANDIDATE_TTL_MINUTES` TTL.
7. The member selects which characters to save in the profile.

### Saved character fields

For each character, the profile stores:

- name;
- realm;
- region;
- class;
- specialization;
- role;
- item level;
- media/avatar;
- profile url;
- last updated timestamp.

### Main character

The main character is used for:

- Discord nickname format;
- profile ordering;
- raid signup;
- role resolution when no manual raid role is selected.

### Auto refresh before raid signup

Before a raid signup action, the system attempts to refresh saved character data without requiring another Battle.net login.

Order:

1. main character first;
2. other saved characters afterwards;
3. if Battle.net is temporarily unavailable, the signup still works with the last stored snapshot.

## 6. Raid role preference

The profile supports a raid role preference:

- Auto;
- Tank;
- Healer;
- DPS.

Priority:

```text
if a manual role is selected → use it
otherwise → use the main character role
```

The manual role is attached to the current main character. If the main character is changed or removed, the manual role is cleared.

## 7. Raids

The raid system lets officers create raid announcements, publish them to Discord, and build the roster.

### Main raid fields

- title;
- difficulty: normal, heroic, mythic;
- date;
- time;
- Discord channel;
- Markdown description;
- consumables: own/guild;
- loot mode;
- composition;
- minimum item level;
- max players;
- thumbnail/image;
- role mentions for Discord;
- status: draft, published, closed.

### Discord publishing

An officer or admin can:

- save a draft;
- publish the raid to Discord;
- update the existing Discord message;
- close the raid;
- delete the raid.

When the roster changes, only the exact Discord message connected to that raid is updated. The system does not update every raid message.

### Raid signup

A user can choose:

- Going;
- Late;
- Skipped.

Signup works both from the website and from Discord buttons.

### Member visibility

A regular member sees:

- basic raid information;
- rules/link information;
- signup buttons;
- detailed party roster;
- raid average item level;
- raid minimum item level.

A regular member does not see:

- individual character item levels;
- staff-only action buttons;
- technical data;
- drafts.

Officers and admins see the full roster, individual item levels, and staff warnings.

### Live updates

The raid page has live sync:

- snapshot polling runs roughly every 10 seconds;
- if roster or status changes, the page refreshes through `router.refresh()`;
- signup buttons work without a full page reload.

## 8. Guild applications

Applications are read from Firebase Firestore.

### Supported features

- application list;
- statuses: review, accepted, declined;
- status/class/search filters;
- live filters without normal form submit;
- debounced search;
- query params in the URL;
- bulk status updates;
- moderation event in Firestore;
- synchronized status labels.

### Data source

Firebase applications are stored in the `FIREBASE_APPLICATIONS_COLLECTION` collection. The default is `guildApplications`.

Statuses are stored as labels:

- `status:review`;
- `status:accepted`;
- `status:declined`.

The code also cleans up legacy/broken labels from older versions.

## 9. Discord embed editor

The panel can create and edit Discord embed messages.

### General embeds

Available to officers and admins:

- content above embed;
- embed title;
- description;
- color;
- author;
- footer;
- fields;
- role mentions;
- editing an existing message by message link.

### Rules embeds

Available to admins.

Supports:

- guild rules;
- raid rules;
- accept/decline buttons;
- role assignment after acceptance;
- kick after decline;
- rules statistics through Worker endpoints.

### Dynamic preview

The editor includes:

- live preview;
- desktop/mobile preview mode;
- Discord Markdown preview;
- counters for Discord limits;
- warnings for Markdown problems;
- publish blocking when strict Discord limits are exceeded.

## 10. Integration status

Staff users see a compact “System status” panel.

It checks:

- Discord;
- Battle.net;
- Firebase Firestore;
- Firebase.

Status can be refreshed manually and is also refreshed automatically about once per minute.

## 11. Website content

Admins can manage website content:

- news;
- guides;
- slug;
- description;
- body;
- categories;
- tags;
- images;
- update/delete.

Files are created or updated through GitHub Contents API on `GITHUB_CONTENT_BRANCH`.

## 12. Security

The dashboard uses several layers of protection:

- signed session cookie;
- OAuth state cookie;
- HMAC-based profile ids;
- trusted origin checks;
- allowed hosts;
- optional Cloudflare-only mode;
- nonce-based CSP middleware;
- noindex/noarchive headers;
- rate limits for sensitive actions;
- body size limits;
- server-only secrets;
- member/moderator/admin UI separation.

## 13. Mobile UX

Recent UI work standardizes:

- typography;
- spacing;
- mobile containers;
- bottom navigation;
- mobile toasts;
- touch-friendly buttons;
- compact cards;
- metric grids.

The goal is to make the mobile version feel like a usable app rather than a compressed desktop site.

Live Discord access sync: on each signed-in session, the dashboard periodically re-checks the user's current guild roles with the Discord bot and recalculates dashboard permissions from the ENV role mapping.
