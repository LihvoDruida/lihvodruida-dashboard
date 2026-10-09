import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "danger";

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function PageShell({ children, className }: PageShellProps) {
  return <main className={joinClassNames("container app-page", className)}>{children}</main>;
}

export function PageSection({ children, className }: PageShellProps) {
  return <section className={joinClassNames("panel page-section", className)}>{children}</section>;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="section-header dashboard-list-head">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="action-bar">{actions}</div> : null}
    </header>
  );
}

export function StatusChip({ children, tone = "info" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`status-chip status-chip--${tone}`}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function DebugDetails({ title = "Технічні деталі", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="debug-details">
      <summary>{title}</summary>
      {children}
    </details>
  );
}
