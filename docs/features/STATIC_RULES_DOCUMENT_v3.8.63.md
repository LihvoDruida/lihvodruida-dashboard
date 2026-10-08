# Static rules document integration — v3.8.63

- Source: user-uploaded `Правила статіка(1).doc`, byte-identical to the prior `Правила статіка.doc`.
- Canonical Markdown: `docs/content/static-rules.md` (body of every original clause retained).
- Summary table and in-page navigation were added **above**, not inside, the numbered clauses.
- On a database record with no published rule text, the bundled Markdown appears as version 1 and can be accepted once Discord role configuration is complete.
- On records with nonempty published rules, **nothing is overwritten on deploy**. RЛ/admin may choose **«Підставити правила з документа»** on `/discord/static/rules`, review and explicitly save; version then increases.
- Public invite and staff view use the same Markdown renderer, including safe local section anchors. Raw HTML still isn't evaluated.
- This change does not backfill or modify already-signed consent records, member bans or their history.

## Unresolved policy discrepancy

The supplied document (3.1.2 and 3.1.3.2) mentions exclusion after two warnings; the implemented discipline feature applies a 30-day ban on the third logged violation. No automatic punishment thresholds were changed in this content update. Owners should reconcile these rules explicitly before relying on them as one policy.

## Verification

- Confirm fallback when `data.text` is absent, but preserved stored content when present.
- Verify five sections and all numbered provisions remain in the Markdown.
- Verify same renderer on acceptance and editor preview, including `#section-*` links.
- Verify settings edit access, template only to editors, explicit save, and version bump.
- Run full Next/TypeScript build on VPS before production deployment.
