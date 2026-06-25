import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  applyAccessGroupToSession,
  recordSystemAudit,
  resolveAccessGroupFromDiscord,
} from "@/lib/accessGroups";
import {
  fetchDiscordGuildBanSnapshot,
  fetchDiscordGuildSnapshot,
} from "@/lib/discordAdmin";
import {
  LEGACY_OAUTH_STATE_COOKIE,
  LEGACY_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createStableProfileId,
  parseOAuthStateToken,
} from "@/lib/auth";
import { setSession } from "@/lib/session";
import {
  exchangeDiscordCode,
  fetchDiscordGuildMember,
  fetchDiscordUser,
  getDashboardUrl,
} from "@/lib/oauth";
import {
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
} from "@/lib/security";
import { checkGeoAccess, geoAccessDeniedResponse } from "@/lib/geoAccessPolicy";
import {
  evaluateAuthAccessPolicy,
  getAuthAccessPolicy,
} from "@/lib/authAccessPolicy";
import {
  findProfileCharacterConflicts,
  getProfileById,
  profileFromSession,
  profileNeedsSettingsSetup,
  profileSettingsSetupPath,
  upsertProfileFromSession,
} from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import {
  normalizeRulesAcceptPath,
  parseRulesRoleIdsFromUrl,
  rulesOnboardingStatus,
} from "@/lib/rulesOnboarding";
import { deleteDashboardProfilesByDiscordUserId } from "@/lib/profileCleanup";
import { safeDashboardReturnPath } from "@/lib/dashboardRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOGIN_NEXT_COOKIE = "__Host-mistblossom_next";

const OAUTH_NONCE_COOKIE_MAX_AGE = 60 * 10;
const MAX_PARALLEL_OAUTH_FLOWS = 8;

function normalizeOAuthNonces(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter((item): item is string => Boolean(item)),
    ),
  ).slice(-MAX_PARALLEL_OAUTH_FLOWS);
}

function parseRememberedOAuthNonces(value?: string | null): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { nonces?: unknown }).nonces)
        ? (parsed as { nonces: unknown[] }).nonces
        : [];
    return normalizeOAuthNonces(list);
  } catch {
    // Old deployments stored the whole state string directly in the cookie.
    return [raw];
  }
}

function serializeRememberedOAuthNonces(nonces: string[]) {
  return JSON.stringify({ v: 1, nonces: normalizeOAuthNonces(nonces) });
}

function expireOAuthCookie(
  response: NextResponse,
  name: string,
  secure: boolean,
) {
  response.cookies.set(name, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function rememberRemainingOAuthNonces(
  response: NextResponse,
  nonces: string[],
) {
  const clean = Array.from(
    new Set(nonces.map((item) => String(item || "").trim()).filter(Boolean)),
  ).slice(-MAX_PARALLEL_OAUTH_FLOWS);
  if (clean.length) {
    response.cookies.set(
      OAUTH_STATE_COOKIE,
      serializeRememberedOAuthNonces(clean),
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: OAUTH_NONCE_COOKIE_MAX_AGE,
      },
    );
  } else {
    expireOAuthCookie(response, OAUTH_STATE_COOKIE, true);
  }
  expireOAuthCookie(response, LEGACY_OAUTH_STATE_COOKIE, false);
  expireOAuthCookie(response, LOGIN_NEXT_COOKIE, true);
}

function expireSessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(LEGACY_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function isDiscordOAuthMemberMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    /Discord guild member (?:403|404):/i.test(message) ||
    /Unknown Guild Member|Missing Access|access_denied/i.test(message)
  );
}

function conflictAuditSummary(
  conflicts: Awaited<ReturnType<typeof findProfileCharacterConflicts>>,
) {
  return conflicts.slice(0, 5).map((item) => ({
    profileId: item.profileId,
    displayName: item.displayName,
    characterKey: item.characterKey,
    characterName: item.characterName,
    realmName: item.realmName,
  }));
}

function loginRedirect(error: string) {
  const response = NextResponse.redirect(
    `${getDashboardUrl()}/login?error=${encodeURIComponent(error)}`,
    303,
  );
  for (const [key, value] of Object.entries(noStoreHeaders()))
    response.headers.set(key, value);
  return response;
}

