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
