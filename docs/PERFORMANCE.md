# Performance preset — 2 vCPU / 4 GB RAM / 40 GB SSD

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
