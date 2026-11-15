import Link from "next/link";
import type { ProfileSettingsModel } from "@/services/profileSettings";
import DashboardIdentity from "@/components/DashboardIdentity";
import ProfileNameControls from "@/components/ProfileNameControls";
import RaidReminderPreferenceControls from "@/components/RaidReminderPreferenceControls";
import ListReturnLink from "@/components/ListReturnLink";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { canViewProfiles } from "@/lib/permissions";
import { wowRoleLabel } from "@/lib/wowRoles";
import { profileGenderLabel } from "@/lib/profiles";
import { formatStableUkCompactDate } from "@/lib/stableUiText";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import FormSection from "@/components/page/FormSection";
import Notice from "@/components/page/Notice";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import ProfileSidebar from "../ProfileSidebar";
import ProfileCompletion from "./ProfileCompletion";
import { ProfileGenderPreferenceForm, RaidRolePreferenceForm, NicknameCharactersForm } from "./ProfilePreferences";

export default function ProfileSettingsView(model: ProfileSettingsModel) {
  const { session, profile, isRulesReturn, settingsRulesReturnPath, profileRulesReturnPath, rulesReviewPath, mainCharacter,
    manualRaidRole, selectedRaidRole, publicNamePreview, serverStyleNamePreview, discordNicknamePreview,
    discordMemberReadable, canSyncDiscordNickname, discordOwnerLocked, currentServerNickname, liveDiscordMember,
    setupStatus, settingsPageTitle, guildStatus, storageWarning, nicknamePolicy } = model;
  const profileHref = profileRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}`;
  return <PageContainer label={settingsPageTitle} navigation={<DashboardIdentity user={session} activeSection="profile" />}
    sidebar={<ProfileSidebar profileId={profile.profileId} name={publicNamePreview} avatar={liveDiscordMember?.avatarUrl || profile.avatarUrl}
      status={guildStatus} role={wowRoleLabel(selectedRaidRole)} characterCount={profile.characters.length} mainName={mainCharacter?.name}
      linked={Boolean(profile.battlenet?.linked)} isOwnProfile canViewPrivate active="settings" settingsHref={settingsRulesReturnPath} overviewHref={profileHref} />}>
    {!isRulesReturn && canViewProfiles(session) ? <ListReturnLink kind="profiles" scope={listNavigationScope(session)} /> : null}
    <div id="profile-settings-overview"><PageHeader title={settingsPageTitle} eyebrow="Mistblossom Vanguard"
      description="Імʼя, звертання, Discord-нік і роль у рейдах. Кожна форма зберігається окремо."
      breadcrumbs={[{ label: "Профіль", href: profileHref }, { label: "Налаштування" }]}
      actions={<Link href={profileHref} className="btn subtle">Відкрити профіль</Link>}
      metrics={[{ label: "Публічне імʼя", value: publicNamePreview }, { label: "Discord-нік", value: discordNicknamePreview || "Не сформовано" }, { label: "Звертання", value: profileGenderLabel(profile.grammaticalGender) }]} /></div>
    {storageWarning ? <Notice title="Тимчасові дані" tone="warning">{storageWarning}</Notice> : null}
    {rulesReviewPath ? <Notice title="Завершення реєстрації" actions={<Link href={rulesReviewPath} className="btn subtle">Повернутись до правил</Link>}>
      Заповни обовʼязкові поля й повернись до перевірки правил. Посилання прийняття збережено.
    </Notice> : null}
    <ProfileCompletion status={setupStatus} />
    <PageSection id="profile-personal-title" title="Особисті дані">
      <div id="profile-name-settings"><FormSection title="Імʼя та відображення">
        <PageErrorBoundary resetKey={profile.profileId}><ProfileNameControls identityProfileId={profile.profileId}
          preferredName={profile.preferredName} publicNameMode={profile.publicNameMode} discordName={profile.displayName}
          publicNamePreview={publicNamePreview} serverStyleNamePreview={serverStyleNamePreview} nicknamePreview={discordNicknamePreview}
          lastSyncedNickname={profile.discordNickname?.value} lastSyncedAt={profile.discordNickname?.syncedAt ? formatStableUkCompactDate(profile.discordNickname.syncedAt) : null}
          currentServerNickname={currentServerNickname} serverNicknameChecked={Boolean(discordMemberReadable && liveDiscordMember)} canManage
          canSyncDiscord={canSyncDiscordNickname} discordOwnerLocked={discordOwnerLocked} returnTo={settingsRulesReturnPath} /></PageErrorBoundary>
      </FormSection></div>
      <div id="profile-gender-settings"><ProfileGenderPreferenceForm value={profile.grammaticalGender} returnTo={settingsRulesReturnPath} /></div>
    </PageSection>
    <PageSection id="profile-discord-title" title="Discord та нагадування">
      <div id="profile-nickname-settings"><NicknameCharactersForm profile={profile} nicknameTemplate={nicknamePolicy.template} returnTo={settingsRulesReturnPath} /></div>
      {profile.provider === "discord" ? <div id="profile-notifications-settings"><FormSection title="Нагадування про рейди"><PageErrorBoundary><RaidReminderPreferenceControls /></PageErrorBoundary></FormSection></div> : null}
    </PageSection>
    <div id="profile-role-settings"><RaidRolePreferenceForm mainCharacter={mainCharacter} manualRole={manualRaidRole} selectedRole={selectedRaidRole} returnTo={settingsRulesReturnPath} /></div>
  </PageContainer>;
}
