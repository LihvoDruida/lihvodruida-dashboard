import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getDashboardUrl } from "@/lib/oauth";
import {
  BNET_OAUTH_STATE_COOKIE,
  exchangeBattleNetCode,
  fetchBattleNetGuildCharacters,
  fetchBattleNetUserInfo,
  normalizeBattleNetRegion,
} from "@/lib/battlenet";
import { recordSystemAudit } from "@/lib/accessGroups";
import {
  findProfileCharacterConflicts,
  saveBattleNetSyncState,
  upsertProfileFromSession,
} from "@/lib/profiles";
import {
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
} from "@/lib/security";
import { checkGeoAccess } from "@/lib/geoAccessPolicy";
import { safeDashboardReturnPath } from "@/lib/dashboardRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getOAuthStateParts(state: string) {
  return String(state || "").split(".");
}

function getRegionFromOAuthState(state: string) {
  const parts = getOAuthStateParts(state);
  return normalizeBattleNetRegion(parts.length >= 3 ? parts[1] : null);
}

function getNextPathFromOAuthState(state: string) {
  const parts = getOAuthStateParts(state);
  const encoded = parts.length >= 4 ? parts.slice(3).join(".") : "";
  if (!encoded) return "";
  try {
    return safeDashboardReturnPath(
      Buffer.from(encoded, "base64url").toString("utf8"),
      { scope: "battlenet-auth", fallback: "" },
    );
  } catch {
    return "";
  }
}

function redirectToProfile(profileId: string, status: string, nextPath = "") {
  const targetPath = safeDashboardReturnPath(nextPath, {
    scope: "battlenet-auth",
    fallback: "",
  });
  const target = targetPath
    ? new URL(`${getDashboardUrl()}${targetPath}`)
    : new URL(`${getDashboardUrl()}/profile/${profileId}`);
  target.searchParams.set("characterStatus", status);
  const response = NextResponse.redirect(target.toString(), 303);
  for (const [key, value] of Object.entries(noStoreHeaders()))
    response.headers.set(key, value);
  return response;
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

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.profileId) {
    return NextResponse.redirect(
      `${getDashboardUrl()}/login?error=session_required`,
      303,
    );
  }

  logDashboardEvent("info", "auth.battlenet.callback", request, {
    profileId: session.profileId,
  });

  const geoDecision = await checkGeoAccess(request, "auth");
  if (geoDecision.blocked) {
    logDashboardEvent("warn", "auth.battlenet.callback.geo_blocked", request, {
      country: geoDecision.country || null,
      reason: geoDecision.reason,
    });
    return redirectToProfile(session.profileId, "geo_blocked");
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(
    `battlenet-oauth-callback:${session.profileId}:${ip}`,
    20,
    10 * 60 * 1000,
  );
  if (!limit.ok) return redirectToProfile(session.profileId, "rate_limit");

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  const store = await cookies();
  const expectedState = store.get(BNET_OAUTH_STATE_COOKIE)?.value || "";
  store.delete(BNET_OAUTH_STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    logDashboardEvent(
      "warn",
      "auth.battlenet.callback.state_mismatch",
      request,
      {
        profileId: session.profileId,
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasExpectedState: Boolean(expectedState),
      },
    );
    return redirectToProfile(session.profileId, "bnet_state");
  }

  try {
    await upsertProfileFromSession(session);
    const region = getRegionFromOAuthState(state);
    const token = await exchangeBattleNetCode(code, region);
    const [scan, account] = await Promise.all([
      fetchBattleNetGuildCharacters(token.access_token, region),
      fetchBattleNetUserInfo(token.access_token, region).catch(() => null),
    ]);

    const conflicts = await findProfileCharacterConflicts(
      session.profileId,
      scan.characters || [],
      { excludeProviderUserId: session.id },
    ).catch((error) => {
      logDashboardEvent(
        "error",
        "auth.battlenet.callback.character_conflict_check_failed",
        request,
        {
          profileId: session.profileId,
          message: safeErrorMessage(error),
        },
      );
      throw error;
    });

    if (conflicts.length) {
      logDashboardEvent(
        "warn",
        "auth.battlenet.callback.blocked_duplicate_characters",
        request,
        {
          profileId: session.profileId,
          region: scan.region,
          totalCharacters: scan.totalCharacters,
          conflicts: conflictAuditSummary(conflicts),
        },
      );
      await recordSystemAudit("auth.battlenet.blocked_duplicate_characters", {
        status: "error",
        summary:
          "Battle.net привʼязку заблоковано: персонажі вже є в іншому профілі.",
        profileId: session.profileId,
        region: scan.region,
        totalCharacters: scan.totalCharacters,
        conflicts: conflictAuditSummary(conflicts),
      }).catch(() => false);
      return redirectToProfile(
        session.profileId,
        "bnet_duplicate_account",
        getNextPathFromOAuthState(state),
      );
    }

    await saveBattleNetSyncState(session.profileId, scan, account);

    logDashboardEvent("info", "auth.battlenet.callback.success", request, {
      profileId: session.profileId,
      region: scan.region,
      totalCharacters: scan.totalCharacters,
      scannedCharacters: scan.scannedCharacters,
      eligibleCharacters: scan.eligibleCharacters,
      guildCharacters: scan.guildCharacters,
      otherCharacters: scan.otherCharacters,
      concurrency: scan.concurrency,
      failedCharacters: scan.failedCharacters,
      fallbackCharacters: scan.fallbackCharacters,
      durationMs: scan.durationMs,
    });

    return redirectToProfile(
      session.profileId,
      scan.characters.length ? "bnet_connected" : "bnet_no_characters",
      getNextPathFromOAuthState(state),
    );
  } catch (error) {
    logDashboardEvent("error", "auth.battlenet.callback.failed", request, {
      profileId: session.profileId,
      message: safeErrorMessage(error),
    });
    return redirectToProfile(
      session.profileId,
      "bnet_failed",
      getNextPathFromOAuthState(state),
    );
  }
}
