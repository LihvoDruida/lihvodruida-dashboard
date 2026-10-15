"use client";

import { useEffect, useState } from "react";
import { dispatchDashboardToast, type DashboardToastInput } from "@/lib/clientToasts";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useActionFocus } from "@/lib/useActionFocus";
import { requestRaidPollMutation, raidPollMutationFailure, type RaidPollMutationOptions, type RaidPollMutationReply } from "@/lib/raidPollMutation";

export function useRaidPollMutation(onPendingChange?: (pending: boolean) => void) {
  const requests = useDashboardRequests();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLDivElement>(pending);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  async function run(url: string, options: RaidPollMutationOptions, trigger: HTMLElement,
    success: (data: RaidPollMutationReply) => DashboardToastInput) {
    if (requests.pending("mutation")) return;
    const request = requests.begin("mutation", 45_000);
    beginActionFocus(trigger, { preferResult: true });
    setPending(true); onPendingChange?.(true); setMessage(""); setUnconfirmed(false);
    try {
      const data = await requestRaidPollMutation(url, { ...options, signal: request.signal });
      if (!request.current()) return;
      const toast = success(data);
      setMessage([toast.title, toast.message].filter(Boolean).join(". "));
      dispatchDashboardToast(toast);
    } catch (error) {
      if (!request.current()) return;
      const failure = raidPollMutationFailure(error);
      setUnconfirmed(failure.outcome === "unconfirmed"); setMessage(failure.message);
      dispatchDashboardToast({ tone: failure.outcome === "unconfirmed" ? "warning" : "error", title: failure.outcome === "unconfirmed" ? "Результат не підтверджено" : "Дію відхилено", message: failure.message, ttl: 8200 });
    } finally {
      if (request.current()) { setPending(false); onPendingChange?.(false); }
      request.finish();
    }
  }
  return { pending, message, unconfirmed, scopeRef, run };
}
