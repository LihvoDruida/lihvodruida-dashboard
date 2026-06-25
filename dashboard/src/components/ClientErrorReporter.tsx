"use client";

import { useEffect, useRef } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";

type ClientErrorPayload = {
  message: string;
  stack?: string;
  source:
    | "window-error"
    | "unhandled-rejection"
    | "react-error-boundary"
    | "manual";
  pathname: string;
  userAgent: string;
  filename?: string;
};

type NormalizedClientError = {
  message: string;
  stack: string;
  filename: string;
};

function errorMessage(value: unknown) {
  if (value instanceof Error)
    return value.message || value.name || "Client error";
  if (value && typeof value === "object" && "message" in value)
    return String((value as { message?: unknown }).message || "Client error");
  return String(value || "Client error");
}

function errorStack(value: unknown) {
  if (value instanceof Error) return value.stack || "";
  if (value && typeof value === "object" && "stack" in value)
    return String((value as { stack?: unknown }).stack || "");
  return "";
}

function normalizeError(
  value: unknown,
  event?: ErrorEvent | PromiseRejectionEvent,
): NormalizedClientError {
  const message = errorMessage(value).slice(0, 500);
  const stack = errorStack(value).slice(0, 4000);
  const filename =
    event && "filename" in event && typeof event.filename === "string"
      ? event.filename.slice(0, 500)
      : "";

  return { message, stack, filename };
}

function isExtensionSource(value: string) {
  return /(?:^|\s|\()(?:(?:chrome|moz|safari-web)-extension):\/\//i.test(value);
}

export function isIgnorableClientError(
  message: string,
  stack = "",
  filename = "",
) {
  const combined = `${message}\n${stack}\n${filename}`;

  return (
    /Could not establish connection\. Receiving end does not exist/i.test(
      message,
    ) ||
    /A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received/i.test(
      message,
    ) ||
    /The message port closed before a response was received/i.test(message) ||
    /Unchecked runtime\.lastError/i.test(message) ||
    /Extension context invalidated/i.test(message) ||
    /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i.test(
      message,
    ) ||
    /Connection closed\.?|Error in input stream/i.test(message) ||
    /Script error\.?/i.test(message) ||
    isExtensionSource(combined)
  );
}

export function isTransientClientStreamError(message: string) {
  return /Connection closed\.?|Error in input stream/i.test(message);
}

function shouldShowVisibleToast(normalized: NormalizedClientError) {
  if (
    isIgnorableClientError(
      normalized.message,
      normalized.stack,
      normalized.filename,
    )
  )
    return false;

  // Do not scare users with a global error toast for expected background API
  // refresh failures. Components that own those requests render local status.
  if (/Dashboard background API/i.test(normalized.message)) return false;

  return true;
}

async function reportClientError(payload: ClientErrorPayload) {
  try {
    await fetch("/api/client-errors", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dashboard-action": "client-error",
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(payload),
    });
  } catch {
    // Logging must never create another visible failure.
  }
}

export function sendClientErrorReport(
  error: unknown,
  source: ClientErrorPayload["source"] = "manual",
) {
  if (typeof window === "undefined") return;
  const normalized = normalizeError(error);
  if (
    !normalized.message ||
    isIgnorableClientError(normalized.message, normalized.stack)
  )
    return;

  void reportClientError({
    message: normalized.message,
    stack: normalized.stack,
    source,
    pathname: window.location.pathname + window.location.search,
    userAgent: navigator.userAgent,
  });
}

export default function ClientErrorReporter() {
  const reported = useRef<Set<string>>(new Set());

  useEffect(() => {
    function emit(
      error: unknown,
      source: ClientErrorPayload["source"],
      event?: ErrorEvent | PromiseRejectionEvent,
    ) {
      const normalized = normalizeError(error, event);
      if (!normalized.message) return;

      if (
        isIgnorableClientError(
          normalized.message,
          normalized.stack,
          normalized.filename,
        )
      ) {
        event?.preventDefault();
        return;
      }

      const key = `${source}:${window.location.pathname}:${normalized.message}`;
      if (reported.current.has(key)) return;
      reported.current.add(key);
      window.setTimeout(() => reported.current.delete(key), 60_000);

      void reportClientError({
        message: normalized.message,
        stack: normalized.stack,
        source,
        pathname: window.location.pathname + window.location.search,
        userAgent: navigator.userAgent,
        filename: normalized.filename,
      });

      if (!shouldShowVisibleToast(normalized)) return;

      dispatchDashboardToast({
        tone: "error",
        title: "Технічний збій",
        message:
          "Частина сторінки не оновилась. Спробуй повторити дію або онови сторінку.",
        ttl: 7200,
      });
    }

    function onError(event: ErrorEvent) {
      emit(event.error || event.message, "window-error", event);
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      emit(event.reason, "unhandled-rejection", event);
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
