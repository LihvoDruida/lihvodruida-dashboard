import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { deleteRaid } from "@/lib/raids";
import { assertRequestBodySize, logDashboardEvent, safeErrorMessage } from "@/lib/security";
import {  } from "@/lib/serverToasts";
import {  redirectWithToast } from "@/lib/apiRoute";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ raidId: string }> }) {
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

  const { raidId } = await params;
  try {
    logDashboardEvent("info", "raids.delete.start", request, { raidId, actorId: user.id, actorRole: user.role });
    const result = await deleteRaid(raidId);
    logDashboardEvent("info", "raids.delete.done", request, { raidId: result.id, actorId: user.id, actorRole: user.role });
    const discordCleanupFailed = result.discordDeleteFailed || result.discordEventDeleteFailed;
    await recordAdminAudit("raids.delete", user, {
      status: discordCleanupFailed ? "warning" : "success",
      summary: discordCleanupFailed ? `Рейд видалено з панелі, але не всі Discord-ресурси вдалося прибрати: ${result.title || result.id}.` : `Рейд видалено: ${result.title || result.id}.`,
      raidId: result.id,
      title: result.title || null,
      raidStatus: result.status,
      discordDeleted: Boolean(result.discordDeleted),
      discordDeleteFailed: Boolean(result.discordDeleteFailed),
      discordEventDeleted: Boolean(result.discordEventDeleted),
      discordEventDeleteFailed: Boolean(result.discordEventDeleteFailed),
      discordEventId: result.discordEventId || null,
      channelId: result.channelId || null,
      messageId: result.messageId || null,
    }).catch((auditError) => {
      logDashboardEvent("warn", "raids.delete.audit_failed", request, { raidId: result.id, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });
    return redirectWithToast(request, "/raids", {
      tone: discordCleanupFailed ? "warning" : "success",
      title: result.status === "draft" ? "Чернетку видалено" : "Рейд видалено",
      message: discordCleanupFailed
        ? "Рейд видалено з панелі, але один із Discord-ресурсів (повідомлення або подію) не вдалося прибрати автоматично. Перевір Discord вручну."
        : result.discordDeleted || result.discordEventDeleted
          ? "Рейд прибрано з панелі разом із повʼязаними Discord-ресурсами."
          : "Рейд прибрано зі списку.",
      ttl: discordCleanupFailed ? 9800 : 6200,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raids.delete.failed", request, { raidId, actorId: user.id, actorRole: user.role, message });
    await recordAdminAudit("raids.delete_failed", user, {
      status: "error",
      summary: `Рейд не видалено: ${message}`,
      raidId,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return redirectWithToast(request, "/raids", {
      tone: "error",
      title: "Дію з рейдом не виконано",
      message: safeErrorMessage(error),
      ttl: 8600,
    });
  }
}
