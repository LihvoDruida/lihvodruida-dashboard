import type { ReactNode } from "react";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import styles from "./account.module.css";

type Row = { key: string; icon: "discord" | "battlenet" | "group" | "role"; title: string; detail?: ReactNode; ok?: boolean; action?: ReactNode };

const ICONS: Record<Row["icon"], ReactNode> = {
  discord: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.6 5.6A16 16 0 0 0 15.7 4.4l-.5 1a14.7 14.7 0 0 0-6.4 0l-.5-1A16 16 0 0 0 4.4 5.6C1.9 9.3 1.3 12.9 1.6 16.5a16 16 0 0 0 4.8 2.4l1-1.6a10 10 0 0 1-1.6-.8l.4-.3a11.5 11.5 0 0 0 11.6 0l.4.3c-.5.3-1 .6-1.6.8l1 1.6a16 16 0 0 0 4.8-2.4c.4-4.2-.6-7.8-2.8-10.9ZM8.7 14.3c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.8 2-1.7 2Zm6.6 0c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Z" /></svg>,
  battlenet: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M8 12h8M12 8v8" /></svg>,
  group: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 19 6v6c0 4.4-3 8.3-7 9-4-.7-7-4.6-7-9V6Z" /></svg>,
  role: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 19 19 5M14 5h5v5M5 14v5h5" /></svg>,
};

/** Connected services and account state; the owner also gets settings and sign-out. */
export default function AccountCard({ title = "Акаунт", rows, settingsHref, canSignOut = false }: { title?: string; rows: readonly Row[]; settingsHref?: string; canSignOut?: boolean }) {
  return <section className={styles.card} aria-labelledby="account-card-title">
    <h2 className={styles.cardTitle} id="account-card-title">{title}</h2>
    <ul className={styles.rows}>
      {rows.map(row => <li className={styles.row} key={row.key}>
        <span className={styles.rowIcon} data-tone={row.icon === "discord" ? "discord" : row.ok ? "ok" : undefined}>{ICONS[row.icon]}</span>
        <span className={styles.rowCopy}><strong>{row.title}</strong>{row.detail ? <small>{row.detail}</small> : null}</span>
        {row.action ? <span className={styles.rowAction}>{row.action}</span> : null}
      </li>)}
    </ul>
    {settingsHref || canSignOut ? <div className={styles.heroActions}>
      {settingsHref ? <Link className="btn subtle" href={settingsHref} prefetch={false}>Налаштування</Link> : null}
      {canSignOut ? <LogoutButton className="" buttonClassName="btn subtle" /> : null}
    </div> : null}
  </section>;
}
