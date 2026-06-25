import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { recalculatePublishedRaidPollDiscordRecommendations } from "@/lib/raidPolls";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const user = await getSession();
  if (!user || !canManageRaids(user)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
  }

  try {
    const result = await recalculatePublishedRaidPollDiscordRecommendations();
    logDashboardEvent("info", "raid_polls.recommendations_recalculated", request, {
      actorId: user.id,
      total: result.total,
      updated: result.updated,
      failed: result.failed,
    });
    await recordAdminAudit("raid_polls.recommendations.recalculate", user, {
      status: result.failed ? "warning" : "success",
      summary: result.failed
        ? `Перераховано рекомендації рейд-пулів частково: ${result.updated}/${result.total}, помилок: ${result.failed}.`
        : `Перераховано рекомендації для ${result.updated} Discord-опублікованих рейд-пулів.`,
      total: result.total,
      updated: result.updated,
      failed: result.failed,
      failedPollIds: result.failedPollIds,
    }).catch(() => false);

    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raid_polls.recommendations_recalculate_failed", request, { actorId: user.id, message });
    await recordAdminAudit("raid_polls.recommendations.recalculate_failed", user, {
      status: "error",
      summary: `Не вдалося перерахувати рекомендації рейд-пулів: ${message}`,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return NextResponse.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders() });
  }
}
