"use client";

import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { errorFromPayload } from "@/lib/clientToasts";

export type RaidPollMutationReply = {
  ok: true;
  warning?: string;
  discordDeleteFailed?: boolean;
  republished?: boolean;
  redirectTo?: string;
  updated?: number;
  failed?: number;
};
export type RaidPollMutationOptions = {
  method: "POST" | "DELETE";
  action: string;
  json?: unknown;
  signal?: AbortSignal;
};
class PollResponseError extends Error {
  constructor(readonly outcome: "rejected" | "unconfirmed", message: string) { super(message); }
}
export async function requestRaidPollMutation(url: string, options: RaidPollMutationOptions): Promise<RaidPollMutationReply> {
  const data = await dashboardApiJson<unknown>(url, {
    method: options.method, json: options.json, signal: options.signal,
    headers: { "X-Dashboard-Action": options.action }, timeoutMs: 45_000, retries: 0,
  });
  if (!data || typeof data !== "object" || Array.isArray(data) || (data as Record<string, unknown>).ok !== true) {
    if (data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>).ok === false)
      throw new PollResponseError("rejected", errorFromPayload(data, "Запит відхилено."));
    throw new PollResponseError("unconfirmed", "Сервер не підтвердив результат дії.");
  }
  const reply = data as Record<string, unknown>;
  return {
    ok: true,
    warning: typeof reply.warning === "string" ? reply.warning : undefined,
    discordDeleteFailed: reply.discordDeleteFailed === true,
    republished: reply.republished === true,
    redirectTo: typeof reply.redirectTo === "string" && /^\/polls(?:\/|\?|$)/.test(reply.redirectTo) ? reply.redirectTo : undefined,
    updated: Number.isSafeInteger(reply.updated) && Number(reply.updated) >= 0 ? Number(reply.updated) : undefined,
    failed: Number.isSafeInteger(reply.failed) && Number(reply.failed) >= 0 ? Number(reply.failed) : undefined,
  };
}
export function raidPollMutationFailure(error: unknown) {
  const rejected = error instanceof PollResponseError && error.outcome === "rejected" ||
    // These routes can return 400 after a partial external action, and 409
    // for a publication that is still pending. Neither proves no commit.
    error instanceof ApiHttpError && [401, 403, 404, 413, 415, 422, 428, 429].includes(error.status);
  return {
    outcome: rejected ? "rejected" as const : "unconfirmed" as const,
    message: rejected
      ? error instanceof PollResponseError ? error.message : errorFromPayload((error as ApiHttpError).body, "Запит відхилено. Перевір права та актуальний стан пулу.")
      : "Результат не підтверджено. Дія могла завершитися. Перевір стан рейд-пулу перед повтором; автоматичного повтору немає.",
  };
}
