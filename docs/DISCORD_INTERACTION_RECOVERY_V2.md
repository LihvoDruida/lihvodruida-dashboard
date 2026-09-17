# Discord interaction recovery v2

## Build fix

`discordInteractionStorage.ts` now declares the shape returned by authoritative document reads. This fixes the production TypeScript errors where `exists` and `data()` were being resolved on `{}`.

## Runtime recovery order

For raid, raid-poll and roster Discord buttons the dashboard now attempts:

1. exact document id in PostgreSQL;
2. exact `channelId + messageId` lookup;
3. compatibility scan for legacy field names (`message_id`, `discordMessageId`, nested Discord refs, `messageUrl`);
4. Firestore read-through/backfill when legacy credentials are still configured;
5. safe zero-state recovery from the live Discord embed when the message proves there are zero signups/votes/picks.

Zero-state recovery is deliberately refused for populated messages because recreating them as empty would silently destroy state.

## Orphan prevention

Roster formation creation now persists the backing database document before publishing the Discord message. If publication fails the draft row is rolled back. Raid publish-state and poll Discord-ref writes can probe past a stale write circuit.

## Raid presentation

A raid being published is now rendered in Discord as `published`, not `draft`, so the public embed no longer shows “Чернетка” next to active signup buttons.
