import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import {
  assertRequestBodySize,
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  verifyTrustedOrigin,
} from "@/lib/security";
import { dashboardToastCookie, type DashboardToastCookie } from "@/lib/serverToasts";
import {
  clearRosterFormation,
  deleteRosterFormation,
  hasRosterStorage,
  saveRosterFormationFromInput,
  setRosterFormationStatus,
} from "@/lib/rosterFormation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function appBaseUrl() {
  return (
    process.env.DASHBOARD_URL ||
    process.env.NEXT_PUBLIC_DASHBOARD_URL ||
    process.env.ADMIN_DASHBOARD_URL ||
    process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  );
}

function redirectWithToast(request: NextRequest, path: string, toast?: DashboardToastCookie) {
  const url = new URL(path, appBaseUrl());
  const response = NextResponse.redirect(url, { status: 303, headers: noStoreHeaders() });
  if (toast) response.headers.append("Set-Cookie", dashboardToastCookie(toast));
  void request;
  return response;
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) {
    return redirectWithToast(request, "/roster", {
      tone: "error",
      title: "Недовірене джерело запиту",
      message: "Спробуй ще раз зі сторінки формування складу.",
      ttl: 7600,
    });
  }

  const tooLarge = assertRequestBodySize(request, 32 * 1024);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session || !canManageRaids(session)) {
    return redirectWithToast(request, "/roster", {
      tone: "error",
      title: "Доступ заборонено",
      message: "Публікувати й очищати склад може лише гільдмайстер або офіцер.",
      ttl: 7600,
    });
  }

  if (!hasRosterStorage()) {
    return redirectWithToast(request, "/roster", {
      tone: "error",
      title: "Сховище недоступне",
      message: "Firebase не налаштований, тому склад не збережеться. Звернись до гільдмайстра.",
      ttl: 8600,
    });
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`roster:${session.id}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) {
    return redirectWithToast(request, "/roster", {
      tone: "error",
      title: "Забагато операцій",
      message: "Трохи зачекай і спробуй ще раз.",
      ttl: 6800,
    });
  }

  let action = "publish";

  try {
    const form = await request.formData();
    action = String(form.get("action") || "publish").trim();

    if (action === "clear") {
      const rosterId = String(form.get("rosterId") || "").trim();
      if (!rosterId) throw new Error("Не вказано, який склад очищати.");
      await clearRosterFormation(rosterId);
      logDashboardEvent("info", "roster.clear", request, { rosterId, actorId: session.id, actorRole: session.role });
      return redirectWithToast(request, "/roster", {
        tone: "success",
        title: "Склад очищено",
        message: "Усі вибори гравців прибрано. Discord-повідомлення оновлено.",
        ttl: 6400,
      });
    }

    if (action === "close" || action === "reopen") {
      const rosterId = String(form.get("rosterId") || "").trim();
      if (!rosterId) throw new Error("Не вказано, який склад змінювати.");
      const status = action === "close" ? "closed" : "open";
      const roster = await setRosterFormationStatus(rosterId, status);
      logDashboardEvent("info", `roster.${action}`, request, {
        rosterId,
        actorId: session.id,
        actorRole: session.role,
      });
      return redirectWithToast(request, "/roster", {
        tone: "success",
        title: status === "closed" ? "Набір закрито" : "Набір відкрито",
        message:
          status === "closed"
            ? `${roster.title}: кнопки в Discord стали неактивними, склад збережено.`
            : `${roster.title}: гравці знову можуть обирати клас.`,
        ttl: 6400,
      });
    }

    if (action === "delete") {
      const rosterId = String(form.get("rosterId") || "").trim();
      if (!rosterId) throw new Error("Не вказано, який склад видаляти.");
      await deleteRosterFormation(rosterId);
      logDashboardEvent("info", "roster.delete", request, { rosterId, actorId: session.id, actorRole: session.role });
      return redirectWithToast(request, "/roster", {
        tone: "success",
        title: "Формування складу видалено",
        message: "Discord-повідомлення прибрано, запис у базі стерто.",
        ttl: 6400,
      });
    }

    // publish (default)
    const roster = await saveRosterFormationFromInput(
      {
        season: form.get("season"),
        description: form.get("description"),
        channelId: form.get("channelId"),
        mentionRoleIds: form.getAll("mentionRoleIds"),
      },
      session,
    );

    logDashboardEvent("info", "roster.publish", request, {
      rosterId: roster.id,
      season: roster.season,
      channelId: roster.channelId,
      actorId: session.id,
      actorRole: session.role,
    });

    return redirectWithToast(request, "/roster", {
      tone: "success",
      title: "Оголошення складу опубліковано",
      message: `${roster.title} відправлено в Discord. Гравці вже можуть обирати клас.`,
      ttl: 7200,
    });
  } catch (error) {
    logDashboardEvent("error", "roster.action_failed", request, {
      action,
      actorId: session.id,
      message: safeErrorMessage(error),
    });
    return redirectWithToast(request, "/roster", {
      tone: "error",
      title: "Дію не виконано",
      message: safeErrorMessage(error, "Не вдалося виконати дію зі складом. Спробуй ще раз."),
      ttl: 8600,
    });
  }
}
