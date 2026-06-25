export type DashboardToastTone = "info" | "success" | "warning" | "error";

export type DashboardToastCookie = {
  tone?: DashboardToastTone;
  title: string;
  message?: string;
  ttl?: number;
};

const TOAST_COOKIE_NAME = "dashboard_toast";

function clean(value: unknown, limit = 360) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function dashboardToastCookie(toast: DashboardToastCookie) {
  const payload = {
    tone: toast.tone || "info",
    title: clean(toast.title, 96),
    message: clean(toast.message, 520),
    ttl: toast.ttl,
  };

  if (!payload.title) return "";

  return `${TOAST_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(payload))}; Path=/; Max-Age=45; SameSite=Lax`;
}

export function clearDashboardToastCookie() {
  return `${TOAST_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}
