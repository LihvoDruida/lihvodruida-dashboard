# Static rules build hotfix — 2026-10-08

## Problem

The `make up` Docker build stopped at `npm run typecheck` with `TS2532` in `dashboard/src/lib/staticRules.ts:122`: `doc.data()` can return `undefined`, yet the previous audit mapping accessed `.createdAt` on it. This error is present in 3.8.57 and the earlier 3.8.58 archive.

## Fix

Read the document once with `const data = doc.data() ?? {};` before accessing `data.createdAt`. Preserve audit history sorting (descending `createdAt`) and the `""` fallback. No TypeScript safety check has been removed.

## Independent verification

An isolated strict TypeScript reproduction using the real document-store return type (`Record<string, unknown> | undefined`) failed with `TS2532` before the patch and passed after the patch. Runtime cases for an undefined document, missing `createdAt`, and descending sorting all passed. Full Next.js production build has NOT been verified in this environment because `npm ci` cannot reach npm registry (`EAI_AGAIN`). Re-run `make up` on the VPS to validate the entire build.

## Deployment

If v3.8.57 or v3.8.58 is already checked out on the VPS, apply `lihvodruida-static-rules-ts2532-hotfix.patch`, commit/push in the source repository, pull on the VPS, then run `make up`. Alternatively deploy the complete v3.8.59 source archive.
