import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";
import { refreshGuildRosterApiBatch } from "@/lib/guildRoster";
import { canViewGuildRoster } from "@/lib/permissions";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, noStoreHeaders, rateLimitResponse, safeErrorMessage, unauthorizedResponse, verifyTrustedOrigin } from "@/lib/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const maxDuration = 30;

type GuildRefreshBody = {
  force?: unknown;
  continue?: unknown;
  includeMembers?: unknown;
  includeStats?: unknown;
  debug?: unknown;
  cacheOnly?: unknown;
  soft?: unknown;
  bypassCache?: unknown;
};

function truthy(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!canViewGuildRoster(session)) return unauthorizedResponse();

  const ip = getClientIp(request);
  const actor = session?.profileId || session?.id || ip;
  const limit = checkRateLimit(`guild-roster-refresh:${actor}`, 2400, 30 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const globalLimit = checkRateLimit("guild-roster-refresh:global", 6000, 30 * 60 * 1000);
  if (!globalLimit.ok) return rateLimitResponse(globalLimit.resetAt);

  try {
    const body = (await request.json().catch(() => null)) as GuildRefreshBody | null;
    const forceRefresh = truthy(body?.force);
    const continueSync = truthy(body?.continue);
    const includeMembers = body?.includeMembers === undefined ? false : truthy(body.includeMembers);
    const includeStats = truthy(body?.includeStats) || includeMembers;
    const debugRequested = truthy(body?.debug) || request.headers.get("x-dashboard-debug") === "1";
    const cacheOnly = truthy(body?.cacheOnly);
    const softSync = truthy(body?.soft);
    const bypassCache = truthy(body?.bypassCache) || cacheOnly || softSync;
    const apiSettings = await getDashboardApiSettings().catch(() => null);
    const debugAuditEnabled = Boolean(debugRequested || apiSettings?.dashboardApiDebugAuditLogs);
    const roster = await refreshGuildRosterApiBatch({
      forceRoster: forceRefresh,
      continueSync,
      cacheOnly,
      softSync,
      bypassCache,
    });

    const warningReasons = [
      roster.refresh.battleNet.reason,
      roster.refresh.raiderIo.reason,
    ].filter((reason): reason is string => Boolean(reason && !["served_from_firebase", "not_current_phase", "fresh", "disabled", "disabled_by_step_size"].includes(reason)));
    const syncError = roster.refresh.sync.errors.at(-1) || null;
    const auditLevel = roster.refresh.sync.status === "failed"
      ? "error"
      : warningReasons.length
        ? "warning"
        : "debug";
    const shouldPersistStep = auditLevel === "debug"
      ? debugAuditEnabled
      : apiSettings?.dashboardApiWarningAuditLogs !== false;
    if (!cacheOnly) {
      await recordDashboardSystemLog(auditLevel, "guild.roster.sync.step", {
        summary: `Guild roster sync: ${roster.refresh.sync.phase} • ${roster.members.length} персонажів`,
        profileId: session?.profileId || null,
        memberCount: roster.members.length,
        source: roster.source,
        forceRefresh,
        continueSync,
        includeMembers,
        includeStats,
        cacheOnly,
        softSync,
        bypassCache,
        refresh: roster.refresh,
        warningReasons,
        error: syncError,
        syncErrors: roster.refresh.sync.errors,
      }, { debugEnabled: debugAuditEnabled, persist: shouldPersistStep });
    }

    logDashboardEvent("info", "guild.roster.refreshed", request, {
      profileId: session?.profileId || null,
      memberCount: roster.members.length,
      source: roster.source,
      refresh: roster.refresh,
    });

    return NextResponse.json({
      ok: true,
      memberCount: roster.members.length,
      updatedAt: roster.stats.updatedAt,
      source: roster.source,
      ...(includeStats ? { stats: roster.stats } : {}),
      ...(includeMembers ? { members: roster.members } : {}),
      error: roster.error || syncError || null,
      refresh: roster.refresh,
      hasMore:
        roster.refresh.sync.status === "running" ||
        roster.refresh.battleNet.remaining > 0 ||
        roster.refresh.raiderIo.remaining > 0,
    }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("warn", "guild.roster.refresh_failed", request, {
      profileId: session?.profileId || null,
      message,
    });
    await recordDashboardSystemLog("error", "guild.roster.sync.failed", {
      summary: message,
      profileId: session?.profileId || null,
      error: message,
    }, { persist: true });

    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося оновити склад гільдії.",
    }, { status: 500, headers: noStoreHeaders() });
  }
}
