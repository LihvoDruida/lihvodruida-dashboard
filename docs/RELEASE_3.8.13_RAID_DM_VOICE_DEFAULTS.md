# v3.8.13 — Raid DM reminders, voice channel and editor defaults

Raid signup and reminder delivery now keep enough Discord identity context to reliably notify every active participant before raid start.

## Signup identity

- Every signup path converges through `recordRaidSignup`.
- Before persistence, the dashboard resolves the current guild member snapshot and stores the Discord server nickname, username and global name together with the stable Discord user ID.
- Website signup, Discord interactions and manual class/spec signup therefore use the same persistence path.
- The nickname snapshot is informational/diagnostic; private messages are addressed by the stable Discord user ID.

## 15-minute reminder

- The existing `reminder_send` lifecycle task still runs at `raid start - 15 min`.
- The public reminder is still posted to the selected raid text channel.
- The same lifecycle run also sends a private Discord message to every active signup (`going`, `tentative`, `late`), including bench players.
- `skipped` signups do not receive a DM.
- The DM contains raid title/time, signup status/character, Raid Lead when configured, the selected voice-channel link, and a direct link to the raid announcement in Discord.
- A failed DM to one participant does not stop delivery to the rest. Attempt/success/failure counts are stored on the raid for diagnostics.

## Voice channel

- Raid create/edit now exposes a Discord voice/stage-channel selector.
- The selected `voiceChannelId` is persisted on the raid.
- The voice channel is included in the 15-minute channel reminder, participant DMs and Scheduled Event location/description.
- Changing the voice channel invalidates stale reminder state so the next reminder uses the updated destination.

## Per-account editor defaults

- The dashboard stores the last selected publication text channel and voice channel per editing dashboard account.
- On the next new raid, those saved channels are moved to the top and selected automatically when they still exist in Discord.
- The original raid creator is preserved when another officer later edits the raid; editing no longer rewrites `createdBy...` fields.

## Regression coverage

`npm run check:raid-reminders` checks the identity snapshot, DM delivery path, voice-channel persistence, per-account defaults, creator preservation and CI wiring. It is included in both `verify` and `build:ci`.
