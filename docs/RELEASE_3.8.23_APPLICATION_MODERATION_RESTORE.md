# v3.8.23 — Restore Discord application moderation

- Restored `Прийняти` / `Відхилити` buttons on every new guild application Discord message.
- Added application moderation actions to the shared Discord `custom_id` contract used by both the bot and dashboard.
- Kept backwards compatibility with archived `guild_application:accepted|declined:*` buttons found in older releases.
- Discord button clicks enforce the same `applications.manage` access-group permission used by the dashboard.
- The Discord server owner remains authorized automatically through the access-group resolver.
- Finalized applications cannot be silently overwritten by a second Discord click.
- Accepted/declined application messages are edited in place, action buttons are removed, and the moderator is shown.
- Added a CI regression check so application moderation controls cannot disappear unnoticed again.
