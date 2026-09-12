import os from "node:os";
import { readFile, stat, statfs } from "node:fs/promises";

import type {
  DockerStorageMetric,
  DockerStorageSnapshot,
  ServerStatusSnapshot,
} from "@/lib/serverStatusTypes";

type CpuTimes = {
  idle: number;
  total: number;
};

type CpuSample = {
  sampledAt: number;
  cores: CpuTimes[];
};

type DockerCacheEntry = {
  filePath: string;
  mtimeMs: number;
  value: DockerStorageSnapshot | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomServerCpuSample: CpuSample | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomDockerStorageCache: DockerCacheEntry | undefined;
}

function cpuTimes() {
  return os.cpus().map((cpu) => {
    const values = Object.values(cpu.times);
    return {
      idle: cpu.times.idle,
      total: values.reduce((sum, value) => sum + value, 0),
    };
  });
}

function boundedPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function computeCpuUsage(current: CpuTimes[], previous?: CpuSample) {
  if (!previous || previous.cores.length !== current.length) {
    return current.map(() => null as number | null);
  }

  return current.map((core, index) => {
    const before = previous.cores[index];
    const totalDelta = core.total - before.total;
    const idleDelta = core.idle - before.idle;
    if (totalDelta <= 0) return null;
    return boundedPercent(((totalDelta - idleDelta) / totalDelta) * 100);
  });
}

function parseLinuxMeminfo(raw: string) {
  const values = new Map<string, number>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z_()]+):\s+(\d+)\s*kB/i.exec(line.trim());
    if (!match) continue;
    values.set(match[1], Number(match[2]) * 1024);
  }
  return values;
}

