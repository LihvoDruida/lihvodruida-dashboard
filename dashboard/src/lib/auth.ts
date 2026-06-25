import { cookies } from "next/headers";
import {
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordGuildSnapshot,
} from "@/lib/discordAdmin";
import {
  applyAccessGroupToSession,
  hasPermission,
  recordSystemAudit,
  resolveAccessGroupFromDiscord,
} from "@/lib/accessGroups";
import { deleteDashboardProfilesByDiscordUserId } from "@/lib/profileCleanup";
import { createStableProfileId } from "@/lib/profileIds";
import { logDashboardEvent } from "@/lib/security";
import {
  isQuotaOrResourceError,
  isTimeoutLikeError,
  openRuntimeCircuit,
  runtimeCircuitOpen,
  singleFlight,
  withTimeout,
} from "@/lib/runtimeResilience";
import {
  evaluateAuthAccessPolicy,
  getAuthAccessPolicy,
} from "@/lib/authAccessPolicy";

export type DashboardRole = "admin" | "moderator" | "mentor" | "member";

export type DashboardSession = {
  provider: "discord" | "github" | "token";
  id: string;
  name: string;
  login?: string;
  role: DashboardRole;
  profileId?: string;
  avatar?: string | null;
  avatar_url?: string | null;
  discordRoleIds?: string[];
  groupId?: string;
  groupName?: string;
  groupRank?: number;
  permissions?: string[];
  isServerOwner?: boolean;
  impersonatedBy?: string;
};

export type SessionUser = DashboardSession;

export const SESSION_COOKIE = "__Host-mistblossom_dashboard_session";
export const LEGACY_SESSION_COOKIE = "mistblossom_dashboard_session";
export const OAUTH_STATE_COOKIE = "__Host-mistblossom_oauth_state";
export const LEGACY_OAUTH_STATE_COOKIE = "mistblossom_oauth_state";
const SESSION_AUDIENCE = "mistblossom-dashboard";
const OAUTH_STATE_AUDIENCE = "mistblossom-oauth-state";
function getSessionMaxAgeSeconds() {
  const parsed = Number(
    process.env.SESSION_MAX_AGE_SECONDS || 60 * 60 * 24 * 7,
  );
  if (!Number.isFinite(parsed) || parsed < 60 * 30) return 60 * 60 * 24 * 7;
  return Math.min(Math.floor(parsed), 60 * 60 * 24 * 30);
}

const SESSION_MAX_AGE_SECONDS = getSessionMaxAgeSeconds();

