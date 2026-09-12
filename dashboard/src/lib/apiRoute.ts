import { NextRequest, NextResponse } from "next/server";
import { applyNoStoreHeaders, getRequestHost, isAllowedHost, noStoreHeaders } from "@/lib/security";
import { dashboardToastCookie } from "@/lib/serverToasts";
import { cleanSnowflake, dashboardPublicOrigin, envFlag } from "@/lib/values";

/** Ре-експорт для роутів, які вже імпортують envFlag саме звідси. */
export { cleanSnowflake, envFlag };

/**
 * Спільні дрібні хелпери для route handler-ів.
 *
 * До цього кожен роут тримав власні копії: `appBaseUrl` — у дев'яти файлах,
 * `redirectWithToast` — у семи, `envFlag` — у восьми, `wantsJson` — у чотирьох.
 * Копії встигли розійтись між собою (див. коментар до `appBaseUrl`), і це вже
 * була не косметика, а різна поведінка на однакових на вигляд роутах.
 */

export type DashboardToastInput = {
  tone?: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  ttl?: number;
};

/**
 * Базовий URL панелі для редіректів.
 *
 * Реалізація живе у `@/lib/values`, щоб її бачили і роути, і серверні
 * бібліотеки без залежності від `next/server`.
 */
export function appBaseUrl(request?: NextRequest) {
  // У dev залишаємо користувача на тому локальному origin, з якого він
  // реально відкрив панель (localhost / 127.0.0.1 / 0.0.0.0). Інакше
  // DASHBOARD_PUBLIC_URL із production-конфіга перетягує локальні форми на
  // бойовий домен після успішного POST.
  if (request && process.env.NODE_ENV !== "production") {
    const host = getRequestHost(request);
    if (host && isAllowedHost(host)) {
      try {
        const requestUrl = new URL(request.url);
        if (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") {
          return `${requestUrl.protocol}//${host}`;
        }
      } catch {
        // Нижче використаємо канонічний public origin.
      }
    }
  }
  return dashboardPublicOrigin();
}

/** Редірект 303 із необовʼязковим тостом у cookie. */
export function redirectWithToast(request: NextRequest, path: string, toast?: DashboardToastInput) {
  const url = new URL(path, appBaseUrl(request));
  const response = NextResponse.redirect(url, { status: 303, headers: noStoreHeaders() });
  if (toast) response.headers.append("Set-Cookie", dashboardToastCookie(toast));
  return response;
}

/**
 * Чи чекає клієнт JSON. `DashboardFormEnhancer` шле `Accept: application/json`,
 * тому форма отримує JSON, а звичайна навігація — редірект.
 */
export function wantsJson(request: NextRequest) {
  const accept = request.headers.get("accept") || "";
  const contentType = request.headers.get("content-type") || "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders() });
}

/** Ціле число з query-параметра, затиснуте в межі. */
export function integerParam(value: string | null, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}


/**
 * Чи очікує адмінська форма JSON.
 *
 * Відрізняється від `wantsJson` тим, що вміє про заголовок
 * `X-Dashboard-Action: live`, який шле `DashboardFormEnhancer`. Без нього
 * звичайна навігація формою вивалювала б сирий JSON у вікно браузера.
 */
export function wantsJsonResponse(request: NextRequest) {
  const dashboardAction = String(request.headers.get("x-dashboard-action") || "").toLowerCase();
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  return dashboardAction === "live" || accept.includes("application/json");
}

/** Простий 303-редірект відносно поточного запиту, без кешування. */
export function redirectTo(request: NextRequest, path: string) {
  return applyNoStoreHeaders(NextResponse.redirect(new URL(path, appBaseUrl(request)), 303));
}
