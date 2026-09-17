# 3.8.35 — Welcome redesign + newcomer gateway regression merge

This release intentionally merges the v3.8.34 welcome-card redesign onto the
v3.8.33 bot/site regression-fix branch rather than replacing it.

## Preserved bot/site lifecycle fixes
- `GUILD_MEMBER_ADD` remains the primary high-priority newcomer trigger.
- Queue starvation guard and reconnect-penalty reset remain enabled.
- Targeted onboarding fails/retries when the requested Discord member snapshot
  cannot yet be resolved instead of silently dropping the join.
- Bootstrap self-heal checks the configured default role specifically; unrelated
  Discord roles are preserved.
- OAuth/live-session bootstrap, distributed onboarding lease, recovery cron,
  root gateway credential preflight and post-deploy Gateway/4014 diagnostics are
  retained.
- `check:guild-lifecycle` remains part of verify/build:ci.

## v3.8.34 welcome redesign included
- New WoW/night-elf composition with bundled Spectral SC + Philosopher OFL fonts.
- Real member join-order number instead of a Discord-ID hash.
- Lossless adaptive PNG compression, 1280×720 renderer and 16 px transparent
  rounded corners.
- Owner test lab auto-resolves live/next member number.
- Optimized background asset and runtime font copy in the dashboard image.

## Compatibility fixes made during merge
- Kept the nickname-gate TS2367 hotfix from the welcome branch while preserving
  post-rules sequencing from the regression branch.
- Corrected stale auth documentation: bootstrap repairs the missing configured
  role on recent joins and does not require the member to have zero other roles.
- Missing newcomers are inserted provisionally into the cached join timeline.
  This prevents duplicate member numbers for burst joins that arrive before the
  next Discord member-list refresh; a real refresh replaces provisional entries.

## Verification
- All 31 dashboard `check:*` scripts pass.
- `check:guild-lifecycle`: 17/17.
- `check:discord-welcome-card`: 41/41.
- `check:welcome-performance`: 26/26.
- `check:nickname-warnings`: 61/61.
- Bot suite: 26/26.
- UI/CSS/import/security/CI source audits pass.
- Bot MJS and deployment shell syntax checks pass.
