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
