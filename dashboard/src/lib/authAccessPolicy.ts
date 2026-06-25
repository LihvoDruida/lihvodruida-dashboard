import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import type { DashboardSession } from "@/lib/auth";
import { logDashboardEvent } from "@/lib/security";
import { resilientRead } from "@/lib/runtimeResilience";
import { firebaseWrite } from "@/lib/firebaseAccess";

const SETTINGS_COLLECTION = "dashboardSettings";
const AUTH_ACCESS_DOC_ID = "authAccessPolicy";

const POLICY_CACHE_TTL_MS = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.AUTH_ACCESS_POLICY_CACHE_TTL_MS || 10 * 60_000)));
const POLICY_ERROR_LOG_TTL_MS = 5 * 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomAuthAccessPolicyCache: { policy: AuthAccessPolicy; cachedAt: number } | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomAuthAccessPolicyErrorLoggedAt: number | undefined;
}

function authPolicyCacheFresh() {
  const cached = globalThis.__mistblossomAuthAccessPolicyCache;
  return Boolean(cached && Date.now() - cached.cachedAt < POLICY_CACHE_TTL_MS);
}

function setAuthPolicyCache(policy: AuthAccessPolicy) {
  globalThis.__mistblossomAuthAccessPolicyCache = { policy, cachedAt: Date.now() };
  return policy;
}

function logAuthPolicyReadFailureOnce(error: unknown) {
  const now = Date.now();
  const last = globalThis.__mistblossomAuthAccessPolicyErrorLoggedAt || 0;
  if (now - last < POLICY_ERROR_LOG_TTL_MS) return;
  globalThis.__mistblossomAuthAccessPolicyErrorLoggedAt = now;
  logDashboardEvent("warn", "auth_access.policy_read_failed", undefined, { message: error instanceof Error ? error.message : String(error || "unknown") });
}


export type AuthAccessPolicy = {
  enabled: boolean;
  requireConfiguredRole: boolean;
  allowServerOwner: boolean;
  allowEmergencyTokenLogin: boolean;
  requiredRoleIds: string[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type AuthAccessDecision = {
  allowed: boolean;
  reason: "disabled" | "server_owner" | "no_required_role_configured" | "missing_required_role" | "allowed";
  requiredRoleIds: string[];
  matchedRoleIds: string[];
};

function envFlag(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function timestampToIso(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate().toISOString();
  return null;
}

export function cleanDiscordRoleIds(value: unknown) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/g);
  return Array.from(
    new Set(
      items
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d{16,25}$/.test(item))
    )
  ).slice(0, 25);
}