function authEnvFlag(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

type LiveDiscordAccessCacheEntry = {
  checkedAt: number;
  session: DashboardSession | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomLiveDiscordAccessCache:
    | Map<string, LiveDiscordAccessCacheEntry>
    | undefined;
}

function liveDiscordAccessSyncTtlMs() {
  const parsed = Number(process.env.DISCORD_LIVE_ACCESS_SYNC_SECONDS || 90);
  if (!Number.isFinite(parsed)) return 90_000;
  return Math.max(15, Math.min(900, Math.floor(parsed))) * 1000;
}

function canRefreshDiscordAccess(
  session: DashboardSession | null | undefined,
): session is DashboardSession & { provider: "discord"; id: string } {
  return Boolean(
    session &&
    session.provider === "discord" &&
    /^\d{16,25}$/.test(session.id) &&
    String(process.env.DISCORD_BOT_TOKEN || "").trim() &&
    String(process.env.DISCORD_GUILD_ID || "").trim(),
  );
}

function isSensitiveDashboardRole(role: DashboardRole | null | undefined) {
  return role === "admin" || role === "moderator" || role === "mentor";
}

function downgradeToSafeMemberSession(
  session: DashboardSession,
): DashboardSession {
  return {
    ...session,
    role: "member",
    groupId: undefined,
    groupName: "Учасник",
    groupRank: 10,
    permissions: [
      "dashboard.view",
      "raids.view",
      "guild.roster.view",
      "profiles.group.view",
    ],
    isServerOwner: false,
    // Do not keep stale Discord role ids after a failed live read. Role ids are
    // rehydrated on the next successful Discord API check.
    discordRoleIds: [],
  };
}

async function deleteProfileAfterDiscordMembershipLoss(
  session: DashboardSession,
  message: string,
) {
  const profileId = session.profileId || "";
  const deleted = await deleteDashboardProfilesByDiscordUserId(
    session.id,
  ).catch((error) => ({
    deleted: 0,
    profileIds: [] as string[],
    reason:
      error instanceof Error ? error.message : String(error || "delete-failed"),
  }));

  logDashboardEvent(
    "warn",
    "auth.discord.live.profile_deleted_not_member",
    undefined,
    {
      userId: session.id,
      profileId,
      deletedProfiles: deleted.deleted,
      deletedProfileIds: deleted.profileIds,
      reason: deleted.reason,
      message,
    },
  );

  await recordSystemAudit("auth.discord.live.profile_deleted_not_member", {
    status: "warning",
    summary:
      "Профіль видалено під час live-перевірки: Discord-акаунта вже немає на сервері.",
    userId: session.id,
    profileId,
    deletedProfiles: deleted.deleted,
    deletedProfileIds: deleted.profileIds,
    reason: deleted.reason,
  }).catch(() => false);
}

async function refreshDiscordAccess(
  session: DashboardSession | null,
): Promise<DashboardSession | null> {
  if (!canRefreshDiscordAccess(session)) return session;

  const cacheKey = `${session.provider}:${session.id}`;
  const ttlMs = liveDiscordAccessSyncTtlMs();
  const cache =
    globalThis.__mistblossomLiveDiscordAccessCache ||
    new Map<string, LiveDiscordAccessCacheEntry>();
  globalThis.__mistblossomLiveDiscordAccessCache = cache;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < ttlMs) return cached.session;

  if (runtimeCircuitOpen("discord-live-access")) {
    return cached?.session ?? session;
  }

  return singleFlight(`discord-live-access:${cacheKey}`, async () => {
    try {
      const [member, guild, authPolicy] = await withTimeout(
        Promise.all([
          fetchDiscordGuildMemberSnapshot(session.id),
          fetchDiscordGuildSnapshot().catch(() => null),
          getAuthAccessPolicy(),
        ]),
        3_500,
        "discord live access",
      );
      const authDecision = evaluateAuthAccessPolicy(authPolicy, {
        userId: session.id,
        ownerId: guild?.ownerId || null,
        roleIds: member.roleIds || [],
      });
      if (!authDecision.allowed) {
        logDashboardEvent(
          "warn",
          "auth.discord.live.required_role_missing",
          undefined,
          {
            userId: session.id,
            profileId: session.profileId,
            reason: authDecision.reason,
            requiredRoles: authDecision.requiredRoleIds.length,
            memberRoles: member.roleIds?.length || 0,
          },
        );
        void recordSystemAudit("auth.discord.live.required_role_missing", {
          status: "warning",
          summary:
            authDecision.reason === "no_required_role_configured"
              ? "Сесію Discord заблоковано: обовʼязкова роль для входу не налаштована."
              : "Сесію Discord заблоковано: у користувача немає обовʼязкової ролі сервера.",
          userId: session.id,
          profileId: session.profileId,
          reason: authDecision.reason,
          requiredRoleIds: authDecision.requiredRoleIds,
        }).catch(() => false);
        cache.set(cacheKey, { checkedAt: Date.now(), session: null });
        return null;
      }

      const resolved = await resolveAccessGroupFromDiscord(
        member.roleIds || [],
        session.id,
        guild?.ownerId || null,
      );
      const liveSession: DashboardSession | null =
        resolved.group.permissions.includes("dashboard.view")
          ? applyAccessGroupToSession(
              {
                ...session,
                name: member.displayName || session.name,
                discordRoleIds: member.roleIds || [],
                impersonatedBy: undefined,
              },
              resolved.group,
              resolved.isServerOwner,
            )
          : null;

      cache.set(cacheKey, { checkedAt: Date.now(), session: liveSession });
      return liveSession;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "");
      if (/^Discord API 404:/.test(message)) {
        await deleteProfileAfterDiscordMembershipLoss(session, message).catch(
          (cleanupError) => {
            logDashboardEvent(
              "error",
              "auth.discord.live.profile_delete_failed",
              undefined,
              {
                userId: session.id,
                profileId: session.profileId,
                message:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError || "unknown"),
              },
            );
          },
        );
        cache.set(cacheKey, { checkedAt: Date.now(), session: null });
        return null;
      }

      if (isQuotaOrResourceError(error) || isTimeoutLikeError(error)) {
        openRuntimeCircuit("discord-live-access", error, 120_000);
        const fallbackSession = cached?.session ?? session;
        cache.set(cacheKey, {
          checkedAt: Date.now(),
          session: fallbackSession,
        });
        return fallbackSession;
      }

      const fallbackSession = isSensitiveDashboardRole(session.role)
        ? downgradeToSafeMemberSession(session)
        : session;
      cache.set(cacheKey, {
        checkedAt: Date.now() - Math.floor(ttlMs * 0.75),
        session: fallbackSession,
      });
      return fallbackSession;
    }
  });
}

