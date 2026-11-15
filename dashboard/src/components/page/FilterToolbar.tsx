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
