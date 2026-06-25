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
