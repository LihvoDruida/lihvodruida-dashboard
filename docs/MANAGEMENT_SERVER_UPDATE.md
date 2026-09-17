# Management + server monitoring update

## Management UI

- Replaced the six separate large admin hero layouts with one `AdminPageHeader`.
- Standardized `/dashboard`, groups, Discord, logs and server pages.
- Reworked management tabs into one consistent segmented navigation.
- Corrected Discord management desktop columns: compact single-user actions on the left, bulk operations on the wide right side.
- Added a dedicated access-group desktop layout: sticky group list, consistent editor, summaries, permission groups and actions.
- Standardized role/country controls on the management overview.

## Live server monitoring

Fast metrics are polled every 2 seconds:

- total CPU;
- each logical CPU core;
- RAM;
- Swap;
- root/storage usage;
- uptime and Node process memory.

The polling loop is recursive rather than a blind interval, so a slow request can never overlap the next one. It pauses in hidden tabs, refreshes immediately when the tab becomes visible, aborts a request after 4 seconds and backs off after repeated errors. Background polling no longer changes the manual button to a loading state.

Docker/BuildKit information is deliberately slower. The dashboard never receives `/var/run/docker.sock`. A host-side script writes a read-only `docker system df` snapshot to `runtime/server-stats/docker-system-df.jsonl`, which the dashboard reads and caches by file mtime.

## 40 GB VPS BuildKit protection

Defaults:

```text
BUILD_CACHE_KEEP_STORAGE=6GB
BUILD_CACHE_MAX_AGE=168h
AUTO_PRUNE_BUILD_CACHE=1
```

After a successful image build the deploy flow prunes only unused BuildKit cache, preferring `--keep-storage 6GB`. If the Docker version does not support that flag, it falls back to the 7-day age filter. Docker volumes are never pruned.

Commands:

```bash
make docker-stats
make clean-cache
make resources
```

`make up`, `make rebuild-dashboard`, `make rebuild-bot`, `make clean-cache` and `make resources` refresh the Docker storage snapshot used by the owner-only server page.
