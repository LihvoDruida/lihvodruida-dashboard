import "server-only";

import { getSession } from "@/lib/auth";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { characterManagementModel } from "@/services/profileCharacters";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";
import { withTimeout } from "@/lib/runtimeResilience";
import { fetchDiscordGuildMemberSnapshot, fetchDiscordGuildSnapshot, hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";

import { guildStatusLabel } from "@/lib/permissions";
import { buildProfileDiscordNickname, getMainCharacter, getProfileById, getProfilePublicName, getProfileRaidRole, getProfileServerStyleName, profileFromSession, profileSettingsSetupStatus, upsertProfileFromSession } from "@/lib/profiles";
import { notFound, redirect } from "next/navigation";

export async function loadProfileSettings({
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

  const [nicknamePolicy, query] = await Promise.all([
    getGuildNicknamePolicy().catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.profile_settings.nickname_policy_unavailable",
        {
          summary:
            "Шаблон Discord-ніку тимчасово недоступний, використано стандартний.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return {
        template: "{name} [{main}, {alt}, {alt}]",
        nicknameCleanupConcurrency: 0,
        nicknameCleanupMaxConcurrency: 4,
        nicknameReminderEnabled: false,
        nicknameReminderIntervalHours: 24,
        nicknameInvalidRecheckHours: 6,
        nicknameValidRecheckHours: 72,
        nicknameReminderCooldownHours: 72,
        nicknameReminderBatchLimit: 100,
        nicknameReminderChannelId: "",
        nicknameNewcomerGateEnabled: false,
        nicknameNewcomerRoleId: "",
        updatedAt: null,
        updatedBy: null,
      };
    }),
    searchParams,
  ]);

  const { profileId } = await params;
  const rulesReturnToken = String(
    Array.isArray(query.rt) ? query.rt[0] : query.rt || "",
  ).trim();
  const isRulesReturn =
    String(Array.isArray(query.from) ? query.from[0] : query.from || "") ===
      "rules" && Boolean(rulesReturnToken);
  const settingsRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}/settings?setup=1&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const profileRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}?from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const rulesReviewPath = isRulesReturn
    ? `/rules/accept?rt=${encodeURIComponent(rulesReturnToken)}&status=incomplete`
    : "";
  const isOwnProfile = Boolean(
    session.profileId && session.profileId === profileId,
  );
  if (!isOwnProfile) notFound();

  let profile = await getProfileById(profileId);
  let storageWarning = "";

  if (!profile) {
    const result = await upsertProfileFromSession(session).catch(() => null);
    profile = result?.profile || { ...profileFromSession(session), profileId };
    if (!result?.stored) {
      storageWarning =
        "Профіль тимчасово показано з поточної сесії. Частина даних може оновитися після повторного входу.";
    }
  }

  if (!profile) notFound();

  const mainCharacter = getMainCharacter(profile);
  const raidRolePreference = profile.raidRolePreference || null;
  const manualRaidRole =
    raidRolePreference &&
    mainCharacter &&
    raidRolePreference.characterKey === mainCharacter.key
      ? raidRolePreference.role
      : null;
  const selectedRaidRole = getProfileRaidRole(profile);
  const publicNamePreview = getProfilePublicName(
    profile,
    nicknamePolicy.template,
  );
  const serverStyleNamePreview = getProfileServerStyleName(
    profile,
    80,
    nicknamePolicy.template,
  );
  const discordNicknamePreview = buildProfileDiscordNickname(
    profile,
    nicknamePolicy.template,
  );
  const discordMemberReadable =
    profile.provider === "discord" &&
    /^\d{16,25}$/.test(profile.providerUserId) &&
    hasDiscordEmbedConfig();
  const canSyncDiscordNickname = discordMemberReadable;
  let discordOwnerLocked = false;
  let currentServerNickname: string | null = null;
  let liveDiscordMember: Awaited<
    ReturnType<typeof fetchDiscordGuildMemberSnapshot>
  > | null = null;

  if (discordMemberReadable) {
    const [guild, member] = await withTimeout(
      Promise.all([
        fetchDiscordGuildSnapshot().catch(() => null),
        fetchDiscordGuildMemberSnapshot(profile.providerUserId).catch(
          () => null,
        ),
      ]),
      1_800,
      "profile settings discord member read",
    ).catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.profile_settings.discord_live_read_failed",
        {
          summary:
            "Discord-нік не перевірено наживо, показано збережені дані профілю.",
          profileId,
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return [null, null] as const;
    });
    liveDiscordMember = member;
    discordOwnerLocked = Boolean(
      guild?.ownerId && guild.ownerId === profile.providerUserId,
    );
    currentServerNickname = member?.nick || null;
  }

  const setupStatus = profileSettingsSetupStatus(profile);
  const isSetupEntry =
    String(Array.isArray(query.setup) ? query.setup[0] : query.setup || "") ===
      "1" || setupStatus.missing.length > 0;
  const settingsPageTitle = isSetupEntry
    ? "Реєстрація профілю"
    : "Налаштування профілю";
  const guildStatus = guildStatusLabel(profile.role);
  const accountStatusLabel = guildStatus;
  // Character management lives on the settings page: Battle.net returns here.
  const characters = characterManagementModel(profile, { returnPath: settingsRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}/settings` });
  const apiSettings = await getDashboardApiSettings();
  const visibleCharacters = [...profile.characters].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (a.verifiedGuild !== b.verifiedGuild) return a.verifiedGuild ? -1 : 1;
    return a.name.localeCompare(b.name, "uk");
  });
  return { characters, apiSettings, visibleCharacters, session, profile, query, isOwnProfile, isRulesReturn, settingsRulesReturnPath, profileRulesReturnPath, rulesReviewPath, mainCharacter, manualRaidRole, selectedRaidRole, publicNamePreview, serverStyleNamePreview, discordNicknamePreview, discordMemberReadable, canSyncDiscordNickname, discordOwnerLocked, currentServerNickname, liveDiscordMember, setupStatus, isSetupEntry, settingsPageTitle, guildStatus, accountStatusLabel, storageWarning, nicknamePolicy };
}

export type ProfileSettingsModel = Awaited<ReturnType<typeof loadProfileSettings>>;
