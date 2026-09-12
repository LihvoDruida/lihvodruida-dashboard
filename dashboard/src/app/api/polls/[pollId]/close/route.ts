import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { closeRaidPoll, raidPollLiveRevision, reopenRaidPoll } from "@/lib/raidPolls";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";
import {  } from "@/lib/serverToasts";
import {  redirectWithToast, wantsJson } from "@/lib/apiRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function readAction(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  let raw: Record<string, unknown> = {};
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && !Array.isArray(body)) raw = body as Record<string, unknown>;
  } else {
    const form = await request.formData().catch(() => null);
    if (form) raw = Object.fromEntries(form.entries());
  }
  const action = String(raw.action || "close").trim().toLowerCase();
  return {
    reopen: action === "reopen",
    minutes: Math.max(0, Math.min(20160, Math.floor(Number(raw.minutes) || 0))),
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  const user = await getSession();
  const { pollId } = await context.params;
  const jsonMode = wantsJson(request);
  if (!user || !canManageRaids(user)) {
    if (jsonMode) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
    return redirectWithToast(request, `/polls/${encodeURIComponent(pollId)}`, { tone: "error", title: "Доступ заборонено", message: "Твоя роль не може закривати рейд-пули." });
  }

  const { reopen, minutes } = await readAction(request);

  try {
    const poll = reopen
      ? await reopenRaidPoll(pollId, { minutes })
      : await closeRaidPoll(pollId, "manual");

    logDashboardEvent("info", reopen ? "raid_polls.reopened" : "raid_polls.closed", request, { pollId, actorId: user.id, status: poll.status });
    await recordAdminAudit(reopen ? "raid_polls.reopen" : "raid_polls.close", user, {
      status: "success",
      summary: reopen ? `Рейд-пул відкрито знову: ${poll.title}.` : `Рейд-пул закрито: ${poll.title}.`,
      pollId: poll.id,
    }).catch(() => false);

    if (jsonMode) {
      return NextResponse.json(
        { ok: true, pollId: poll.id, status: poll.status, poll, revision: raidPollLiveRevision(poll) },
        { headers: noStoreHeaders() },
      );
    }
    return redirectWithToast(request, `/polls/${encodeURIComponent(poll.id)}`, {
      tone: "success",
      title: reopen ? "Рейд-пул відкрито" : "Рейд-пул закрито",
      message: reopen ? "Кнопки голосування в Discord знову активні." : "Discord-повідомлення оновлено фінальним результатом.",
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    if (jsonMode) return NextResponse.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders() });
    return redirectWithToast(request, `/polls/${encodeURIComponent(pollId)}`, { tone: "error", title: "Не вдалося закрити", message, ttl: 8200 });
  }
}
