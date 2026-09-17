# 3.8.27 — Discord welcome-card build/runtime fix

- Fixed Node 24 / TypeScript 6 `Buffer<ArrayBufferLike>` → DOM `BlobPart` incompatibility in Discord multipart uploads by copying attachments to an ArrayBuffer-backed `Uint8Array`.
- Made the night-elf background resolver work in both local dashboard builds and the standalone Docker layout (`/app/dashboard/public`).
- Added activation-time gating so enabling public welcome cards never backfills historical onboarding members.
- Added explicit skipped state while the public welcome-card feature is disabled, preventing endless reconsideration of already handled newcomers.
- Added `check:discord-welcome-card` to `verify` and `build:ci`.
- Dashboard release bumped to 3.8.27.
