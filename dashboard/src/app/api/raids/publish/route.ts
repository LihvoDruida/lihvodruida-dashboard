import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { getProfileById } from "@/lib/profiles";
import { saveAndMaybePublishRaid } from "@/lib/raids";
import { assertRequestBodySize, logDashboardEvent, safeErrorMessage } from "@/lib/security";
import {  } from "@/lib/serverToasts";
import {  redirectWithToast } from "@/lib/apiRoute";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 64 * 1024);
  if (tooLarge) return tooLarge;

  const user = await getSession();
  if (!user || !canManageRaids(user)) {
    return redirectWithToast("/raids", {
      tone: "error",
      title: "Доступ заборонено",
      message: "Твоя роль не має доступу до керування рейдами.",
      ttl: 7600,
    });
  }

  let failurePath = "/raids";

  try {
    const form = await request.formData();
    form.set("action", "publish");
    const raidId = String(form.get("raidId") || "").trim();
    failurePath = raidId ? `/raids/${encodeURIComponent(raidId)}/edit` : "/raids/new";

    const profile = user.profileId ? await getProfileById(user.profileId) : null;
    logDashboardEvent("info", "raids.discord.publish.start", request, {
      raidId,
      actorId: user.id,
      actorRole: user.role,
      channelId: String(form.get("channelId") || ""),
    });

    const result = await saveAndMaybePublishRaid(form, user, profile);
    const discordEvent = result.discordAction === "updated" ? "raids.discord.updated" : "raids.discord.created";
    const toastTitle = result.discordAction === "updated" ? "Discord-оголошення оновлено" : "Discord-оголошення опубліковано";

    logDashboardEvent("info", discordEvent, request, {
      raidId: result.raid.id,
      actorId: user.id,
      actorRole: user.role,
      messageUrl: result.published || "",
      channelId: result.raid.channelId || "",
      messageId: result.raid.messageId || "",
    });

    await recordAdminAudit("raids.discord.publish", user, {
      status: "success",
      summary: `${result.discordAction === "updated" ? "Discord-оголошення рейду оновлено" : "Discord-оголошення рейду опубліковано"}: ${result.raid.title || result.raid.id}.`,
      raidId: result.raid.id,
      raidStatus: result.raid.status,
      discordAction: result.discordAction,
      title: result.raid.title || null,
      channelId: result.raid.channelId || null,
      messageId: result.raid.messageId || null,
      messageUrl: result.published || null,
    }).catch((auditError) => {
      logDashboardEvent("warn", "raids.discord.publish.audit_failed", request, { raidId: result.raid.id, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });

    return redirectWithToast(`/raids/${encodeURIComponent(result.raid.id)}/edit`, {
      tone: "success",
      title: toastTitle,
      message: result.published || "Discord-повідомлення оброблено.",
      ttl: 7600,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raids.discord.publish.failed", request, { actorId: user.id, actorRole: user.role, message });
    await recordAdminAudit("raids.discord.publish_failed", user, {
      status: "error",
      summary: `Discord-публікацію рейду не виконано: ${message}`,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return redirectWithToast(failurePath, {
      tone: "error",
      title: "Discord-публікацію не виконано",
      message: safeErrorMessage(error),
      ttl: 9200,
    });
  }
}
