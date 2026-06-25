import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { fetchDiscordGuildSnapshot, getDiscordGuildId, updateGuildMemberNickname } from "@/lib/discordAdmin";
import { buildProfileDiscordNicknamePlan, getProfileById, markProfileDiscordNicknameSynced } from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, rateLimitResponse, safeErrorMessage, verifyTrustedOrigin } from "@/lib/security";
import { profileActionReturnTo, redirectToProfileAction } from "@/lib/profileActionRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectToProfile(request: NextRequest, profileId: string, status: string, returnTo?: string) {
  return redirectToProfileAction(request, profileId, "characterStatus", status, returnTo, `/profile/${profileId}/settings`);
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session?.profileId) return NextResponse.redirect(new URL("/login", request.url), 303);

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-discord-nickname:${session.profileId}:${ip}`, 10, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}/settings`);

  try {
    const profile = await getProfileById(session.profileId);
    if (!profile) return redirectToProfile(request, session.profileId, "discord_nick_profile_missing", returnTo);
    if (profile.provider !== "discord" || !/^\d{16,25}$/.test(profile.providerUserId)) {
      return redirectToProfile(request, session.profileId, "discord_nick_not_discord", returnTo);
    }

    const guildId = getDiscordGuildId();
    if (!guildId) return redirectToProfile(request, session.profileId, "discord_nick_failed", returnTo);

    const guild = await fetchDiscordGuildSnapshot().catch(() => null);
    if (guild?.ownerId && guild.ownerId === profile.providerUserId) {
      return redirectToProfile(request, session.profileId, "discord_nick_owner", returnTo);
    }

    const nicknamePolicy = await getGuildNicknamePolicy();
    const nicknamePlan = buildProfileDiscordNicknamePlan(profile, nicknamePolicy.template);
    const nickname = nicknamePlan.value;
    if (!nickname) return redirectToProfile(request, session.profileId, "discord_nick_name_missing", returnTo);

    await updateGuildMemberNickname({
      guildId,
      userId: profile.providerUserId,
      nickname,
      reason: `Mistblossom profile nickname sync: ${profile.profileId}`,
    });
    await markProfileDiscordNicknameSynced(profile.profileId, nickname, nicknamePlan).catch(() => null);

    logDashboardEvent("info", "profile.discord_nickname.synced", request, {
      profileId: profile.profileId,
      nickname,
      characters: nicknamePlan.characterNames,
      truncated: nicknamePlan.truncated,
    });
    return redirectToProfile(request, session.profileId, nicknamePlan.truncated ? "discord_nick_synced_short" : "discord_nick_synced", returnTo);
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("warn", "profile.discord_nickname.failed", request, { profileId: session.profileId, message });
    if (/Discord API\s+403|Missing Permissions|50013/i.test(message)) {
      return redirectToProfile(request, session.profileId, "discord_nick_hierarchy", returnTo);
    }
    return redirectToProfile(request, session.profileId, "discord_nick_failed", returnTo);
  }
}
