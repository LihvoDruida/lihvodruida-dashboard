import { NextRequest, NextResponse } from "next/server";
import {
  loadStoredGuildRosterData,
  refreshGuildRosterApiBatch,
  type GuildRosterSyncProgress,
} from "@/lib/guildRoster";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";
import {
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  unauthorizedResponse,
  verifyInternalBearerToken,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const maxDuration = 55;

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomGuildRosterCronGuard:
    | {
        inFlight?: Promise<Record<string, unknown>>;
        lastStartedAt: number;
        lastResult?: Record<string, unknown>;
      }
    | undefined;
}

function intEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;
}

function boolEnv(name: string, fallback = true) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function guard() {
  const value = globalThis.__mistblossomGuildRosterCronGuard || {
    lastStartedAt: 0,
  };
  globalThis.__mistblossomGuildRosterCronGuard = value;
  return value;
}

function ageMs(value?: string | null) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Number.POSITIVE_INFINITY;
}

function hasRateLimit(progress: GuildRosterSyncProgress | null | undefined, reasons: Array<string | null | undefined>) {
  if (progress?.errors?.some((item) => /rate.?limit|429/i.test(item))) return true;
  return reasons.some((item) => String(item || "").startsWith("raiderio_rate_limited"));
}

async function runAutomaticSync() {
  if (!boolEnv("GUILD_ROSTER_AUTO_SYNC_ENABLED", true)) {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  const maxSteps = intEnv("GUILD_ROSTER_AUTO_SYNC_STEPS", 2, 1, 3);
  const rosterRefreshMs =
    intEnv("GUILD_ROSTER_FULL_REFRESH_SECONDS", 21_600, 900, 604_800) * 1000;
  const stored = await loadStoredGuildRosterData({ bypassCache: true }).catch(() => null);
  const rosterUpdatedAt = stored?.stats?.rosterUpdatedAt || stored?.stats?.updatedAt || null;
  const forceRoster = !stored?.members?.length || ageMs(rosterUpdatedAt) >= rosterRefreshMs;

  let result: Awaited<ReturnType<typeof refreshGuildRosterApiBatch>> | null = null;
  let steps = 0;

  for (let index = 0; index < maxSteps; index += 1) {
    result = await refreshGuildRosterApiBatch({
      forceRoster: index === 0 && forceRoster,
      continueSync: index > 0 || !forceRoster,
      bypassCache: true,
      softSync: true,
    });
    steps += 1;

    const sync = result.refresh.sync;
    const reasons = [result.refresh.battleNet.reason, result.refresh.raiderIo.reason];
    if (sync.status === "completed" || sync.status === "failed" || hasRateLimit(sync, reasons)) break;
    if (!result.members.length && sync.phase !== "roster") break;
  }

  const payload = {
    ok: true,
    skipped: false,
    steps,
    forcedRoster: forceRoster,
    memberCount: result?.members.length || stored?.members.length || 0,
    updatedAt: result?.stats.updatedAt || stored?.stats.updatedAt || null,
    rosterUpdatedAt: result?.stats.rosterUpdatedAt || rosterUpdatedAt,
    source: result?.source || stored?.source || "none",
    sync: result?.refresh.sync || null,
    battleNet: result?.refresh.battleNet || null,
    raiderIo: result?.refresh.raiderIo || null,
  };

  await recordDashboardSystemLog("debug", "guild.roster.auto_sync", {
    summary: `Автосинхронізація складу: ${payload.memberCount} персонажів • ${payload.sync?.phase || "idle"}`,
    ...payload,
  }, { persist: payload.sync?.status === "failed" });

  return payload;
}

export async function POST(request: NextRequest) {
  const token = await verifyInternalBearerToken(
    request,
    ["GUILD_ROSTER_SYNC_SECRET", "CRON_SECRET", "INTERNAL_API_TOKEN"],
    { minLength: 24 },
  );
  if (!token.ok) {
    logDashboardEvent("warn", "guild.roster.auto_sync_forbidden", request, {
      reason: token.reason,
      envName: token.envName || null,
      statusCode: 401,
    });
    return unauthorizedResponse();
  }

  const state = guard();
  if (state.inFlight) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: "in_flight", ...(state.lastResult || {}) },
      { headers: noStoreHeaders() },
    );
  }

  try {
    state.lastStartedAt = Date.now();
    const promise = runAutomaticSync();
    state.inFlight = promise;
    const result = await promise;
    state.lastResult = result;
    logDashboardEvent("info", "guild.roster.auto_sync", request, result);
    return NextResponse.json(result, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    await recordDashboardSystemLog("error", "guild.roster.auto_sync_failed", {
      summary: message,
      error: message,
    }, { persist: true });
    logDashboardEvent("warn", "guild.roster.auto_sync_failed", request, { message });
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: noStoreHeaders() },
    );
  } finally {
    guard().inFlight = undefined;
  }
}
