import { NextRequest, NextResponse } from "next/server";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";
import {
  assertRequestBodySize,
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function clean(value: unknown, limit = 500) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function cleanStack(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, 4000);
}

function isIgnorableClientErrorMessage(message: string, stack = "", filename = "") {
  const combined = `${message}\n${stack}\n${filename}`;
  return (
    /Could not establish connection\. Receiving end does not exist/i.test(message) ||
    /A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received/i.test(message) ||
    /The message port closed before a response was received/i.test(message) ||
    /Unchecked runtime\.lastError/i.test(message) ||
    /Extension context invalidated/i.test(message) ||
    /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i.test(message) ||
    /Connection closed\.?|Error in input stream/i.test(message) ||
    /Script error\.?/i.test(message) ||
    /(?:^|\s|\()(?:(?:chrome|moz|safari-web)-extension):\/\//i.test(combined)
  );
}

export async function POST(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 12 * 1024);
  if (tooLarge) return tooLarge;

  const ip = getClientIp(request);
  const limit = checkRateLimit(`client-errors:${ip}`, 30, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Rate limited." },
      {
        status: 429,
        headers: noStoreHeaders({
          "Retry-After": String(
            Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
          ),
        }),
      },
    );
  }

  try {
    const data = await request.json().catch(() => ({}));
    const message = clean(data?.message, 500);
    if (!message)
      return NextResponse.json(
        { ok: false, error: "Empty client error." },
        { status: 400, headers: noStoreHeaders() },
      );
    const stack = cleanStack(data?.stack);
    const filename = clean(data?.filename, 500);
    if (isIgnorableClientErrorMessage(message, stack, filename)) {
      return NextResponse.json(
        { ok: true, ignored: true },
        { headers: noStoreHeaders() },
      );
    }

    const details = {
      status: "error",
      summary: `Client-side помилка: ${message}`,
      message,
      source: clean(data?.source, 80) || "client",
      pathname: clean(data?.pathname, 240),
      userAgent: clean(data?.userAgent, 240),
      stack,
      filename,
      ip,
    };

    logDashboardEvent("error", "client.exception", request, details);

    const shouldPersist =
      /Server Components render|react-error-boundary|page|route/i.test(
        `${details.message} ${details.source}`,
      );
    if (shouldPersist) {
      await recordDashboardSystemLog(
        "error",
        "page.client_exception",
        {
          ...details,
          summary: "Технічна помилка сторінки записана з браузера.",
        },
        { persist: true },
      ).catch(() => false);
    }

    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    logDashboardEvent("warn", "client.exception_log_failed", request, {
      message: safeErrorMessage(error),
    });
    return NextResponse.json(
      { ok: false },
      { status: 400, headers: noStoreHeaders() },
    );
  }
}
