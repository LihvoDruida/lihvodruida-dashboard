import type { ReactNode } from "react";
import Link from "next/link";
import ProfileAvatar from "@/components/ProfileAvatar";
import StatusBadge, { type StatusTone } from "@/components/page/StatusBadge";
import styles from "./account.module.css";

export type AccountTab = { href: string; label: string; current?: boolean };
export type AccountBadge = { label: string; tone?: StatusTone };
export type AccountStat = { label: string; value: ReactNode };

/** Account header shared by the profile and its settings page: cover, identity, key numbers, tabs. */
export default function AccountHero({ id, name, subtitle, avatar, badges = [], stats = [], actions, tabs }: {
  id?: string;
  name: string;
  subtitle?: ReactNode;
  avatar?: string | null;
  badges?: readonly AccountBadge[];
  stats?: readonly AccountStat[];
  actions?: ReactNode;
  tabs: readonly AccountTab[];
}) {
  return <header className={styles.hero} id={id}>
    <div className={styles.cover} aria-hidden="true" />
    <div className={styles.heroBody}>
      <ProfileAvatar src={avatar} width={96} height={96} className={styles.avatar} loading="eager" />
      <div className={styles.identity}>
        <h1 className={styles.name}>{name}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {badges.length ? <div className={styles.badges}>{badges.map(badge => <StatusBadge key={badge.label} tone={badge.tone}>{badge.label}</StatusBadge>)}</div> : null}
      </div>
      {actions ? <div className={styles.heroActions}>{actions}</div> : null}
    </div>
    {stats.length ? <dl className={styles.stats} aria-label="Коротко про акаунт">
      {stats.map(stat => <div className={styles.stat} key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}
    </dl> : null}
    <nav className={styles.tabs} aria-label="Розділи профілю">
      {tabs.map(tab => <Link key={tab.href + tab.label} href={tab.href} aria-current={tab.current ? "page" : undefined} prefetch={false}>{tab.label}</Link>)}
    </nav>
  </header>;
}
