"use client";

import { useEffect, useRef } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";

const LOGOUT_STORAGE_KEY = "mistblossom:dashboard:logout";
const LAST_AUTH_CHECK_KEY = "mistblossom:dashboard:last-auth-check";
const MIN_AUTH_CHECK_MS = 20_000;

function isProtectedPath(pathname: string) {
  if (
    !pathname ||
    pathname === "/login" ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms")
  )
    return false;
  if (pathname.startsWith("/_next") || pathname.startsWith("/api"))
    return false;
  return (
    pathname === "/" ||
    /^\/(admin|guild|profile|profiles|raids|discord|content)(?:\/|$)/.test(
      pathname,
    )
  );
}

function loginTarget() {
  const current = window.location.pathname + window.location.search;
  if (!current || current === "/login") return "/login";
  return `/login?next=${encodeURIComponent(current)}&reauth=1`;
}

async function checkSession() {
  const response = await fetch("/api/auth/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-Dashboard-Action": "session-check",
    },
  });

  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) return true;
  const data = await response.json().catch(() => ({}));
  return Boolean(data?.authenticated);
}

function redirectToLogin(reason: "logout" | "expired" | "missing") {
  try {
    document.documentElement.dataset.authState = "signed-out";
    document.body.dataset.authState = "signed-out";
  } catch {
    // best effort only
  }

  dispatchDashboardToast({
    tone: "warning",
    title: "Сесію завершено",
    message:
      reason === "logout"
        ? "Вхід завершено в іншій вкладці. Відкрий сторінку після повторного входу."
        : "Потрібен повторний вхід для перегляду цієї сторінки.",
    ttl: 5200,
  });
  window.location.replace(loginTarget());
}

export function notifyDashboardLogout() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOGOUT_STORAGE_KEY, String(Date.now()));
  } catch {
    // storage can be blocked; redirect still happens from caller
  }
}

export default function ClientAuthGuard() {
  const inFlight = useRef(false);
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!isProtectedPath(window.location.pathname)) return;

    async function verify(reason: string, force = false) {
      if (inFlight.current) return;
      const now = Date.now();
      if (!force && now - lastCheck.current < MIN_AUTH_CHECK_MS) return;
      lastCheck.current = now;
      try {
        window.sessionStorage.setItem(LAST_AUTH_CHECK_KEY, String(now));
      } catch {
        // ignored
      }

      inFlight.current = true;
      try {
        const ok = await checkSession();
        if (!ok) redirectToLogin(reason === "logout" ? "logout" : "expired");
      } catch {
        // Do not kick users out on a transient network hiccup. Server-side route
        // guards still protect real data on the next navigation/request.
      } finally {
        inFlight.current = false;
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === LOGOUT_STORAGE_KEY && event.newValue) {
        redirectToLogin("logout");
      }
    }

    function onFocus() {
      void verify("focus");
    }

    function onVisibility() {
      if (document.visibilityState === "visible") void verify("visible");
    }

    function onPageShow(event: PageTransitionEvent) {
      void verify(event.persisted ? "bfcache" : "pageshow", event.persisted);
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    void verify("mount", true);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
