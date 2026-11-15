import Link from "next/link";
import ProfileAvatar from "@/components/ProfileAvatar";
import LogoutButton from "@/components/LogoutButton";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "./profile-workspace.module.css";

export type ProfileSidebarProps = {
  profileId: string;
  name: string;
  avatar?: string | null;
  status: string;
  role: string;
  accountLabel?: string;
  characterCount: number;
  guildCharacterCount?: number;
  mainName?: string;
  linked: boolean;
  isOwnProfile: boolean;
  canViewPrivate: boolean;
  active: "overview" | "settings";
  settingsHref?: string;
  overviewHref?: string;
};
export default function ProfileSidebar(props: ProfileSidebarProps) {
  const base = `/profile/${encodeURIComponent(props.profileId)}`;
  const overview = props.overviewHref || base;
  return <div className={styles.sidebar}>
    <div className={styles.identity}>
      <ProfileAvatar src={props.avatar} width={80} height={80} className={styles.avatar} fallbackClassName={styles.avatar} />
      <strong>{props.name}</strong>{props.accountLabel ? <small>{props.accountLabel}</small> : null}<div className={styles.inline}><StatusBadge>{props.status}</StatusBadge><StatusBadge>{props.role}</StatusBadge></div>
    </div>
    <dl className={styles.facts}>
      <div><dt>Персонажі</dt><dd>{props.characterCount}</dd></div>
      {props.guildCharacterCount !== undefined ? <div><dt>У гільдії</dt><dd>{props.guildCharacterCount}</dd></div> : null}
      <div><dt>Мейн</dt><dd>{props.mainName || "Не вибрано"}</dd></div>
      <div><dt>Battle.net</dt><dd>{props.linked ? "Підключено" : "Не підключено"}</dd></div>
    </dl>
    <nav className={styles.navigation} aria-label="Розділи профілю">
      <Link href={overview} aria-current={props.active === "overview" ? "page" : undefined}>Огляд</Link>
      <Link href={`${overview}#profile-characters`}>Персонажі</Link>
      {props.canViewPrivate ? <Link href={`${overview}#profile-raids`}>Рейдові записи</Link> : null}
      {props.isOwnProfile ? <Link href={props.settingsHref || `${base}/settings`} aria-current={props.active === "settings" ? "page" : undefined}>Налаштування</Link> : null}
    </nav>
    {props.isOwnProfile ? <LogoutButton className={styles.logout} buttonClassName="btn subtle" /> : null}
  </div>;
}
