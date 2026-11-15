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
