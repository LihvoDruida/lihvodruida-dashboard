# Performance preset — 2 vCPU / 4 GB RAM / 40 GB SSD

## Dashboard 3.8.96: source checks and large catalogs

TypeScript now reuses incremental state under `.next/cache/typecheck`, covered by the existing locked BuildKit cache mount. On the local QA host, the second unchanged check fell from 18.327 s to 2.621 s; a cold check still took 18.132 s. A full-project negative control verified that changing a cached source file to a real type error returns exit 2 and repairing it returns exit 0. `npm run check:typecheck-cache` runs this optional heavy suite; strict source checking remains in every build:ci.

Group search normalization is reused until the server catalog changes. Twenty field edits with 2,000 groups no longer perform 40,000 catalog normalizations. Character role changes no longer re-sort 5,000 unchanged candidates, and key membership uses sets. `npm run check:profile-groups-browser` verifies these cases with real production components and controlled APIs. [Measurements and limits](roadmap/R7_3_PROFILE_GROUPS_PERFORMANCE_2026-10-15.md). These are local measurements, not live SQL/Discord benchmarks.

This deployment is tuned for the OVH VPS profile used by Mistblossom Vanguard.

## What changed

- `make up` builds `dashboard` and `bot` once, then starts services with `--no-build --no-deps`.
- Compose build concurrency defaults to `1` to avoid two builds fighting for 4 GB RAM.
- Next/Turbopack uses `2` build CPUs and a 2560 MB Node heap cap.
- Docker BuildKit persists npm tarballs and `.next/cache` between builds.
- Health checks run sooner, so a ready dashboard/bot is detected in seconds rather than waiting up to ~30 s.
- PostgreSQL is sized for a small application host: 50 connections, 256 MB shared buffers, 4 MB work_mem, JIT off.

## Recommended commands

```bash
make up                 # full incremental deploy
make rebuild-dashboard  # only dashboard changed
make rebuild-bot        # only bot changed
make resources          # host/container resource snapshot
make clean-cache        # free old build cache on the 40 GB disk
```

## Overrides

Place these in the root `.env` only when needed:

```dotenv
NEXT_BUILD_CPUS=2
NODE_BUILD_MEMORY_MB=2560
```

On this 4 GB machine, increasing `NEXT_BUILD_CPUS` above 2 or the Node heap above ~3 GB usually makes builds slower because the host starts swapping.

A 2 GB swap file is recommended as an OOM safety net, but it should not be treated as normal build memory.

## VPS 2 vCPU / 4 GB / 40 GB: BuildKit cache guard

Repeated `docker compose build` can grow `/var/lib/containerd` even when the
application, logs and PostgreSQL are small.  The deployment flow therefore
runs a conservative cache maintenance step after a successful image build.

Defaults:

```text
BUILD_CACHE_KEEP_STORAGE=6GB
BUILD_CACHE_MAX_AGE=168h
AUTO_PRUNE_BUILD_CACHE=1
```

The maintenance script removes only unused BuildKit cache / dangling images.
It never uses `--volumes`, so `mistblossom_pgdata` and certificate volumes are
not part of the cleanup.  Set `AUTO_PRUNE_BUILD_CACHE=0` for a one-off deploy
if you intentionally want to keep all build cache.

Useful commands:

```bash
make docker-stats   # refresh server-page Docker snapshot, no cleanup
make clean-cache    # cap unused build cache and refresh snapshot
make resources      # host/container resource summary
```

The dashboard does **not** receive `/var/run/docker.sock`.  `make up` writes a
read-only `runtime/server-stats/docker-system-df.jsonl` snapshot instead. This
keeps the owner monitoring page useful without granting the web process root-
equivalent Docker access.


## R7.5 / dashboard 3.8.98 — cleanup panel

An expanded cleanup list (>25 rows) now polls only persisted settings, execution and counters, through one authenticated `summary=1` GET. It does not query membership rows or call Discord REST. The visible rows are explicitly labelled as a snapshot; “Оновити показаний список” refreshes its displayed pages through GET without starting a scan. Lists of at most 25 rows continue to refresh automatically. Dirty settings pause panel reads and participate in the shared live-refresh guard.

In the controlled Chromium scenario with 100 rows, one background tick changed from 4 paged HTTP reads to 1 summary read (0 row reads). Instrumented Intl.DateTimeFormat construction over the same mount-and-tick scenario changed from 800 to 1, through reuse of one formatter. These are operation counts, not production latency or PostgreSQL throughput measurements. Explicit refresh still reads up to the previously displayed row count, under one overall 15-second deadline. Repeated cursors and duplicate-only intermediate pages stop with an error while retaining the previous snapshot. Row merging uses a Set; a 10,000-row test checks bounded work.

Details and reproducible commands: [R7.5 validation](roadmap/R7_5_CLEANUP_VIEW_2026-10-15.md).


## R7.6 / dashboard 3.8.99 — Static role settings

Role search uses a memoized normalized name/ID index and a Map for selection validation. Typing does not fetch Discord or save settings. In the controlled 250-role Chromium fixture, filtering by one Ukrainian role name reduced the two native selectors from 502 options to 8, retaining their selected roles and placeholders. The pure index check reads 250 names once, then performs 100 searches without re-reading or re-normalizing those role names. Filtering still scans the cached index; this is not a claim of constant-time search or production latency improvement.

The form has no polling. Initial load, manual refresh and uncertain-save reconciliation each use one GET with automatic retries disabled. Search is local; Enter in its field does not submit permission changes. Detailed validation and limits: [R7.6](roadmap/R7_6_STATIC_ROLE_SETTINGS_2026-10-15.md).
