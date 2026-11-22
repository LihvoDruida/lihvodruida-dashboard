import Link from "next/link";
import type { ReactNode } from "react";
import type { ProfileSettingsModel } from "@/services/profileSettings";
import DashboardIdentity from "@/components/DashboardIdentity";
import ProfileNameControls from "@/components/ProfileNameControls";
import RaidReminderPreferenceControls from "@/components/RaidReminderPreferenceControls";
import ListReturnLink from "@/components/ListReturnLink";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { canViewProfiles } from "@/lib/permissions";
import { wowRoleLabel } from "@/lib/wowRoles";
import { formatStableUkCompactDate } from "@/lib/stableUiText";
import PageContainer from "@/components/page/PageContainer";
import FormSection from "@/components/page/FormSection";
import Notice from "@/components/page/Notice";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import AccountHero from "@/components/account/AccountHero";
import AccountCard from "@/components/account/AccountCard";
import styles from "@/components/account/account.module.css";
import ProfileCompletion from "./ProfileCompletion";
import { ProfileGenderPreferenceForm, RaidRolePreferenceForm, NicknameCharactersForm } from "./ProfilePreferences";
import ProfileCharactersManager from "./ProfileCharactersManager";

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return <section className={styles.settingsSection} id={id} aria-labelledby={`${id}-title`}>
    <div className={styles.settingsSectionHead}><h2 id={`${id}-title`}>{title}</h2><p>{description}</p></div>
    {children}
  </section>;
}

export default function ProfileSettingsView(model: ProfileSettingsModel) {
  const { session, profile, isRulesReturn, settingsRulesReturnPath, profileRulesReturnPath, rulesReviewPath, mainCharacter,
    manualRaidRole, selectedRaidRole, publicNamePreview, serverStyleNamePreview, discordNicknamePreview,
    discordMemberReadable, canSyncDiscordNickname, discordOwnerLocked, currentServerNickname, liveDiscordMember,
    setupStatus, settingsPageTitle, guildStatus, storageWarning, nicknamePolicy } = model;
  const profileHref = profileRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}`;
  const settingsHref = settingsRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}/settings`;
  const missing = new Set(setupStatus.missing.map(step => step.key));
  const nav = [
    { href: "#profile-characters-settings", label: `Персонажі · ${profile.characters.length}` },
    { href: "#profile-identity", label: "Імʼя", missing: [...missing].some(key => key !== "profile_gender") },
    { href: "#profile-discord", label: "Discord" },
    { href: "#profile-raids-settings", label: "Рейди та звертання", missing: missing.has("profile_gender") },
    { href: "#profile-connections", label: "Сесія" },
  ];
  return <PageContainer label={settingsPageTitle} navigation={<DashboardIdentity user={session} activeSection="profile" />}>
    {!isRulesReturn && canViewProfiles(session) ? <ListReturnLink kind="profiles" scope={listNavigationScope(session)} /> : null}
    <AccountHero id="profile-settings-overview" name={settingsPageTitle} avatar={liveDiscordMember?.avatarUrl || profile.avatarUrl}
      subtitle={`${publicNamePreview} · кожна форма зберігається окремо`}
      badges={[{ label: profile.groupName || guildStatus, tone: "info" }, { label: wowRoleLabel(selectedRaidRole) }]}
      actions={<Link href={profileHref} className="btn subtle" prefetch={false}>Відкрити профіль</Link>}
      tabs={[
        { href: profileHref, label: "Огляд" },
        { href: `${profileHref}#profile-characters`, label: `Персонажі · ${profile.characters.length}` },
        { href: settingsHref, label: "Налаштування", current: true },
      ]} />
    {storageWarning ? <Notice title="Тимчасові дані" tone="warning">{storageWarning}</Notice> : null}
    {rulesReviewPath ? <Notice title="Завершення реєстрації" actions={<Link href={rulesReviewPath} className="btn subtle">Повернутись до правил</Link>}>
      Заповни обовʼязкові поля й повернись до перевірки правил. Посилання прийняття збережено.
    </Notice> : null}
    <div className={styles.settingsLayout}>
      <nav className={styles.settingsNav} aria-label="Розділи налаштувань">
        {nav.map(item => <a key={item.href} href={item.href} data-missing={item.missing || undefined}>{item.label}</a>)}
      </nav>
      <div className={styles.settingsMain}>
        {setupStatus.complete ? null : <ProfileCompletion status={setupStatus} />}
        <Section id="profile-characters-settings" title="Персонажі" description="Retail і WoW Forever з Battle.net: мейн, склад і видалення.">
          <ProfileCharactersManager model={model} />
        </Section>
        <Section id="profile-identity" title="Імʼя" description="Як тебе бачать у панелі, рейдах і на сервері.">
          <div id="profile-name-settings"><FormSection title="Імʼя та відображення">
            <PageErrorBoundary resetKey={profile.profileId}><ProfileNameControls identityProfileId={profile.profileId}
              preferredName={profile.preferredName} publicNameMode={profile.publicNameMode} discordName={profile.displayName}
              publicNamePreview={publicNamePreview} serverStyleNamePreview={serverStyleNamePreview} nicknamePreview={discordNicknamePreview}
              lastSyncedNickname={profile.discordNickname?.value} lastSyncedAt={profile.discordNickname?.syncedAt ? formatStableUkCompactDate(profile.discordNickname.syncedAt) : null}
              currentServerNickname={currentServerNickname} serverNicknameChecked={Boolean(discordMemberReadable && liveDiscordMember)} canManage
              canSyncDiscord={canSyncDiscordNickname} discordOwnerLocked={discordOwnerLocked} returnTo={settingsRulesReturnPath} /></PageErrorBoundary>
          </FormSection></div>
        </Section>
        <Section id="profile-discord" title="Discord" description="Персонажі в серверному ніку та особисті нагадування.">
          <div id="profile-nickname-settings"><NicknameCharactersForm profile={profile} nicknameTemplate={nicknamePolicy.template} returnTo={settingsRulesReturnPath} /></div>
          {profile.provider === "discord" ? <div id="profile-notifications-settings"><FormSection title="Нагадування про рейди"><PageErrorBoundary><RaidReminderPreferenceControls /></PageErrorBoundary></FormSection></div> : null}
        </Section>
        <Section id="profile-raids-settings" title="Рейди та звертання" description="Роль, з якою тебе ставлять у склад, і форма звертання в текстах.">
          <div className={styles.settingsPair}>
            <div id="profile-role-settings"><RaidRolePreferenceForm mainCharacter={mainCharacter} manualRole={manualRaidRole} selectedRole={selectedRaidRole} returnTo={settingsRulesReturnPath} /></div>
            <div id="profile-gender-settings"><ProfileGenderPreferenceForm value={profile.grammaticalGender} returnTo={settingsRulesReturnPath} /></div>
          </div>
        </Section>
        <Section id="profile-connections" title="Сесія" description="Discord-акаунт, через який ти входиш у панель.">
          <AccountCard title="Вхід" rows={[
            { key: "discord", icon: "discord", title: profile.displayName || "Discord", detail: currentServerNickname ? `Серверний нік: ${currentServerNickname}` : "Вхід і ролі через Discord", ok: true },
          ]} canSignOut />
        </Section>
      </div>
    </div>
  </PageContainer>;
}
