import "server-only";

import { recordSystemAudit } from "@/lib/accessGroups";
import { logDashboardEvent } from "@/lib/security";

type DashboardSystemLogLevel = "debug" | "info" | "warning" | "error";

type DashboardSystemLogOptions = {
  persist?: boolean;
  debugEnabled?: boolean;
};

function consoleLevel(level: DashboardSystemLogLevel) {
  if (level === "warning") return "warn";
  return level;
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

export async function recordDashboardSystemLog(
  level: DashboardSystemLogLevel,
  action: string,
  details: Record<string, unknown> = {},
  options: DashboardSystemLogOptions = {},
) {
  logDashboardEvent(consoleLevel(level), action, undefined, details);

  if (!shouldPersist(level, options)) return false;

  return recordSystemAudit(action, {
    ...details,
    status:
      level === "error"
        ? "error"
        : level === "warning"
          ? "warning"
          : "info",
    logLevel: level,
  }).catch((error) => {
    logDashboardEvent("error", "dashboard.system_log.persist_failed", undefined, {
      action,
      level,
      error: error instanceof Error ? error.message : String(error || "unknown"),
    });
    return false;
  });
}
