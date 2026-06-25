import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  addGuildMemberRoles,
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordGuildSnapshot,
  getDiscordGuildId,
  updateGuildMemberNickname,
} from "@/lib/discordAdmin";
import {
  buildProfileDiscordNicknamePlan,
  getProfileById,
  markProfileDiscordNicknameSynced,
} from "@/lib/profiles";
import {
  markRulesOnboardingCompleted,
  parseRulesRoleTokenDetails,
  rulesOnboardingStatus,
} from "@/lib/rulesOnboarding";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { checkGeoAccess } from "@/lib/geoAccessPolicy";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  verifyTrustedOrigin,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectToToken(request: NextRequest, token: string, status: string) {
  const url = new URL("/rules/accept", request.url);
  if (token) url.searchParams.set("rt", token);
  url.searchParams.set("status", status);
  const response = NextResponse.redirect(url, 303);
  for (const [key, value] of Object.entries(noStoreHeaders()))
    response.headers.set(key, value);
  return response;
}

function rulesTokenFromReferrer(request: NextRequest) {
  const referrer =
    request.headers.get("referer") || request.headers.get("referrer") || "";
  if (!referrer) return "";
  try {
    const url = new URL(referrer, request.url);
    if (
      url.origin !== new URL(request.url).origin ||
      url.pathname !== "/rules/accept"
    )
      return "";
    return url.searchParams.get("rt") || "";
  } catch {
    return "";
  }
}

async function completeAuthenticatedRulesOnboarding(params: {
  request: NextRequest;
  token: string;
  profileId: string;
  roleIds: string[];
  ip: string;
}) {
  const { request, token, profileId, roleIds, ip } = params;
  const limit = checkRateLimit(
    `rules-accept-complete:${profileId}:${ip}`,
    10,
    10 * 60 * 1000,
  );
  if (!limit.ok) return redirectToToken(request, token, "rate_limit");

  try {
    const profile = await getProfileById(profileId);
    const nicknamePolicy = await getGuildNicknamePolicy();
    const onboarding = rulesOnboardingStatus(profile, nicknamePolicy.template);
    if (!profile || !onboarding.complete) {
      logDashboardEvent("warn", "rules.onboarding.incomplete", request, {
        profileId,
        missing: onboarding.missing.map((step) => step.key),
      });
      return redirectToToken(request, token, "incomplete");
    }
    if (
      profile.provider !== "discord" ||
      !/^\d{16,25}$/.test(profile.providerUserId)
    ) {
      return redirectToToken(request, token, "not_discord_profile");
    }

    const guildId = getDiscordGuildId();
    if (!guildId)
      return redirectToToken(request, token, "discord_not_configured");

    const guild = await fetchDiscordGuildSnapshot().catch(() => null);
    const nicknamePlan = buildProfileDiscordNicknamePlan(
      profile,
      nicknamePolicy.template,
    );
    const nickname = nicknamePlan.value;
    let nicknameSynced = false;
    const isGuildOwner = Boolean(
      guild?.ownerId && guild.ownerId === profile.providerUserId,
    );

    if (nickname && !isGuildOwner) {
      try {
        await updateGuildMemberNickname({
          guildId,
          userId: profile.providerUserId,
          nickname,
          reason: `Mistblossom rules registration nickname: ${profile.profileId}`,
        });
        await markProfileDiscordNicknameSynced(
          profile.profileId,
          nickname,
          nicknamePlan,
        ).catch(() => null);
        nicknameSynced = true;
      } catch (error) {
        logDashboardEvent("warn", "rules.onboarding.nickname_failed", request, {
          profileId: profile.profileId,
          message: safeErrorMessage(error),
        });
      }
    }

    await addGuildMemberRoles({
      guildId,
      userId: profile.providerUserId,
      roleIds,
      reason: `Rules onboarding completed by ${profile.displayName || profile.providerUserId}`,
    });
    await markRulesOnboardingCompleted(profile.profileId, {
      roleIds,
      nickname: nicknameSynced ? nickname : null,
    });

    logDashboardEvent("info", "rules.onboarding.completed", request, {
      profileId: profile.profileId,
      roles: roleIds.length,
      nicknameSynced,
      nicknameManualReason: isGuildOwner
        ? "guild_owner"
        : nickname && !nicknameSynced
          ? "discord_denied"
          : null,
    });
    return redirectToToken(
      request,
      token,
      nicknameSynced
        ? "completed"
        : isGuildOwner
          ? "completed_owner_nickname_manual"
          : "completed_nickname_manual",
    );
  } catch (error) {
    logDashboardEvent("error", "rules.onboarding.complete_failed", request, {
      profileId,
      message: safeErrorMessage(error),
    });
    return redirectToToken(request, token, "failed");
  }
}

