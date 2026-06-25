import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids, canViewRaidDirectory } from "@/lib/permissions";
import { deleteRaidPoll, getRaidPoll, raidPollLiveRevision, updateRaidPollFromForm, updateRaidPollFromInput, type RaidPollUpdateInput } from "@/lib/raidPolls";
import { assertRequestBodySize, logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function wantsJson(request: NextRequest) {
  const accept = request.headers.get("accept") || "";
  const contentType = request.headers.get("content-type") || "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: noStoreHeaders() });
}

async function readUpdateInput(request: NextRequest): Promise<{ input?: RaidPollUpdateInput; form?: FormData }> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Некоректне JSON-тіло запиту.");
    return { input: body as RaidPollUpdateInput };
  }
  return { form: await request.formData() };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  const user = await getSession();
  if (!user || !canViewRaidDirectory(user)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
  }
  const { pollId } = await context.params;
  const poll = await getRaidPoll(pollId);
  if (!poll) return NextResponse.json({ ok: false, error: "Poll not found" }, { status: 404, headers: noStoreHeaders() });
  return NextResponse.json({ ok: true, poll, revision: raidPollLiveRevision(poll) }, { headers: noStoreHeaders() });
}

async function updatePoll(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  const tooLarge = assertRequestBodySize(request, 32 * 1024);
  if (tooLarge) return tooLarge;

  const jsonMode = wantsJson(request);
  const user = await getSession();
  const { pollId } = await context.params;
  if (!user || !canManageRaids(user)) {
    return jsonMode ? jsonError("Твоя роль не має доступу до редагування рейд-пулів.", 403) : jsonError("Forbidden", 403);
  }

  try {
    const { input, form } = await readUpdateInput(request);
    const poll = input ? await updateRaidPollFromInput(pollId, input) : await updateRaidPollFromForm(pollId, form as FormData);
    logDashboardEvent("info", "raid_polls.updated", request, {
      pollId: poll.id,
      actorId: user.id,
      channelId: poll.channelId || "",
      messageId: poll.messageId || "",
    });
    await recordAdminAudit("raid_polls.update", user, {
      status: "success",
      summary: `Рейд-пул оновлено: ${poll.title}.`,
      pollId: poll.id,
      title: poll.title,
      channelId: poll.channelId || null,
      messageId: poll.messageId || null,
    }).catch(() => false);

    return NextResponse.json({ ok: true, pollId: poll.id, redirectTo: `/polls/${encodeURIComponent(poll.id)}`, poll, revision: raidPollLiveRevision(poll) }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raid_polls.update_failed", request, { pollId, actorId: user.id, message });
    await recordAdminAudit("raid_polls.update_failed", user, {
      status: "error",
      summary: `Рейд-пул не оновлено: ${message}`,
      pollId,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return jsonError(message, 400);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  return updatePoll(request, context);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  return updatePoll(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ pollId: string }> }) {
  const user = await getSession();
  const { pollId } = await context.params;
  if (!user || !canManageRaids(user)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
  }

  try {
    const result = await deleteRaidPoll(pollId);
    logDashboardEvent("info", "raid_polls.deleted", request, {
      pollId: result.poll.id,
      actorId: user.id,
      discordDeleted: result.discordDeleted,
      discordDeleteFailed: result.discordDeleteFailed,
    });
    await recordAdminAudit("raid_polls.delete", user, {
      status: result.discordDeleteFailed ? "warning" : "success",
      summary: result.discordDeleteFailed
        ? `Рейд-пул видалено із сайту, але Discord-повідомлення не вдалося видалити: ${result.poll.title}.`
        : `Рейд-пул видалено: ${result.poll.title}.`,
      pollId: result.poll.id,
      title: result.poll.title,
      channelId: result.poll.channelId || null,
      messageId: result.poll.messageId || null,
    }).catch(() => false);

    return NextResponse.json({
      ok: true,
      pollId: result.poll.id,
      redirectTo: "/polls",
      discordDeleted: result.discordDeleted,
      discordDeleteFailed: result.discordDeleteFailed,
      warning: result.discordDeleteFailed ? "Пул видалено із сайту, але Discord-повідомлення не вдалося видалити автоматично." : null,
    }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raid_polls.delete_failed", request, { pollId, actorId: user.id, message });
    await recordAdminAudit("raid_polls.delete_failed", user, {
      status: "error",
      summary: `Рейд-пул не видалено: ${message}`,
      pollId,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return NextResponse.json({ ok: false, error: message }, { status: 400, headers: noStoreHeaders() });
  }
}
