import "server-only";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canManageGroups } from "@/lib/permissions";
import { listDashboardProfilePage, profileDirectoryFilters } from "@/lib/profileDirectory";
import { fetchDiscordGuildMembersCachedForUi } from "@/lib/discordAdmin";
import { listRaidDiscordPreferences } from "@/lib/raidDiscordPresets";

export async function loadProfileDirectory({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getSession({ live: true });
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageGroups(user)) redirect("/access-denied?reason=profiles&from=/profiles");

  const params = await searchParams;
  const filters = profileDirectoryFilters({ query: params.q, link: params.link, role: params.role, sort: params.sort });
  const { query, link: linkFilter, role: roleFilter, sort } = filters;
  const result = await listDashboardProfilePage({ viewer: user, ...filters, cursor: params.cursor });
  const { profiles, total, characterCount, linkedCount: linkedBattleNetCount } = result;
  const hasDiscordProfiles = profiles.some((profile) =>
    profile.provider === "discord" && /^\d{16,25}$/.test(profile.providerUserId)
  );
  const liveDiscordAvatars = new Map<string, string>();
  if (hasDiscordProfiles) {
    const members = await fetchDiscordGuildMembersCachedForUi().catch(() => []);
    for (const member of members) {
      if (member.avatarUrl) liveDiscordAvatars.set(member.userId, member.avatarUrl);
    }
  }
  const canManageCleanup = Boolean(user.isServerOwner);
  // Saved Discord raid preferences are not a member directory. Admin-only.
  const raidPreferences = await listRaidDiscordPreferences(100).catch(() => []);
  const hasFilters = Boolean(query || linkFilter !== "all" || roleFilter !== "all" || sort !== "activity");
  const paginationState = filters;

  return { user, params, filters, result, profiles, total, characterCount, linkedBattleNetCount, liveDiscordAvatars, canManageCleanup, raidPreferences, hasFilters, paginationState };
}
export type ProfileDirectoryModel = Awaited<ReturnType<typeof loadProfileDirectory>>;
