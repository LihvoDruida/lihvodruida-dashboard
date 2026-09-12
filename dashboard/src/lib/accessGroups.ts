import "server-only";

import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { getRuntimeCachedValue, setRuntimeCachedValue, clearRuntimeCachedValue, resilientRead, logThrottled, safeErrorText } from "@/lib/runtimeResilience";
import { firebaseWrite } from "@/lib/firebaseAccess";
import { inferStructuredLogCategory, listStructuredLogs, recordStructuredLog, type StructuredLogLevel } from "@/lib/structuredLogs";
import type { DashboardRole, DashboardSession } from "@/lib/auth";
import {
  DASHBOARD_PERMISSION_KEYS,
  DEFAULT_ADMIN_GROUP_ID,
  DEFAULT_MEMBER_GROUP_ID,
  DEFAULT_MENTOR_GROUP_ID,
  DEFAULT_MODERATOR_GROUP_ID,
  FIXED_GROUP_IDS,
  type AccessGroup,
  type DashboardPermissionKey,
} from "@/lib/accessGroupSchema";

const DEFAULT_GROUPS: AccessGroup[] = [
  {
    id: DEFAULT_ADMIN_GROUP_ID,
    name: "Адмін",
    role: "admin",
    rank: 100,
    lockedId: true,
    protectedGroup: true,
    discordRoleIds: [],
    icon: "👑",
    permissions: [...DASHBOARD_PERMISSION_KEYS],
  },
  {
    id: DEFAULT_MODERATOR_GROUP_ID,
    name: "Модератор",
    role: "moderator",
    rank: 50,
    lockedId: true,
    protectedGroup: true,
    discordRoleIds: [],
    icon: "🛡️",
    permissions: [
      "dashboard.view",
      "applications.view",
      "applications.manage",
      "applications.sensitive.view",
      "discord.embeds.manage",
      "raids.view",
      "raids.manage",
      "raids.roster.view",
      "guild.roster.view",
      "profiles.view",
      "profiles.group.view",
      "profiles.access.view",
      "rules.stats.view",
    ],
  },
  {
    id: DEFAULT_MENTOR_GROUP_ID,
    name: "Наставник новачків",
    role: "mentor",
    rank: 20,
    lockedId: true,
    protectedGroup: true,
    discordRoleIds: [],
    icon: "🌿",
    permissions: [
      "dashboard.view",
      "applications.view",
      "raids.view",
      "guild.roster.view",
      "profiles.group.view",
    ],
  },
  {
    id: DEFAULT_MEMBER_GROUP_ID,
    name: "Учасник",
    role: "member",
    rank: 10,
    lockedId: true,
    protectedGroup: true,
    discordRoleIds: [],
    icon: "🍃",
    permissions: [
      "dashboard.view",
      "raids.view",
      "guild.roster.view",
      "profiles.group.view",
    ],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function cleanId(value: unknown) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
}

function cleanName(value: unknown, fallback = "Група") {
  return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, 80) || fallback;
}

function cleanDiscordRoleIds(value: unknown) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/g);
  const firstValidRoleId = items.map((item) => String(item || "").trim()).find((item) => /^\d{16,25}$/.test(item));
  return firstValidRoleId ? [firstValidRoleId] : [];
}

function cleanGroupIcon(value: unknown) {
  const icon = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!icon) return null;
  // Optional visual marker only: emoji, short text, or compact symbol. No HTML/URLs.
  return icon.replace(/[<>]/g, "");
}

function cleanPermissions(value: unknown) {
  const allowed = new Set<string>(DASHBOARD_PERMISSION_KEYS);
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/g);
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter((item): item is DashboardPermissionKey => allowed.has(item))));
}

function cleanRole(value: unknown, fallback: DashboardRole = "member"): DashboardRole {
  return value === "admin" || value === "moderator" || value === "mentor" || value === "member" ? value : fallback;
}

function roleForGroup(id: string, rank: number, requestedRole?: unknown): DashboardRole {
  if (id === DEFAULT_ADMIN_GROUP_ID) return "admin";
  if (id === DEFAULT_MODERATOR_GROUP_ID) return "moderator";
  if (id === DEFAULT_MENTOR_GROUP_ID) return "mentor";
  if (id === DEFAULT_MEMBER_GROUP_ID) return "member";
  if (requestedRole !== undefined && requestedRole !== null && String(requestedRole).trim()) {
    return cleanRole(requestedRole, "member");
  }
  if (rank >= 100) return "admin";
  if (rank >= 50) return "moderator";
  if (rank >= 20) return "mentor";
  return "member";
}

