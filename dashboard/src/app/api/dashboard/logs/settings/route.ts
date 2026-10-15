import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { hasPostgresConfig } from "@/lib/db/pgPool";
import { getStructuredLogSettings, updateStructuredLogSettings } from "@/lib/logSettings";
import { canManageGroups, canViewAdminLogs } from "@/lib/permissions";
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
import { appBaseUrl, wantsJsonResponse } from "@/lib/apiRoute";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResponseInput = {
  ok: boolean;
  tone?: "success" | "info" | "warning" | "error";
  title: string;
  message?: string;
  status?: number;
  data?: Record<string, unknown>;
};

function safeAdminRedirectUrl(request: NextRequest) {
  const fallback = new URL("/dashboard/logs", appBaseUrl(request));
  const ref = request.headers.get("referer");
  if (!ref) return fallback;
  try {
    const url = new URL(ref);
    const current = new URL(appBaseUrl(request));
    if (url.origin !== current.origin || url.pathname !== "/dashboard/logs") return fallback;
    return url;
  } catch {
    return fallback;
  }
}

function responseFor(request: NextRequest, input: ResponseInput) {
  const payload = {
    ok: input.ok,
    message: input.message || input.title,
    ...(input.data || {}),
    toast: {
      tone: input.tone || (input.ok ? "success" : "error"),
      title: input.title,
      message: input.message,
      ttl: input.ok ? 6200 : 9200,
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

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !canViewAdminLogs(session)) return responseFor(request, { ok: false, title: "Немає доступу", status: session ? 403 : 401 });
  try {
    const settings = await getStructuredLogSettings({ fresh: true, strict: true });
    return NextResponse.json({ ok: true, settings, configured: hasPostgresConfig(), canEdit: canManageGroups(session), canTuneStorage: Boolean(session.isServerOwner) }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, message: "Не вдалося прочитати налаштування журналу зі сховища." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) {
    return responseFor(request, { ok: false, title: "Дію заблоковано", message: "Недовірене джерело запиту.", status: 403 });
  }
  const tooLarge = assertRequestBodySize(request, 8 * 1024);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session) return responseFor(request, { ok: false, tone: "warning", title: "Потрібен вхід", status: 401 });
  if (!canManageGroups(session)) {
    return responseFor(request, { ok: false, title: "Немає доступу", message: "Налаштування журналу може змінювати тільки адміністратор.", status: 403 });
  }

  const ip = getClientIp(request);
  const rate = checkRateLimit(`structured-log-settings:${session.id}:${ip}`, 10, 10 * 60 * 1000);
  if (!rate.ok) return responseFor(request, { ok: false, tone: "warning", title: "Забагато змін", status: 429 });

  try {
    const form = await request.formData();
    const invalid = (message: string) => responseFor(request, { ok: false, title: "Перевір налаштування", message, status: 422 });
    if (!["0", "1"].includes(String(form.get("securityDiscordEnabled")))) return invalid("Потрібен явний стан Discord mirror.");
    if (!["info", "warning", "error"].includes(String(form.get("securityDiscordMinLevel")))) return invalid("Невідомий мінімальний рівень Security mirror.");
    if (session.isServerOwner) {
      for (const [key, min, max] of [["maxStorageMb",32,1024],["maxRows",5000,250000],["queryLimit",50,500]] as const) {
        const raw = String(form.get(key) ?? ""); const value = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) return invalid(`${{ maxStorageMb: "Ліміт таблиці", maxRows: "Максимум записів", queryLimit: "Рядків у браузері" }[key]} має бути цілим числом від ${min} до ${max}.`);
      }
    }
    const mirrorEnabled = String(form.get("securityDiscordEnabled") || "").trim() === "1";
    const mirrorChannelId = String(form.get("securityDiscordChannelId") || "").trim();
    if (mirrorChannelId && !/^\d{16,25}$/.test(mirrorChannelId) || mirrorEnabled && !mirrorChannelId) {
      return responseFor(request, {
        ok: false,
        title: "Не вказано Security-канал",
        message: "Для увімкненого Discord mirror потрібен коректний channel ID (16–25 цифр).",
        status: 400,
      });
    }

    const settings = await updateStructuredLogSettings({
      securityDiscordEnabled: mirrorEnabled,
      securityDiscordChannelId: mirrorChannelId,
      securityDiscordMinLevel: form.get("securityDiscordMinLevel"),
      maxStorageMb: form.get("maxStorageMb"),
      maxRows: form.get("maxRows"),
      queryLimit: form.get("queryLimit"),
    }, session);

    await recordAdminAudit("logging.settings.update", session, {
      status: "success",
      summary: settings.securityDiscordEnabled
        ? `Security-події дублюються в Discord від рівня ${settings.securityDiscordMinLevel}.`
        : "Discord-дзеркало Security вимкнено.",
      securityDiscordEnabled: settings.securityDiscordEnabled,
      securityDiscordChannelId: settings.securityDiscordChannelId || null,
      securityDiscordMinLevel: settings.securityDiscordMinLevel,
      maxStorageMb: settings.maxStorageMb,
      maxRows: settings.maxRows,
      queryLimit: settings.queryLimit,
    });

    return responseFor(request, {
      ok: true,
      title: "Журнал оновлено",
      message: "У Discord дублюються тільки Security-події. API, дії, системні та інтеграційні логи залишаються лише на сервері.",
      data: { settings, refresh: true },
    });
  } catch (error) {
    const message = safeErrorMessage(error, "Не вдалося зберегти налаштування журналу.");
    logDashboardEvent("warn", "logging.settings.update_failed", request, { message }, { category: "security" });
    return responseFor(request, { ok: false, title: "Дію не виконано", message, status: 400 });
  }
}
