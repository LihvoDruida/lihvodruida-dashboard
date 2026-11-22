import type { ProfileSettingsModel } from "@/services/profileSettings";
import ProfileCharactersLiveSection from "@/components/ProfileCharactersLiveSection";
import ProfileCharacterSetup from "@/components/ProfileCharacterSetup";
import ProfileCandidateBulkActions from "@/components/ProfileCandidateBulkActions";
import ProfileCandidateExpiryTimer from "@/components/ProfileCandidateExpiryTimer";
import ProfileCandidateCharacterRow from "@/components/ProfileCandidateCharacterRow";
import FormSection from "@/components/page/FormSection";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import styles from "@/components/account/account.module.css";

/** Everything about the profile's characters: Battle.net sync, list with main / remove, composition and candidates. */
export default function ProfileCharactersManager({ model }: { model: ProfileSettingsModel }) {
  const { profile, characters, visibleCharacters, mainCharacter, apiSettings, isRulesReturn, settingsRulesReturnPath } = model;
  const { availableCandidates, availableGuildCandidates, availableOtherCandidates, hasAvailableBattleNetCandidates,
    battleNetAction, battleNetCharacterActionHref, battleNetLastSyncLabel, bulkFormId } = characters;
  const returnTo = settingsRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}/settings`;
  const linked = Boolean(profile.battlenet?.linked);
  return <>
    <div className={styles.syncBar}>
      <span className={styles.rowCopy}>
        <strong>{linked ? (profile.battlenet?.accountLabel || "Battle.net підключено") : "Battle.net не підключено"}</strong>
        <small>{linked ? `Синхронізація ${battleNetLastSyncLabel} · Retail і WoW Forever` : "Підключи, щоб знайти персонажів Retail і WoW Forever"}</small>
      </span>
      <a className="btn primary" href={battleNetCharacterActionHref}>{battleNetAction.title}</a>
    </div>
    <PageErrorBoundary resetKey={profile.profileId}><ProfileCharactersLiveSection profileId={profile.profileId} initialCharacters={visibleCharacters}
      initialUpdatedAt={profile.battlenet?.lastProfileViewRefreshAt || profile.battlenet?.lastCharacterRefreshAt || profile.battlenet?.lastSyncAt || profile.updatedAt || profile.lastLoginAt || mainCharacter?.lastSeenAt || null}
      canManage showMainBadge variant="rows" returnTo={returnTo} candidateCount={availableCandidates.length}
      emptyMessage="Підключи Battle.net і додай персонажів." refreshMinMs={apiSettings.profileViewRefreshMinSeconds * 1000} /></PageErrorBoundary>
    {/* Only when Battle.net found characters to add: main and role are set on the rows and in "Raids". */}
    {!isRulesReturn && hasAvailableBattleNetCandidates
      ? <FormSection title="Нові персонажі з Battle.net" description="Вибери, кого додати до профілю."><PageErrorBoundary resetKey={profile.profileId}><ProfileCharacterSetup key={profile.profileId} profileId={profile.profileId} /></PageErrorBoundary></FormSection> : null}
    {isRulesReturn && hasAvailableBattleNetCandidates ? <div id="profile-candidates" className="profile-candidates-box" data-profile-candidates-box="true">
      <FormSection title="Додати персонажів" description="Вибери потрібних гільдійних або інших персонажів для профілю.">
        <div className="profile-candidate-counter"><span className="profile-count-pill" data-profile-candidate-count="true">{availableCandidates.length}</span>
          {profile.battlenet?.candidateExpiresAt ? <ProfileCandidateExpiryTimer expiresAt={profile.battlenet.candidateExpiresAt} /> : null}</div>
        <form id={bulkFormId} className="profile-candidate-bulk-form" action="/api/profile/characters/bulk-add" method="post">
          <input type="hidden" name="returnTo" value={returnTo} />
        </form>
        <ProfileCandidateBulkActions formId={bulkFormId} count={availableCandidates.length} />
        {availableGuildCandidates.length ? <section className="profile-candidate-group" aria-label="Гільдійні кандидати"><strong>Гільдійні · {availableGuildCandidates.length}</strong>
          <ul className="profile-character-candidates">{availableGuildCandidates.map(character => <ProfileCandidateCharacterRow key={character.key} character={character} bulkFormId={bulkFormId} />)}</ul></section> : null}
        {availableOtherCandidates.length ? <section className="profile-candidate-group" aria-label="Інші кандидати"><strong>Інші · {availableOtherCandidates.length}</strong>
          <ul className="profile-character-candidates">{availableOtherCandidates.map(character => <ProfileCandidateCharacterRow key={character.key} character={character} bulkFormId={bulkFormId} />)}</ul></section> : null}
      </FormSection>
    </div> : null}
  </>;
}