function defaultAuthAccessPolicy(): AuthAccessPolicy {
  const requiredRoleIds = cleanDiscordRoleIds(
    process.env.AUTH_ACCESS_REQUIRED_ROLE_IDS ||
    process.env.DISCORD_AUTH_REQUIRED_ROLE_IDS ||
    process.env.REQUIRED_DISCORD_ROLE_IDS ||
    ""
  );

  return {
    enabled: envFlag("AUTH_ACCESS_RESTRICTIONS_ENABLED", true),
    requireConfiguredRole: envFlag("AUTH_ACCESS_REQUIRE_CONFIGURED_ROLE", true),
    allowServerOwner: envFlag("AUTH_ACCESS_ALLOW_SERVER_OWNER", true),
    allowEmergencyTokenLogin: envFlag("AUTH_ACCESS_ALLOW_EMERGENCY_TOKEN_LOGIN", false),
    requiredRoleIds,
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizePolicyData(data?: Record<string, unknown> | null): AuthAccessPolicy {
  const fallback = defaultAuthAccessPolicy();
  const hasStoredRoleIds = Boolean(data && Object.prototype.hasOwnProperty.call(data, "requiredRoleIds"));

  return {
    enabled: typeof data?.enabled === "boolean" ? data.enabled : fallback.enabled,
    requireConfiguredRole: typeof data?.requireConfiguredRole === "boolean" ? data.requireConfiguredRole : fallback.requireConfiguredRole,
    allowServerOwner: typeof data?.allowServerOwner === "boolean" ? data.allowServerOwner : fallback.allowServerOwner,
    allowEmergencyTokenLogin: typeof data?.allowEmergencyTokenLogin === "boolean" ? data.allowEmergencyTokenLogin : fallback.allowEmergencyTokenLogin,
    requiredRoleIds: hasStoredRoleIds ? cleanDiscordRoleIds(data?.requiredRoleIds) : fallback.requiredRoleIds,
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

export async function getAuthAccessPolicy(options: { bypassCache?: boolean } = {}): Promise<AuthAccessPolicy> {
  if (!options.bypassCache && authPolicyCacheFresh()) {
    return globalThis.__mistblossomAuthAccessPolicyCache!.policy;
  }
  if (!hasFirebaseProfileConfig()) return setAuthPolicyCache(defaultAuthAccessPolicy());

  const policy = await resilientRead(
    "getAuthAccessPolicy",
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(SETTINGS_COLLECTION)
        .doc(AUTH_ACCESS_DOC_ID)
        .get();
      return snapshot.exists
        ? normalizePolicyData(snapshot.data() || null)
        : globalThis.__mistblossomAuthAccessPolicyCache?.policy || defaultAuthAccessPolicy();
    },
    {
      ttlMs: POLICY_CACHE_TTL_MS,
      timeoutMs: 2_000,
      circuitKey: "firebase-auth-policy-read",
      circuitTtlMs: 90_000,
      bypassCache: Boolean(options.bypassCache),
      fallback: () => globalThis.__mistblossomAuthAccessPolicyCache?.policy || defaultAuthAccessPolicy(),
      logEvent: "auth_access.policy_read_failed",
    },
  );
  return setAuthPolicyCache(policy);
}

export async function setAuthAccessPolicy(input: {
  enabled?: unknown;
  requireConfiguredRole?: unknown;
  allowServerOwner?: unknown;
  allowEmergencyTokenLogin?: unknown;
  requiredRoleIds?: unknown;
  requiredRoleIdsText?: unknown;
}, actor?: DashboardSession | null) {
  if (!hasFirebaseProfileConfig()) throw new Error("Firebase не налаштований для збереження правил авторизації.");

  const selectedRoleIds = [
    ...cleanDiscordRoleIds(input.requiredRoleIds),
    ...cleanDiscordRoleIds(input.requiredRoleIdsText),
  ];
  const nextPolicy = normalizePolicyData({
    enabled: input.enabled === "on" || input.enabled === "1" || input.enabled === true,
    requireConfiguredRole: input.requireConfiguredRole === "on" || input.requireConfiguredRole === "1" || input.requireConfiguredRole === true,
    allowServerOwner: input.allowServerOwner === "on" || input.allowServerOwner === "1" || input.allowServerOwner === true,
    allowEmergencyTokenLogin: input.allowEmergencyTokenLogin === "on" || input.allowEmergencyTokenLogin === "1" || input.allowEmergencyTokenLogin === true,
    requiredRoleIds: selectedRoleIds,
  });

  await firebaseWrite(
    "settings",
    "auth-access-policy:save",
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(AUTH_ACCESS_DOC_ID).set({
      enabled: nextPolicy.enabled,
      requireConfiguredRole: nextPolicy.requireConfiguredRole,
      allowServerOwner: nextPolicy.allowServerOwner,
      allowEmergencyTokenLogin: nextPolicy.allowEmergencyTokenLogin,
      requiredRoleIds: nextPolicy.requiredRoleIds,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor?.name || actor?.login || actor?.id || null,
    }, { merge: true }),
    { timeoutMs: 3_000, logEvent: "auth_access.policy_write_failed" },
  );

  return setAuthPolicyCache({
    ...nextPolicy,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  });
}

export function evaluateAuthAccessPolicy(policy: AuthAccessPolicy, params: {
  userId?: string | null;
  ownerId?: string | null;
  roleIds?: string[] | null;
}): AuthAccessDecision {
  const userId = String(params.userId || "").trim();
  const ownerId = String(params.ownerId || "").trim();
  const memberRoleIds = cleanDiscordRoleIds(params.roleIds || []);
  const requiredRoleIds = cleanDiscordRoleIds(policy.requiredRoleIds || []);

  if (!policy.enabled) {
    return { allowed: true, reason: "disabled", requiredRoleIds, matchedRoleIds: [] };
  }

  if (policy.allowServerOwner && userId && ownerId && userId === ownerId) {
    return { allowed: true, reason: "server_owner", requiredRoleIds, matchedRoleIds: [] };
  }

  if (requiredRoleIds.length === 0) {
    return {
      allowed: !policy.requireConfiguredRole,
      reason: policy.requireConfiguredRole ? "no_required_role_configured" : "allowed",
      requiredRoleIds,
      matchedRoleIds: [],
    };
  }

  const memberRoleSet = new Set(memberRoleIds);
  const matchedRoleIds = requiredRoleIds.filter((roleId) => memberRoleSet.has(roleId));
  return {
    allowed: matchedRoleIds.length > 0,
    reason: matchedRoleIds.length > 0 ? "allowed" : "missing_required_role",
    requiredRoleIds,
    matchedRoleIds,
  };
}
