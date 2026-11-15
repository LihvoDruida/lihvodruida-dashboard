import styles from "./page-system.module.css";

export default function PageSkeleton({ label = "Завантаження даних", variant = "cards", count = 3 }: {
  label?: string;
  variant?: "cards" | "rows" | "page";
  count?: number;
}) {
  const length = Number.isFinite(count) ? Math.max(1, Math.min(12, Math.floor(count))) : 3;
  return <div className={styles.skeleton} role="status" aria-label={label} aria-busy="true">
    <span className={styles.visuallyHidden}>{label}</span>
    {variant === "page" ? <div className={styles.skeletonHeader} aria-hidden="true">
      <span className={styles.skeletonLine} /><span className={styles.skeletonLine} />
    </div> : null}
    <div className={variant === "rows" ? styles.skeletonRows : styles.grid} aria-hidden="true">
      {Array.from({ length }, (_, index) => <div className={variant === "rows" ? styles.skeletonRow : styles.skeletonCard} key={index}>
        <span className={styles.skeletonLine} /><span className={styles.skeletonLine} /><span className={styles.skeletonLine} />
      </div>)}
    </div>
  </div>;
}