async function linuxMemoryInfo() {
  if (process.platform !== "linux") return null;
  try {
    return parseLinuxMeminfo(await readFile("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
}

async function diskInfo(path: string) {
  try {
    const stats = await statfs(path);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      path,
      totalBytes,
      usedBytes,
      freeBytes,
      usagePercent: totalBytes > 0 ? boundedPercent((usedBytes / totalBytes) * 100) : 0,
    };
  } catch {
    return {
      path,
      totalBytes: null,
      usedBytes: null,
      freeBytes: null,
      usagePercent: null,
    };
  }
}

function parseHumanBytes(input: unknown) {
  const text = String(input ?? "").trim().replace(/\s*\([^)]*\)\s*$/, "");
  if (!text) return null;
  const match = /^([\d.,]+)\s*([kmgtpe]?i?b)$/i.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const units: Record<string, number> = {
    b: 1,
    kb: 1e3,
    mb: 1e6,
    gb: 1e9,
    tb: 1e12,
    pb: 1e15,
    eb: 1e18,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    pib: 1024 ** 5,
    eib: 1024 ** 6,
  };
  return Math.max(0, value * (units[match[2].toLowerCase()] || 1));
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDockerType(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDockerMetric(record: Record<string, unknown>): DockerStorageMetric | null {
  const type = String(record.Type ?? record.type ?? "").trim();
  if (!type) return null;
  const reclaimableRaw = record.Reclaimable ?? record.reclaimable ?? null;
  const reclaimableText = String(reclaimableRaw ?? "");
  const percentMatch = /\((\d+(?:[.,]\d+)?)%\)/.exec(reclaimableText);
  return {
    type,
    totalCount: numberOrNull(record.TotalCount ?? record.totalCount ?? record.Total ?? record.total),
    activeCount: numberOrNull(record.Active ?? record.active),
    sizeBytes: parseHumanBytes(record.Size ?? record.size),
    reclaimableBytes: parseHumanBytes(reclaimableRaw),
    reclaimablePercent: percentMatch ? Number(percentMatch[1].replace(",", ".")) : null,
  };
}

function findDockerMetric(metrics: DockerStorageMetric[], ...names: string[]) {
  const expected = names.map(normalizeDockerType);
  return metrics.find((metric) => expected.includes(normalizeDockerType(metric.type))) ?? null;
}

async function dockerStorageInfo(): Promise<DockerStorageSnapshot | null> {
  const filePath = String(process.env.SERVER_DOCKER_STATS_FILE || "/runtime/server-stats/docker-system-df.jsonl").trim();
  if (!filePath) return null;

  try {
    const info = await stat(filePath);
    const cached = globalThis.__mistblossomDockerStorageCache;
    if (cached && cached.filePath === filePath && cached.mtimeMs === info.mtimeMs) {
      return cached.value;
    }

    const raw = await readFile(filePath, "utf8");
    let sampledAt: string | null = null;
    const metrics: DockerStorageMetric[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (parsed.sampledAt && !parsed.Type && !parsed.type) {
          sampledAt = String(parsed.sampledAt);
          continue;
        }
        const metric = parseDockerMetric(parsed);
        if (metric) metrics.push(metric);
      } catch {
        // One malformed docker row must not break the whole owner dashboard.
      }
    }

    const value: DockerStorageSnapshot = {
      sampledAt,
      available: metrics.length > 0,
      metrics,
      buildCache: findDockerMetric(metrics, "Build Cache", "Build cache"),
      images: findDockerMetric(metrics, "Images"),
      containers: findDockerMetric(metrics, "Containers"),
      volumes: findDockerMetric(metrics, "Local Volumes", "Volumes"),
    };
    globalThis.__mistblossomDockerStorageCache = { filePath, mtimeMs: info.mtimeMs, value };
    return value;
  } catch {
    const value: DockerStorageSnapshot = {
      sampledAt: null,
      available: false,
      metrics: [],
      buildCache: null,
      images: null,
      containers: null,
      volumes: null,
    };
    globalThis.__mistblossomDockerStorageCache = { filePath, mtimeMs: -1, value };
    return value;
  }
}

export async function getServerStatusSnapshot(options: { includeDocker?: boolean } = {}): Promise<ServerStatusSnapshot> {
  const cpus = os.cpus();
  const currentTimes = cpuTimes();
  const previous = globalThis.__mistblossomServerCpuSample;
  const coreUsage = computeCpuUsage(currentTimes, previous);
  globalThis.__mistblossomServerCpuSample = {
    sampledAt: Date.now(),
    cores: currentTimes,
  };

  const measuredCoreUsage = coreUsage.filter((value): value is number => value !== null);
  const totalCpuUsage = measuredCoreUsage.length
    ? measuredCoreUsage.reduce((sum, value) => sum + value, 0) / measuredCoreUsage.length
    : null;

  const [meminfo, disk, docker] = await Promise.all([
    linuxMemoryInfo(),
    diskInfo(String(process.env.SERVER_STATS_DISK_PATH || "/").trim() || "/"),
    options.includeDocker === false ? Promise.resolve(null) : dockerStorageInfo(),
  ]);

  const totalBytes = meminfo?.get("MemTotal") ?? os.totalmem();
  const availableBytes = meminfo?.get("MemAvailable") ?? os.freemem();
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const swapTotalBytes = meminfo?.get("SwapTotal") ?? null;
  const swapFreeBytes = meminfo?.get("SwapFree") ?? null;
  const swapUsedBytes = swapTotalBytes !== null && swapFreeBytes !== null
    ? Math.max(0, swapTotalBytes - swapFreeBytes)
    : null;
  const processMemory = process.memoryUsage();

  return {
    sampledAt: new Date().toISOString(),
    platform: {
      hostname: os.hostname(),
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      nodeVersion: process.version,
    },
    uptime: {
      systemSeconds: os.uptime(),
      processSeconds: process.uptime(),
    },
    cpu: {
      model: cpus[0]?.model || "Невідомий CPU",
      logicalCores: cpus.length,
      usagePercent: totalCpuUsage,
      loadAverage: os.loadavg() as [number, number, number],
      cores: cpus.map((cpu, index) => ({
        index,
        model: cpu.model,
        speedMHz: cpu.speed,
        usagePercent: coreUsage[index] ?? null,
      })),
    },
    memory: {
      totalBytes,
      usedBytes,
      availableBytes,
      usagePercent: totalBytes > 0 ? boundedPercent((usedBytes / totalBytes) * 100) : 0,
      swapTotalBytes,
      swapUsedBytes,
      swapFreeBytes,
      processRssBytes: processMemory.rss,
      processHeapUsedBytes: processMemory.heapUsed,
      processHeapTotalBytes: processMemory.heapTotal,
    },
    disk,
    docker,
  };
}
