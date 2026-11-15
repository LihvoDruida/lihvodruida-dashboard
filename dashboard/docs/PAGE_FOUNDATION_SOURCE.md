# Крок 1 — повний код реалізації

Канонічні файли розміщені у src/. Нижче наведено їхній повний текст без скорочень.

## src/components/page/DataCard.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export type DataCardProps = {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
};
export default function DataCard({ title, description, badge, children, actions, headingLevel = 3 }: DataCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return <article className={styles.dataCard}>
    <header className={styles.cardHeader}>
      <Heading className={styles.cardTitle}>{title}</Heading>{badge}
    </header>
    {description ? <p className={styles.cardDescription}>{description}</p> : null}
    {children ? <div className={styles.cardBody}>{children}</div> : null}
    {actions ? <footer className={styles.cardActions}>{actions}</footer> : null}
  </article>;
}
```

## src/components/page/DataGrid.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export default function DataGrid({ children, label, columns = "auto", busy = false }: {
  children: ReactNode;
  label: string;
  columns?: "auto" | "two" | "three";
  busy?: boolean;
}) {
  return <div className={`${styles.grid} ${styles[columns]}`} role="group" aria-label={label} aria-busy={busy || undefined}>
    {children}
  </div>;
}
```

## src/components/page/EmptyState.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export default function EmptyState({ title, description, actions }: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return <div className={styles.emptyState}>
    <h3 className={styles.cardTitle}>{title}</h3>
    <p className={styles.description}>{description}</p>
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </div>;
}
```

## src/components/page/ErrorState.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export default function ErrorState({ title = "Не вдалося завантажити дані", description, actions, digest }: {
  title?: string;
  description: ReactNode;
  actions?: ReactNode;
  digest?: string;
}) {
  return <div className={styles.errorState} role="alert">
    <h3 className={styles.cardTitle}>{title}</h3>
    <p className={styles.description}>{description}</p>
    {digest ? <small className={styles.metadata}>Код звернення: {digest.slice(0, 64)}</small> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </div>;
}
```

## src/components/page/FilterToolbar.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export type FilterToolbarProps = {
  label: string;
  search: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  result?: ReactNode;
  busy?: boolean;
};

/** A region rather than role=toolbar: native fields retain normal Tab navigation. */
export default function FilterToolbar({ label, search, filters, actions, result, busy = false }: FilterToolbarProps) {
  return <section className={styles.toolbar} aria-label={label} aria-busy={busy || undefined}>
    <div className={styles.toolbarRow}>
      <div className={styles.search}>{search}</div>
      {filters ? <div className={styles.filters}>{filters}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
    {result ? <p className={styles.result} role="status" aria-live="polite" aria-atomic="true">{result}</p> : null}
  </section>;
}
```

## src/components/page/FormSection.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export default function FormSection({ title, description, children, actions, disabled = false }: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  disabled?: boolean;
}) {
  return <fieldset className={styles.formSection} disabled={disabled}>
    <legend>{title}</legend>
    {description ? <p className={styles.description}>{description}</p> : null}
    <div className={styles.formFields}>{children}</div>
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </fieldset>;
}
```

## src/components/page/PageContainer.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export type PageContainerProps = {
  children: ReactNode;
  navigation?: ReactNode;
  sidebar?: ReactNode;
  label: string;
};

export default function PageContainer({ children, navigation, sidebar, label }: PageContainerProps) {
  return <main className={`container app-page ${styles.container}`} aria-label={label}>
    <div className={`dashboard-shell content-shell app-page-stack ${styles.frame}`}>
      {navigation}
      <div className={sidebar ? styles.workspace : styles.content}>
        {sidebar ? <aside className={styles.sidebar} aria-label="Навігація розділів">{sidebar}</aside> : null}
        {sidebar ? <div className={styles.content}>{children}</div> : children}
      </div>
    </div>
  </main>;
}
```

## src/components/page/PageErrorBoundary.tsx

```tsx
"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import ErrorState from "./ErrorState";
import { sendClientErrorReport } from "@/components/ClientErrorReporter";

type Props = { children: ReactNode; resetKey?: string; onRetry?: () => void };
type State = { failed: boolean };

