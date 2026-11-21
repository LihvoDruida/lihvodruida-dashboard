import Link from "next/link";
import type { ProfileOverviewModel } from "@/services/profileOverview";
import DashboardIdentity from "@/components/DashboardIdentity";
import ListReturnLink from "@/components/ListReturnLink";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { canViewGuildRoster, canViewProfiles } from "@/lib/permissions";
import { wowRoleLabel } from "@/lib/wowRoles";
import PageContainer from "@/components/page/PageContainer";
import Notice from "@/components/page/Notice";
import AccountHero, { type AccountTab } from "@/components/account/AccountHero";
import AccountCard from "@/components/account/AccountCard";
import MainCharacterShowcase from "@/components/account/MainCharacterShowcase";
import styles from "@/components/account/account.module.css";
import ProfileCharactersGallery from "./ProfileCharactersGallery";
import ProfileRaidSignups from "./ProfileRaidSignups";

export default function ProfileOverviewView(model: ProfileOverviewModel) {
  const { viewer, profile, query, isOwnProfile, isRulesReturn, settingsRulesReturnPath, rulesReviewPath,
    mainCharacter, selectedRaidRole, canViewPrivateProfileBlocks, profileGuildCharacterCount, publicNamePreview,
    guildStatus, raidSignups, profileAvatarUrl, storageWarning, battleNetLastSyncLabel, battleNetRefreshHref, battleNetAction } = model;
  const overviewHref = model.profileRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}`;
  const settingsHref = settingsRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}/settings`;
  const bestRio = Math.max(0, ...profile.characters.map(item => item.raiderIo?.currentScore || 0));
  const activeSignups = raidSignups.filter(item => ["going", "tentative", "late"].includes(item.signup.status)).length;
  const linked = Boolean(profile.battlenet?.linked);
  const tabs: AccountTab[] = [
    { href: overviewHref, label: "Огляд", current: true },
    { href: `${overviewHref}#profile-characters`, label: `Персонажі · ${profile.characters.length}` },
    ...(canViewPrivateProfileBlocks ? [{ href: `${overviewHref}#profile-raids`, label: "Рейдові записи" }] : []),
    ...(isOwnProfile ? [{ href: settingsHref, label: "Налаштування" }] : []),
  ];
  return <PageContainer label={isOwnProfile ? "Мій профіль" : "Профіль учасника"} navigation={<DashboardIdentity user={viewer} activeSection="profile" />}>
    {!isRulesReturn && query.from === "guild" && canViewGuildRoster(viewer) ? <ListReturnLink kind="guild" scope={listNavigationScope(viewer)} />
      : !isRulesReturn && canViewProfiles(viewer) ? <ListReturnLink kind="profiles" scope={listNavigationScope(viewer)} /> : null}
    <AccountHero id="profile-overview" name={publicNamePreview} avatar={profileAvatarUrl}
      subtitle={[profile.displayName && profile.displayName !== publicNamePreview ? `Discord: ${profile.displayName}` : "Discord", isOwnProfile ? "мій профіль" : null].filter(Boolean).join(" · ")}
      badges={[{ label: profile.groupName || guildStatus, tone: "info" }, ...(profile.groupName ? [{ label: guildStatus }] : []), { label: wowRoleLabel(selectedRaidRole) }]}
      stats={[
        { label: "Мейн", value: mainCharacter?.name || "Не вибрано" },
        { label: "Персонажі", value: `${profile.characters.length} · ${profileGuildCharacterCount} у гільдії` },
        { label: "ilvl мейна", value: typeof mainCharacter?.itemLevel === "number" ? mainCharacter.itemLevel : "—" },
        { label: "Найкращий RIO", value: bestRio ? Math.round(bestRio) : "—" },
        ...(canViewPrivateProfileBlocks ? [{ label: "Активні записи", value: activeSignups }] : []),
      ]}
      actions={isOwnProfile ? <Link href={settingsHref} className="btn primary" prefetch={false}>Налаштування профілю</Link> : null}
      tabs={tabs} />
    {storageWarning ? <Notice title="Тимчасові дані" tone="warning">{storageWarning}</Notice> : null}
    {rulesReviewPath ? <Notice title="Завершення реєстрації" actions={<Link className="btn subtle" href={rulesReviewPath}>Повернутись до правил</Link>}>
      Перевір персонажів і мейна, потім повернись до прийняття правил.
    </Notice> : null}
    {!isOwnProfile && canViewPrivateProfileBlocks ? <Notice title="Перегляд профілю">Змінювати персонажів і підключення може лише власник профілю.</Notice> : null}
    <div className={styles.layout}>
      <div className={styles.main}>
        {mainCharacter ? <MainCharacterShowcase character={mainCharacter} /> : null}
        <ProfileCharactersGallery model={model} settingsHref={settingsHref} />
        {canViewPrivateProfileBlocks ? <ProfileRaidSignups items={raidSignups} unavailable={model.raidSignupsUnavailable} /> : null}
      </div>
      <div className={styles.aside}>
        <AccountCard rows={[
          { key: "discord", icon: "discord", title: profile.displayName || "Discord", detail: "Вхід і ролі через Discord", ok: true },
          { key: "battlenet", icon: "battlenet", title: linked ? (profile.battlenet?.accountLabel || "Battle.net підключено") : "Battle.net не підключено",
            detail: linked ? `Синхронізація: ${battleNetLastSyncLabel}` : "Потрібен для персонажів і мейна", ok: linked,
            action: isOwnProfile ? <a className="btn subtle" href={battleNetRefreshHref}>{linked ? "Оновити" : battleNetAction.title}</a> : null },
          { key: "group", icon: "group", title: profile.groupName || guildStatus, detail: `Статус у гільдії: ${guildStatus}` },
          { key: "role", icon: "role", title: wowRoleLabel(selectedRaidRole), detail: mainCharacter ? `Роль у рейдах · мейн ${mainCharacter.name}` : "Роль у рейдах" },
        ]} settingsHref={isOwnProfile ? settingsHref : undefined} canSignOut={isOwnProfile} />
      </div>
    </div>
  </PageContainer>;
}
