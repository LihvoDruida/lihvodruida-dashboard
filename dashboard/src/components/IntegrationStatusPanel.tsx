"use client";

import { useMemo } from "react";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { formatStableUtcTime } from "@/lib/stableUiText";

type IntegrationState = "ok" | "warning" | "error" | "unconfigured";

type IntegrationStatusItem = {
  key: string;
  label: string;
  state: IntegrationState;
  message: string;
  checkedAt: string;
};

type IntegrationStatusSummary = {
  checkedAt: string;
  items: IntegrationStatusItem[];
};

function formatCheckedAt(value?: string | null) {
  return formatStableUtcTime(value);
}

function statusText(state: IntegrationState) {
  if (state === "ok") return "працює";
  if (state === "warning") return "увага";
  if (state === "unconfigured") return "потребує уваги";
  return "помилка";
}

export default function IntegrationStatusPanel({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const resource = useDashboardApiResource<IntegrationStatusSummary | null>({
    key: "integrations:status",
    scope: "integrations",
    initialData: null,
    refreshOnMount: true,
    request: () => ({
      url: "/api/background/refresh",
      method: "POST",
      headers: { "X-Dashboard-Action": "background-integrations" },
      json: { resources: [{ key: "integrations:status", kind: "integrations" }] },
      select: (payload) => {
        const first = payload && typeof payload === "object" && "resources" in payload
          ? (payload as { resources?: Array<{ ok?: boolean; data?: IntegrationStatusSummary; error?: string }> }).resources?.[0]
          : null;
        if (!first?.ok || !first.data) throw new Error(first?.error || "Не вдалося перевірити інтеграції.");
        return first.data;
      },
    }),
  });

  const summary = resource.data;
  const error = resource.error;
  const loading = resource.status === "checking" && !summary;
  const items = summary?.items || [];
  const hasProblem = useMemo(() => items.some((item) => item.state === "error" || item.state === "warning" || item.state === "unconfigured"), [items]);

  return (
    <section className={`integration-status-panel panel${compact ? " integration-status-panel--compact" : ""}${className ? ` ${className}` : ""}`} data-problem={hasProblem ? "true" : "false"} aria-label="Стан інтеграцій">
      <div className="integration-status-head">
        <div>
          <strong>Стан системи</strong>
          <span>Discord, Battle.net, заявки й профілі</span>
        </div>
        <button className="btn subtle btn-sm" type="button" onClick={() => void resource.refresh("manual", { force: true })} disabled={loading} aria-busy={loading}>{loading ? "..." : "Оновити"}</button>
      </div>

      {error ? <p className="integration-status-error">{error}</p> : null}

      <div className="integration-status-grid">
        {(items.length ? items : ["Discord", "Battle.net", "Заявки", "Профілі"].map((label, index) => ({ key: `${index}`, label, state: "warning" as IntegrationState, message: loading ? "перевіряємо" : "немає даних", checkedAt: summary?.checkedAt || "" }))).map((item) => (
          <div className="integration-status-item" data-state={item.state} key={item.key} title={item.message}>
            <span className="integration-status-dot" aria-hidden="true" />
            <strong>{item.label}</strong>
            <small>{item.message || statusText(item.state)}</small>
          </div>
        ))}
      </div>

      <div className="integration-status-foot">
        <span>Остання перевірка: {formatCheckedAt(summary?.checkedAt)}</span>
      </div>
    </section>
  );
}
