import type { ReactNode } from "react";

type AdminHeaderMetric = {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger";
};

export default function AdminPageHeader({
  eyebrow,
  title,
  description,
  metrics,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  metrics?: AdminHeaderMetric[];
}) {
  return (
    <header className="panel admin-page-header">
      <div className="admin-page-header__copy">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {metrics?.length ? (
        <div className="admin-page-header__metrics" aria-label={`Короткий огляд: ${title}`}>
          {metrics.map((metric, index) => (
            <div
              key={`${metric.label}-${index}`}
              className={`admin-page-header__metric is-${metric.tone || "neutral"}`}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.note ? <small>{metric.note}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
    </header>
  );
}
