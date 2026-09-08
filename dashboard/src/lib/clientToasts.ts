"use client";

export type DashboardToastTone = "info" | "success" | "warning" | "error";

export type DashboardToastInput = {
  tone?: DashboardToastTone;
  title: string;
  message?: string;
  ttl?: number;
};

function clean(value: unknown, limit = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function dispatchDashboardToast({ tone = "info", title, message, ttl }: DashboardToastInput) {
  if (typeof window === "undefined") return;

  const cleanTitle = clean(title, 96);
  if (!cleanTitle) return;

  window.dispatchEvent(new CustomEvent("dashboard:toast", {
    detail: {
      tone,
      title: cleanTitle,
      message: clean(message),
      ttl,
    },
  }));
}

export function dashboardErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

/**
 * Витягує текст помилки з JSON-відповіді API.
 * Був скопійований у чотирьох компонентах кнопок рейд-пулу.
 */
export function errorFromPayload(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  const message = record.error || record.message || record.warning;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}
