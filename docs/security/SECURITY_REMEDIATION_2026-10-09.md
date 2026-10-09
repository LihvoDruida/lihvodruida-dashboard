# Security remediation — v3.8.68 follow-up (2026-10-09)

Source: `Security_Verification_v3.8.68_2026-10-09(1).md`.

## Implemented code changes

- F1: dashboard client now reads and bounds full fetch body under the same abort deadline, using a 4 MiB response cap.
- F2: worker API supplies at most one leased job per poll to avoid pre-leasing a serial batch. Both ingress and outbox lease TTL are now 90 seconds; signature and delivery expiration checks still apply. Stage 3/4 test clocks updated to assert expiry at 91 seconds. This is a mitigation, not a formal distributed fencing guarantee.
- F3: quota cleanup transactionally re-reads the current counter and deletes only if it is still expired; stage 2 fake transaction now supports delete.
- F4: due-time predicates are applied before 150-row scan in production-supported collection queries, while the mock single-filter interface retains transactional due checks. Composite index and live load test still required for Firestore fallback; PostgreSQL adapter accepts chained predicates.
- F5: bot immediately responds with an ephemeral unsupported callback to type 2/5 instead of persisting them for unsupported deferred dispatch. Ingress validation accepts only type 3.
- F6: internal outbox settlement streaming reader imposes 2 KiB cap and validates non-null, non-array JSON objects before field access.
- F7: local limiter now emits Retry-After based on its reset timestamp. Existing 8/IP local gate continues to coexist with shared 16/IP+invite and 300/invite limits; this remains documented two-tier rate limiting, and NAT false positives should be measured.

## Local checks

- Bot `npm test`: 43 / 43 passed.
- Stage 2 independent: 13 / 13 passed.
- Stage 3 independent: 20 / 20 passed.
- Stage 4 independent storage/crypto: 18 / 18 passed.
- Stage 4 HTTP routes: 10 / 10 passed.
- JS syntax check for bot server and dashboard client passed.

## Not completed / not independently verified

- F8: `package.json` and `package-lock.json` still reference baseline Next 16.3.3, React 19.2.6, Sharp 0.34.4. Dockerfile security overlay pins Next 16.3.5, React 19.2.8, Sharp 0.35.4. Package lock regeneration was attempted but npm package registry did not respond before timeout; **do not run the local baseline as a certified security release**. The Docker overlay remains required. No Dashboard TypeScript/full Next production build in this run (dashboard dependencies unavailable).
- No Docker production image build, no live Discord end-to-end test, no PostgreSQL multi-worker/failover/load test, no production Cloudflare verification, no GitHub commit/deployment.
- R1–R10 operational topics not closed: keyring/rotation, reconciliation console, queue diagnostics and alerting, SAST/SBOM/provenance, role audit completeness, NAT measurements, origin/WAF configuration, backup/restore, rollback drills.
- 90s lease reduces risk but network stalls beyond 90s can still lead to duplicate Discord PATCH; introduce fenced claims or renewal if strict multi-worker exclusivity is required.
