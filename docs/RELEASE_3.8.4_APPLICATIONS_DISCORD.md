# v3.8.4 — Applications Discord channel + owner deletion

- Dashboard Discord settings now persist `applicationsChannelId`.
- New applications and fallback status notifications use that channel.
- Empty setting keeps compatibility with legacy `DISCORD_CHANNEL_ID`.
- Existing application status updates still edit their saved Discord `channel_id/message_id` first.
- Dashboard includes a test action for the selected applications channel.
- Only the Discord server owner can delete an application.
- Deletion removes the Discord message first; the server record is deleted only after Discord succeeds or the message is already missing/no reference exists.
