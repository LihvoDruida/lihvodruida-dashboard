"use client";

import { type FormEvent, useState } from "react";
import { notifyDashboardLogout } from "@/components/ClientAuthGuard";
import {
  dashboardErrorMessage,
  dispatchDashboardToast,
} from "@/lib/clientToasts";

export default function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function fallbackLogout(message?: string) {
    if (message) console.warn("[dashboard:logout:fallback]", message);
    dispatchDashboardToast({
      tone: "warning",
      title: "Резервний вихід",
      message:
        "Основний запит не підтвердився, тому запускаємо безпечний fallback.",
      ttl: 4200,
    });
    notifyDashboardLogout();
    window.location.assign("/api/auth/logout?fallback=1");
  }

  async function submitLogout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError("");
    dispatchDashboardToast({
      tone: "info",
      title: "Вихід з акаунта",
      message: "Завершуємо поточну сесію.",
      ttl: 3200,
    });

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "follow",
        headers: {
          Accept: "application/json, text/html;q=0.9, */*;q=0.8",
          "X-Dashboard-Action": "logout",
        },
      });

      if (!response.ok && !response.redirected) {
        const data = await response.json().catch(() => ({}));
        fallbackLogout(
          data?.error || `Logout POST failed with ${response.status}`,
        );
        return;
      }

      dispatchDashboardToast({
        tone: "success",
        title: "Сесію завершено",
        message: "Повертаємо на сторінку входу.",
      });
      notifyDashboardLogout();
      window.location.assign("/login");
    } catch (caught) {
      console.error("[dashboard:logout]", caught);
      const errorMessage = dashboardErrorMessage(caught, "Logout fetch failed");
      setError("Виконуємо резервний вихід...");
      dispatchDashboardToast({
        tone: "error",
        title: "Основний вихід не спрацював",
        message: errorMessage,
      });
      fallbackLogout(errorMessage);
    }
  }

  return (
    <form
      method="post"
      action="/api/auth/logout"
      className="dashboard-user__logout"
      data-toast-managed="true"
      onSubmit={submitLogout}
    >
      <button
        type="submit"
        aria-label="Вийти"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Виходимо..." : "Вийти"}
      </button>
      {error ? (
        <small className="dashboard-user__logout-error" role="alert">
          {error}
        </small>
      ) : null}
    </form>
  );
}
