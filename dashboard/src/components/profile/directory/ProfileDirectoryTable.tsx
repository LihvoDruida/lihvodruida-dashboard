import Link from "next/link";
import type { DashboardProfile } from "@/lib/profiles";
import { getMainCharacter, getProfilePublicName } from "@/lib/profiles";
import { guildStatusLabel, dashboardRoleLabel } from "@/lib/permissions";
import { listEntryId } from "@/lib/listViewState";
import ProfileAvatar from "@/components/ProfileAvatar";
import DataTable from "@/components/ui/DataTable";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "./directory.module.css";

export function profileDirectoryDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
export default function ProfileDirectoryTable({ profiles, avatars }: { profiles: DashboardProfile[]; avatars: Map<string, string> }) {
  return <DataTable caption="Список доступних профілів" headings={["Учасник", "Група / роль", "Мейн", "Персонажі", "Battle.net", "Активність"]}
    className={styles.area} tableClassName={styles.table}>
    {profiles.map(profile => {
      const name = getProfilePublicName(profile), main = getMainCharacter(profile);
      return <tr key={profile.profileId} id={listEntryId("profiles", profile.profileId)} data-list-entry="profiles">
        <th scope="row" data-label="Учасник"><Link className={styles.identity} href={`/profile/${profile.profileId}`} prefetch={false} aria-label={`Відкрити профіль: ${name}`}>
          <ProfileAvatar src={avatars.get(profile.providerUserId) || profile.avatarUrl} width={40} height={40} className={styles.avatar} fallbackClassName={styles.avatar} />
          <span><strong>{name}</strong><small>{profile.login ? `@${profile.login}` : `Discord · ${profile.providerUserId}`}</small></span>
        </Link></th>
        <td data-label="Група / роль"><strong>{profile.groupName || guildStatusLabel(profile.role)}</strong><small>{dashboardRoleLabel(profile.role)}</small></td>
        <td data-label="Мейн"><strong>{main?.name || "Не вибрано"}</strong><small>{[main?.realmName || main?.realmSlug, main?.className, main?.activeSpecName].filter(Boolean).join(" · ") || "Персонажа не призначено"}</small></td>
        <td data-label="Персонажі">{profile.characters.length}</td>
        <td data-label="Battle.net"><StatusBadge tone={profile.battlenet?.linked ? "success" : "neutral"}>{profile.battlenet?.linked ? "Підключено" : "Не підключено"}</StatusBadge>
          {profile.battlenet?.linked ? <small>Синхр. {profileDirectoryDate(profile.battlenet.lastSyncAt || profile.battlenet.lastConnectedAt)}</small> : null}</td>
        <td data-label="Активність"><time dateTime={profile.lastLoginAt || profile.updatedAt || undefined}>{profileDirectoryDate(profile.lastLoginAt || profile.updatedAt)}</time><small>{profile.lastLoginAt ? "Останній вхід" : "Оновлення профілю"}</small></td>
      </tr>;
    })}
  </DataTable>;
}
