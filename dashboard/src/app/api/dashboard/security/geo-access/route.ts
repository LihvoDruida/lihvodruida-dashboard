import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { setGeoAccessPolicy } from "@/lib/geoAccessPolicy";
import { canManageGroups } from "@/lib/permissions";
import {
  assertRequestBodySize,
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  verifyTrustedOrigin,
} from "@/lib/security";
import { dashboardToastCookie } from "@/lib/serverToasts";
import { wantsJsonResponse } from "@/lib/apiRoute";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeAdminRedirectUrl(request: NextRequest) {
  const fallback = new URL("/dashboard", request.url);
  const ref = request.headers.get("referer");
  if (!ref) return fallback;
  try {
    const url = new URL(ref);
    const current = new URL(request.url);
    if (url.origin !== current.origin) return fallback;
    if (!url.pathname.startsWith("/dashboard")) return fallback;
    return url;
  } catch {
    return fallback;
  }
}

type ResponseInput = {
  ok: boolean;
  tone?: "success" | "info" | "warning" | "error";
  title: string;
  message?: string;
  status?: number;
  data?: Record<string, unknown>;
};

function adminResponse(request: NextRequest, input: ResponseInput) {
  const payload = {
    ok: input.ok,
    ...(input.data || {}),
    toast: {
      tone: input.tone || (input.ok ? "success" : "error"),
      title: input.title,
      message: input.message,
      ttl: input.ok ? 5200 : 8200,
    },
  };

  if (wantsJsonResponse(request)) {
    return NextResponse.json(payload, { status: input.status || (input.ok ? 200 : 400), headers: noStoreHeaders() });
  }

  const response = NextResponse.redirect(safeAdminRedirectUrl(request), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.append("Set-Cookie", dashboardToastCookie(payload.toast));
  return response;
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) {
    return adminResponse(request, { ok: false, tone: "error", title: "Дію заблоковано", message: "Недовірене джерело запиту.", status: 403 });
  }

  const tooLarge = assertRequestBodySize(request, 8 * 1024);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session) {
    return adminResponse(request, { ok: false, tone: "warning", title: "Потрібен вхід", message: "Сесія застаріла. Увійди в панель ще раз.", status: 401, data: { loginUrl: "/login" } });
  }

  if (!canManageGroups(session)) {
    return adminResponse(request, { ok: false, tone: "error", title: "Немає доступу", message: "Геообмеження може змінювати тільки адміністратор із правом керування групами.", status: 403 });
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`admin-geo-access:${session.id}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) {
    return adminResponse(request, { ok: false, tone: "warning", title: "Забагато дій", message: "Зачекай кілька хвилин і повтори зміну.", status: 429 });
  }

  try {
    const form = await request.formData();
    const policy = await setGeoAccessPolicy({
      enabled: form.get("enabled"),
      blockApplications: form.get("blockApplications"),
      blockAuth: form.get("blockAuth"),
      blockUnknownCountries: form.get("blockUnknownCountries"),
      blockedCountries: form.get("blockedCountries"),
    }, session);

    await recordAdminAudit("security.geo_access.update", session, {
      status: "success",
      summary: `Оновлено геообмеження: ${policy.enabled ? "увімкнено" : "вимкнено"}; країни: ${policy.blockedCountries.join(", ")}`,
      policy,
    }).catch((error) => {
      logDashboardEvent("warn", "admin.geo_access.audit_failed", request, { message: error instanceof Error ? error.message : String(error || "unknown") });
    });

    return adminResponse(request, {
      ok: true,
      title: "Геообмеження збережено",
      message: `${policy.enabled ? "Увімкнено" : "Вимкнено"}. Заблоковані країни: ${policy.blockedCountries.join(", ")}.`,
      data: { policy, refresh: true },
    });
  } catch (error) {
    const message = safeErrorMessage(error, "Не вдалося зберегти геообмеження.");
    logDashboardEvent("warn", "admin.geo_access.update_failed", request, { message });
    await recordAdminAudit("security.geo_access.update_failed", session, {
      status: "error",
      summary: message,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return adminResponse(request, { ok: false, title: "Дію не виконано", message, status: 400 });
  }
}