export async function GET(request: NextRequest) {
  logDashboardEvent("info", "auth.discord.callback", request);

  const geoDecision = await checkGeoAccess(request, "auth");
  if (geoDecision.blocked) return geoAccessDeniedResponse(request, geoDecision);

  const ip = getClientIp(request);
  const limit = checkRateLimit(
    `discord-oauth-callback:${ip}`,
    30,
    10 * 60 * 1000,
  );
  if (!limit.ok) {
    logDashboardEvent("warn", "auth.discord.callback.rate_limited", request, {
      resetAt: limit.resetAt,
    });
    return loginRedirect("rate_limit");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  const store = await cookies();
  const rawStateCookie =
    store.get(OAUTH_STATE_COOKIE)?.value ||
    store.get(LEGACY_OAUTH_STATE_COOKIE)?.value ||
    "";
  const rememberedNonces = parseRememberedOAuthNonces(rawStateCookie);
  const parsedState = await parseOAuthStateToken(state);
  const legacyStateMatches = Boolean(state && rememberedNonces.includes(state));
  const nonceMatches = Boolean(
    parsedState?.nonce && rememberedNonces.includes(parsedState.nonce),
  );
  const nextPath = safeDashboardReturnPath(
    parsedState?.nextPath || store.get(LOGIN_NEXT_COOKIE)?.value,
    { scope: "discord-auth", fallback: "" },
  );
  const rulesNextPath = normalizeRulesAcceptPath(nextPath);
  const rulesRoleIds = parseRulesRoleIdsFromUrl(rulesNextPath);
  const hasRulesOnboardingRoleToken = Boolean(
    rulesNextPath && rulesRoleIds.length,
  );
  const remainingNonces = parsedState?.nonce
    ? rememberedNonces.filter(
        (item) => item !== parsedState.nonce && item !== state,
      )
    : rememberedNonces.filter((item) => item !== state);

  if (!code || !state || (!legacyStateMatches && !nonceMatches)) {
    logDashboardEvent("warn", "auth.discord.callback.state_mismatch", request, {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasExpectedState: rememberedNonces.length > 0,
      parsedState: Boolean(parsedState),
      rememberedStates: rememberedNonces.length,
    });
    const response = loginRedirect("oauth_state");
    rememberRemainingOAuthNonces(response, remainingNonces);
    return response;
  }

  try {
    const token = await exchangeDiscordCode(code);
    const user = await fetchDiscordUser(token.access_token);
    const userId = String(user.id || "");
    const profileId = await createStableProfileId("discord", userId);

    const ban = await fetchDiscordGuildBanSnapshot(userId).catch((error) => {
      logDashboardEvent(
        "error",
        "auth.discord.callback.ban_check_failed",
        request,
        {
          userId,
          message: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    });

    if (ban) {
      const deleted = await deleteDashboardProfilesByDiscordUserId(
        userId,
      ).catch((error) => ({
        deleted: 0,
        profileIds: [] as string[],
        reason:
          error instanceof Error
            ? error.message
            : String(error || "delete-failed"),
      }));
      logDashboardEvent(
        "warn",
        "auth.discord.callback.blocked_banned",
        request,
        {
          userId,
          profileId,
          deletedProfiles: deleted.deleted,
          deletedProfileIds: deleted.profileIds,
          banReason: ban.reason,
        },
      );
      await recordSystemAudit("auth.discord.blocked_banned", {
        status: "warning",
        summary: "Discord-вхід заблоковано: акаунт у бані сервера.",
        userId,
        profileId,
        deletedProfiles: deleted.deleted,
        deletedProfileIds: deleted.profileIds,
        banReason: ban.reason,
      }).catch(() => false);
      const response = loginRedirect("discord_banned");
      expireSessionCookies(response);
      rememberRemainingOAuthNonces(response, remainingNonces);
      return response;
    }

    let member: Awaited<ReturnType<typeof fetchDiscordGuildMember>>;
    try {
      member = await fetchDiscordGuildMember(token.access_token);
    } catch (error) {
      if (isDiscordOAuthMemberMissing(error)) {
        const deleted = await deleteDashboardProfilesByDiscordUserId(
          userId,
        ).catch((deleteError) => ({
          deleted: 0,
          profileIds: [] as string[],
          reason:
            deleteError instanceof Error
              ? deleteError.message
              : String(deleteError || "delete-failed"),
        }));
        logDashboardEvent(
          "warn",
          "auth.discord.callback.profile_deleted_not_member",
          request,
          {
            userId,
            profileId,
            deletedProfiles: deleted.deleted,
            deletedProfileIds: deleted.profileIds,
            message: error instanceof Error ? error.message : String(error),
          },
        );
        await recordSystemAudit("auth.discord.profile_deleted_not_member", {
          status: "warning",
          summary: "Профіль видалено: Discord-акаунта вже немає на сервері.",
          userId,
          profileId,
          deletedProfiles: deleted.deleted,
          deletedProfileIds: deleted.profileIds,
        }).catch(() => false);
        const response = loginRedirect("not_guild_member");
        expireSessionCookies(response);
        rememberRemainingOAuthNonces(response, remainingNonces);
        return response;
      }
      throw error;
    }

    const existingProfile = await getProfileById(profileId).catch(() => null);
    if (existingProfile?.characters?.length) {
      const conflicts = await findProfileCharacterConflicts(
        profileId,
        existingProfile.characters,
        { excludeProviderUserId: userId },
      ).catch((error) => {
        logDashboardEvent(
          "warn",
          "auth.discord.callback.character_conflict_check_unavailable",
          request,
          {
            userId,
            profileId,
            message: error instanceof Error ? error.message : String(error),
          },
        );
        return [];
      });
      if (conflicts.length) {
        logDashboardEvent(
          "warn",
          "auth.discord.callback.blocked_duplicate_characters",
          request,
          {
            userId,
            profileId,
            conflicts: conflictAuditSummary(conflicts),
          },
        );
        await recordSystemAudit("auth.discord.blocked_duplicate_characters", {
          status: "error",
          summary:
            "Discord-вхід заблоковано: персонажі вже привʼязані до іншого профілю.",
          userId,
          profileId,
          conflicts: conflictAuditSummary(conflicts),
        }).catch(() => false);
        const response = loginRedirect("duplicate_characters");
        expireSessionCookies(response);
        rememberRemainingOAuthNonces(response, remainingNonces);
        return response;
      }
    }

    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : null;

    const discordRoleIds = Array.isArray(member.roles)
      ? member.roles
          .map((roleId: unknown) => String(roleId || "").trim())
          .filter(Boolean)
      : [];
    const guild = await fetchDiscordGuildSnapshot().catch(() => null);
    const authPolicy = await getAuthAccessPolicy();
    const authDecision = evaluateAuthAccessPolicy(authPolicy, {
      userId: String(user.id),
      ownerId: guild?.ownerId || null,
      roleIds: discordRoleIds,
    });
    if (!authDecision.allowed && !hasRulesOnboardingRoleToken) {
      logDashboardEvent(
        "warn",
        "auth.discord.callback.required_role_missing",
        request,
        {
          userId: user.id,
          profileId,
          reason: authDecision.reason,
          requiredRoles: authDecision.requiredRoleIds.length,
          memberRoles: discordRoleIds.length,
        },
      );
      await recordSystemAudit("auth.discord.required_role_missing", {
        status: "warning",
        summary:
          authDecision.reason === "no_required_role_configured"
            ? "Discord-вхід заблоковано: обовʼязкова роль для входу не налаштована."
            : "Discord-вхід заблоковано: у користувача немає обовʼязкової ролі сервера.",
        userId: String(user.id),
        profileId,
        reason: authDecision.reason,
        requiredRoleIds: authDecision.requiredRoleIds,
      }).catch(() => false);
      const response = loginRedirect(
        authDecision.reason === "no_required_role_configured"
          ? "auth_role_not_configured"
          : "required_discord_role",
      );
      expireSessionCookies(response);
      rememberRemainingOAuthNonces(response, remainingNonces);
      return response;
    }

    if (!authDecision.allowed && hasRulesOnboardingRoleToken) {
      logDashboardEvent(
        "info",
        "auth.discord.callback.rules_onboarding_role_gate_deferred",
        request,
        {
          userId: user.id,
          profileId,
          reason: authDecision.reason,
          requestedRuleRoles: rulesRoleIds.length,
          memberRoles: discordRoleIds.length,
        },
      );
      await recordSystemAudit(
        "auth.discord.rules_onboarding_role_gate_deferred",
        {
          status: "info",
          summary:
            "Discord-вхід продовжено для завершення правил: роль буде видана тільки після повного профілю.",
          userId: String(user.id),
          profileId,
          reason: authDecision.reason,
          requestedRoleIds: rulesRoleIds,
        },
      ).catch(() => false);
    }

    const resolved = await resolveAccessGroupFromDiscord(
      discordRoleIds,
      String(user.id),
      guild?.ownerId || null,
    );
    if (!resolved.group.permissions.includes("dashboard.view")) {
      logDashboardEvent(
        "warn",
        "auth.discord.callback.access_denied",
        request,
        { userId: user.id },
      );
      const response = loginRedirect("access_denied");
      rememberRemainingOAuthNonces(response, remainingNonces);
      return response;
    }

    const session = applyAccessGroupToSession(
      {
        provider: "discord" as const,
        id: String(user.id),
        profileId,
        name: user.global_name || user.username || String(user.id),
        role: resolved.group.role,
        avatar: avatarUrl,
        avatar_url: avatarUrl,
        discordRoleIds,
      },
      resolved.group,
      resolved.isServerOwner,
    );
    const role = session.role;

    const profileWrite = await upsertProfileFromSession(session).catch(
      (error) => {
        logDashboardEvent(
          "error",
          "auth.discord.profile_upsert_failed",
          request,
          {
            userId: user.id,
            role,
            message: error instanceof Error ? error.message : String(error),
          },
        );
        return { stored: false, reason: "write-failed" };
      },
    );
    const currentProfile = await getProfileById(session.profileId || "").catch(
      () => null,
    );
    const setupProfile = currentProfile || profileFromSession(session);
    const setupRedirectPath = profileNeedsSettingsSetup(setupProfile)
      ? profileSettingsSetupPath(session.profileId || setupProfile.profileId)
      : "";
    const nicknamePolicy = rulesNextPath
      ? await getGuildNicknamePolicy()
      : null;
    const rulesStatus = rulesNextPath
      ? rulesOnboardingStatus(setupProfile, nicknamePolicy?.template)
      : null;
    const rulesRedirectPath =
      rulesNextPath && !rulesStatus?.complete
        ? normalizeRulesAcceptPath(rulesNextPath, "incomplete")
        : rulesNextPath;

    logDashboardEvent("info", "auth.discord.callback.success", request, {
      userId: user.id,
      profileId: session.profileId,
      role,
      profileStored: profileWrite.stored,
      setupRequired: Boolean(setupRedirectPath),
      rulesOnboardingRequired: Boolean(
        rulesRedirectPath && !rulesStatus?.complete,
      ),
      rulesOnboardingMissing:
        rulesStatus?.missing.map((step) => step.key) || [],
    });

    await setSession(session);

    const redirectPath =
      rulesRedirectPath ||
      setupRedirectPath ||
      nextPath ||
      (role === "member" ? `/profile/${session.profileId}` : "/");
    const response = NextResponse.redirect(
      `${getDashboardUrl()}${redirectPath}`,
      303,
    );
    for (const [key, value] of Object.entries(noStoreHeaders()))
      response.headers.set(key, value);
    rememberRemainingOAuthNonces(response, remainingNonces);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const securityCheckFailed =
      /^Discord API (?:401|403|429|5\d\d):/i.test(message) ||
      message.includes("Discord bot token") ||
      message.includes("Discord-сервер");
    logDashboardEvent("error", "auth.discord.callback.failed", request, {
      message,
      securityCheckFailed,
    });
    const response = loginRedirect(
      securityCheckFailed ? "security_check_failed" : "discord_oauth",
    );
    rememberRemainingOAuthNonces(response, remainingNonces);
    return response;
  }
}