async function completePublicRulesAcceptance(params: {
  request: NextRequest;
  token: string;
  discordUserId: string;
  roleIds: string[];
  ip: string;
}) {
  const { request, token, discordUserId, roleIds, ip } = params;
  const limit = checkRateLimit(
    `rules-accept-public:${discordUserId}:${ip}`,
    8,
    10 * 60 * 1000,
  );
  if (!limit.ok) return redirectToToken(request, token, "rate_limit");

  const guildId = getDiscordGuildId();
  if (!guildId) return redirectToToken(request, token, "discord_not_configured");

  try {
    const member = await fetchDiscordGuildMemberSnapshot(discordUserId, guildId).catch(
      () => null,
    );
    if (!member) {
      logDashboardEvent("warn", "rules.public.member_missing", request, {
        userId: discordUserId,
        roles: roleIds.length,
      });
      return redirectToToken(request, token, "discord_member_missing");
    }

    await addGuildMemberRoles({
      guildId,
      userId: discordUserId,
      roleIds,
      reason: `Rules accepted without dashboard auth by ${member.displayName || discordUserId}`,
    });

    logDashboardEvent("info", "rules.public.completed", request, {
      userId: discordUserId,
      roles: roleIds.length,
      memberName: member.displayName || null,
    });
    return redirectToToken(request, token, "completed_public");
  } catch (error) {
    logDashboardEvent("error", "rules.public.complete_failed", request, {
      userId: discordUserId,
      roles: roleIds.length,
      message: safeErrorMessage(error),
    });
    return redirectToToken(request, token, "failed");
  }
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();
  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) {
    const fallbackToken =
      new URL(request.url).searchParams.get("rt") ||
      rulesTokenFromReferrer(request);
    return redirectToToken(request, fallbackToken, "request_too_large");
  }

  const form = await request.formData();
  const token = String(form.get("rt") || "").trim();
  const parsedToken = parseRulesRoleTokenDetails(token);
  const roleIds = parsedToken.roleIds;

  const geoDecision = await checkGeoAccess(request, "auth");
  if (geoDecision.blocked) {
    logDashboardEvent("warn", "rules.onboarding.geo_blocked", request, {
      country: geoDecision.country || null,
      reason: geoDecision.reason,
    });
    return redirectToToken(request, token, "geo_blocked");
  }

  if (!roleIds.length) return redirectToToken(request, token, "missing_role_token");

  const ip = getClientIp(request);
  const session = await getSession().catch(() => null);
  if (session?.profileId) {
    return completeAuthenticatedRulesOnboarding({
      request,
      token,
      profileId: session.profileId,
      roleIds,
      ip,
    });
  }

  if (parsedToken.discordUserId) {
    return completePublicRulesAcceptance({
      request,
      token,
      discordUserId: parsedToken.discordUserId,
      roleIds,
      ip,
    });
  }

  logDashboardEvent("warn", "rules.public.discord_user_missing", request, {
    roles: roleIds.length,
  });
  return redirectToToken(request, token, "discord_user_missing");
}
