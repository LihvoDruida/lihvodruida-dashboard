import Link from "next/link";
import type { ProfileOverviewModel } from "@/services/profileOverview";
import ProfileCharactersLiveSection from "@/components/ProfileCharactersLiveSection";
import PageSection from "@/components/page/PageSection";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";

/** Read-only characters on the profile; adding, main and removal live on the settings page. */
export default function ProfileCharactersGallery({ model, settingsHref }: { model: ProfileOverviewModel; settingsHref: string }) {
  const { profile, visibleCharacters, mainCharacter, apiSettings, canViewPrivateProfileBlocks, isOwnProfile, battleNetLastSyncLabel } = model;
  const others = Boolean(mainCharacter && canViewPrivateProfileBlocks);
  return <div id="profile-characters"><PageSection id="profile-characters-title" title={others ? "Інші персонажі" : "Персонажі"}
    description={profile.battlenet?.linked ? `Battle.net синхронізовано ${battleNetLastSyncLabel}` : undefined}
    actions={isOwnProfile ? <Link className="btn subtle" href={`${settingsHref}#profile-characters-settings`} prefetch={false}>Керувати персонажами</Link> : null}>
    <PageErrorBoundary resetKey={profile.profileId}><ProfileCharactersLiveSection profileId={profile.profileId} initialCharacters={visibleCharacters}
      initialUpdatedAt={profile.battlenet?.lastProfileViewRefreshAt || profile.battlenet?.lastCharacterRefreshAt || profile.battlenet?.lastSyncAt || profile.updatedAt || profile.lastLoginAt || mainCharacter?.lastSeenAt || null}
      canManage={false} showMainBadge={canViewPrivateProfileBlocks} hideMain={others} showSummary={false} candidateCount={0}
      emptyMessage={others ? "Крім мейна, персонажів немає." : isOwnProfile ? "Підключи Battle.net у налаштуваннях і додай персонажів." : "Учасник ще не додав персонажів."}
      refreshMinMs={apiSettings.profileViewRefreshMinSeconds * 1000} /></PageErrorBoundary>
  </PageSection></div>;
}
