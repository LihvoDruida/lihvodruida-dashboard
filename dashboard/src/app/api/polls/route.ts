import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids, canViewRaidDirectory } from "@/lib/permissions";
import { listRaidPolls, raidPollLiveRevision, saveRaidPollFromForm, saveRaidPollFromInput, type RaidPollCreateInput } from "@/lib/raidPolls";
import { assertRequestBodySize, logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";
import {  } from "@/lib/serverToasts";
import {  jsonError, redirectWithToast, wantsJson } from "@/lib/apiRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function readCreateInput(request: NextRequest): Promise<{ input?: RaidPollCreateInput; form?: FormData }> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Некоректне JSON-тіло запиту.");
    return { input: body as RaidPollCreateInput };
  }
  return { form: await request.formData() };
}

export async function GET() {
  const user = await getSession();
  if (!user || !canViewRaidDirectory(user)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
  }
  const polls = await listRaidPolls(120);
  return NextResponse.json({ ok: true, polls }, { headers: noStoreHeaders() });
}

export async function POST(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 32 * 1024);
  if (tooLarge) return tooLarge;

  const jsonMode = wantsJson(request);
  const user = await getSession();
  if (!user || !canManageRaids(user)) {
    if (jsonMode) return jsonError("Твоя роль не має доступу до створення рейд-пулів.", 403);
    return redirectWithToast(request, "/polls", {
      tone: "error",
      title: "Доступ заборонено",
      message: "Твоя роль не має доступу до створення рейд-пулів.",
      ttl: 7600,
    });
  }

  try {
    const { input, form } = await readCreateInput(request);
    const poll = input ? await saveRaidPollFromInput(input, user) : await saveRaidPollFromForm(form as FormData, user);
    logDashboardEvent("info", "raid_polls.created", request, {
      pollId: poll.id,
      actorId: user.id,
      channelId: poll.channelId || "",
      messageId: poll.messageId || "",
    });
    await recordAdminAudit("raid_polls.create", user, {
      auditId: `raid_polls.create:${poll.id}`,
      status: "success",
      summary: `Рейд-пул створено: ${poll.title}.`,
      pollId: poll.id,
      title: poll.title,
      channelId: poll.channelId || null,
      messageId: poll.messageId || null,
    }).catch(() => false);

    if (jsonMode) {
      return NextResponse.json({
        ok: true,
        pollId: poll.id,
        redirectTo: `/polls/${encodeURIComponent(poll.id)}`,
        poll,
        revision: raidPollLiveRevision(poll),
      }, { status: 201, headers: noStoreHeaders() });
    }

    return redirectWithToast(request, `/polls/${encodeURIComponent(poll.id)}`, {
      tone: "success",
      title: "Рейд-пул створено",
      message: "Повідомлення опубліковано в Discord, голосування відкрите.",
      ttl: 6200,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raid_polls.create_failed", request, { actorId: user.id, message });
    await recordAdminAudit("raid_polls.create_failed", user, {
      auditId: `raid_polls.create_failed:${Date.now().toString(36)}`,
      status: "error",
      summary: `Рейд-пул не створено: ${message}`,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);

    if (jsonMode) return jsonError(message, 400);

    return redirectWithToast(request, "/polls/new", {
      tone: "error",
      title: "Рейд-пул не створено",
      message,
      ttl: 8600,
    });
  }
}
