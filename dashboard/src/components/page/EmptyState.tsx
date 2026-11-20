import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export default function EmptyState({ title, description, actions, headingLevel = 3 }: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  /** Use 2 when the state stands directly under the page h1. */
  headingLevel?: 2 | 3;
}) {
  return <div className={styles.emptyState}>
    {headingLevel === 2 ? <h2 className={styles.cardTitle}>{title}</h2> : <h3 className={styles.cardTitle}>{title}</h3>}
    <p className={styles.description}>{description}</p>
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </div>;
}
