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
