import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { getProfileById } from "@/lib/profiles";
import { saveRaidFromForm } from "@/lib/raids";
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
    const action = String(form.get("action") || "").trim();
    const raidId = String(form.get("raidId") || "").trim();
    failurePath = raidId ? `/raids/${encodeURIComponent(raidId)}/edit` : "/raids/new";

    if (action && action !== "save") {
      return redirectWithToast(failurePath, {
        tone: "warning",
        title: "Дія не для цієї кнопки",
        message: "Ця кнопка тільки зберігає зміни в панелі. Для Discord використовуй кнопку “Опублікувати” або “Оновити Discord”.",
        ttl: 7200,
      });
    }

    const profile = user.profileId ? await getProfileById(user.profileId) : null;
    logDashboardEvent("info", "raids.save.start", request, {
      action: "save",
      raidId,
      actorId: user.id,
      actorRole: user.role,
      hasChannel: Boolean(form.get("channelId")),
    });
    const raid = await saveRaidFromForm(form, user, profile);
    logDashboardEvent("info", "raids.saved", request, {
      action: "save",
      raidId: raid.id,
      actorId: user.id,
      actorRole: user.role,
      channelId: raid.channelId || "",
      messageId: raid.messageId || "",
    });
    await recordAdminAudit("raids.save", user, {
      status: "success",
      summary: `${raid.status === "draft" ? "Чернетку рейду" : "Рейд"} збережено: ${raid.title || raid.id}.`,
      raidId: raid.id,
      raidStatus: raid.status,
      title: raid.title || null,
      channelId: raid.channelId || null,
      messageId: raid.messageId || null,
    }).catch((auditError) => {
      logDashboardEvent("warn", "raids.save.audit_failed", request, { raidId: raid.id, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });
    return redirectWithToast(`/raids/${encodeURIComponent(raid.id)}/edit`, {
      tone: "success",
      title: raid.status === "draft" ? "Чернетку збережено" : "Зміни збережено",
      message: raid.status === "published" ? "Зміни збережено в панелі. Щоб показати їх у Discord, натисни “Оновити Discord”." : "Чернетку збережено. У Discord її ще не опубліковано.",
      ttl: 6200,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raids.action.failed", request, { actorId: user.id, actorRole: user.role, message });
    await recordAdminAudit("raids.save_failed", user, {
      status: "error",
      summary: `Рейд не збережено: ${message}`,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return redirectWithToast(failurePath, {
      tone: "error",
      title: "Дію з рейдом не виконано",
      message: safeErrorMessage(error),
      ttl: 8600,
    });
  }
}