/** Widget-level boundary. Server-render failures are handled by Next's route boundary. */
export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    sendClientErrorReport(error, "react-error-boundary");
  }
  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  private retry = () => {
    this.setState({ failed: false });
    this.props.onRetry?.();
  };
  render() {
    if (this.state.failed) return <ErrorState description="Цей блок тимчасово недоступний. Решта сторінки продовжує працювати."
      actions={<Button onClick={this.retry}>Повторити</Button>} />;
    return this.props.children;
  }
}
```

## src/components/page/PageHeader.tsx

```tsx
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
```

## src/components/page/PageRefreshButton.tsx

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function PageRefreshButton({ label = "Повторити" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button busy={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Оновлюємо…" : label}</Button>;
}
```

## src/components/page/PageSection.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export default function PageSection({ id, title, description, actions, children }: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return <section className={styles.section} aria-labelledby={id}>
    <header className={styles.sectionHeader}>
      <div className={styles.headerCopy}><h2 id={id} className={styles.sectionTitle}>{title}</h2>
        {description ? <p className={styles.description}>{description}</p> : null}</div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
    {children}
  </section>;
}
```

## src/components/page/PageSkeleton.tsx

```tsx
import styles from "./page-system.module.css";

export default function PageSkeleton({ label = "Завантаження даних", variant = "cards", count = 3 }: {
  label?: string;
  variant?: "cards" | "rows" | "page";
  count?: number;
}) {
  const length = Number.isFinite(count) ? Math.max(1, Math.min(12, Math.floor(count))) : 3;
  return <div className={styles.skeleton} role="status" aria-label={label} aria-busy="true">
    <span className={styles.visuallyHidden}>{label}</span>
    {variant === "page" ? <div className={styles.skeletonHeader} aria-hidden="true">
      <span className={styles.skeletonLine} /><span className={styles.skeletonLine} />
    </div> : null}
    <div className={variant === "rows" ? styles.skeletonRows : styles.grid} aria-hidden="true">
      {Array.from({ length }, (_, index) => <div className={variant === "rows" ? styles.skeletonRow : styles.skeletonCard} key={index}>
        <span className={styles.skeletonLine} /><span className={styles.skeletonLine} /><span className={styles.skeletonLine} />
      </div>)}
    </div>
  </div>;
}
```

## src/components/page/StatusBadge.tsx

```tsx
import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";
export default function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}
```

## src/components/page/page-system.module.css

```css
.container { min-width: 0; }
.frame { display: grid; gap: var(--page-gap); min-width: 0; }
.workspace { display: grid; grid-template-columns: var(--management-sidebar-width) minmax(0, 1fr); gap: var(--page-gap); align-items: start; min-width: 0; }
.content { display: grid; gap: var(--page-gap); min-width: 0; container-type: inline-size; }
.sidebar { position: sticky; top: calc(var(--nav-space) + var(--space-md)); max-height: calc(100dvh - var(--nav-space) - var(--space-xl)); overflow-y: auto; min-width: 0; scrollbar-width: thin; }
.sidebar :global(.management-nav) { display: grid; gap: var(--space-lg); padding: var(--space-md); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--nav-surface); }
.sidebar :global(.management-nav-label) { display: block; margin-bottom: var(--space-xs); color: var(--text-muted); font-size: var(--font-size-meta); font-weight: var(--font-weight-medium); }
.sidebar :global(.management-nav-links) { display: grid; gap: var(--space-2xs); }
.sidebar :global(.management-nav-links) a { display: grid; gap: var(--space-2xs); padding: var(--space-sm); border: var(--stroke-width) solid transparent; border-radius: var(--control-radius); color: var(--text-body); text-decoration: none; overflow-wrap: anywhere; transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out); }
.sidebar :global(.management-nav-links) a small { color: var(--text-muted); font-size: var(--font-size-meta); }
.sidebar :global(.management-nav-links) a:hover { background: var(--surface-hover); }
.sidebar :global(.management-nav-links) a[aria-current="page"] { border-color: var(--border-strong); background: var(--accent-soft); }
.header, .toolbar, .dataCard, .formSection, .emptyState, .errorState { min-width: 0; border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); box-shadow: var(--shadow-sm); }
.header { display: grid; gap: var(--space-lg); padding: var(--panel-padding); }
.headerRow, .sectionHeader { display: flex; align-items: start; justify-content: space-between; flex-wrap: wrap; gap: var(--space-md); }
.headerCopy { min-width: 0; flex: 1 1 var(--toolbar-search-min); display: grid; gap: var(--space-xs); }
.header .title { margin: 0; color: var(--text-strong); font-family: var(--font-display); font-size: var(--heading-page-size); font-weight: var(--font-weight-bold); line-height: var(--line-height-tight); overflow-wrap: anywhere; }
.eyebrow { color: var(--c-accent-300); font-size: var(--font-size-meta); font-weight: var(--font-weight-semibold); }
.description { margin: 0; color: var(--text-soft); font-size: var(--font-size-body); line-height: var(--line-height-copy); overflow-wrap: anywhere; }
.breadcrumbs { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin: 0; padding: 0; list-style: none; color: var(--text-muted); font-size: var(--font-size-meta); }
.breadcrumbs li + li::before { content: "/"; margin-right: var(--space-xs); color: var(--text-faint); }
.breadcrumbs a { color: var(--text-soft); }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-xs); min-width: 0; }
.actions :global(.btn) { white-space: normal; max-width: 100%; overflow-wrap: anywhere; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-md); margin: 0; }
.metric { min-width: 0; padding-block-start: var(--space-sm); border-top: var(--stroke-width) solid var(--border-subtle); }
.metric dt, .metadata { color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-body); }
.metric dd { margin: var(--space-2xs) 0 0; color: var(--text-strong); font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); overflow-wrap: anywhere; }
.metric .metricNote { color: var(--text-muted); font-size: var(--font-size-meta); font-weight: var(--font-weight-ui); }
.toolbar { display: grid; gap: var(--space-sm); padding: var(--space-md); }
.toolbarRow { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-sm); }
.search { flex: 1 1 var(--toolbar-search-min); min-width: 0; }
.filters { display: flex; flex-wrap: wrap; gap: var(--space-sm); min-width: 0; }
.filters > label { display: grid; gap: var(--space-xs); color: var(--text-body); font-size: var(--font-size-body-sm); min-width: 0; }
.filters select, .search input { width: 100%; max-width: 100%; min-width: 0; }
.result { margin: 0; color: var(--text-muted); font-size: var(--font-size-meta); }
.section { display: grid; gap: var(--section-gap); min-width: 0; }
.section .sectionTitle { margin: 0; font-size: var(--heading-section-size); color: var(--text-strong); font-family: var(--font-display); line-height: var(--line-height-tight); overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--data-grid-min)), 1fr)); gap: var(--space-md); min-width: 0; align-items: stretch; }
.auto { grid-auto-flow: row; }
.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.dataCard { min-block-size: var(--data-card-min-height); display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--panel-padding); }
.cardHeader { display: flex; align-items: start; flex-wrap: wrap; gap: var(--space-xs); }
.cardHeader .cardTitle, .emptyState .cardTitle, .errorState .cardTitle { margin: 0; color: var(--text-strong); font-family: var(--font-display); font-size: var(--heading-card-size); font-weight: var(--font-weight-semibold); line-height: var(--line-height-compact); overflow-wrap: anywhere; }
.cardHeader .cardTitle { flex: 1 1 var(--dropdown-min); }
.cardDescription { margin: 0; color: var(--text-soft); font-size: var(--font-size-body-sm); line-height: var(--line-height-copy); overflow-wrap: anywhere; }
.cardBody { min-width: 0; }
.cardActions { margin-top: auto; padding-top: var(--space-sm); display: flex; flex-wrap: wrap; gap: var(--space-xs); }
.cardActions :global(.btn) { max-width: 100%; white-space: normal; }
.formSection { display: grid; gap: var(--section-gap); margin: 0; padding: var(--panel-padding); }
.formSection legend { padding-inline: var(--space-xs); color: var(--text-strong); font-size: var(--heading-card-size); font-weight: var(--font-weight-semibold); }
.formFields { display: grid; gap: var(--space-md); min-width: 0; }
.emptyState, .errorState { display: grid; gap: var(--space-sm); padding: var(--panel-padding); }
.errorState { border-color: var(--tint-danger-border); background: var(--tint-danger-bg); }
.badge { display: inline-flex; align-items: center; max-width: 100%; padding: var(--space-2xs) var(--space-xs); border: var(--stroke-width) solid var(--border-subtle); border-radius: var(--radius-pill); color: var(--text-soft); background: var(--surface-sunken); font-size: var(--font-size-meta); line-height: var(--line-height-compact); overflow-wrap: anywhere; }
.badge[data-tone="success"] { color: var(--text-on-success); border-color: var(--tint-success-border); background: var(--tint-success-bg); }
.badge[data-tone="warning"] { color: var(--text-on-warning); border-color: var(--tint-warning-border); background: var(--tint-warning-bg); }
.badge[data-tone="danger"] { color: var(--text-on-danger); border-color: var(--tint-danger-border); background: var(--tint-danger-bg); }
.badge[data-tone="info"] { color: var(--c-info); border-color: var(--tint-info-border); background: var(--tint-info-bg); }
.dropdown { position: relative; min-width: 0; }
.dropdownTrigger { list-style: none; gap: var(--space-xs); }
.dropdownTrigger::-webkit-details-marker { display: none; }
.dropdownPanel { position: absolute; inset-inline-end: 0; top: calc(100% + var(--space-xs)); z-index: var(--z-dropdown); display: grid; gap: var(--space-2xs); padding: var(--space-xs); width: max-content; max-width: min(var(--data-grid-min), calc(100vw - var(--page-gutter) * 2)); min-width: min(var(--dropdown-min), calc(100vw - var(--page-gutter) * 2)); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--nav-panel); box-shadow: var(--shadow-md); }
.dropdownItem { padding: var(--space-xs) var(--space-sm); border-radius: var(--control-radius); color: var(--text-body); text-decoration: none; overflow-wrap: anywhere; transition: background-color var(--dur-fast) var(--ease-out); }
.dropdownItem:hover { background: var(--surface-hover); }
.dropdownItem[data-danger="true"] { color: var(--text-on-danger); }
.dropdownItem[aria-disabled="true"] { opacity: var(--opacity-disabled); cursor: not-allowed; }
.skeleton { min-width: 0; display: grid; gap: var(--section-gap); }
.skeletonHeader, .skeletonCard, .skeletonRow { display: grid; align-content: start; gap: var(--space-md); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); padding: var(--panel-padding); }
.skeletonHeader, .skeletonCard { min-block-size: var(--skeleton-card-height); }
.skeletonRows { display: grid; gap: var(--space-xs); }
.skeletonRow { min-block-size: var(--skeleton-row-height); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.skeletonLine { display: block; height: var(--skeleton-line-height); border-radius: var(--control-radius); background: var(--surface-raised); animation: pulse var(--skeleton-duration) var(--ease-in-out) infinite alternate; }
.visuallyHidden { position: absolute; width: var(--stroke-width); height: var(--stroke-width); padding: 0; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.container :where(a, button, input, select, textarea, summary):focus-visible, .dropdownItem:focus-visible { outline: var(--focus-width) solid var(--accent-ring); outline-offset: var(--focus-offset); }
.container :global(.btn):active:not(:disabled) { transform: none; background: var(--accent-soft); }
.container :where(input, select, textarea):disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
@keyframes pulse { from { opacity: var(--opacity-skeleton-low); } to { opacity: var(--opacity-skeleton-high); } }
@media (max-width: 1000px) {
  .workspace { grid-template-columns: minmax(0, 1fr); }
  .sidebar { position: static; max-height: none; overflow: visible; }
  .sidebar :global(.management-nav) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .sidebar :global(.management-nav) { grid-template-columns: minmax(0, 1fr); }
  .sidebar :global(.management-nav-links) { display: flex; flex-wrap: wrap; }
  .sidebar :global(.management-nav-links) a small { display: none; }
  .dropdownPanel { inset-inline-start: 0; inset-inline-end: auto; }
  .filters { width: 100%; }
  .filters > label { flex: 1 1 var(--dropdown-min); }
}
@container (max-width: 640px) { .two, .three { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) {
  .skeletonLine { animation: none; }
  .container :where(a, button, summary) { transition: none; }
}

.container :global(.btn) { font-size: var(--font-size-body-sm); }
.container :global(.btn):hover { transform: none; }

.container:global(.app-page) { width: 100%; max-width: var(--page-max); margin-inline: auto; padding: var(--space-lg) var(--page-gutter) var(--space-3xl); }

.container :where(input, select, textarea), .search :global(.ui-field) > label { font-size: var(--font-size-body-sm); }
```

## src/components/ui/DropdownMenu.tsx

```tsx
"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import Button from "./Button";
import styles from "../page/page-system.module.css";

type MenuBase = { id: string; label: string; disabled?: boolean; danger?: boolean };
export type DropdownMenuItem = MenuBase & (
  | { href: string; onSelect?: never }
  | { href?: never; onSelect: () => void }
);

/** Native disclosure, normal Tab order; no incomplete ARIA menu implementation. */
export default function DropdownMenu({ label = "Інші дії", items }: { label?: string; items: readonly DropdownMenuItem[] }) {
  const root = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const panelId = useId();
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) root.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  if (!items.length) return null;
  return <details className={styles.dropdown} ref={root} onKeyDown={event => {
    if (event.key === "Escape" && root.current?.open) {
      event.preventDefault(); root.current.open = false; trigger.current?.focus();
    }
  }}>
    <summary className={`btn subtle ${styles.dropdownTrigger}`} ref={trigger} aria-controls={panelId}>{label}<span aria-hidden="true">⌄</span></summary>
    <div id={panelId} className={styles.dropdownPanel} aria-label={label}>
      {items.map(item => item.href !== undefined
        ? item.disabled
          ? <span key={item.id} className={styles.dropdownItem} aria-disabled="true">{item.label}</span>
          : <Link key={item.id} href={item.href} className={styles.dropdownItem} data-danger={item.danger || undefined}
              onClick={() => root.current?.removeAttribute("open")}>{item.label}</Link>
        : <Button key={item.id} disabled={item.disabled} tone={item.danger ? "danger" : "ghost"} onClick={() => {
            root.current?.removeAttribute("open"); trigger.current?.focus(); item.onSelect();
          }}>{item.label}</Button>)}
    </div>
  </details>;
}
```

## src/components/management/overview/ManagementDirectory.tsx

```tsx
"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import FilterToolbar from "@/components/page/FilterToolbar";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import EmptyState from "@/components/page/EmptyState";
import StatusBadge from "@/components/page/StatusBadge";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";
import useManagementDirectoryFilters from "@/hooks/useManagementDirectoryFilters";
import {
  DEFAULT_DIRECTORY_FILTERS, MANAGEMENT_CATEGORY_LABELS, filterManagementDirectory,
  type ManagementDirectoryItem, type ManagementDirectoryFilters,
} from "@/lib/managementDirectory";

export default function ManagementDirectory({ items, initialFilters }: {
  items: readonly ManagementDirectoryItem[];
  initialFilters: ManagementDirectoryFilters;
}) {
  const { filters, update } = useManagementDirectoryFilters(initialFilters);
  const prefix = useId();
  const results = useMemo(() => filterManagementDirectory(items, filters), [items, filters]);
  const categories = Object.entries(MANAGEMENT_CATEGORY_LABELS).filter(([key]) => items.some(item => item.section === key));
  const hasFilters = Boolean(filters.query || filters.section !== "all" || filters.sort !== "recommended");
  const reset = () => update(DEFAULT_DIRECTORY_FILTERS);
  return <>
    <FilterToolbar label="Пошук і фільтри розділів"
      search={<FormField type="search" label="Пошук розділу" id={`${prefix}-search`} name="q" value={filters.query} maxLength={160}
        placeholder="Назва або призначення" onChange={event => update({ ...filters, query: event.target.value })} />}
      filters={<>
        <label htmlFor={`${prefix}-section`}>Категорія<select id={`${prefix}-section`} name="section" value={filters.section}
          onChange={event => update({ ...filters, section: event.target.value as ManagementDirectoryFilters["section"] })}>
          <option value="all">Усі категорії</option>
          {categories.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
        </select></label>
        <label htmlFor={`${prefix}-sort`}>Сортування<select id={`${prefix}-sort`} name="sort" value={filters.sort}
          onChange={event => update({ ...filters, sort: event.target.value === "title" ? "title" : "recommended" })}>
          <option value="recommended">За призначенням</option><option value="title">За назвою</option>
        </select></label>
      </>}
      actions={hasFilters ? <Button onClick={reset}>Скинути</Button> : null}
      result={`Знайдено: ${results.length} із ${items.length}`} />
    {!items.length ? <EmptyState title="Немає доступних розділів" description="Для цієї групи не призначено інструментів керування. Перевір права групи з власником сервера." />
      : !results.length ? <EmptyState title="Нічого не знайдено" description="Спробуй іншу назву або скинь фільтри."
          actions={<Button onClick={reset}>Показати всі розділи</Button>} />
      : <DataGrid label="Доступні розділи керування">
        {results.map(item => <DataCard key={item.key} title={item.label} description={item.description}
          badge={<StatusBadge>{MANAGEMENT_CATEGORY_LABELS[item.section]}</StatusBadge>}
          actions={<Link href={item.href} className="btn subtle" prefetch={false}>Відкрити<span className="sr-only"> {item.label}</span></Link>} />)}
      </DataGrid>}
  </>;
}
```

## src/components/management/overview/OverviewAutomations.tsx

```tsx
import Link from "next/link";
import type { DashboardSession } from "@/types/auth";
import { getAutomationOverview } from "@/lib/automationOverview";
import { canViewOverviewAutomation, overviewAutomationAction } from "@/lib/managementOverviewModel";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import StatusBadge, { type StatusTone } from "@/components/page/StatusBadge";
import type { AutomationStatus } from "@/lib/automationStatus";
import styles from "./overview.module.css";

const tones: Record<AutomationStatus["state"], StatusTone> = {
  running: "info", waiting: "neutral", paused: "neutral", attention: "warning", unavailable: "danger",
};
function time(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return <time dateTime={value}>{new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }).format(new Date(value))} · Київ</time>;
}
export default async function OverviewAutomations({ user }: { user: DashboardSession }) {
  const overview = await getAutomationOverview().catch(() => null);
  const cards = overview?.cards.filter(card => canViewOverviewAutomation(user, card.id)) || [];
  const unavailable = !overview || (cards.length > 0 && cards.every(card => card.state === "unavailable"));
  return <PageSection id="overview-automations" title="Автоматизації"
    description={overview ? <>Знімок стану на {time(overview.checkedAt)}. Оновлюється разом зі сторінкою.</> : "Стан фонових задач і останні результати."}
    actions={<PageRefreshButton label="Оновити стан" />}>
    {unavailable ? <ErrorState description="Не вдалося прочитати стан фонових задач. Налаштування збережені; спробуй оновити стан пізніше." />
      : !cards.length ? <EmptyState title="Немає доступних автоматизацій" description="Для цієї групи не призначено перегляду фонових задач." />
      : <DataGrid label="Стан фонових задач">
        {cards.map(card => {
          const action = overviewAutomationAction(user, card);
          return <DataCard key={card.id} title={card.title} description={card.reason}
            badge={<StatusBadge tone={tones[card.state]}>{card.label}</StatusBadge>}
            actions={action ? <Link className="btn subtle" href={action.href} prefetch={false}>{action.label}</Link> : null}>
            <dl className={styles.taskDetails}>
              <div><dt>Останній результат</dt><dd>{card.lastResult}{time(card.lastAt)}</dd></div>
              <div><dt>Наступний запуск</dt><dd>{time(card.nextAt)}<span>{card.nextNote}</span></dd></div>
            </dl>
          </DataCard>;
        })}
      </DataGrid>}
  </PageSection>;
}
```

## src/components/management/overview/OverviewIntegrations.tsx

```tsx
"use client";

import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { formatStableUtcTime } from "@/lib/stableUiText";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import PageSkeleton from "@/components/page/PageSkeleton";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import StatusBadge, { type StatusTone } from "@/components/page/StatusBadge";
import Button from "@/components/ui/Button";

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
      : summary?.items.length ? <DataGrid label="Стан інтеграцій" busy={pending}>
        {summary.items.map(item => <DataCard key={item.key} title={item.label} description={item.message || labels[item.state]}
          badge={<StatusBadge tone={tones[item.state]}>{labels[item.state]}</StatusBadge>} />)}
      </DataGrid>
      : summary ? <EmptyState title="Інтеграцій немає" description="Сервіс не повернув підключень. Перевір налаштування або повтори запит." /> : null}
  </PageSection>;
}
```

## src/components/management/overview/overview.module.css

```css
.taskDetails { display: grid; gap: var(--space-md); margin: 0; }
.taskDetails > div { padding-top: var(--space-sm); border-top: var(--stroke-width) solid var(--border-subtle); }
.taskDetails dt { color: var(--text-muted); font-size: var(--font-size-meta); }
.taskDetails dd { display: grid; gap: var(--space-2xs); margin: var(--space-xs) 0 0; color: var(--text-body); font-size: var(--font-size-body-sm); line-height: var(--line-height-copy); overflow-wrap: anywhere; }
.taskDetails time { display: block; color: var(--text-soft); font-variant-numeric: tabular-nums; }
```

## src/hooks/useManagementDirectoryFilters.ts

```typescript
"use client";