async function enforceNonDiscordSessionPolicy(
  session: DashboardSession | null,
): Promise<DashboardSession | null> {
  if (!session || session.provider === "discord" || session.impersonatedBy)
    return session;

  const policy = await getAuthAccessPolicy();
  if (!policy.enabled) return session;

  if (session.provider === "token" && policy.allowEmergencyTokenLogin) {
    return session;
  }

  logDashboardEvent("warn", "auth.non_discord_session_blocked", undefined, {
    provider: session.provider,
    userId: session.id,
    role: session.role,
  });
  return null;
}

function getSecret() {
  const secret =
    process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET || "";
  if (secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set and at least 32 characters long.",
    );
  }
  return secret;
}

function base64UrlEncode(input: string | Uint8Array) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  );
}

async function sign(data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export type OAuthStatePayload = {
  nonce: string;
  nextPath?: string;
  issuedAt: number;
};

function safeOAuthNextPath(value?: string | null) {
  const path = String(value || "").trim();
  if (!path || path.length > 1500) return "";
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  if (
    path === "/" ||
    /^\/(?:raids|profile|rules\/accept)(?:[/?#]|$)/.test(path)
  )
    return path;
  return "";
}

function createNonce(bytesLength = 24) {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function createOAuthStateToken(
  nextPathInput?: string | null,
): Promise<OAuthStatePayload & { token: string }> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = createNonce();
  const nextPath = safeOAuthNextPath(nextPathInput) || undefined;
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: OAUTH_STATE_AUDIENCE,
      n: nonce,
      next: nextPath || null,
      iat: issuedAt,
    }),
  );
  return {
    nonce,
    nextPath,
    issuedAt,
    token: `${payload}.${await sign(payload)}`,
  };
}

