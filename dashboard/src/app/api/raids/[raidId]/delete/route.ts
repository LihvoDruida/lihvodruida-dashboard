import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { deleteRaid } from "@/lib/raids";
import { assertRequestBodySize, logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";
import { dashboardToastCookie } from "@/lib/serverToasts";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ToastInput = { tone?: "info" | "success" | "warning" | "error"; title: string; message?: string; ttl?: number };

function appBaseUrl() {
  return process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || process.env.ADMIN_DASHBOARD_URL || process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
}

function redirectWithToast(path: string, toast?: ToastInput) {
  const url = new URL(path, appBaseUrl());
  const response = NextResponse.redirect(url, { status: 303, headers: noStoreHeaders() });
  if (toast) response.headers.append("Set-Cookie", dashboardToastCookie(toast));
  return response;
}

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
    logDashboardEvent("info", "raids.delete.start", request, { raidId, actorId: user.id, actorRole: user.role });
    const result = await deleteRaid(raidId);
    logDashboardEvent("info", "raids.delete.done", request, { raidId: result.id, actorId: user.id, actorRole: user.role });
    await recordAdminAudit("raids.delete", user, {
      status: result.discordDeleteFailed ? "warning" : "success",
      summary: result.discordDeleteFailed ? `Рейд видалено з панелі, але Discord-повідомлення не видалилось: ${result.title || result.id}.` : `Рейд видалено: ${result.title || result.id}.`,
      raidId: result.id,
      title: result.title || null,
      raidStatus: result.status,
      discordDeleted: Boolean(result.discordDeleted),
      discordDeleteFailed: Boolean(result.discordDeleteFailed),
      channelId: result.channelId || null,
      messageId: result.messageId || null,
    }).catch((auditError) => {
      logDashboardEvent("warn", "raids.delete.audit_failed", request, { raidId: result.id, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });
    return redirectWithToast("/raids", {
      tone: result.discordDeleteFailed ? "warning" : "success",
      title: result.status === "draft" ? "Чернетку видалено" : "Рейд видалено",
      message: result.discordDeleteFailed
        ? "Рейд видалено з панелі, але Discord-повідомлення не вдалося прибрати автоматично. Перевір його в Discord вручну."
        : result.discordDeleted
          ? "Рейд прибрано з панелі, а Discord-повідомлення видалено."
          : "Рейд прибрано зі списку.",
      ttl: result.discordDeleteFailed ? 9800 : 6200,
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
    return redirectWithToast("/raids", {
      tone: "error",
      title: "Дію з рейдом не виконано",
      message: safeErrorMessage(error),
      ttl: 8600,
    });
  }
}
