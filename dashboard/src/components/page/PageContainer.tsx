import type { ReactNode } from "react";
import styles from "./page-system.module.css";

export type PageContainerProps = {
  children: ReactNode;
  navigation?: ReactNode;
  sidebar?: ReactNode;
  label: string;
};

export default function PageContainer({ children, navigation, sidebar, label }: PageContainerProps) {
  return <main className={`container app-page ${styles.container}`} aria-label={label}>
    <div className={`dashboard-shell content-shell app-page-stack ${styles.frame}`}>
      {navigation}
      <div className={sidebar ? styles.workspace : styles.content}>
        {sidebar ? <section className={styles.sidebar} aria-label="Навігація розділів">{sidebar}</section> : null}
        {sidebar ? <div className={styles.content}>{children}</div> : children}
      </div>
    </div>
  </main>;
}
