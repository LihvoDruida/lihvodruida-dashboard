import type { ReactNode } from "react";
import StatusBadge, { type StatusTone } from "./StatusBadge";
import styles from "./page-system.module.css";

export default function Notice({ title, children, tone = "info", actions }: {
  title: string;
  children?: ReactNode;
  tone?: StatusTone;
  actions?: ReactNode;
}) {
  return <div className={styles.notice} data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
    <strong><StatusBadge tone={tone}>{title}</StatusBadge></strong>
    {children ? <div className={styles.description}>{children}</div> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </div>;
}
