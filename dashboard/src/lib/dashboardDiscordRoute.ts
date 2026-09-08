import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageDiscordMembers } from "@/lib/permissions";
import { assertRequestBodySize, checkRateLimit, getClientIp, logDashboardEvent, noStoreHeaders, safeErrorMessage, verifyTrustedOrigin } from "@/lib/security";
import { dashboardToastCookie } from "@/lib/serverToasts";
import { wantsJsonResponse } from "@/lib/apiRoute";

export async function requireDiscordAdmin(request: NextRequest, action: string, bodyLimit = 16 * 1024) {
  if (!verifyTrustedOrigin(request)) {
    return { error: adminDiscordResponse(request, { ok: false, tone: "error", title: "Дію заблоковано", message: "Недовірене джерело запиту.", status: 403 }) };
  }
  const tooLarge = assertRequestBodySize(request, bodyLimit);
  if (tooLarge) {
    return { error: adminDiscordResponse(request, { ok: false, tone: "error", title: "Запит завеликий", message: "Форма містить забагато даних. Онови сторінку і повтори дію.", status: 413 }) };
  }

  const session = await getSession();
  if (!session) {
    return { error: adminDiscordResponse(request, { ok: false, tone: "warning", title: "Потрібен вхід", message: "Сесія застаріла. Увійди в панель ще раз і повтори дію.", status: 401, data: { loginUrl: "/login" } }) };
  }
  if (!canManageDiscordMembers(session)) {
    return { error: adminDiscordResponse(request, { ok: false, tone: "error", title: "Немає доступу", message: "У цього акаунта немає права керувати Discord-учасниками.", status: 403 }) };
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`admin-discord:${action}:${session.id}:${ip}`, action.includes("cleanup") ? 8 : 30, 10 * 60 * 1000);
  if (!limit.ok) {
    return { error: adminDiscordResponse(request, { ok: false, tone: "warning", title: "Забагато дій", message: "Зачекай кілька хвилин і повтори Discord-дію.", status: 429 }) };
  }

  return { session };
}

type AdminDiscordResultInput = {
  ok: boolean;
  tone?: "success" | "info" | "warning" | "error";
  title: string;
  message?: string;
  status?: number;
  data?: Record<string, unknown>;
  ttl?: number;
};

function adminDiscordPayload(input: AdminDiscordResultInput) {
  return {
    ok: input.ok,
    ...(input.data || {}),
    toast: {
      tone: input.tone || (input.ok ? "success" : "error"),
      title: input.title,
      message: input.message,
      ttl: input.ttl || (input.ok ? 5200 : 8200),
    },
  };
}

function safeAdminRedirectUrl(request: NextRequest) {
  const fallback = new URL("/dashboard/discord", request.url);
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

export function adminDiscordJson(input: AdminDiscordResultInput) {
  return NextResponse.json(adminDiscordPayload(input), { status: input.status || (input.ok ? 200 : 400), headers: noStoreHeaders() });
}

export function adminDiscordResponse(request: NextRequest, input: AdminDiscordResultInput) {
  if (wantsJsonResponse(request)) return adminDiscordJson(input);

  const payload = adminDiscordPayload(input);
  const response = NextResponse.redirect(safeAdminRedirectUrl(request), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.append("Set-Cookie", dashboardToastCookie({
    tone: payload.toast.tone,
    title: payload.toast.title,
    message: payload.toast.message,
    ttl: payload.toast.ttl,
  }));
  return response;
}

export async function auditDiscordAdmin(action: string, session: NonNullable<Awaited<ReturnType<typeof getSession>>>, details: Record<string, unknown>) {
  const recorded = await recordAdminAudit(action, session, details).catch((error) => {
    logDashboardEvent("error", "admin.discord.audit_unhandled_failure", undefined, {
      action,
      actorId: session.id,
      error: error instanceof Error ? error.message : String(error || "unknown"),
    });
    return false;
  });

  if (!recorded) {
    logDashboardEvent("warn", "admin.discord.audit_not_recorded", undefined, {
      action,
      actorId: session.id,
      status: details.status || "info",
      summary: details.summary || details.message || null,
    });
  }

  return recorded;
}

export async function discordAdminError(request: NextRequest, event: string, error: unknown, fallback: string, session?: NonNullable<Awaited<ReturnType<typeof getSession>>> | null, details: Record<string, unknown> = {}) {
  const message = safeErrorMessage(error, fallback);
  logDashboardEvent("warn", event, request, { message, ...details });
  if (session) {
    const recorded = await recordAdminAudit(event, session, {
      ...details,
      status: "error",
      summary: message,
      message,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch((auditError) => {
      logDashboardEvent("error", "admin.discord.error_audit_failed", request, {
        event,
        actorId: session.id,
        message,
        error: auditError instanceof Error ? auditError.message : String(auditError || "unknown"),
      });
      return false;
    });
    if (!recorded) {
      logDashboardEvent("warn", "admin.discord.error_audit_not_recorded", request, { event, actorId: session.id, message });
    }
  }
  return adminDiscordResponse(request, { ok: false, tone: "error", title: "Дію не виконано", message, status: 400, data: { error: message } });
}
