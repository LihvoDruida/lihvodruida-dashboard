# Mistblossom Dashboard 3.8.3 — Combined

This release consolidates the two 3.8.1 deliverables into one canonical tree.

Included together:
- Main Site public-site bridge: applications, guild roster, raid progression/rankings and published raids.
- Newcomer Discord role-gated nickname validation and priority scheduling.
- Existing v3.7.x security hardening and deployment safeguards.

The two supplied 3.8.1 archives were content-identical when extracted; 3.8.3 establishes a single release identity for deployment and future work.

- Fixed proxy classification for `/api/site/applications` and `/api/site/guild`: Main Site cross-origin requests now reach their route-level CORS/origin controls instead of being rejected by Dashboard session/same-origin middleware.
