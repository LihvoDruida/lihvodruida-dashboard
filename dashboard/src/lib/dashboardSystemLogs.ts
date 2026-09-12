import "server-only";

import { logDashboardEvent } from "@/lib/security";

type DashboardSystemLogLevel = "debug" | "info" | "warning" | "error";

type DashboardSystemLogOptions = {
  persist?: boolean;
  debugEnabled?: boolean;
};

function consoleLevel(level: DashboardSystemLogLevel) {
  if (level === "warning") return "warn" as const;
  if (level === "debug") return "debug" as const;
  if (level === "error") return "error" as const;
  return "info" as const;
}

function shouldPersist(
  level: DashboardSystemLogLevel,
  options: DashboardSystemLogOptions,
) {
  if (options.persist === true) return true;
  if (options.persist === false) return level === "error";
  if (level === "error" || level === "warning") return true;
  if (level === "debug") return Boolean(options.debugEnabled);
  return false;
}

/**
 * One logging path only. Previously this function wrote the same event twice:
 * once through console/security logging and once through the old Discord audit
 * store. `logDashboardEvent` now owns structured persistence, while this helper
 * only decides whether a low-value event deserves a database row.
 */
export async function recordDashboardSystemLog(
  level: DashboardSystemLogLevel,
  action: string,
  details: Record<string, unknown> = {},
  options: DashboardSystemLogOptions = {},
) {
  logDashboardEvent(consoleLevel(level), action, undefined, details, {
    persist: shouldPersist(level, options),
  });
  return true;
}
