import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { pauseRaidPoll, raidPollLiveRevision, resumeRaidPoll } from "@/lib/raidPolls";
import { assertRequestBodySize, logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";
import {  } from "@/lib/serverToasts";
import {  redirectWithToast, wantsJson } from "@/lib/apiRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PauseAction = "pause" | "resume";

async function readAction(request: NextRequest): Promise<{ action: PauseAction; note: string; extendMinutes: number }> {
  const contentType = request.headers.get("content-type") || "";
  let raw: Record<string, unknown> = {};

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && !Array.isArray(body)) raw = body as Record<string, unknown>;
  } else {
    const form = await request.formData().catch(() => null);
    if (form) raw = Object.fromEntries(form.entries());
  }

  const action = String(raw.action || "pause").trim().toLowerCase();
  return {
    action: action === "resume" ? "resume" : "pause",
    note: String(raw.note || "").trim().slice(0, 300),
    extendMinutes: Math.max(0, Math.min(10080, Math.floor(Number(raw.extendMinutes) || 0))),
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  const tooLarge = assertRequestBodySize(request, 8 * 1024);
  if (tooLarge) return tooLarge;

  const user = await getSession();
  const { pollId } = await context.params;
  const jsonMode = wantsJson(request);

  if (!user || !canManageRaids(user)) {
    if (jsonMode) return NextResponse.json({ ok: false, error: "Твоя роль не може ставити рейд-пули на паузу." }, { status: 403, headers: noStoreHeaders() });
    return redirectWithToast(request, `/polls/${encodeURIComponent(pollId)}`, { tone: "error", title: "Доступ заборонено", message: "Твоя роль не може керувати паузою рейд-пулів." });
  }

  const { action, note, extendMinutes } = await readAction(request);

  try {
    const poll = action === "pause"
      ? await pauseRaidPoll(pollId, { actorName: user.name || user.login || "Dashboard", note })
      : await resumeRaidPoll(pollId, { actorName: user.name || user.login || "Dashboard", extendMinutes });

    logDashboardEvent("info", `raid_polls.${action}d`, request, { pollId: poll.id, actorId: user.id, status: poll.status });
    await recordAdminAudit(`raid_polls.${action}`, user, {
      status: "success",
      summary: action === "pause"
        ? `Рейд-пул поставлено на паузу: ${poll.title}.`
        : `Рейд-пул відновлено: ${poll.title}.`,
      pollId: poll.id,
      title: poll.title,
    }).catch(() => false);

    if (jsonMode) {
      return NextResponse.json({ ok: true, pollId: poll.id, status: poll.status, poll, revision: raidPollLiveRevision(poll) }, { headers: noStoreHeaders() });
    }
    return redirectWithToast(request, `/polls/${encodeURIComponent(poll.id)}`, {
      tone: "success",
      title: action === "pause" ? "Рейд-пул на паузі" : "Рейд-пул відновлено",
      message: action === "pause"
        ? "Час до закриття заморожено, Discord-кнопки вимкнено."
        : "Голосування знову приймає голоси, залишок часу повернено.",
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", `raid_polls.${action}_failed`, request, { pollId, actorId: user.id, message });
    if (jsonMode) return NextResponse.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders() });
    return redirectWithToast(request, `/polls/${encodeURIComponent(pollId)}`, {
      tone: "error",
      title: action === "pause" ? "Не вдалося поставити на паузу" : "Не вдалося відновити",
      message,
      ttl: 8200,
    });
  }
}
