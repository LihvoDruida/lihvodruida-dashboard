import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./page-system.module.css";

export type DataCardProps = {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
  listEntry?: "applications" | "raids" | "polls";
  titleHref?: string;
};
export default function DataCard({ title, description, badge, children, actions, headingLevel = 3, id, listEntry, titleHref }: DataCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return <article className={styles.dataCard} id={id} data-list-entry={listEntry}>
    <header className={styles.cardHeader}>
      <Heading className={styles.cardTitle}>{titleHref ? <Link href={titleHref} prefetch={false}>{title}</Link> : title}</Heading>{badge}
    </header>
    {description ? <p className={styles.cardDescription}>{description}</p> : null}
    {children ? <div className={styles.cardBody}>{children}</div> : null}
    {actions ? <footer className={styles.cardActions}>{actions}</footer> : null}
  </article>;
}
