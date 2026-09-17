# 3.8.10 — Diagnostic Discord security logging

This release keeps Discord Ed25519 verification fail-closed and makes rejected
interaction requests diagnosable without persisting credentials or request bodies.

For `bot.security.invalid_discord_signature` the log store now receives bounded
metadata such as request ID, method/path/status, normalized client IP, User-Agent,
Content-Type/Length, Cloudflare Ray, trusted-proxy marker, body size, timestamp
presence/age/skew, Ed25519 header presence/length/format and a machine-readable
failure reason.

The Ed25519 header value, Discord public key, raw body, authorization headers,
cookies and tokens are never written to the structured log details.

Failure reasons include:

- `public_key_missing`
- `public_key_invalid`
- `missing_ed25519`
- `invalid_ed25519_format`
- `missing_timestamp`
- `invalid_timestamp`
- `timestamp_out_of_window`
- `ed25519_verification_failed`
- `verification_error`

The internal Dashboard interaction verifier now persists its own
`discord.interaction.signature_rejected`/`signature_failed` diagnostics as a
second verification layer. Oversized interaction payloads and invalid JSON after
a valid signature also produce bounded diagnostic events.
