import "server-only";

import { getEnabledBattleNetRegions } from "@/lib/battlenet";
import { normalizeCharacterKey } from "@/lib/wowCharacters";
import { listProfileRaidSignups } from "@/lib/raids";
import { formatStableUkCompactDate } from "@/lib/stableUiText";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { fetchDiscordGuildMemberSnapshot } from "@/lib/discordAdmin";

import { getSession, type DashboardSession } from "@/lib/auth";
import { canViewProfileAccessDetails, dashboardRoleLabel, guildStatusLabel } from "@/lib/permissions";
import { canViewProfile, getMainCharacter, getProfilePublicName, getProfileRaidRole, getProfileById, profileNeedsSettingsSetup, profileSettingsSetupPath, profileFromSession, upsertProfileFromSession, type DashboardProfile, type ProfileCharacter } from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { notFound, redirect } from "next/navigation";

function battleNetActionCopy(
  profile: DashboardProfile,
  hasFreshBattleNetSession: boolean,
) {
  if (hasFreshBattleNetSession) {
    return {
      eyebrow: "Готово до додавання",
      title: "Додати персонажів",
      hint: "Вибери потрібних зі свіжого списку",
    };
  }
  if (profile.battlenet?.linked) {
    return {
      eyebrow: "Battle.net підключено",
      title: "Оновити список",
      hint: "Потрібно для нових або оновлених персонажів",
    };
  }
  return {
    eyebrow: "Battle.net не підключено",
    title: "Підключити Battle.net",
    hint: "Знайде гільдійних та інших персонажів Battle.net",
  };
}