export async function parseOAuthStateToken(
  token?: string | null,
): Promise<OAuthStatePayload | null> {
  const value = String(token || "").trim();
  if (!value || !value.includes(".")) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = await sign(payload);
  if (!constantTimeEqual(expected, signature)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    if (!parsed || parsed.aud !== OAUTH_STATE_AUDIENCE) return null;
    const nonce = String(parsed.n || "").trim();
    const issuedAt = Number(parsed.iat || 0);
    const now = Math.floor(Date.now() / 1000);
    if (!nonce || !Number.isFinite(issuedAt)) return null;
    if (issuedAt > now + 60 || now - issuedAt > 60 * 10) return null;
    return {
      nonce,
      nextPath: safeOAuthNextPath(parsed.next),
      issuedAt,
    };
  } catch {
    return null;
  }
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export { createStableProfileId };

function normalizeSessionPayload(parsed: any): DashboardSession | null {
  if (!parsed || parsed.aud !== SESSION_AUDIENCE) return null;
  if (
    parsed.role !== "admin" &&
    parsed.role !== "moderator" &&
    parsed.role !== "mentor" &&
    parsed.role !== "member"
  )
    return null;

  const id = String(parsed.id || "").trim();
  if (!id) return null;

  const issuedAt = Number(parsed.iat || 0);
  const expiresAt = Number(parsed.exp || 0);
  const now = Math.floor(Date.now() / 1000);

  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
  if (issuedAt > now + 60) return null;
  if (expiresAt <= now) return null;

  return {
    provider:
      parsed.provider === "github" || parsed.provider === "token"
        ? parsed.provider
        : "discord",
    id,
    name: String(parsed.name || "Moderator").slice(0, 120),
    login: parsed.login ? String(parsed.login).slice(0, 120) : undefined,
    role: parsed.role,
    profileId:
      typeof parsed.profileId === "string" &&
      /^id[a-f0-9]{16,40}$/.test(parsed.profileId)
        ? parsed.profileId
        : undefined,
    avatar: parsed.avatar || null,
    avatar_url: parsed.avatar_url || parsed.avatar || null,
    discordRoleIds: Array.isArray(parsed.discordRoleIds)
      ? parsed.discordRoleIds
          .map((roleId: unknown) => String(roleId || "").trim())
          .filter(Boolean)
          .slice(0, 100)
      : [],
    groupId:
      typeof parsed.groupId === "string"
        ? parsed.groupId.slice(0, 32)
        : undefined,
    groupName:
      typeof parsed.groupName === "string"
        ? parsed.groupName.slice(0, 80)
        : undefined,
    groupRank: Number.isFinite(Number(parsed.groupRank))
      ? Math.floor(Number(parsed.groupRank))
      : undefined,
    permissions: Array.isArray(parsed.permissions)
      ? parsed.permissions
          .map((item: unknown) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 100)
      : [],
    isServerOwner: Boolean(parsed.isServerOwner),
    impersonatedBy:
      typeof parsed.impersonatedBy === "string"
        ? parsed.impersonatedBy.slice(0, 80)
        : undefined,
  };
}

export async function createSessionToken(session: DashboardSession) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: SESSION_AUDIENCE,
      provider: session.provider,
      id: session.id,
      name: session.name,
      login: session.login,
      role: session.role,
      profileId:
        session.profileId ||
        (await createStableProfileId(session.provider, session.id)),
      avatar: session.avatar || null,
      avatar_url: session.avatar_url || session.avatar || null,
      discordRoleIds: Array.from(
        new Set(
          (session.discordRoleIds || [])
            .map((roleId) => String(roleId || "").trim())
            .filter(Boolean),
        ),
      ).slice(0, 100),
      groupId: session.groupId || null,
      groupName: session.groupName || null,
      groupRank: session.groupRank || 0,
      permissions: Array.from(
        new Set(
          (session.permissions || [])
            .map((item) => String(item || "").trim())
            .filter(Boolean),
        ),
      ).slice(0, 100),
      isServerOwner: Boolean(session.isServerOwner),
      impersonatedBy: session.impersonatedBy || null,
      iat: now,
      exp: now + SESSION_MAX_AGE_SECONDS,
    }),
  );

  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionToken(
  token?: string | null,
): Promise<DashboardSession | null> {
  if (!token || !token.includes(".")) return null;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = await sign(payload);
  if (!constantTimeEqual(expected, signature)) return null;

  try {
    return normalizeSessionPayload(JSON.parse(base64UrlDecode(payload)));
  } catch {
    return null;
  }
}

