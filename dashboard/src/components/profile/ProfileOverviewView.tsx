import Link from "next/link";
import type { ProfileOverviewModel } from "@/services/profileOverview";
import DashboardIdentity from "@/components/DashboardIdentity";
import ListReturnLink from "@/components/ListReturnLink";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { canViewGuildRoster, canViewProfiles } from "@/lib/permissions";
import { wowRoleLabel } from "@/lib/wowRoles";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import Notice from "@/components/page/Notice";
import ProfileSidebar from "./ProfileSidebar";
import ProfileBattleNetPanel from "./ProfileBattleNetPanel";
import ProfileRaidSignups from "./ProfileRaidSignups";

export default function ProfileOverviewView(model: ProfileOverviewModel) {
  const { viewer, profile, query, isOwnProfile, isRulesReturn, settingsRulesReturnPath, rulesReviewPath,
    mainCharacter, selectedRaidRole, canViewPrivateProfileBlocks, profileGuildCharacterCount, publicNamePreview,
    guildStatus, raidSignups, profileAvatarUrl, storageWarning } = model;
  const settingsHref = settingsRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}/settings`;
  return <PageContainer label={isOwnProfile ? "Мій профіль" : "Профіль учасника"} navigation={<DashboardIdentity user={viewer} activeSection="profile" />}
    sidebar={<ProfileSidebar profileId={profile.profileId} name={publicNamePreview} avatar={profileAvatarUrl} status={guildStatus} role={wowRoleLabel(selectedRaidRole)}
      characterCount={profile.characters.length} guildCharacterCount={profileGuildCharacterCount} mainName={mainCharacter?.name} linked={Boolean(profile.battlenet?.linked)}
      isOwnProfile={isOwnProfile} canViewPrivate={canViewPrivateProfileBlocks} active="overview" settingsHref={settingsHref} overviewHref={model.profileRulesReturnPath} accountLabel={model.accountStatusLabel} />}>
    {!isRulesReturn && query.from === "guild" && canViewGuildRoster(viewer) ? <ListReturnLink kind="guild" scope={listNavigationScope(viewer)} />
      : !isRulesReturn && canViewProfiles(viewer) ? <ListReturnLink kind="profiles" scope={listNavigationScope(viewer)} /> : null}
    <div id="profile-overview"><PageHeader title={isOwnProfile ? "Мій профіль" : "Профіль учасника"} eyebrow="Mistblossom Vanguard"
      description={publicNamePreview} breadcrumbs={[{ label: "Профіль" }]}
      actions={isOwnProfile ? <Link href={settingsHref} className="btn primary">Налаштування профілю</Link> : null}
      metrics={[{ label: "Мейн", value: mainCharacter?.name || "Не вибрано" }, { label: "Роль у рейді", value: wowRoleLabel(selectedRaidRole) }, { label: "Група", value: profile.groupName || guildStatus }, { label: "Персонажі", value: profile.characters.length }]} /></div>
    {storageWarning ? <Notice title="Тимчасові дані" tone="warning">{storageWarning}</Notice> : null}
    {rulesReviewPath ? <Notice title="Завершення реєстрації" actions={<Link className="btn subtle" href={rulesReviewPath}>Повернутись до правил</Link>}>
      Перевір персонажів і мейна, потім повернись до прийняття правил.
    </Notice> : null}
    {!isOwnProfile && canViewPrivateProfileBlocks ? <Notice title="Перегляд профілю">Змінювати персонажів і підключення може лише власник профілю.</Notice> : null}
    <ProfileBattleNetPanel model={model} />
    {canViewPrivateProfileBlocks ? <ProfileRaidSignups items={raidSignups} unavailable={model.raidSignupsUnavailable} /> : null}
  </PageContainer>;
}