export async function loadProfileOverview({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
    throw new Error("Unauthorized");
  }
  const viewer: DashboardSession = session;

  const [{ profileId }, query, nicknamePolicy, apiSettings] = await Promise.all([
    params,
    searchParams,
    getGuildNicknamePolicy(),
    getDashboardApiSettings(),
  ]);
  const rulesReturnToken = String(
    Array.isArray(query.rt) ? query.rt[0] : query.rt || "",
  ).trim();
  const isRulesReturn =
    String(Array.isArray(query.from) ? query.from[0] : query.from || "") ===
      "rules" && Boolean(rulesReturnToken);
  const profileRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}?from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const settingsRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}/settings?setup=1&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const rulesReviewPath = isRulesReturn
    ? `/rules/accept?rt=${encodeURIComponent(rulesReturnToken)}&status=incomplete`
    : "";
  const initialProfile = await getProfileById(profileId);

  const isOwnProfile = Boolean(
    viewer.profileId && viewer.profileId === profileId,
  );
  if (initialProfile && !canViewProfile(viewer, profileId, initialProfile)) {
    notFound();
  }
  if (!initialProfile && !isOwnProfile && !canViewProfile(viewer, profileId)) {
    notFound();
  }

  let profile = initialProfile;
  let storageWarning = "";

  if (!profile && isOwnProfile) {
    const result = await upsertProfileFromSession(viewer).catch(() => null);
    profile = result?.profile || { ...profileFromSession(viewer), profileId };
    if (!result?.stored) {
      storageWarning =
        "Профіль тимчасово показано з поточної сесії. Частина даних може оновитися після повторного входу.";
    }
  }

  if (!profile) {
    notFound();
  }

  if (isOwnProfile && profileNeedsSettingsSetup(profile)) {
    const setupPath = profileSettingsSetupPath(profile.profileId);
    redirect(
      isRulesReturn
        ? `${setupPath}&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
        : setupPath,
    );
  }

  const mainCharacter = getMainCharacter(profile);
  const selectedRaidRole = getProfileRaidRole(profile);
  const enabledBattleNetRegions = getEnabledBattleNetRegions();
  const canManageCharacters = isOwnProfile;
  const canViewPrivateProfileBlocks =
    isOwnProfile || canViewProfileAccessDetails(viewer);
  const addedKeys = new Set(
    profile.characters
      .map((item) => normalizeCharacterKey(item.key))
      .filter(Boolean),
  );
  const candidateByKey = new Map<string, ProfileCharacter>();
  for (const candidate of profile.battlenet?.candidateCharacters || []) {
    const key = normalizeCharacterKey(candidate.key);
    if (key && !candidateByKey.has(key)) candidateByKey.set(key, candidate);
  }
  const availableCandidates = Array.from(candidateByKey.values()).filter(
    (item) => !addedKeys.has(normalizeCharacterKey(item.key)),
  );
  const availableGuildCandidates = availableCandidates.filter(
    (item) => item.verifiedGuild,
  );
  const availableOtherCandidates = availableCandidates.filter(
    (item) => !item.verifiedGuild,
  );
  const profileGuildCharacterCount = profile.characters.filter(
    (item) => item.verifiedGuild,
  ).length;
  const hasAvailableBattleNetCandidates = Boolean(
    availableCandidates.length && profile.battlenet?.candidateExpiresAt,
  );
  const hasFreshBattleNetSession = hasAvailableBattleNetCandidates;
  const primaryBattleNetRegion = enabledBattleNetRegions[0] || "eu";
  const battleNetAction = battleNetActionCopy(
    profile,
    hasFreshBattleNetSession,
  );
  const battleNetRefreshHref = `/api/auth/battlenet/start?region=${primaryBattleNetRegion}${profileRulesReturnPath ? `&next=${encodeURIComponent(profileRulesReturnPath)}` : ""}`;
  const battleNetCharacterActionHref = hasAvailableBattleNetCandidates
    ? "#profile-candidates"
    : battleNetRefreshHref;
  const battleNetLastSyncAt =
    profile.battlenet?.lastProfileViewRefreshAt ||
    profile.battlenet?.lastCharacterRefreshAt ||
    profile.battlenet?.lastSyncAt ||
    null;
  const battleNetLastSyncLabel = formatStableUkCompactDate(battleNetLastSyncAt);
  const bulkFormId = "profile-candidate-bulk-add";
  const publicNamePreview = getProfilePublicName(
    profile,
    nicknamePolicy.template,
  );
  const guildStatus = guildStatusLabel(profile.role);
  const [raidResult, discordMember] = await Promise.all([
    canViewPrivateProfileBlocks
      ? listProfileRaidSignups(profile).then(items => ({ items, unavailable: false })).catch(() => ({ items: [], unavailable: true }))
      : Promise.resolve({ items: [], unavailable: false }),
    profile.provider === "discord" && /^\d{16,25}$/.test(profile.providerUserId)
      ? fetchDiscordGuildMemberSnapshot(profile.providerUserId).catch(() => null)
      : Promise.resolve(null),
  ]);
  const raidSignups = raidResult.items;
  const raidSignupsUnavailable = raidResult.unavailable;
  const accountStatusLabel = dashboardRoleLabel(profile.role);
  const liveDiscordAvatarUrl = discordMember?.avatarUrl || null;
  const profileAvatarUrl = liveDiscordAvatarUrl || profile.avatarUrl || null;
  const visibleCharacters = [...profile.characters].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (a.verifiedGuild !== b.verifiedGuild) return a.verifiedGuild ? -1 : 1;
    return a.name.localeCompare(b.name, "uk");
  });
  return { viewer, profile, query, isOwnProfile, isRulesReturn, profileRulesReturnPath, settingsRulesReturnPath, rulesReviewPath, mainCharacter, selectedRaidRole, canManageCharacters, canViewPrivateProfileBlocks, availableCandidates, availableGuildCandidates, availableOtherCandidates, profileGuildCharacterCount, hasAvailableBattleNetCandidates, battleNetAction, battleNetRefreshHref, battleNetCharacterActionHref, battleNetLastSyncLabel, bulkFormId, publicNamePreview, guildStatus, raidSignups, raidSignupsUnavailable, accountStatusLabel, profileAvatarUrl, visibleCharacters, storageWarning, apiSettings };
}

export type ProfileOverviewModel = Awaited<ReturnType<typeof loadProfileOverview>>;
