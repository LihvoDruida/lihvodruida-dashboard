import { NextRequest, NextResponse } from "next/server";

import {
  acquireAccountCleanupExecutionLock,
  getAccountCleanupAutomationSettings,
  isAccountCleanupDue,
  recordAccountCleanupRun,
  type AccountCleanupRunMode,
} from "@/lib/accountCleanupAutomation";
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

function forcedMode(request: NextRequest): AccountCleanupRunMode | null {
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1" || request.headers.get("x-force-account-cleanup") === "1";
  if (!force) return null;
  return url.searchParams.get("mode") === "apply" ? "apply" : "inspect";
}

function resultSummary(mode: AccountCleanupRunMode, result: Awaited<ReturnType<typeof cleanupDashboardProfilesDiscordMembership>>) {
  if (mode === "apply") {
    return `Автоочищення: перевірено ${result.checkedDiscordProfiles}; кандидатів ${result.targetProfilesTotal}; видалено профілів ${result.deletedProfilesTotal}; рейдових записів ${result.removedRaidSignupsTotal}; піків складу ${result.removedRosterPicksTotal || 0}; голосів ${result.removedPollVotesTotal || 0}; помилок ${result.errorsTotal || result.failed || 0}.`;
  }
  return `Автоперевірка: перевірено ${result.checkedDiscordProfiles}; кандидатів ${result.targetProfilesTotal}; захищено roster ${result.rosterProtectedTotal}; помилок ${result.errorsTotal || result.failed || 0}.`;
}

async function run(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, ACCOUNT_CLEANUP_TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "profiles.orphan_cleanup.forbidden", request, {
      reason: auth.reason,
      envName: auth.envName || null,
      statusCode: 401,
    });
    return unauthorizedResponse("Forbidden");
  }

  const guard = accountCleanupGuard();
  if (guard.inFlight) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: "in_flight", ...(guard.lastResult || {}) },
      { headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "in-flight" }) },
    );
  }

  const settings = await getAccountCleanupAutomationSettings({ fresh: true });
  const forced = forcedMode(request);
  const now = Date.now();
  let mode: AccountCleanupRunMode | null = forced;

  if (!mode) {
    const cleanupDue = settings.autoCleanupEnabled
      && isAccountCleanupDue(settings.lastCleanupAt, settings.cleanupIntervalHours, now);
    const checkDue = settings.autoCheckEnabled
      && isAccountCleanupDue(settings.lastCheckAt, settings.checkIntervalHours, now);
    const lastCheckMs = settings.lastCheckAt ? Date.parse(settings.lastCheckAt) : Number.NaN;
    const freshCheckWindowMs = Math.max(1, settings.checkIntervalHours) * 60 * 60_000 + 20 * 60_000;
    const cleanupHasFreshSafetyCheck = settings.lastCheckStatus === "success"
      && Number.isFinite(lastCheckMs)
      && now - lastCheckMs <= freshCheckWindowMs;

    // Automatic deletion is deliberately two-phase. If the cleanup deadline
    // arrives without a recent successful dry-run, this tick only inspects.
    // The following cron tick may apply after that safety check was persisted.
    if (cleanupDue && cleanupHasFreshSafetyCheck) mode = "apply";
    else if (cleanupDue || checkDue) mode = "inspect";
  }

  if (!mode) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: settings.autoCheckEnabled || settings.autoCleanupEnabled ? "not_due" : "disabled",
      settings: {
        autoCheckEnabled: settings.autoCheckEnabled,
        autoCleanupEnabled: settings.autoCleanupEnabled,
        checkIntervalHours: settings.checkIntervalHours,
        cleanupIntervalHours: settings.cleanupIntervalHours,
        lastCheckAt: settings.lastCheckAt,
        lastCleanupAt: settings.lastCleanupAt,
      },
    }, { headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "skipped" }) });
  }

  // A force apply is intentionally reserved for authenticated internal calls.
  // Normal cron execution can apply only when the owner enabled auto cleanup.
  if (!forced && mode === "apply" && !settings.autoCleanupEnabled) mode = "inspect";

  const execution = acquireAccountCleanupExecutionLock(`automatic:${mode}`);
  if (!execution) {
    return NextResponse.json({ ok: true, skipped: true, reason: "cleanup_in_flight" }, {
      headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "in-flight" }),
    });
  }

  const startedAt = new Date().toISOString();
  guard.lastStartedAt = now;
  logDashboardEvent("info", mode === "apply" ? "profiles.orphan_cleanup.auto_apply_started" : "profiles.orphan_cleanup.auto_check_started", request, {
    mode,
    forced: Boolean(forced),
    profileLimit: settings.profileLimit,
  }, { category: "action" });

  const task = cleanupDashboardProfilesDiscordMembership({
    limit: settings.profileLimit,
    dryRun: mode !== "apply",
    reason: mode === "apply"
      ? "Mistblossom automatic orphan account cleanup"
      : "Mistblossom automatic orphan account check",
  });
  guard.inFlight = task;

  try {
    const result = await task;
    const status = result.failed || result.rosterSafetyBlocked || result.rosterRefresh?.failed ? "warning" : "success";
    const summary = resultSummary(mode, result);
    const payload = {
      ok: true,
      mode,
      forced: Boolean(forced),
      status,
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
      removedRosterPicksTotal: result.removedRosterPicksTotal || 0,
      removedPollVotesTotal: result.removedPollVotesTotal || 0,
      updatedRaidsTotal: result.updatedRaidsTotal,
      failed: result.failed,
      errorsTotal: result.errorsTotal,
      summary,
    };
    guard.lastResult = payload;

    await recordAccountCleanupRun({
      mode,
      source: "automatic",
      status,
      startedAt,
      checkedProfiles: result.checkedDiscordProfiles,
      candidates: result.targetProfilesTotal,
      deletedProfiles: result.deletedProfilesTotal,
      removedRaidSignups: result.removedRaidSignupsTotal,
      removedRosterPicks: result.removedRosterPicksTotal || 0,
      removedPollVotes: result.removedPollVotesTotal || 0,
      errors: result.errorsTotal || result.failed || 0,
      summary,
      error: status === "warning" ? summary : null,
    }).catch((error) => {
      logDashboardEvent("warn", "profiles.orphan_cleanup.state_record_failed", request, {
        mode,
        message: safeErrorMessage(error, "Не вдалося записати стан автоматичного очищення."),
      });
    });

    logDashboardEvent(status === "warning" ? "warn" : "info", mode === "apply"
      ? "profiles.orphan_cleanup.auto_apply_completed"
      : "profiles.orphan_cleanup.auto_check_completed", request, payload, { category: "action" });
    return NextResponse.json(payload, {
      headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": mode }),
    });
  } catch (error) {
    const message = safeErrorMessage(error, "Автоматичну перевірку акаунтів не виконано.");
    const payload = { ok: false, mode, status: "error", error: message };
    guard.lastResult = payload;
    await recordAccountCleanupRun({
      mode,
      source: "automatic",
      status: "error",
      startedAt,
      summary: message,
      error: message,
      errors: 1,
    }).catch(() => null);
    logDashboardEvent("error", mode === "apply"
      ? "profiles.orphan_cleanup.auto_apply_failed"
      : "profiles.orphan_cleanup.auto_check_failed", request, { message }, { category: "action" });
    return NextResponse.json(payload, {
      status: 500,
      headers: noStoreHeaders({ "X-Mistblossom-Account-Cleanup": "error" }),
    });
  } finally {
    guard.inFlight = undefined;
    execution.release();
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
