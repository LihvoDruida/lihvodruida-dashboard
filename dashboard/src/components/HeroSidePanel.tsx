import type { ReactNode } from "react";

export type HeroSummaryItem = {
  label: string;
  value: ReactNode;
  note?: ReactNode;
};

export type HeroStatItem = {
  label: string;
  value: ReactNode;
};

type HeroSidePanelProps = {
  ariaLabel?: string;
  className?: string;
  summary?: HeroSummaryItem[];
  stats?: HeroStatItem[];
  actions?: ReactNode;
};

export default function HeroSidePanel({
  ariaLabel = "Короткий огляд",
  className = "",
  summary = [],
  stats = [],
  actions,
}: HeroSidePanelProps) {
  if (!summary.length && !stats.length && !actions) return null;

  const statsCount = Math.min(Math.max(stats.length, 1), 4);
  const rootClassName = ["guild-hero-side", "hero-map-side", className].filter(Boolean).join(" ");

  return (
    <div className={rootClassName} aria-label={ariaLabel}>
      {summary.length ? (
        <div className="guild-hero-summary hero-map-summary">
          {summary.map((item, index) => (
            <section className="guild-hero-summary__block hero-map-summary__block" key={`${item.label}-${index}`}>
              <span className="guild-hero-summary__label hero-map-summary__label">{item.label}</span>
              <strong>{item.value}</strong>
              {item.note ? <p>{item.note}</p> : null}
            </section>
          ))}
        </div>
      ) : null}

      {stats.length ? (
        <div className={`guild-hero-stats hero-map-stats hero-map-stats--${statsCount}`}>
          {stats.map((item, index) => (
            <div className="guild-hero-stat-card hero-map-stat-card" key={`${item.label}-${index}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}

      {actions ? <div className="guild-hero-actions hero-map-actions">{actions}</div> : null}
    </div>
  );
}
