import type { ApplicationStatus } from "@/lib/github";
import type { DashboardApiJsonOptions } from "@/lib/dashboardApiClient";

export type ApplicationDecision = Exclude<ApplicationStatus, "review">;
export type ApplicationDecisionOutcome = "changed" | "partial" | "already" | "uncertain" | "review";
export type ApplicationDecisionResult = {
  issueNumber: number;
  status?: ApplicationStatus;
  state?: string;
  outcome: ApplicationDecisionOutcome;
  message: string;
};
export type ApplicationJsonRequest = (url: string, options: DashboardApiJsonOptions) => Promise<unknown>;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function knownStatus(value: unknown): ApplicationStatus | undefined {
  return value === "accepted" || value === "declined" || value === "review" ? value : undefined;
}
const STATUS_LABELS: Record<ApplicationStatus, string> = { review: "На розгляді", accepted: "Прийнято", declined: "Відхилено" };
export function uncertainApplicationResult(issueNumber: number): ApplicationDecisionResult {
  return { issueNumber, outcome: "uncertain", message: "Результат не підтверджено. Перевір стан заявки перед наступною дією." };
}
export function describeApplicationDecision(issueNumber: number, value: unknown): ApplicationDecisionResult {
  const data = record(value);
  const status = knownStatus(data.status);
  if (data.ok !== true || !status) return uncertainApplicationResult(issueNumber);
  const state = typeof data.state === "string" ? data.state : status === "review" ? "open" : "closed";
  if (data.alreadyModerated === true) return {
    issueNumber, status, state, outcome: "already",
    message: status === "review" ? "Заявку закрито зі статусом «На розгляді». Повторну модерацію заблоковано." : `Заявку вже розглянуто: ${STATUS_LABELS[status]}. Повторне рішення не надсилалося.`,
  };
  if (status === "review") return uncertainApplicationResult(issueNumber);
  const discord = record(data.discord);
  const confirmed = record(discord.edited).ok === true || record(discord.notified).ok === true;
  return { issueNumber, status, state, outcome: confirmed ? "changed" : "partial",
    message: confirmed ? `${STATUS_LABELS[status]}: рішення збережено, Discord підтвердив оновлення.` : `${STATUS_LABELS[status]}: рішення збережено. Discord не підтвердив оновлення; не повторюй рішення для синхронізації.` };
}
export async function submitApplicationDecisions(
  request: ApplicationJsonRequest, numbers: number[], status: ApplicationDecision, signal?: AbortSignal,
): Promise<ApplicationDecisionResult[]> {
  const unique = Array.from(new Set(numbers));
  if (!unique.length || unique.length > 50 || unique.some((number) => !Number.isSafeInteger(number) || number <= 0) || !["accepted", "declined"].includes(status)) {
    throw new Error("Вибери від 1 до 50 заявок і остаточне рішення.");
  }
  const single = unique.length === 1;
  const body = await request(single ? `/api/applications/${unique[0]}/status` : "/api/applications/bulk-status", {
    method: "POST", headers: { "X-Dashboard-Action": single ? "moderate-application" : "bulk-moderate-applications" },
    json: single ? { status } : { issueNumbers: unique, status }, signal,
    timeoutMs: 45_000, retries: 0,
  });
  const payload = record(body);
  const items = single ? [payload] : Array.isArray(payload.items) ? payload.items : [];
  return unique.map((issueNumber) => {
    const item = items.map(record).find((item) => item.issueNumber === issueNumber);
    if (!item || item.ok !== true) return uncertainApplicationResult(issueNumber);
    return describeApplicationDecision(issueNumber, single ? item : item.result);
  });
}
export async function readApplicationDecision(request: ApplicationJsonRequest, issueNumber: number, signal?: AbortSignal): Promise<ApplicationDecisionResult> {
  const data = record(await request(`/api/applications/${issueNumber}`, { method: "GET", signal, timeoutMs: 10_000, retries: 0 }));
  const status = knownStatus(data.status);
  if (!data.ok || data.issueNumber !== issueNumber || !status) return uncertainApplicationResult(issueNumber);
  return { issueNumber, status, state: typeof data.state === "string" ? data.state : "open", outcome: status === "review" && data.state !== "closed" ? "review" : "already",
    message: status === "review" && data.state !== "closed"
      ? "У сховищі заявка ще на розгляді. Рішення можна надіслати окремою явною дією; паралельні рішення захищені."
      : status === "review" ? "Заявку закрито зі статусом «На розгляді». Повторну модерацію заблоковано." : `${STATUS_LABELS[status]}: збережене рішення підтверджено. Стан доставки в Discord цим читанням не перевірявся.` };
}
export function summarizeApplicationDecisions(items: ApplicationDecisionResult[]) {
  return {
    total: items.length,
    changed: items.filter((item) => item.outcome === "changed" || item.outcome === "partial").length,
    already: items.filter((item) => item.outcome === "already").length,
    discordPending: items.filter((item) => item.outcome === "partial").length,
    uncertain: items.filter((item) => item.outcome === "uncertain").length,
  };
}
