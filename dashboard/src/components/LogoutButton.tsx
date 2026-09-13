"use client";

import { type FormEvent, useState } from "react";
import { notifyDashboardLogout } from "@/components/ClientAuthGuard";
import {
  dashboardErrorMessage,
  dispatchDashboardToast,
} from "@/lib/clientToasts";

export default function LogoutButton({
  className = "nav-account__logout",
  errorClassName = "nav-account__logout-error",
  buttonClassName = "btn ghost",
}: {
  className?: string;
  errorClassName?: string;
  buttonClassName?: string;
} = {}) {
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
    // Свідомо жорстка навігація, а не router.push: після виходу треба скинути
    // клієнтський RSC-кеш авторизованих сторінок, інакше вони лишаються в памʼяті.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
      // Те саме, що й у fallbackLogout: повний перезавантаж документа гарантує,
      // що після виходу не лишиться закешованого приватного RSC-контенту.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
      className={className}
      data-toast-managed="true"
      onSubmit={submitLogout}
    >
      <button
        className={buttonClassName}
        type="submit"
        aria-label="Вийти"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Виходимо..." : "Вийти"}
      </button>
      {error ? (
        <small className={errorClassName} role="alert">
          {error}
        </small>
      ) : null}
    </form>
  );
}
