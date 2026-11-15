import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";
export default function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}
