# Raider.IO fixtures

Public responses captured on 2026-10-16 (EU, Terokkar, Mistblossom Vanguard).
Only public raid/season and guild profile fields are retained; no credentials.

- `/api/v1/mythic-plus/static-data?expansion_id=10` and `11`
- `/api/v1/raiding/static-data?expansion_id=10` and `11`
- `/api/v1/guilds/profile?region=eu&realm=terokkar&name=Mistblossom%20Vanguard&fields=raid_progression,raid_rankings`

The launch-week regressions use these responses without replacing dates or
slug names. The test fixture synthesizes small older expansion responses
(6–9) only to exercise bounded collection and checkpoint behavior offline.
Tests never query the live API, PostgreSQL server or Discord.
