# Dashboard v3.8.65 — Docker build: Static rules Markdown input

## Confirmed production failure

The `v3.8.64` Docker builder passes TypeScript and the preceding checks,
then `check:static-document` fails with `ENOENT` because
`/repo/docs/content/static-rules.md` was not present in the **builder** image.

## Root cause

- `.dockerignore` excluded the complete `docs/` directory from the build context.
- `dashboard/Dockerfile` explicitly copied other inputs for `build:ci`, but not
  `docs/content/static-rules.md`.
- The rules integrity checker read the canonical Markdown from the repository
  root, so it passed locally and failed in the isolated Docker build stage.

## Changes

- `.dockerignore` now excludes `docs/**` **except** the single canonical Markdown
  file and its parent directory.
- `dashboard/Dockerfile` explicitly copies the Markdown only to the builder
  stage, immediately before CI checks; it does not enter the runtime image.
- The integrity check now verifies the Docker build-input contract as well as
  the existing content, versioning, render safety, and permission checks.
- Package and lock versions are synchronized to `3.8.65`; no dependencies changed.

## Validated locally

- `check:static-document`: 15/15.
- Other reachable `build:ci` actions and audits: all 50 passed.
- Full Docker build/Next production build: **not run locally** (no Docker
  daemon or installed Next runtime in the test environment).

## Deployment

From an up-to-date checkout of the `live` branch, apply the patch and run
`make up`. To investigate another failure, retain the log from the first
`ERROR` after `npm run build:ci`. After a successful build, check application
health and external Cloudflare DNS/HTTPS separately; these have different
failure modes from the build.
