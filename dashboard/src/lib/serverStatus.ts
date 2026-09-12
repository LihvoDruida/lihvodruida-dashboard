import os from "node:os";
import { readFile, statfs } from "node:fs/promises";

import type { ServerStatusSnapshot } from "@/lib/serverStatusTypes";

type CpuTimes = {
  idle: number;
  total: number;
};

type CpuSample = {
  sampledAt: number;
  cores: CpuTimes[];
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomServerCpuSample: CpuSample | undefined;
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

export async function getServerStatusSnapshot(): Promise<ServerStatusSnapshot> {
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

  const meminfo = await linuxMemoryInfo();
  const totalBytes = meminfo?.get("MemTotal") ?? os.totalmem();
  const availableBytes = meminfo?.get("MemAvailable") ?? os.freemem();
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const swapTotalBytes = meminfo?.get("SwapTotal") ?? null;
  const swapFreeBytes = meminfo?.get("SwapFree") ?? null;
  const swapUsedBytes = swapTotalBytes !== null && swapFreeBytes !== null
    ? Math.max(0, swapTotalBytes - swapFreeBytes)
    : null;
  const processMemory = process.memoryUsage();
  const diskPath = String(process.env.SERVER_STATS_DISK_PATH || "/").trim() || "/";
  const disk = await diskInfo(diskPath);

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
  };
}
