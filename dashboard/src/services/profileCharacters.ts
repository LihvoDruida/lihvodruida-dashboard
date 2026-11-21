import "server-only";

import { getEnabledBattleNetRegions } from "@/lib/battlenet";
import { normalizeCharacterKey } from "@/lib/wowCharacters";
import { formatStableUkCompactDate } from "@/lib/stableUiText";
import type { DashboardProfile, ProfileCharacter } from "@/lib/profiles";

function battleNetActionCopy(profile: DashboardProfile, hasFreshBattleNetSession: boolean) {
  if (hasFreshBattleNetSession) return { eyebrow: "Готово до додавання", title: "Додати персонажів", hint: "Вибери потрібних зі свіжого списку" };
  if (profile.battlenet?.linked) return { eyebrow: "Battle.net підключено", title: "Оновити список", hint: "Потрібно для нових або оновлених персонажів" };
  return { eyebrow: "Battle.net не підключено", title: "Підключити Battle.net", hint: "Знайде гільдійних та інших персонажів Battle.net" };
}

/**
 * Battle.net candidates and actions for managing a profile's characters.
 * `returnPath` is where Battle.net OAuth sends the user back (the settings page,
 * which owns character management).
 */
export function characterManagementModel(profile: DashboardProfile, { returnPath }: { returnPath: string }) {
  const addedKeys = new Set(profile.characters.map(item => normalizeCharacterKey(item.key)).filter(Boolean));
  const candidateByKey = new Map<string, ProfileCharacter>();
  for (const candidate of profile.battlenet?.candidateCharacters || []) {
    const key = normalizeCharacterKey(candidate.key);
    if (key && !candidateByKey.has(key)) candidateByKey.set(key, candidate);
  }
  const availableCandidates = Array.from(candidateByKey.values()).filter(item => !addedKeys.has(normalizeCharacterKey(item.key)));
  const hasAvailableBattleNetCandidates = Boolean(availableCandidates.length && profile.battlenet?.candidateExpiresAt);
  const region = getEnabledBattleNetRegions()[0] || "eu";
  const battleNetRefreshHref = `/api/auth/battlenet/start?region=${region}${returnPath ? `&next=${encodeURIComponent(returnPath)}` : ""}`;
  const lastSyncAt = profile.battlenet?.lastProfileViewRefreshAt || profile.battlenet?.lastCharacterRefreshAt || profile.battlenet?.lastSyncAt || null;
  return {
    availableCandidates,
    availableGuildCandidates: availableCandidates.filter(item => item.verifiedGuild),
    availableOtherCandidates: availableCandidates.filter(item => !item.verifiedGuild),
    profileGuildCharacterCount: profile.characters.filter(item => item.verifiedGuild).length,
    hasAvailableBattleNetCandidates,
    battleNetAction: battleNetActionCopy(profile, hasAvailableBattleNetCandidates),
    battleNetRefreshHref,
    battleNetCharacterActionHref: hasAvailableBattleNetCandidates ? "#profile-candidates" : battleNetRefreshHref,
    battleNetLastSyncLabel: formatStableUkCompactDate(lastSyncAt),
    bulkFormId: "profile-candidate-bulk-add",
  };
}

export type CharacterManagementModel = ReturnType<typeof characterManagementModel>;
