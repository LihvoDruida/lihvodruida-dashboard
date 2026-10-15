import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/apiRoute";
import {
  addGuildMemberRoles,
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordRoles,
  getDiscordGuildId,
} from "@/lib/discordAdmin";
import { parseRulesRoleTokenDetails } from "@/lib/rulesOnboarding";
import { getGuildRulesDocument } from "@/lib/guildRulesDocument";
import { tokenRulesRolesAreCurrentlyAllowed } from "@/lib/discordRulesRolePolicy";
import { processNewcomerNicknameRoleGrant } from "@/lib/discordNicknameWarnings";
import { markDiscordNewcomerRulesAccepted } from "@/lib/discordNewcomerOnboarding";
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

    // Discord role PUTs are idempotent; skip already-held roles on retries.
    const missingRoleIds = roleIds.filter(id => !member.roleIds.includes(id));
    if (missingRoleIds.length) await addGuildMemberRoles({
      guildId,
      userId: discordUserId,
      roleIds: missingRoleIds,
      reason: `Rules accepted without dashboard auth by ${member.displayName || discordUserId}`,
    });
    await markDiscordNewcomerRulesAccepted(discordUserId).catch((error) => {
      logDashboardEvent("warn", "rules.public.newcomer_state_failed", request, {
        userId: discordUserId,
        message: safeErrorMessage(error),
      });
    });
    await processNewcomerNicknameRoleGrant({ userId: discordUserId, grantedRoleIds: roleIds }).catch((error) => {
      logDashboardEvent("warn", "rules.public.nickname_gate_failed", request, {
        userId: discordUserId,
        message: safeErrorMessage(error),
      });
    });

    await recordRulesDecision({ guildId, discordId: discordUserId, discordName: member.displayName, scope: "guild", action: "accepted" }).catch(error => {
      logDashboardEvent("warn", "rules.stats.record_failed", request, { userId: discordUserId, message: safeErrorMessage(error) });
    });

    logDashboardEvent("info", "rules.public.completed", request, {
      userId: discordUserId,
      roles: roleIds.length,
      newlyGrantedRoles: missingRoleIds.length,
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

  let form: FormData;
  try { form = await request.formData(); }
  catch { return redirectToToken(request, "", "failed"); }
  const token = String(form.get("rt") || "").trim();
  if (form.get("agree") !== "yes") return redirectToToken(request, token, "agreement_required");
  const parsedToken = parseRulesRoleTokenDetails(token);
  const roleIds = parsedToken.roleIds;

  if (!checkRateLimit(`rules-accept-request:${getClientIp(request)}`, 20, 10 * 60 * 1000).ok) return redirectToToken(request, token, "rate_limit");

  const geoDecision = await checkGeoAccess(request, "auth");
  if (geoDecision.blocked) {
    logDashboardEvent("warn", "rules.onboarding.geo_blocked", request, {
      country: geoDecision.country || null,
      reason: geoDecision.reason,
    });
    return redirectToToken(request, token, "geo_blocked");
  }

  if (!roleIds.length) return redirectToToken(request, token, "missing_role_token");

  const roleTokenAllowed = await tokenRulesRolesAreCurrentlyAllowed(roleIds).catch((error) => {
    logDashboardEvent("error", "rules.onboarding.role_policy_unavailable", request, {
      message: safeErrorMessage(error),
    }, { category: "security" });
    return false;
  });
  if (!roleTokenAllowed) {
    logDashboardEvent("warn", "rules.onboarding.role_token_rejected", request, {
      roleCount: roleIds.length,
      reason: "not_currently_configured",
    }, { category: "security" });
    return redirectToToken(request, token, "discord_role_not_allowed");
  }

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

  // A personal signed Discord token is the identity for this separate flow.
  // Site sessions/profile registration never select or replace its recipient.
  if (!parsedToken.discordUserId) return redirectToToken(request, token, "discord_user_missing");
  const document = await getGuildRulesDocument(roleIds).catch(error => {
    logDashboardEvent("warn", "rules.public.document_unavailable", request, { message: safeErrorMessage(error) });
    return null;
  });
  if (!document) return redirectToToken(request, token, "rules_unavailable");
  if (form.get("revision") !== document.revision) return redirectToToken(request, token, "rules_changed");
  return completePublicRulesAcceptance({ request, token, discordUserId: parsedToken.discordUserId, roleIds, ip: getClientIp(request) });
}
