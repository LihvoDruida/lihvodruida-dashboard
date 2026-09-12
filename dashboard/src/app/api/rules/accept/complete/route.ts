import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/apiRoute";
import { getSession } from "@/lib/auth";
import {
  addGuildMemberRoles,
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordGuildSnapshot,
  fetchDiscordRoles,
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
import { recordRulesDecision } from "@/lib/discordRulesStats";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  safeErrorMessage,
  verifyTrustedOrigin, applyNoStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectToToken(request: NextRequest, token: string, status: string) {
  const url = new URL("/rules/accept", appBaseUrl(request));
  if (token) url.searchParams.set("rt", token);
  url.searchParams.set("status", status);
  const response = NextResponse.redirect(url, 303);
  applyNoStoreHeaders(response);
  return response;
}

function rulesTokenFromReferrer(request: NextRequest) {
  const referrer =
    request.headers.get("referer") || request.headers.get("referrer") || "";
  if (!referrer) return "";
  try {
    const url = new URL(referrer, appBaseUrl(request));
    const publicOrigin = new URL(appBaseUrl(request)).origin;
    if (
      url.origin !== publicOrigin ||
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
  tokenDiscordUserId?: string | null;
  ip: string;
}) {
  const { request, token, profileId, roleIds, tokenDiscordUserId, ip } = params;
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

    if (
      tokenDiscordUserId &&
      tokenDiscordUserId !== profile.providerUserId
    ) {
      logDashboardEvent("warn", "rules.onboarding.identity_mismatch", request, {
        profileId,
        tokenUserId: tokenDiscordUserId,
        sessionUserId: profile.providerUserId,
      });
      return redirectToToken(request, token, "discord_identity_mismatch");
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

    // Запис для статистики правил. Раніше лічильник жив у Cloudflare KV і
    // його вів воркер; тепер це запис у нашій базі, який робить та сама
    // дія, що видає ролі, — тож статистика не може розійтись із фактом.
    // Помилка запису не має зривати онбординг: ролі вже видані.
    await recordRulesDecision({
      guildId,
      discordId: profile.providerUserId,
      discordName: profile.displayName || profile.providerUserId,
      scope: "guild",
      action: "accepted",
      profileId: profile.profileId,
    }).catch((error) => {
      logDashboardEvent("warn", "rules.stats.record_failed", request, {
        profileId: profile.profileId,
        message: safeErrorMessage(error),
      });
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
    let member: Awaited<ReturnType<typeof fetchDiscordGuildMemberSnapshot>>;
    try {
      member = await fetchDiscordGuildMemberSnapshot(discordUserId, guildId);
    } catch (error) {
      const message = safeErrorMessage(error);
      if (/Discord API 404|Unknown Member|10007/i.test(message)) {
        logDashboardEvent("warn", "rules.public.member_missing", request, {
          userId: discordUserId,
          roles: roleIds.length,
        });
        return redirectToToken(request, token, "discord_member_missing");
      }
      throw error;
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

  const configuredGuildId = getDiscordGuildId();
  if (
    parsedToken.discordGuildId &&
    configuredGuildId &&
    parsedToken.discordGuildId !== configuredGuildId
  ) {
    logDashboardEvent("warn", "rules.onboarding.guild_mismatch", request, {
      tokenGuildId: parsedToken.discordGuildId,
      configuredGuildId,
    });
    return redirectToToken(request, token, "discord_guild_mismatch");
  }

  try {
    const roles = await fetchDiscordRoles();
    const availableRoleIds = new Set(roles.map((role) => role.id));
    const missingRoleIds = roleIds.filter((roleId) => !availableRoleIds.has(roleId));
    if (missingRoleIds.length) {
      logDashboardEvent("warn", "rules.onboarding.role_missing", request, {
        missingRoleIds,
      });
      return redirectToToken(request, token, "discord_role_missing");
    }
  } catch (error) {
    // Discord itself remains the source of truth during PUT. A temporary role-list
    // read failure should not block an otherwise valid acceptance attempt.
    logDashboardEvent("warn", "rules.onboarding.role_preflight_failed", request, {
      message: safeErrorMessage(error),
    });
  }

  const ip = getClientIp(request);
  const session = await getSession().catch(() => null);
  if (session?.profileId) {
    return completeAuthenticatedRulesOnboarding({
      request,
      token,
      profileId: session.profileId,
      roleIds,
      tokenDiscordUserId: parsedToken.discordUserId,
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