import { useEffect, useState } from "react";
import { normalizeDirectoryFilters, type ManagementDirectoryFilters } from "@/lib/managementDirectory";

export default function useManagementDirectoryFilters(initial: ManagementDirectoryFilters) {
  const [filters, setFilters] = useState(() => normalizeDirectoryFilters(initial));
  useEffect(() => {
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search);
      setFilters(normalizeDirectoryFilters({ query: params.get("q"), section: params.get("section"), sort: params.get("sort") }));
    };
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, []);
  function update(next: ManagementDirectoryFilters) {
    const normalized = normalizeDirectoryFilters(next);
    setFilters(normalized);
    const url = new URL(window.location.href);
    for (const [key, value] of [["q", normalized.query], ["section", normalized.section === "all" ? "" : normalized.section], ["sort", normalized.sort === "recommended" ? "" : normalized.sort]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  return { filters, update };
}
```

## src/lib/managementDirectory.ts

```typescript
export type ManagementCategory = "access" | "discord" | "system";
export type ManagementDirectoryItem = {
  key: string;
  href: string;
  label: string;
  description: string;
  section: ManagementCategory;
};
export type ManagementDirectoryFilters = {
  query: string;
  section: ManagementCategory | "all";
  sort: "recommended" | "title";
};
export const MANAGEMENT_CATEGORY_LABELS: Record<ManagementCategory, string> = {
  access: "Доступ і права", discord: "Discord та учасники", system: "Система",
};
export const DEFAULT_DIRECTORY_FILTERS: ManagementDirectoryFilters = { query: "", section: "all", sort: "recommended" };

export function normalizeDirectoryFilters(input: { query?: unknown; section?: unknown; sort?: unknown }): ManagementDirectoryFilters {
  return {
    query: typeof input.query === "string" ? input.query.slice(0, 160) : "",
    section: input.section === "access" || input.section === "discord" || input.section === "system" ? input.section : "all",
    sort: input.sort === "title" ? "title" : "recommended",
  };
}
export function filterManagementDirectory(items: readonly ManagementDirectoryItem[], filters: ManagementDirectoryFilters): ManagementDirectoryItem[] {
  const words = filters.query.normalize("NFKC").trim().toLocaleLowerCase("uk-UA").split(/\s+/).filter(Boolean);
  const result = items.filter(item => {
    if (filters.section !== "all" && item.section !== filters.section) return false;
    const content = `${item.label} ${item.description} ${MANAGEMENT_CATEGORY_LABELS[item.section]}`.normalize("NFKC").toLocaleLowerCase("uk-UA");
    return words.every(word => content.includes(word));
  });
  return filters.sort === "title" ? result.sort((a, b) => a.label.localeCompare(b.label, "uk-UA")) : result;
}
```

## src/lib/managementOverviewModel.ts

```typescript
import "server-only";
import type { DashboardSession } from "@/types/auth";
import { managementItems } from "@/lib/navigation/management";
import type { ManagementDirectoryItem } from "@/lib/managementDirectory";
import {
  canManageApplications, canManageDiscordMembers, canManageGroups, canManageRaids,
  canViewAdminLogs, canViewGuildRoster,
} from "@/lib/permissions";
import { AUTOMATION_TASK_IDS } from "@/lib/automationTaskCatalog";
import type { AutomationStatus } from "@/lib/automationStatus";

export function managementOverviewItems(user: DashboardSession): ManagementDirectoryItem[] {
  return managementItems(user).filter(item => item.key !== "overview")
    .map(({ key, href, label, description, section }) => ({ key, href, label, description, section }));
}

export function canViewOverviewAutomation(user: DashboardSession, id: AutomationStatus["id"]): boolean {
  switch (id) {
    case "accounts": return Boolean(user.isServerOwner);
    case "members": case "nicknames": case "onboarding": return canManageDiscordMembers(user);
    case "profile-nicknames": return canManageGroups(user);
    case "application-deliveries": return canManageApplications(user);
    case "log-maintenance": return canViewAdminLogs(user);
    case "guild-sync": return canViewGuildRoster(user);
    case "raid-lifecycle": case "polls": return canManageRaids(user);
    default: return false;
  }
}
export function overviewAutomationAction(user: DashboardSession, card: AutomationStatus): AutomationStatus["action"] | null {
  if (!canViewOverviewAutomation(user, card.id)) return null;
  if (card.id === "accounts") return { href: "/dashboard/profiles", label: "Переглянути очищення профілів" };
  return card.action;
}

export function overviewAutomationCount(user: DashboardSession): number {
  const ids: AutomationStatus["id"][] = ["members", "nicknames", "accounts", ...AUTOMATION_TASK_IDS];
  return ids.filter(id => canViewOverviewAutomation(user, id)).length;
}
```

## src/app/dashboard/page.tsx

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminTabs from "@/components/AdminTabs";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import PageSkeleton from "@/components/page/PageSkeleton";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import DropdownMenu from "@/components/ui/DropdownMenu";
import ManagementDirectory from "@/components/management/overview/ManagementDirectory";
import OverviewAutomations from "@/components/management/overview/OverviewAutomations";
import OverviewIntegrations from "@/components/management/overview/OverviewIntegrations";
import { getSession } from "@/lib/auth";
import { canAccessManagement } from "@/lib/navigation/management";
import { managementOverviewItems, overviewAutomationCount } from "@/lib/managementOverviewModel";
import { normalizeDirectoryFilters } from "@/lib/managementDirectory";
import { isDashboardStaff, dashboardRoleLabel } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Керування", description: "Стан системи та робочі розділи гільдії.", path: "/dashboard" });

type SearchParams = Record<string, string | string[] | undefined>;
const scalar = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard");
  if (!canAccessManagement(user)) redirect("/access-denied?reason=admin&from=/dashboard");
  const params = await searchParams;
  const items = managementOverviewItems(user);
  const automationCount = overviewAutomationCount(user);
  const primary = items.find(item => item.key === "discord") || items[0];
  const secondary = items.filter(item => item.section === "system" && item.key !== primary?.key)
    .map(item => ({ id: item.key, label: item.label, href: item.href }));
  const initialFilters = normalizeDirectoryFilters({ query: scalar(params.q), section: scalar(params.section), sort: scalar(params.sort) });
  return <PageContainer label="Центр керування" navigation={<DashboardIdentity user={user} activeSection="admin" />}
    sidebar={<AdminTabs active="overview" user={user} />}>
    <PageHeader title="Центр керування" eyebrow="Mistblossom Vanguard"
      description="Знайди потрібний інструмент і перевір стан системи. Показано розділи, доступні твоїй групі."
      breadcrumbs={[{ label: "Профіль", href: "/profile" }, { label: "Керування" }]}
      actions={<>
        {primary ? <Link className="btn primary" href={primary.href} prefetch={false}>{primary.label}</Link> : null}
        <DropdownMenu label="Системні розділи" items={secondary} />
      </>}
      metrics={[{ label: "Група доступу", value: user.groupName || dashboardRoleLabel(user.role) }, { label: "Розділи керування", value: items.length }]} />
    <PageSection id="management-directory-title" title="Робочі розділи" description="Пошук і фільтри працюють одразу, без перезавантаження сторінки.">
      <PageErrorBoundary resetKey={user.groupId}>
        <ManagementDirectory items={items} initialFilters={initialFilters} />
      </PageErrorBoundary>
    </PageSection>
    {isDashboardStaff(user) ? <PageErrorBoundary><OverviewIntegrations /></PageErrorBoundary> : null}
    {automationCount ? <Suspense fallback={<PageSkeleton label="Завантаження стану автоматизацій" count={automationCount} />}>
      <OverviewAutomations user={user} />
    </Suspense> : null}
  </PageContainer>;
}
```

## Додані токени у src/app/styles/tokens.css

```css
:root {
  /* Universal page foundation: approved semantic geometry and states. */
  --heading-page-size: clamp(1.6rem, 2.8vw, 2.25rem);
  --heading-section-size: clamp(1.15rem, 2vw, 1.45rem);
  --heading-card-size: 1rem;
  --stroke-width: 1px;
  --focus-width: 2px;
  --focus-offset: 3px;
  --management-sidebar-width: 232px;
  --data-grid-min: 16rem;
  --toolbar-search-min: 14rem;
  --dropdown-min: 13rem;
  --data-card-min-height: 12rem;
  --skeleton-card-height: var(--data-card-min-height);
  --skeleton-line-height: 1rem;
  --skeleton-row-height: 4rem;
  --skeleton-duration: 1.2s;
  --opacity-disabled: 0.5;
  --opacity-skeleton-low: 0.45;
  --opacity-skeleton-high: 0.8;
  --tint-info-bg: rgba(121, 166, 216, 0.08);
  --tint-info-border: rgba(121, 166, 216, 0.28);
}
```
