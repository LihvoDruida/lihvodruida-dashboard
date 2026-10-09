# Security Stage 4 — Durable Discord Ingress (v3.8.68)

## Why

Before this release, `bot/src/server.mjs` acknowledged a Discord interaction
and used `setImmediate()` to forward it to the dashboard. A process crash in
between lost the request entirely. Stage 3 protected **completed responses**;
this stage makes the **inbound receipt** durable as well.

## New flow

1. The bot verifies the original Discord Ed25519 signature *before* parsing JSON.
2. For a supported interaction, the bot calls the authenticated internal
   `POST /api/internal/discord/interaction-ingress` endpoint, with a strict
   1.8-second client-side deadline. The dashboard independently re-verifies
   the Discord signature and validates the interaction ID, payload and age.
3. PostgreSQL atomically writes one encrypted receipt keyed by interaction ID.
   Only after the API confirms that write does the bot return the deferred ACK.
   If it cannot confirm persistence, it fails closed instead of scheduling work
   in volatile memory.
4. A recovery worker polls `GET /api/internal/discord/interaction-ingress`,
   obtains a transactionally leased record, and forwards the original signed
   request to `/api/discord/interactions`. The existing Stage 3 outbox claim
   prevents re-execution on retries and records the resulting callback.
5. The worker completes its lease using authenticated `PATCH`. Outbox delivery
   to Discord uses the existing Stage 3 pipeline.

`PING` is answered immediately and unknown/obsolete buttons retain the
pre-existing informative response; neither performs a business side effect.

## Data protection and deadlines

- Collection `discordInteractionIngress` (shared PostgreSQL document store).
- AES-256-GCM ciphertext of the signed interaction envelope under a
  domain-separated key derived from `SESSION_SECRET`.
- SHA-256 fingerprint + 24-hour replay record; raw request erased on successful
  dispatch, permanent failure or deadline expiry.
- No signed request dispatched after the original timestamp reaches the Discord
  verification deadline (20-second reserve); retry count bounded at 12,
  dispatch lease 45 seconds, bounded exponential retry backoff.
- Scans bounded to 150 records per eligible state, 20 lease jobs maximum.
- Cron retention removes expired receipts and scrubs stranded credentials.
- Outbox claims stuck for four minutes produce a warning result instead of
  rerunning an operation whose outcome cannot safely be determined.

## Guarantees and limitations

- **Committed before ACK** (subject to the normal failure window between
  committing to the DB and Discord receiving the ACK).
- **At-most-one business execution per interaction ID through the dashboard's
  transactional outbox claim**, even when ingress delivery is retried.
- **NOT exactly-once delivery**: no atomic transaction spans Discord's ACK,
  PostgreSQL and Discord's webhook PATCH. If a network timeout happens after
  durable acceptance but before the bot receives its confirmation, Discord may
  show an error although a persisted interaction may still run.
- A crash during an irreversible business action, before its outbox result was
  written, is ambiguous; the operation is **not** automatically repeated.
  Users see a warning and must check state before attempting another action.
- Original Discord signatures have a five-minute freshness bound, so a receipt
  that cannot be dispatched within this window will be discarded rather than
  run with unverified stale credentials.
- Do not rotate `SESSION_SECRET` without a coordinated strategy for pending
  encrypted ingress/outbox records.

## Deployment

Update dashboard and bot **in the same deployment**. Ensure the current
`SESSION_SECRET` and `INTERNAL_API_TOKEN` are preserved. No new mandatory
secrets or SQL migration are required (the existing `documents` table is used).

Before deployment:

```sh
cd dashboard && npm ci && npm run build:ci
cd ../bot && npm ci && npm test
```

On the VPS, take a PostgreSQL backup and run the usual `make up` deployment.
Verify both services are healthy, and that a real Discord button immediately
returns a deferred ACK followed by a completed response. Also test restarting
`bot` after a persisted, but not yet dispatched, interaction. Observe
structured logs for `Discord ingress dispatch failed`, `Discord ingress poll
deferred`, and `Discord ingress settlement failed`.

## Independent test coverage

`npm run check:security-stage4-independent` executes storage/crypto/race and
HTTP route tests without depending on earlier check scripts. Bot regression
suite includes `bot/test/ingress-recovery.test.mjs` for commit-before-ACK,
fail-closed and worker recovery. Full production build still needs the
production dependency tree and target network to be validated externally.
