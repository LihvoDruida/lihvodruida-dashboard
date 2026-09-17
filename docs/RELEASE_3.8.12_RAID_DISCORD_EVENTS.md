# v3.8.12 — Raid ↔ Discord Scheduled Events

Dashboard raid publishing now manages a Discord Guild Scheduled Event together with the raid announcement.

## Behaviour

- Draft save never publishes or changes Discord resources.
- Publish/update creates or updates the raid message and one idempotent Scheduled Event.
- Scheduled Event uses the raid date/time in the configured raid timezone.
- Event duration is configurable per raid (default 3 hours).
- Event location points to the Discord raid announcement, with the Dashboard raid page in the event description.
- External Discord events automatically enter ACTIVE at start and COMPLETED at end.
- If the stored event was deleted in Discord, the next manual raid publish recreates it and stores the new ID.
- Disabling `Discord-подія` deletes the linked Scheduled Event on the next publish.
- Deleting a raid also attempts to delete its Scheduled Event.
- Background roster/close-message refreshes do not PATCH Scheduled Events, avoiding unnecessary Discord API traffic.
- Failure to create/update the event does not roll back a successfully published raid message; the error is stored and shown in the editor/toast.
- If a newly created event cannot have its ID persisted, the event is rolled back to prevent duplicates.

## Discord permissions

The bot role needs server-level `Create Events` permission to create external events. `Manage Events` is recommended for reliable edit/delete operations.
