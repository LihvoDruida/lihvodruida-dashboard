import styles from "./page-system.module.css";

export default function Progress({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(safeMax, value)) : 0;
  return <progress className={styles.progress} value={safeValue} max={safeMax} aria-label={label}>{Math.round(safeValue / safeMax * 100)}%</progress>;
}
