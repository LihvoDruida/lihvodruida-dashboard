import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./page-system.module.css";

export type PageMetric = {
  label: string;
  value: ReactNode;
  note?: ReactNode;
};
export type Breadcrumb = { label: string; href?: string };
export type PageHeaderProps = {
  title: string;
  description: ReactNode;
  eyebrow?: string;
  breadcrumbs?: readonly Breadcrumb[];
  actions?: ReactNode;
  metrics?: readonly PageMetric[];
};

export default function PageHeader({ title, description, eyebrow, breadcrumbs = [], actions, metrics = [] }: PageHeaderProps) {
  return <header className={styles.header}>
    {breadcrumbs.length ? <nav aria-label="Хлібні крихти"><ol className={styles.breadcrumbs}>
      {breadcrumbs.map((item, index) => <li key={`${item.href || item.label}-${index}`}>
        {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{item.label}</span>}
      </li>)}
    </ol></nav> : null}
    <div className={styles.headerRow}>
      <div className={styles.headerCopy}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {actions ? <div className={styles.actions} aria-label="Головні дії сторінки">{actions}</div> : null}
    </div>
    {metrics.length ? <dl className={styles.metrics} aria-label="Короткий огляд">
      {metrics.map(metric => <div className={styles.metric} key={metric.label}>
        <dt>{metric.label}</dt><dd>{metric.value}</dd>
        {metric.note ? <dd className={styles.metricNote}>{metric.note}</dd> : null}
      </div>)}
    </dl> : null}
  </header>;
}
