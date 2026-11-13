import "server-only";

import { FieldValue } from "@/lib/db/documentValues";
import { getDocumentDb, hasDocumentDbConfig } from "@/lib/documentDb";
import type { DashboardSession } from "@/lib/auth";
import { resilientRead } from "@/lib/runtimeResilience";
import { storageWrite } from "@/lib/storageAccess";
import { timestampToIso } from "@/lib/values";
import { listAccessGroupsForManagement } from "@/lib/accessGroups";

const SETTINGS_COLLECTION = "dashboardSettings";
const AUTH_ACCESS_DOC_ID = "authAccessPolicy";

const POLICY_CACHE_TTL_MS = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.AUTH_ACCESS_POLICY_CACHE_TTL_MS || 10 * 60_000)));
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

export type DiscordSiteRoleMapping = { roleId: string; groupId: string };

export type AuthAccessPolicy = {
  enabled: boolean;
  requireConfiguredRole: boolean;
  allowServerOwner: boolean;
  allowEmergencyTokenLogin: boolean;
  requiredRoleIds: string[];
  roleGroupMappings: DiscordSiteRoleMapping[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type AuthAccessDecision = {
  allowed: boolean;
  reason: "disabled" | "server_owner" | "no_required_role_configured" | "missing_required_role" | "allowed";
  requiredRoleIds: string[];
  matchedRoleIds: string[];
};
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

export function cleanRoleGroupMappings(value: unknown): DiscordSiteRoleMapping[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const mappings: DiscordSiteRoleMapping[] = [];
  for (const entry of value.slice(0, 200)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const roleId = String(record.roleId || "").trim();
    const groupId = String(record.groupId || "").trim();
    if (!/^\d{16,25}$/.test(roleId) || !/^[A-Za-z0-9_-]{1,32}$/.test(groupId) || seen.has(roleId)) continue;
    seen.add(roleId);
    mappings.push({ roleId, groupId });
    if (mappings.length === 100) break;
  }
  return mappings;
}

function defaultAuthAccessPolicy(): AuthAccessPolicy {
  return {
    enabled: true,
    requireConfiguredRole: true,
    allowServerOwner: true,
    allowEmergencyTokenLogin: false,
    requiredRoleIds: [],
    roleGroupMappings: [],
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizePolicyData(data?: Record<string, unknown> | null): AuthAccessPolicy {
  const fallback = defaultAuthAccessPolicy();
  // Explicit mappings are required. Old flat role allowlists do not authorize
  // access because they had no target group and often included newcomers.
  const roleGroupMappings = cleanRoleGroupMappings(data?.roleGroupMappings);
  return {
    ...fallback,
    allowServerOwner: typeof data?.allowServerOwner === "boolean" ? data.allowServerOwner : true,
    roleGroupMappings,
    requiredRoleIds: roleGroupMappings.map((mapping) => mapping.roleId),
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

export async function getAuthAccessPolicy(options: { bypassCache?: boolean } = {}): Promise<AuthAccessPolicy> {
  if (!options.bypassCache && authPolicyCacheFresh()) {
    return globalThis.__mistblossomAuthAccessPolicyCache!.policy;
  }
  if (!hasDocumentDbConfig()) return setAuthPolicyCache(defaultAuthAccessPolicy());

  const policy = await resilientRead(
    "getAuthAccessPolicy",
    async () => {
      const snapshot = await getDocumentDb()
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
      circuitKey: "storage-auth-policy-read",
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
  roleGroupMappings?: unknown;
}, actor?: DashboardSession | null) {
  if (!hasDocumentDbConfig()) throw new Error("Storage не налаштований для збереження правил авторизації.");

  const supplied = input.roleGroupMappings;
  if (!Array.isArray(supplied) || supplied.length > 100) throw new Error("Некоректний перелік відповідностей Discord-ролей.");
  const mappings = cleanRoleGroupMappings(supplied);
  if (mappings.length !== supplied.length) throw new Error("Повторення або некоректні Discord-ролі чи групи сайту.");
  const groups = await listAccessGroupsForManagement();
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const mapping of mappings) {
    const group = byId.get(mapping.groupId);
    if (!group || !group.permissions.includes("dashboard.view")) throw new Error("Вибрана група сайту недоступна для авторизації.");
    if (!actor?.isServerOwner && (group.role === "admin" || group.permissions.includes("groups.manage"))) {
      throw new Error("Привʼязувати Discord-ролі до адміністративної групи може лише власник Discord-сервера.");
    }
  }
  const nextPolicy = normalizePolicyData({
    allowServerOwner: actor?.isServerOwner
      ? input.allowServerOwner === "on" || input.allowServerOwner === "1" || input.allowServerOwner === true
      : (await getAuthAccessPolicy()).allowServerOwner,
    roleGroupMappings: mappings,
  });

  await storageWrite(
    "settings",
    "auth-access-policy:save",
    () => getDocumentDb().collection(SETTINGS_COLLECTION).doc(AUTH_ACCESS_DOC_ID).set({
      enabled: nextPolicy.enabled,
      requireConfiguredRole: nextPolicy.requireConfiguredRole,
      allowServerOwner: nextPolicy.allowServerOwner,
      allowEmergencyTokenLogin: nextPolicy.allowEmergencyTokenLogin,
      requiredRoleIds: nextPolicy.requiredRoleIds,
      roleGroupMappings: nextPolicy.roleGroupMappings,
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
  const requiredRoleIds = cleanRoleGroupMappings(policy.roleGroupMappings).map((mapping) => mapping.roleId);

  if (policy.allowServerOwner && userId && ownerId && userId === ownerId) {
    return { allowed: true, reason: "server_owner", requiredRoleIds, matchedRoleIds: [] };
  }

  if (requiredRoleIds.length === 0) {
    return {
      allowed: false,
      reason: "no_required_role_configured",
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

/** Newcomer onboarding must never auto-grant website authorization. */
export async function ensureAuthAccessRequiredRole(_roleIdInput: unknown, _actor?: DashboardSession | null) {
  return getAuthAccessPolicy();
}
