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
    return redirectWithToast(request, "/raids", {
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
    const scheduledEvent = result.scheduledEvent;
    const scheduledEventLabel =
      scheduledEvent.action === "created"
        ? "Discord-подію створено"
        : scheduledEvent.action === "updated"
          ? "Discord-подію оновлено"
          : scheduledEvent.action === "deleted"
            ? "Discord-подію видалено"
            : scheduledEvent.action === "failed"
              ? "Discord-подію не синхронізовано"
              : "Discord-подія без змін";

    logDashboardEvent("info", discordEvent, request, {
      raidId: result.raid.id,
      actorId: user.id,
      actorRole: user.role,
      messageUrl: result.published || "",
      channelId: result.raid.channelId || "",
      messageId: result.raid.messageId || "",
      scheduledEventAction: scheduledEvent.action,
      scheduledEventId: scheduledEvent.eventId || "",
      scheduledEventUrl: scheduledEvent.eventUrl || "",
      scheduledEventError: scheduledEvent.error || "",
    });
    logDashboardEvent(
      scheduledEvent.action === "failed" ? "warn" : "info",
      `raids.discord_event.${scheduledEvent.action}`,
      request,
      {
        raidId: result.raid.id,
        eventId: scheduledEvent.eventId || "",
        eventUrl: scheduledEvent.eventUrl || "",
        error: scheduledEvent.error || "",
      },
    );

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
      scheduledEventAction: scheduledEvent.action,
      scheduledEventId: scheduledEvent.eventId || null,
      scheduledEventUrl: scheduledEvent.eventUrl || null,
      scheduledEventError: scheduledEvent.error || null,
    }).catch((auditError) => {
      logDashboardEvent("warn", "raids.discord.publish.audit_failed", request, { raidId: result.raid.id, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });

    return redirectWithToast(request, `/raids/${encodeURIComponent(result.raid.id)}/edit`, {
      tone: scheduledEvent.action === "failed" ? "warning" : "success",
      title: scheduledEvent.action === "failed" ? `${toastTitle}, але подія потребує уваги` : toastTitle,
      message: scheduledEvent.error
        ? `${scheduledEventLabel}: ${scheduledEvent.error}`
        : `${scheduledEventLabel}${scheduledEvent.eventUrl ? ` · ${scheduledEvent.eventUrl}` : ""}`,
      ttl: scheduledEvent.action === "failed" ? 10000 : 7600,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raids.discord.publish.failed", request, { actorId: user.id, actorRole: user.role, message });
    await recordAdminAudit("raids.discord.publish_failed", user, {
      status: "error",
      summary: `Discord-публікацію рейду не виконано: ${message}`,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return redirectWithToast(request, failurePath, {
      tone: "error",
      title: "Discord-публікацію не виконано",
      message: safeErrorMessage(error),
      ttl: 9200,
    });
  }
}
