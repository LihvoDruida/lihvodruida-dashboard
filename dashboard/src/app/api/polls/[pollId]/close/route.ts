import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { closeRaidPoll } from "@/lib/raidPolls";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";
import { dashboardToastCookie } from "@/lib/serverToasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function appBaseUrl() {
  return process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || process.env.ADMIN_DASHBOARD_URL || process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
}

function wantsJson(request: NextRequest) {
  const accept = request.headers.get("accept") || "";
  const contentType = request.headers.get("content-type") || "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

function redirectWithToast(path: string, toast: { tone?: "success" | "error" | "warning"; title: string; message?: string; ttl?: number }) {
  const response = NextResponse.redirect(new URL(path, appBaseUrl()), { status: 303, headers: noStoreHeaders() });
  response.headers.append("Set-Cookie", dashboardToastCookie(toast));
  return response;
}

export async function POST(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  const user = await getSession();
  const { pollId } = await context.params;
  const jsonMode = wantsJson(request);
  if (!user || !canManageRaids(user)) {
    if (jsonMode) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
    return redirectWithToast(`/polls/${encodeURIComponent(pollId)}`, { tone: "error", title: "Доступ заборонено", message: "Твоя роль не може закривати рейд-пули." });
  }

  try {
    const poll = await closeRaidPoll(pollId, "manual", { silentIfClosed: true });
    logDashboardEvent("info", "raid_polls.closed", request, { pollId, actorId: user.id, status: poll.status });
    await recordAdminAudit("raid_polls.close", user, {
      status: "success",
      summary: `Рейд-пул закрито: ${poll.title}.`,
      pollId: poll.id,
    }).catch(() => false);
    if (jsonMode) return NextResponse.json({ ok: true, pollId: poll.id, poll }, { headers: noStoreHeaders() });
    return redirectWithToast(`/polls/${encodeURIComponent(poll.id)}`, { tone: "success", title: "Рейд-пул закрито", message: "Discord-повідомлення оновлено фінальним результатом." });
  } catch (error) {
    const message = safeErrorMessage(error);
    if (jsonMode) return NextResponse.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders() });
    return redirectWithToast(`/polls/${encodeURIComponent(pollId)}`, { tone: "error", title: "Не вдалося закрити", message, ttl: 8200 });
  }
}
