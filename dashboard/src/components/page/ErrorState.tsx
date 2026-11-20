import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export default function ErrorState({ title = "Не вдалося завантажити дані", description, actions, digest, headingLevel = 3 }: {
  title?: string;
  description: ReactNode;
  actions?: ReactNode;
  /** Use 2 when the state stands directly under the page h1. */
  headingLevel?: 2 | 3;
  digest?: string;
}) {
  return <div className={styles.errorState} role="alert">
    {headingLevel === 2 ? <h2 className={styles.cardTitle}>{title}</h2> : <h3 className={styles.cardTitle}>{title}</h3>}
    <p className={styles.description}>{description}</p>
    {digest ? <small className={styles.metadata}>Код звернення: {digest.slice(0, 64)}</small> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </div>;
}