function normalizeGroup(idInput: string, raw: Record<string, unknown> = {}): AccessGroup {
  const id = cleanId(raw.id || idInput);
  const fallback = DEFAULT_GROUPS.find((group) => group.id === id);
  const rank = Number.isFinite(Number(raw.rank)) ? Math.floor(Number(raw.rank)) : fallback?.rank ?? 10;
  const role = roleForGroup(id, rank, raw.role || fallback?.role);
  const permissions = cleanPermissions(raw.permissions);

  return {
    id,
    name: cleanName(raw.name, fallback?.name || "Група"),
    role,
    rank,
    lockedId: Boolean(raw.lockedId ?? fallback?.lockedId ?? FIXED_GROUP_IDS.has(id)),
    protectedGroup: Boolean(raw.protectedGroup ?? fallback?.protectedGroup ?? FIXED_GROUP_IDS.has(id)),
    discordRoleIds: cleanDiscordRoleIds(raw.discordRoleId ?? raw.discordRoleIds),
    icon: cleanGroupIcon(raw.icon ?? fallback?.icon),
    permissions: permissions.length ? permissions : fallback?.permissions || ["dashboard.view"],
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

function fallbackGroups() {
  return DEFAULT_GROUPS.map((group) => ({ ...group, permissions: [...group.permissions], discordRoleIds: [...group.discordRoleIds] }));
}

const ACCESS_GROUPS_CACHE_TTL_MS = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.ACCESS_GROUPS_CACHE_TTL_MS || 10 * 60_000)));
const ACCESS_GROUPS_ENSURE_TTL_MS = Math.max(60_000, Math.min(60 * 60_000, Number(process.env.ACCESS_GROUPS_ENSURE_TTL_MS || 30 * 60_000)));

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomAccessGroupsEnsuredAt: number | undefined;
}

function cacheAccessGroups(groups: AccessGroup[]) {
  return setRuntimeCachedValue("access-groups", groups.map((group) => ({ ...group, permissions: [...group.permissions], discordRoleIds: [...group.discordRoleIds] })));
}

function cachedAccessGroups() {
  return getRuntimeCachedValue<AccessGroup[]>("access-groups", ACCESS_GROUPS_CACHE_TTL_MS);
}

function collectionRef() {
  return getFirebaseAdminDb().collection("dashboardAccessGroups");
}

export async function listAccessGroups(): Promise<AccessGroup[]> {
  const cached = cachedAccessGroups();
  if (cached) return cached;
  if (!hasFirebaseProfileConfig()) return cacheAccessGroups(fallbackGroups());

  return resilientRead(
    "access-groups",
    async () => {
      const snapshot = await collectionRef().get();
      const stored = snapshot.docs.map((doc: any) => normalizeGroup(doc.id, doc.data()));
      const groups = stored.length ? stored : fallbackGroups();
      const sorted = groups.sort((a: AccessGroup, b: AccessGroup) => b.rank - a.rank || a.id.localeCompare(b.id, "uk", { numeric: true }) || a.name.localeCompare(b.name, "uk"));

      if (stored.length < DEFAULT_GROUPS.length && Date.now() - (globalThis.__mistblossomAccessGroupsEnsuredAt || 0) > ACCESS_GROUPS_ENSURE_TTL_MS) {
        globalThis.__mistblossomAccessGroupsEnsuredAt = Date.now();
        void ensureDefaultAccessGroups().catch((error) => {
          logThrottled("warn", "access_groups.ensure_defaults_failed", { message: safeErrorText(error) }, 5 * 60_000);
        });
      }

      return cacheAccessGroups(sorted);
    },
    {
      ttlMs: ACCESS_GROUPS_CACHE_TTL_MS,
      timeoutMs: 2_500,
      circuitKey: "firebase-access-groups-read",
      circuitTtlMs: 90_000,
      fallback: () => cachedAccessGroups() || fallbackGroups(),
      logEvent: "access_groups.read_failed",
    },
  );
}

