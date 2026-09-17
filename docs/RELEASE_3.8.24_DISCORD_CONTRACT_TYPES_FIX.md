# v3.8.24 — Discord contract TypeScript export fix

## Fixed

- Added the missing TypeScript declarations for `buildApplicationCustomId` and `decodeApplicationCustomId` to `shared/index.d.mts`.
- Kept the runtime implementation and the type surface of `@mistblossom/discord-contract` in sync.
- Extended the application moderation regression check so a runtime export without a matching type declaration fails CI before release.

## Root cause

`shared/index.mjs` exported both application moderation helpers, but `shared/index.d.mts` did not declare them. TypeScript therefore reported TS2305 during `npm run typecheck`, even though the functions existed at runtime.
