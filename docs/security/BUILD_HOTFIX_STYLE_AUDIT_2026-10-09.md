# Dashboard v3.8.68 — Docker `audit:styles` build hotfix (2026-10-09)

## Symptom

`make up` / Docker dashboard builder fails during `npm run build:ci`:

```
STYLE AUDIT: 3 CSS file(s) are not imported/referenced by runtime source:
 - src/app/styles/accessibility.css
 - src/app/styles/cascade.css
 - src/app/styles/responsive.css
STYLE AUDIT: 2 unused custom properties:
 - --hero-columns
 - --hero-padding
target dashboard: failed to solve: ... npm run build:ci ... exit code: 1
```

## Root cause

The three CSS files are *not* part of the v3.8.68 release archive. They are
unreferenced leftovers from an older source checkout (for example when a ZIP
is extracted over an existing VPS directory). Docker's `COPY dashboard/ ./`
includes files that happen to remain in the build context. `audit:styles`
correctly exits with code 1 if it discovers unreferenced CSS / variables.
The original 17-file global CSS system is fully referenced and passes the audit.

## Fix

1. `dashboard/scripts/cleanup-legacy.cjs`: remove these three explicitly
   retired filenames before `audit:styles`, leaving all current styles intact.
2. `.dockerignore`: exclude these exact paths from Docker build context so
   contaminated host worktrees cannot propagate them into builder images.
3. `dashboard/scripts/check-legacy-style-cleanup.cjs`: add a regression test
   that verifies the exact allowlist is excluded, clean after maintenance,
   and that cleanup preserves unrelated styles.
4. `dashboard/package.json`: invoke that regression test from `build:ci` and
   `verify` after `cleanup:legacy`.

No design changes, CSS rewrites, reduced audit strictness, or security gate
bypasses are included. The Dashboard app version remains `3.8.68`.

## Locally reproduced and verified

- Injected the three stale CSS filenames: `audit:styles` failed as expected,
  listing all three unused files and the two unused `--hero-*` properties.
- `npm run cleanup:legacy`: removed exactly the three stale files.
- `npm run check:legacy-style-cleanup`: PASS; active styles preserved.
- `node scripts/audit-styles.cjs`: PASS, 17 stylesheets, 1236 class selectors,
  151 CSS custom properties, no orphan selectors/properties/files.
- `npm run check:imports`: PASS, 1332 references / 332 source files.
- `npm run audit:ui`: PASS.
- `npm run inspect:ci`: PASS, 401 checked files, 0 blocking findings.
- Independent security checks: Stage 2 (13/13), Stage 3 (20/20),
  Stage 4 storage (18/18), Stage 4 HTTP (10/10): PASS.

## VPS deploy

After copying the updated project tree to the VPS:

```bash
# From the project repository root (without touching .env or volumes):
rm -f dashboard/src/app/styles/accessibility.css \
      dashboard/src/app/styles/cascade.css \
      dashboard/src/app/styles/responsive.css
make rebuild-dashboard
```

The `rm` step is optional with the updated `.dockerignore` and cleanup script,
but removes obsolete files from the host checkout too. `make rebuild-dashboard`
rebuilds the dashboard image and starts only that service (the Makefile also
applies its schema step). Alternatively use the original `make up` procedure
for an intentional full-stack update.

## Limits

- This hotfix addresses the specific `audit:styles` failure in the supplied
  VPS log. A full Docker image build and real VPS healthcheck were not run in
  this environment.
- The pre-existing Docker security overlay is still required: the checked-in
  base `package-lock.json` is not yet aligned with the overlay's patched
  Next/React/Sharp versions (previously tracked as F8).
- Other independent production hardening issues (Discord, Postgres, key
  rotation, WAF, backups and multi-worker tests) are not closed by this fix.