export async function ensureDefaultAccessGroups() {
  if (!hasFirebaseProfileConfig()) return fallbackGroups();
  const ref = collectionRef();
  await Promise.all(DEFAULT_GROUPS.map(async (group) => firebaseWrite(
    "access-groups",
    `access-group:${group.id}:ensure`,
    async () => {
    const doc = ref.doc(group.id);
    const snap = await doc.get();
    if (!snap.exists) {
      await doc.set({
        ...group,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      return;
    }

    const current = normalizeGroup(group.id, snap.data());
    const patch: Partial<AccessGroup> & { updatedAt?: string } = {};
    if (current.role !== group.role) patch.role = group.role;
    if (current.lockedId !== group.lockedId) patch.lockedId = group.lockedId;
    if (current.protectedGroup !== group.protectedGroup) patch.protectedGroup = group.protectedGroup;
    if (!current.icon && group.icon) patch.icon = group.icon;
    if (group.id === DEFAULT_ADMIN_GROUP_ID) {
      const mergedAdminPermissions = Array.from(new Set([...current.permissions, ...DASHBOARD_PERMISSION_KEYS]));
      if (mergedAdminPermissions.length !== current.permissions.length) patch.permissions = mergedAdminPermissions;
    }
    if (group.id === DEFAULT_MENTOR_GROUP_ID && !current.name) patch.name = group.name;
    if ((group.id === DEFAULT_MENTOR_GROUP_ID || group.id === DEFAULT_MEMBER_GROUP_ID) && !current.permissions.includes("profiles.group.view")) {
      patch.permissions = Array.from(new Set([...(patch.permissions || current.permissions), "profiles.group.view"]));
    }
    if (Object.keys(patch).length) {
      await doc.set({ ...patch, updatedAt: nowIso() }, { merge: true });
    }
    },
    {
      timeoutMs: 3_000,
      logEvent: "access_groups.ensure_write_failed",
      fallback: () => undefined,
    },
  )));
  return fallbackGroups();
}

export async function getAccessGroup(groupId: string) {
  const id = cleanId(groupId);
  if (!id) return null;
  const groups = await listAccessGroups();
  return groups.find((group) => group.id === id) || null;
}

export async function resolveAccessGroupFromDiscord(roleIdsInput: string[], userId?: string | null, ownerId?: string | null) {
  const user = String(userId || "").trim();
  const owner = String(ownerId || "").trim();
  const groups = await listAccessGroups();
  const admin = groups.find((group) => group.id === DEFAULT_ADMIN_GROUP_ID) || DEFAULT_GROUPS[0];
  if (user && owner && user === owner) {
    return { group: admin, isServerOwner: true };
  }

  const roleIds = new Set(roleIdsInput.map((roleId) => String(roleId || "").trim()).filter(Boolean));
  const matched = groups
    .filter((group) => group.discordRoleIds.some((roleId) => roleIds.has(roleId)))
    .sort((a, b) => b.rank - a.rank);

  if (matched[0]) return { group: matched[0], isServerOwner: false };

  const member = groups.find((group) => group.id === DEFAULT_MEMBER_GROUP_ID) || DEFAULT_GROUPS.find((group) => group.id === DEFAULT_MEMBER_GROUP_ID) || DEFAULT_GROUPS[DEFAULT_GROUPS.length - 1];
  return { group: member, isServerOwner: false };
}

export function applyAccessGroupToSession(session: DashboardSession, group: AccessGroup, isServerOwner = false): DashboardSession {
  const permissions = isServerOwner ? [...DASHBOARD_PERMISSION_KEYS] : [...group.permissions];
  return {
    ...session,
    role: isServerOwner ? "admin" : group.role,
    groupId: group.id,
    groupName: isServerOwner ? "Власник сервера" : group.name,
    groupRank: isServerOwner ? 1000 : group.rank,
    permissions,
    isServerOwner,
  };
}

export function hasPermission(session: DashboardSession | null | undefined, permission: DashboardPermissionKey) {
  if (!session) return false;
  if (session.isServerOwner) return true;
  if (session.groupId || session.permissions?.length) return Boolean(session.permissions?.includes(permission));
  return session.role === "admin";
}

export function canManageGroups(session: DashboardSession | null | undefined) {
  return Boolean(session && session.role === "admin" && hasPermission(session, "groups.manage"));
}

export function canEditTargetGroup(viewer: DashboardSession | null | undefined, target: AccessGroup) {
  if (!canManageGroups(viewer)) return false;
  if (!viewer) return false;
  if (viewer.isServerOwner) return true;
  if (target.id === DEFAULT_ADMIN_GROUP_ID) return false;
  if (target.role === "admin" || target.rank >= 100 || target.permissions.includes("groups.manage")) return false;
  if (viewer.groupId && viewer.groupId === target.id) return false;
  return true;
}

export async function upsertAccessGroup(input: {
  id?: unknown;
  currentId?: unknown;
  name?: unknown;
  role?: unknown;
  rank?: unknown;
  discordRoleId?: unknown;
  discordRoleIds?: unknown;
  icon?: unknown;
  permissions?: unknown;
}, viewer: DashboardSession) {
  if (!canManageGroups(viewer)) throw new Error("Недостатньо прав для зміни груп.");
  if (!hasFirebaseProfileConfig()) throw new Error("Firebase не налаштований.");

  const currentId = cleanId(input.currentId);
  const nextId = cleanId(input.id || currentId);
  if (!nextId) throw new Error("Вкажи ID групи.");

  const groups = await listAccessGroups();
  const currentGroup = currentId ? groups.find((group) => group.id === currentId) || null : null;
  const conflictGroup = groups.find((group) => group.id === nextId && group.id !== currentId) || null;
  if (conflictGroup) throw new Error("Група з таким ID уже існує.");

  const target = currentGroup || normalizeGroup(nextId, { id: nextId, name: input.name, permissions: ["dashboard.view"] });
  if (currentGroup && !canEditTargetGroup(viewer, currentGroup)) throw new Error("Цю групу не можна змінювати з поточного акаунта.");

  const fixedId = currentGroup?.lockedId || FIXED_GROUP_IDS.has(currentId || nextId);
  const id = fixedId ? (currentGroup?.id || nextId) : nextId;
  const rankInput = Number(input.rank);
  const rank = Number.isFinite(rankInput) ? Math.max(1, Math.min(100, Math.floor(rankInput))) : target.rank;
  const effectiveRank = id === DEFAULT_ADMIN_GROUP_ID ? 100 : id === DEFAULT_MODERATOR_GROUP_ID ? 50 : id === DEFAULT_MEMBER_GROUP_ID ? 10 : rank;
  const effectiveRole = roleForGroup(id, effectiveRank, input.role || target.role);
  const requestedPermissions = cleanPermissions(input.permissions);
  if (!requestedPermissions.includes("dashboard.view")) requestedPermissions.unshift("dashboard.view");

  if (requestedPermissions.includes("groups.manage") && effectiveRole !== "admin") {
    throw new Error("Право керування групами можна видавати тільки групам із системною роллю адміна.");
  }

  if (!viewer.isServerOwner && (id === DEFAULT_ADMIN_GROUP_ID || effectiveRole === "admin" || effectiveRank >= 100 || requestedPermissions.includes("groups.manage"))) {
    throw new Error("Адміністративні права груп може змінювати тільки власник Discord-сервера.");
  }

  const roleIdSource = input.discordRoleId ?? input.discordRoleIds;
  const discordRoleIds = cleanDiscordRoleIds(roleIdSource);
  const roleConflict = discordRoleIds[0]
    ? groups.find((group) => group.id !== currentId && group.discordRoleIds.includes(discordRoleIds[0]))
    : null;
  if (roleConflict) throw new Error(`Discord role ID уже привʼязаний до групи «${roleConflict.name}». Одна Discord-роль не повинна керувати кількома групами.`);

  const doc = {
    id,
    name: cleanName(input.name, target.name),
    role: effectiveRole,
    rank: effectiveRank,
    lockedId: FIXED_GROUP_IDS.has(id) || Boolean(target.lockedId),
    protectedGroup: FIXED_GROUP_IDS.has(id) || Boolean(target.protectedGroup),
    discordRoleIds,
    icon: cleanGroupIcon(input.icon ?? target.icon),
    permissions: requestedPermissions,
    updatedAt: nowIso(),
  };

  const ref = collectionRef();
  await firebaseWrite(
    "access-groups",
    `access-group:${id}:upsert`,
    async () => {
      if (currentId && currentId !== id) {
        await ref.doc(currentId).delete();
      }
      await ref.doc(id).set({ ...doc, createdAt: currentGroup?.createdAt || nowIso() }, { merge: true });
      clearRuntimeCachedValue("access-groups");
    },
    { timeoutMs: 4_000, logEvent: "access_groups.upsert_write_failed" },
  );
  return normalizeGroup(id, doc);
}

export async function deleteAccessGroup(groupId: string, viewer: DashboardSession) {
  if (!canManageGroups(viewer)) throw new Error("Недостатньо прав для видалення груп.");
  const id = cleanId(groupId);
  if (!id || FIXED_GROUP_IDS.has(id)) throw new Error("Системні групи не видаляються.");
  const group = await getAccessGroup(id);
  if (!group) return true;
  if (!canEditTargetGroup(viewer, group)) throw new Error("Цю групу не можна видалити з поточного акаунта.");
  await firebaseWrite(
    "access-groups",
    `access-group:${id}:delete`,
    async () => {
      await collectionRef().doc(id).delete();
      clearRuntimeCachedValue("access-groups");
    },
    { timeoutMs: 4_000, logEvent: "access_groups.delete_write_failed" },
  );
  return true;
}

export type AdminAuditLogItem = {
  id: string;
  action: string;
  actorId: string;
  actorName: string | null;
  actorGroupId: string | null;
  isServerOwner: boolean;
  status: "success" | "warning" | "error" | "info";
  summary: string | null;
  details: Record<string, unknown>;
  createdAt: string | null;
};

function auditStatus(value: unknown, action = ""): AdminAuditLogItem["status"] {
  const status = String(value || "").trim().toLowerCase();
  if (status === "success" || status === "warning" || status === "error" || status === "info") return status;
  if (/failed|error|denied|blocked/i.test(action)) return "error";
  return "success";
}

function auditLevel(status: AdminAuditLogItem["status"]): StructuredLogLevel {
  if (status === "warning" || status === "error" || status === "success") return status;
  return "info";
}

function auditSummary(action: string, details: Record<string, unknown>) {
  const explicit = String(details.summary || details.message || "").trim();
  if (explicit) return explicit.slice(0, 900);
  if (typeof details.checked === "number" || typeof details.changed === "number" || typeof details.failed === "number") {
    return [
      typeof details.checked === "number" ? `перевірено ${details.checked}` : null,
      typeof details.targets === "number" ? `цілей ${details.targets}` : null,
      typeof details.changed === "number" ? `змінено ${details.changed}` : null,
      typeof details.removedRoles === "number" ? `ролей знято ${details.removedRoles}` : null,
      typeof details.failed === "number" ? `помилок ${details.failed}` : null,
    ].filter(Boolean).join(" • ") || action;
  }
  return action;
}

/**
 * Compatibility reader for code that still expects the old audit shape.
 * Source of truth is now PostgreSQL `system_logs`; Discord is never read back
 * as log storage.
 */
export async function listAdminAuditLogs(limitInput: unknown = 100): Promise<AdminAuditLogItem[]> {
  const limit = Math.max(10, Math.min(250, Math.floor(Number(limitInput) || 50)));
  const logs = await listStructuredLogs({ limit, sinceHours: 72 });
  return logs.map((item) => ({
    id: item.id,
    action: item.event,
    actorId: item.actorId || (item.source === "system" ? "system" : ""),
    actorName: item.actorName,
    actorGroupId: item.actorGroupId,
    isServerOwner: Boolean(item.details.isServerOwner),
    status: item.level === "warning" || item.level === "error" || item.level === "success" ? item.level : "info",
    summary: item.message,
    details: item.details,
    createdAt: item.createdAt,
  }));
}

/**
 * Administrative mutations are stored locally as structured Action logs.
 * They are deliberately NOT mirrored to Discord. Security is the only
 * category allowed to leave the server-side log store.
 */
export async function recordAdminAudit(action: string, viewer: DashboardSession, details: Record<string, unknown> = {}) {
  const status = auditStatus(details.status, action);
  return recordStructuredLog({
    category: "action",
    level: auditLevel(status),
    source: "dashboard",
    event: action,
    message: auditSummary(action, details),
    actorId: viewer.id,
    actorName: viewer.name || viewer.login || null,
    actorGroupId: viewer.groupId || null,
    resourceType: typeof details.resourceType === "string" ? details.resourceType : null,
    resourceId: typeof details.resourceId === "string"
      ? details.resourceId
      : typeof details.raidId === "string"
        ? details.raidId
        : typeof details.pollId === "string"
          ? details.pollId
          : typeof details.profileId === "string"
            ? details.profileId
            : null,
    details: {
      ...details,
      status,
      isServerOwner: Boolean(viewer.isServerOwner),
    },
  });
}

/**
 * System/auth/background events share the same PostgreSQL log. Category is
 * inferred from the event name so auth/security/database/integration events
 * can be filtered independently in the explorer.
 */
export async function recordSystemAudit(action: string, details: Record<string, unknown> = {}) {
  const status = auditStatus(details.status, action);
  const category = inferStructuredLogCategory(action, details);
  return recordStructuredLog({
    category,
    level: auditLevel(status),
    source: "system",
    event: action,
    message: auditSummary(action, details),
    actorId: "system",
    actorName: "System",
    details: { ...details, status },
  });
}
