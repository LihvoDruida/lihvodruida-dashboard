import { NextRequest, NextResponse } from "next/server";
import { cleanupDashboardProfilesDiscordMembership } from "@/lib/discordMemberManagement";
import {
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  unauthorizedResponse,
  verifyInternalBearerToken,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACCOUNT_CLEANUP_TOKENS = [
  "ACCOUNT_CLEANUP_SECRET",
  "CRON_SECRET",
  "INTERNAL_API_TOKEN",
  "RAID_LIFECYCLE_SECRET",
  "WORKER_STATS_TOKEN",
];

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomAccountCleanupApplyRouteGuard:
    | { inFlight?: Promise<unknown>; lastStartedAt: number; lastResult?: Record<string, unknown> }
    | undefined;
}

function guardState() {
  const guard = globalThis.__mistblossomAccountCleanupApplyRouteGuard || { lastStartedAt: 0 };
  globalThis.__mistblossomAccountCleanupApplyRouteGuard = guard;
  return guard;
}

function envFlag(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function minIntervalMs() {
  const fallback = envFlag("DASHBOARD_ECO_MODE", false) ? 24 * 60 * 60_000 : 6 * 60 * 60_000;
  const value = Number(process.env.ACCOUNT_CLEANUP_MIN_INTERVAL_MS || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(30 * 60_000, Math.min(Math.floor(value), 7 * 24 * 60 * 60_000));
}

function limitFromRequest(request: NextRequest) {
  const url = new URL(request.url);
  const value = Number(url.searchParams.get("limit") || process.env.ACCOUNT_CLEANUP_PROFILE_LIMIT || 50_000);
  if (!Number.isFinite(value)) return 50_000;
  return Math.max(100, Math.min(Math.floor(value), 50_000));
}

function wantsForceRun(request: NextRequest) {
  const url = new URL(request.url);
  return url.searchParams.get("force") === "1" || request.headers.get("x-force-account-cleanup") === "1";
}

export async function GET(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, ACCOUNT_CLEANUP_TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "profiles.orphan_cleanup_apply.forbidden", request, { reason: auth.reason, envName: auth.envName || null });
    return unauthorizedResponse("Forbidden");
  }

  const guard = guardState();
  const force = wantsForceRun(request);
  const cooldown = minIntervalMs();
  const now = Date.now();

  if (!force && guard.inFlight) {
    return NextResponse.json({ ok: true, skipped: true, reason: "in_flight", ...(guard.lastResult || {}) }, { headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "in-flight" }) });
  }

  if (!force && guard.lastStartedAt && now - guard.lastStartedAt < cooldown) {
    return NextResponse.json({ ok: true, skipped: true, reason: "cooldown", cooldownMs: cooldown, ...(guard.lastResult || {}) }, { headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "cooldown" }) });
  }

  guard.lastStartedAt = now;
  const task = cleanupDashboardProfilesDiscordMembership({
    limit: limitFromRequest(request),
    dryRun: false,
    reason: "Mistblossom scheduled orphan account cleanup",
  });
  guard.inFlight = task;

  try {
    const result = await task;
    const payload = {
      ok: true,
      dryRun: result.dryRun,
      checkedProfiles: result.checkedProfiles,
      checkedDiscordProfiles: result.checkedDiscordProfiles,
      checkedDiscordMembers: result.checkedDiscordMembers,
      checkedRosterCharacters: result.checkedRosterCharacters,
      rosterRefresh: result.rosterRefresh,
      rosterSafetyBlocked: result.rosterSafetyBlocked,
      rosterProtectedTotal: result.rosterProtectedTotal,
      targetProfilesTotal: result.targetProfilesTotal,
      targetDiscordUsersTotal: result.targetDiscordUsersTotal,
      deletedProfilesTotal: result.deletedProfilesTotal,
      removedRaidSignupsTotal: result.removedRaidSignupsTotal,
      updatedRaidsTotal: result.updatedRaidsTotal,
      failed: result.failed,
      errorsTotal: result.errorsTotal,
    };
    guard.lastResult = payload;
    logDashboardEvent(result.failed || result.rosterSafetyBlocked ? "warn" : "info", "profiles.orphan_cleanup_apply.completed", request, payload);
    return NextResponse.json(payload, { headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "apply" }) });
  } catch (error) {
    const message = safeErrorMessage(error, "Автоматичне очищення акаунтів не виконано.");
    const payload = { ok: false, error: message };
    guard.lastResult = payload;
    logDashboardEvent("error", "profiles.orphan_cleanup_apply.failed", request, { message });
    return NextResponse.json(payload, { status: 500, headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "error" }) });
  } finally {
    guard.inFlight = undefined;
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
