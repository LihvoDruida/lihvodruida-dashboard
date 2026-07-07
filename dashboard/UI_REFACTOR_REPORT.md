# UI/UX refactor report

## Scope
Implemented a unified compatibility UI layer for the dashboard/site according to the attached refactor brief. The existing dark/starfield background and application/API logic were not changed.

## Main changes
- Added shared layout, spacing, radius, typography and responsive tokens to `src/app/design-tokens.css`.
- Added final imported UI consolidation layer: `src/app/refactor.css`.
- Imported the final layer after legacy CSS in `src/app/layout.tsx`, so old classes keep working while resolving layout conflicts.
- Added reusable primitives in `src/components/ui/PagePrimitives.tsx`: `PageShell`, `PageSection`, `SectionHeader`, `StatusChip`, `EmptyState`, `DebugDetails`.
- Unified topbar, desktop overflow menu, bottom mobile navigation reserve, footer, panels, heroes, buttons, form controls, status chips, debug/details blocks, tables/lists and raid cards through shared selectors.
- Converted dashboard table/list behavior on mobile to card-like rows using `data-label` values instead of forcing horizontal table UX as the primary mobile layout.
- Standardized `/guild` and `/profiles` list rhythm through the shared dashboard table/list classes.
- Improved raid list layout: stable two-column desktop, one-column mobile, wrapped text, fixed action stack with open → edit/delete → archive/status.
- Reordered `/dashboard/discord/recruitment` visually so Gateway/Live pipeline/manual scan/preview/settings are prioritized, with settings moved lower on mobile.
- Preserved existing permissions, API routes, Firebase/Discord/profile/raid logic and starfield background.

## Validation run
- `npm run typecheck` — OK
- `npm run lint -- --quiet` — OK
- `npm run inspect:ci` — OK
- `npm run build` — OK

## Notes
This is a code-level and build-level refactor pass. A final browser pass at 1440, 1280, 1024, 900, 760, 560, 390 and 360 px is still recommended after deploy because live data length can expose edge cases that are not visible in static build output.
