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
