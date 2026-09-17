# v3.8.14 — Discord raid publish TypeScript hotfix

- Fixed `TS18048` in `src/app/api/raids/publish/route.ts`.
- The publish route now validates that `saveAndMaybePublishRaid()` returned a scheduled-event synchronization result before reading it.
- This preserves the existing runtime behavior for the forced `action=publish` path while giving TypeScript a safe narrowing point.
- Raid editor/UI/lifecycle/Discord-event/reminder/import regression checks remain green.
