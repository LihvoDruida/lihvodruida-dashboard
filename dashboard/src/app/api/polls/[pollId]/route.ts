import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { raidPollLiveRevision, resyncRaidPollDiscord } from "@/lib/raidPolls";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  const user = await getSession();
  const { pollId } = await context.params;

  if (!user || !canManageRaids(user)) {
    return NextResponse.json({ ok: false, error: "Твоя роль не може синхронізувати рейд-пули з Discord." }, { status: 403, headers: noStoreHeaders() });
  }

  try {
    const { poll, republished } = await resyncRaidPollDiscord(pollId);
    logDashboardEvent("info", "raid_polls.discord_resync", request, { pollId: poll.id, actorId: user.id, republished });
    await recordAdminAudit("raid_polls.discord_resync", user, {
      status: "success",
      summary: republished
        ? `Discord-повідомлення рейд-пулу опубліковано заново: ${poll.title}.`
        : `Discord-повідомлення рейд-пулу пересинхронізовано: ${poll.title}.`,
      pollId: poll.id,
    }).catch(() => false);

    return NextResponse.json(
      {
        ok: true,
        pollId: poll.id,
        republished,
        messageUrl: poll.messageUrl || null,
        poll,
        revision: raidPollLiveRevision(poll),
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raid_polls.discord_resync_failed", request, { pollId, actorId: user.id, message });
    return NextResponse.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders() });
  }
}
