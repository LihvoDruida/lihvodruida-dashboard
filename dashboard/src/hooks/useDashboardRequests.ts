"use client";

import { useEffect, useRef } from "react";

/** Independent request lanes; a replaced/unmounted request can never publish state. */
export function useDashboardRequests() {
  const requests = useRef(new Map<string, { abort: () => void }>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const active = requests.current;
    return () => { mounted.current = false; for (const request of active.values()) request.abort(); active.clear(); };
  }, []);
  return {
    cancel(key: string) { requests.current.get(key)?.abort(); requests.current.delete(key); },
    pending(key: string) { return requests.current.has(key); },
    begin(key: string, deadlineMs: number) {
      requests.current.get(key)?.abort();
      const controller = new AbortController();
      let cancelled = false;
      const timer = setTimeout(() => controller.abort(), deadlineMs);
      const request = {
        signal: controller.signal,
        current: () => mounted.current && !cancelled && requests.current.get(key) === request,
        stopDeadline: () => clearTimeout(timer),
        abort() { cancelled = true; clearTimeout(timer); controller.abort(); },
        finish() { clearTimeout(timer); if (requests.current.get(key) === request) requests.current.delete(key); },
      };
      requests.current.set(key, request);
      return request;
    },
  };
}
