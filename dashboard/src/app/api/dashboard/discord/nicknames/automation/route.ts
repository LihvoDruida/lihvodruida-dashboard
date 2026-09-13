import { NextRequest, NextResponse } from "next/server";

import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import {
  acquireNicknameWarningExecution,
  getNicknameWarningAutomationState,
  nicknameFullScanDue,
  processFullNicknameSweep,
  processPriorityNicknameWarnings,
} from "@/lib/discordNicknameWarnings";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage, unauthorizedResponse, verifyInternalBearerToken } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOKENS = ["CRON_SECRET", "INTERNAL_API_TOKEN", "RAID_LIFECYCLE_SECRET"];

export async function POST(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "discord.nickname_warning.automation_forbidden", request, {
      reason: auth.reason,
      envName: auth.envName || null,
      statusCode: 401,
    });
    return unauthorizedResponse("Forbidden");
  }

  const policy = await getGuildNicknamePolicy({ bypassCache: true });
  if (!policy.nicknameReminderEnabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: "disabled" }, { headers: noStoreHeaders() });
  }

  const state = await getNicknameWarningAutomationState({ fresh: true });
  const runFullScan = nicknameFullScanDue(state, policy);
  const execution = acquireNicknameWarningExecution(runFullScan ? "automatic:full" : "automatic:priority");
  if (!execution) {
    return NextResponse.json({ ok: true, skipped: true, reason: "in_flight" }, { headers: noStoreHeaders() });
  }

  if (runFullScan) {
    logDashboardEvent("info", "discord.nickname_warning.auto_started", request, {
      mode: "full",
      invalidRecheckHours: policy.nicknameInvalidRecheckHours,
      validRecheckHours: policy.nicknameValidRecheckHours,
      cooldownHours: policy.nicknameReminderCooldownHours,
      batchLimit: policy.nicknameReminderBatchLimit,
      fallbackChannelId: policy.nicknameReminderChannelId || null,
      lastFullScanAt: state.lastFullScanAt,
    }, { category: "action" });
  }

  try {
    const result = runFullScan
      ? await processFullNicknameSweep({ source: "automatic" })
      : await processPriorityNicknameWarnings({ source: "automatic", force: false });

    if ("skipped" in result && result.skipped) {
      return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders() });
    }

    logDashboardEvent(result.failed ? "warn" : "info", "discord.nickname_warning.auto_completed", request, result, { category: "action" });
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error, "Автоматичну перевірку ніків не виконано.");
    logDashboardEvent("error", "discord.nickname_warning.auto_failed", request, { message }, { category: "action" });
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: noStoreHeaders() });
  } finally {
    execution.release();
  }
}
