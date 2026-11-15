import type { ProfileOverviewModel } from "@/services/profileOverview";
import ProfileCharactersLiveSection from "@/components/ProfileCharactersLiveSection";
import ProfileCharacterSetup from "@/components/ProfileCharacterSetup";
import ProfileCandidateBulkActions from "@/components/ProfileCandidateBulkActions";
import ProfileCandidateExpiryTimer from "@/components/ProfileCandidateExpiryTimer";
import ProfileCandidateCharacterRow from "@/components/ProfileCandidateCharacterRow";
import PageSection from "@/components/page/PageSection";
import Notice from "@/components/page/Notice";
import FormSection from "@/components/page/FormSection";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";

export default function ProfileBattleNetPanel({ model }: { model: ProfileOverviewModel }) {
  const { profile, canManageCharacters, canViewPrivateProfileBlocks, visibleCharacters, mainCharacter, apiSettings,
    availableCandidates, availableGuildCandidates, availableOtherCandidates, hasAvailableBattleNetCandidates,
    battleNetAction, battleNetCharacterActionHref, battleNetRefreshHref, battleNetLastSyncLabel, profileRulesReturnPath,
    isRulesReturn, bulkFormId } = model;
  return <div id="profile-characters"><PageSection id="profile-characters-title" title="Персонажі Battle.net"
    description={profile.battlenet?.linked ? `Battle.net підключено · синхронізація: ${battleNetLastSyncLabel}` : "Персонажі, мейн і спеціалізації профілю."}
    actions={canManageCharacters ? <a className="btn primary" href={battleNetCharacterActionHref}>{battleNetAction.title}</a> : null}>
    <PageErrorBoundary resetKey={profile.profileId}><ProfileCharactersLiveSection profileId={profile.profileId} initialCharacters={visibleCharacters}
      initialUpdatedAt={profile.battlenet?.lastProfileViewRefreshAt || profile.battlenet?.lastCharacterRefreshAt || profile.battlenet?.lastSyncAt || profile.updatedAt || profile.lastLoginAt || mainCharacter?.lastSeenAt || null}
      canManage={canManageCharacters} showMainBadge={canViewPrivateProfileBlocks} returnTo={profileRulesReturnPath}
      candidateCount={availableCandidates.length} emptyMessage={canManageCharacters ? "Підключи Battle.net і додай персонажів." : "Учасник ще не додав персонажів."}
      refreshMinMs={apiSettings.profileViewRefreshMinSeconds * 1000} /></PageErrorBoundary>
    {canManageCharacters && !hasAvailableBattleNetCandidates && profile.battlenet?.linked ? <Notice title="Додавання нових персонажів"
      actions={<a className="btn subtle" href={battleNetRefreshHref}>Оновити список Battle.net</a>}>
      Онови список Battle.net, щоб знайти інших або оновлених персонажів. Уже додані персонажі залишаються у профілі.
    </Notice> : null}
    {canManageCharacters && !isRulesReturn && (profile.characters.length > 0 || hasAvailableBattleNetCandidates)
      ? <FormSection title="Склад персонажів"><PageErrorBoundary resetKey={profile.profileId}><ProfileCharacterSetup key={profile.profileId} profileId={profile.profileId} /></PageErrorBoundary></FormSection> : null}
    {canManageCharacters && isRulesReturn && hasAvailableBattleNetCandidates ? <div id="profile-candidates" className="profile-candidates-box" data-profile-candidates-box="true">
      <FormSection title="Додати персонажів" description="Вибери потрібних гільдійних або інших персонажів для профілю.">
        <div className="profile-candidate-counter"><span className="profile-count-pill" data-profile-candidate-count="true">{availableCandidates.length}</span>
          {profile.battlenet?.candidateExpiresAt ? <ProfileCandidateExpiryTimer expiresAt={profile.battlenet.candidateExpiresAt} /> : null}</div>
        <form id={bulkFormId} className="profile-candidate-bulk-form" action="/api/profile/characters/bulk-add" method="post">
          {profileRulesReturnPath ? <input type="hidden" name="returnTo" value={profileRulesReturnPath} /> : null}
        </form>
        <ProfileCandidateBulkActions formId={bulkFormId} count={availableCandidates.length} />
        {availableGuildCandidates.length ? <section className="profile-candidate-group" aria-label="Гільдійні кандидати"><strong>Гільдійні · {availableGuildCandidates.length}</strong>
          <ul className="profile-character-candidates">{availableGuildCandidates.map(character => <ProfileCandidateCharacterRow key={character.key} character={character} bulkFormId={bulkFormId} />)}</ul></section> : null}
        {availableOtherCandidates.length ? <section className="profile-candidate-group" aria-label="Інші кандидати"><strong>Інші · {availableOtherCandidates.length}</strong>
          <ul className="profile-character-candidates">{availableOtherCandidates.map(character => <ProfileCandidateCharacterRow key={character.key} character={character} bulkFormId={bulkFormId} />)}</ul></section> : null}
      </FormSection>
    </div> : null}
  </PageSection></div>;
}