export async function getStoredSession(): Promise<DashboardSession | null> {
  const store = await cookies();
  const token =
    store.get(SESSION_COOKIE)?.value || store.get(LEGACY_SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function getSession(
  options: { live?: boolean; enforceNonDiscordPolicy?: boolean } = {},
): Promise<DashboardSession | null> {
  const session = await getStoredSession();
  if (session?.impersonatedBy) return session;

  const shouldEnforceNonDiscordPolicy = options.enforceNonDiscordPolicy ?? true;
  const gatedSession = shouldEnforceNonDiscordPolicy
    ? await enforceNonDiscordSessionPolicy(session).catch((error) => {
        logDashboardEvent(
          "warn",
          "auth.session.policy_check_failed",
          undefined,
          {
            userId: session?.id || null,
            provider: session?.provider || null,
            message:
              error instanceof Error
                ? error.message
                : String(error || "unknown"),
          },
        );
        return session;
      })
    : session;

  const liveAccessEnabled =
    options.live ?? authEnvFlag("SESSION_LIVE_ACCESS_SYNC_ENABLED", false);
  return liveAccessEnabled ? refreshDiscordAccess(gatedSession) : gatedSession;
}

export async function setSession(session: DashboardSession) {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  store.delete(LEGACY_SESSION_COOKIE);
}

export async function clearSession() {
  const store = await cookies();
  const secureCookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  const legacyCookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };

  store.set(SESSION_COOKIE, "", secureCookieOptions);
  store.set(LEGACY_SESSION_COOKIE, "", legacyCookieOptions);
  store.set(OAUTH_STATE_COOKIE, "", secureCookieOptions);
  store.set(LEGACY_OAUTH_STATE_COOKIE, "", legacyCookieOptions);
}

/**
 * Legacy sync resolver kept only for older imports. Real access is resolved
 * asynchronously from Firestore groups in accessGroups.ts.
 */
export function resolveDashboardRole(_roleIds: string[]): DashboardRole | null {
  return null;
}

export function assertCanModerate(
  session: DashboardSession | null,
): asserts session is DashboardSession {
  if (!session || !hasPermission(session, "applications.manage")) {
    throw new Error("Access denied");
  }
}

export function assertAdmin(
  session: DashboardSession | null,
): asserts session is DashboardSession {
  if (
    !session ||
    !hasPermission(session, "groups.manage") ||
    session.role !== "admin"
  ) {
    throw new Error("Admin access required");
  }
}

/**
 * Backward-compatible exports for older dashboard pages/routes.
 */
export async function isAuthenticated() {
  return !!(await getSession());
}

export async function getSessionUser() {
  return getSession();
}

export function canModerate(user: DashboardSession | null | undefined) {
  return hasPermission(user, "applications.manage");
}

export async function createSessionCookie(
  session: (Partial<DashboardSession> & { login?: string }) | string,
) {
  if (typeof session === "string") {
    const verified = await verifyToken(session);
    if (!verified) {
      throw new Error("Invalid dashboard token.");
    }
    return createSessionToken(verified);
  }

  return createSessionToken({
    provider: session.provider || "token",
    id: String(session.id || "local"),
    name: String(session.name || session.login || "Local admin"),
    login: session.login || session.name || "Local admin",
    role:
      session.role === "moderator"
        ? "moderator"
        : session.role === "mentor"
          ? "mentor"
          : session.role === "member"
            ? "member"
            : "admin",
    avatar: session.avatar || null,
    avatar_url: session.avatar_url || session.avatar || null,
    discordRoleIds: session.discordRoleIds || [],
  });
}

export async function verifyToken(token: string) {
  const expected = String(process.env.ADMIN_DASHBOARD_TOKEN || "").trim();
  const provided = String(token || "").trim();
  if (!expected || !provided) return null;

  const [expectedHash, providedHash] = await Promise.all([
    sha256Base64Url(expected),
    sha256Base64Url(provided),
  ]);

  if (!constantTimeEqual(expectedHash, providedHash)) return null;

  return {
    provider: "token",
    id: "emergency-token",
    name: "Emergency Admin",
    login: "Emergency Admin",
    role: "admin",
    discordRoleIds: [],
  } satisfies DashboardSession;
}
