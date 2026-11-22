"use client";

import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { formatStableUtcTime } from "@/lib/stableUiText";
import PageSection from "@/components/page/PageSection";
import PageSkeleton from "@/components/page/PageSkeleton";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import StatusBadge, { type StatusTone } from "@/components/page/StatusBadge";
import Button from "@/components/ui/Button";
import styles from "./overview.module.css";

type IntegrationState = "ok" | "warning" | "error" | "unconfigured";
type IntegrationItem = { key: string; label: string; state: IntegrationState; message: string; checkedAt: string };
type IntegrationSummary = { checkedAt: string; items: IntegrationItem[] };
const labels: Record<IntegrationState, string> = { ok: "Працює", warning: "Потребує уваги", error: "Помилка", unconfigured: "Не налаштовано" };
const tones: Record<IntegrationState, StatusTone> = { ok: "success", warning: "warning", error: "danger", unconfigured: "neutral" };
function validSummary(value: unknown): value is IntegrationSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<IntegrationSummary>;
  return typeof summary.checkedAt === "string" && Array.isArray(summary.items) && summary.items.length <= 20 && summary.items.every(item =>
    item && typeof item.key === "string" && typeof item.label === "string" && typeof item.message === "string" && typeof item.checkedAt === "string" && Object.hasOwn(labels, item.state));
}
export default function OverviewIntegrations() {
  const resource = useDashboardApiResource<IntegrationSummary | null>({
    key: "integrations:status", scope: "integrations", initialData: null, refreshOnMount: true,
    request: () => ({
      url: "/api/background/refresh", method: "POST", headers: { "X-Dashboard-Action": "background-integrations" },
      json: { resources: [{ key: "integrations:status", kind: "integrations" }] },
      select: (payload: unknown) => {
        const first = payload && typeof payload === "object" && "resources" in payload
          ? (payload as { resources?: Array<{ ok?: boolean; data?: unknown }> }).resources?.[0] : null;
        if (!first?.ok || !validSummary(first.data)) throw new Error("Не вдалося перевірити інтеграції.");
        return first.data;
      },
    }),
  });
  const summary = resource.data;
  const pending = resource.status === "checking";
  return <PageSection id="overview-integrations" title="Інтеграції"
    description={summary ? `Остання перевірка: ${formatStableUtcTime(summary.checkedAt)}` : "Підключення Discord, Battle.net та служб панелі."}
    actions={<Button busy={pending} onClick={() => void resource.refresh("manual", { force: true })}>{pending ? "Перевіряємо…" : "Оновити інтеграції"}</Button>}>
    {resource.error ? <ErrorState title={summary ? "Оновлення не вдалося" : "Інтеграції тимчасово недоступні"}
      description={summary ? "Показано останні отримані дані. Спробуй оновити їх пізніше." : "Перевір підключення та повтори запит. Налаштування не змінені."} /> : null}
    {!summary && !resource.error ? <PageSkeleton label="Перевірка інтеграцій" count={5} />
      : summary?.items.length ? <ul className={styles.integrations} aria-label="Стан інтеграцій" aria-busy={pending || undefined}>
        {summary.items.map(item => <li key={item.key} className={styles.integration} data-state={item.state}>
          <strong>{item.label}</strong><StatusBadge tone={tones[item.state]}>{labels[item.state]}</StatusBadge>
          {item.message && item.message.trim().toLowerCase() !== labels[item.state].toLowerCase() ? <small>{item.message}</small> : null}
        </li>)}
      </ul>
      : summary ? <EmptyState title="Інтеграцій немає" description="Сервіс не повернув підключень. Перевір налаштування або повтори запит." /> : null}
  </PageSection>;
}
