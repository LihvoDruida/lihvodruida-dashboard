import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { closeRaid } from "@/lib/raids";
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
    return redirectWithToast("/raids", {
      tone: "error",
      title: "Доступ заборонено",
      message: "Твоя роль не має доступу до керування рейдами.",
      ttl: 7600,
    });
  }

  const { raidId } = await params;
  try {
    logDashboardEvent("info", "raids.close.start", request, { raidId, actorId: user.id, actorRole: user.role });
    const result = await closeRaid(raidId);
    logDashboardEvent("info", "raids.close.done", request, { raidId: result.id, actorId: user.id, actorRole: user.role });
    await recordAdminAudit("raids.close", user, {
      status: result.discordSynced ? "success" : "warning",
      summary: result.discordSynced ? `Рейд закрито і Discord оновлено: ${result.title || result.id}.` : `Рейд закрито, але Discord не синхронізовано автоматично: ${result.title || result.id}.`,
      raidId: result.id,
      title: result.title || null,
      discordSynced: Boolean(result.discordSynced),
      channelId: result.channelId || null,
      messageId: result.messageId || null,
    }).catch((auditError) => {
      logDashboardEvent("warn", "raids.close.audit_failed", request, { raidId: result.id, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });
    return redirectWithToast(`/raids/${encodeURIComponent(result.id)}`, {
      tone: "success",
      title: "Рейд закрито",
      message: result.discordSynced ? "Запис вимкнено, кнопки в Discord стали неактивними." : "Рейд закрито в панелі. Кнопки в Discord не оновилися автоматично — перевір канал і натисни “Оновити Discord”.",
      ttl: 6200,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raids.close.failed", request, { raidId, actorId: user.id, actorRole: user.role, message });
    await recordAdminAudit("raids.close_failed", user, {
      status: "error",
      summary: `Рейд не закрито: ${message}`,
      raidId,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return redirectWithToast("/raids", {
      tone: "error",
      title: "Дію з рейдом не виконано",
      message: safeErrorMessage(error),
      ttl: 8600,
    });
  }
}
