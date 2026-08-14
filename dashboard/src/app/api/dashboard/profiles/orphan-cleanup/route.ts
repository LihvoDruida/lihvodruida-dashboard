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

type AccountCleanupRouteGuard = {
  inFlight?: Promise<unknown>;
  lastStartedAt: number;
  lastResult?: Record<string, unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomAccountCleanupRouteGuard: AccountCleanupRouteGuard | undefined;
}

function accountCleanupGuard() {
  const guard = globalThis.__mistblossomAccountCleanupRouteGuard || { lastStartedAt: 0 };
  globalThis.__mistblossomAccountCleanupRouteGuard = guard;
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

function defaultLimit() {
  const value = Number(process.env.ACCOUNT_CLEANUP_PROFILE_LIMIT || 50_000);
  if (!Number.isFinite(value)) return 50_000;
  return Math.max(100, Math.min(Math.floor(value), 50_000));
}

function wantsForceRun(request: NextRequest) {
  const url = new URL(request.url);
  return url.searchParams.get("force") === "1" || request.headers.get("x-force-account-cleanup") === "1";
}

function wantsApply(request: NextRequest) {
  const url = new URL(request.url);
  const explicit = url.searchParams.get("apply");
  if (explicit !== null) return explicit === "1" || explicit === "true";
  return envFlag("ACCOUNT_CLEANUP_AUTO_APPLY", false);
}

function limitFromRequest(request: NextRequest) {
  const url = new URL(request.url);
  return url.searchParams.get("limit") || defaultLimit();
}

async function run(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, ACCOUNT_CLEANUP_TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "profiles.orphan_cleanup.forbidden", request, { reason: auth.reason, envName: auth.envName || null });
    return unauthorizedResponse("Forbidden");
  }

  const guard = accountCleanupGuard();
  const force = wantsForceRun(request);
  const now = Date.now();
  const cooldown = minIntervalMs();

  if (!force && guard.inFlight) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: "in_flight", ...(guard.lastResult || {}) },
      { headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "in-flight" }) },
    );
  }

  if (!force && guard.lastStartedAt && now - guard.lastStartedAt < cooldown) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: "cooldown", cooldownMs: cooldown, ...(guard.lastResult || {}) },
      { headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "cooldown" }) },
    );
  }

  const apply = wantsApply(request);
  const limit = limitFromRequest(request);
  guard.lastStartedAt = now;

  const task = cleanupDashboardProfilesDiscordMembership({
    limit,
    dryRun: !apply,
    reason: apply ? "Mistblossom automatic orphan account cleanup" : "Mistblossom automatic orphan account cleanup dry-run",
  });

  guard.inFlight = task;
  try {
    const result = await task;
    const summary = {
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
    guard.lastResult = summary;
    logDashboardEvent(result.failed || result.rosterSafetyBlocked ? "warn" : "info", "profiles.orphan_cleanup.completed", request, summary);
    return NextResponse.json(summary, { headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": apply ? "apply" : "dry-run" }) });
  } catch (error) {
    const message = safeErrorMessage(error, "Автоматичне очищення акаунтів не виконано.");
    const payload = { ok: false, error: message };
    guard.lastResult = payload;
    logDashboardEvent("error", "profiles.orphan_cleanup.failed", request, { message });
    return NextResponse.json(payload, { status: 500, headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "error" }) });
  } finally {
    guard.inFlight = undefined;
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
