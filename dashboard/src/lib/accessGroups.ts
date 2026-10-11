import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  getFirebaseAdminDb,
  hasFirebaseProfileConfig,
} from "@/lib/firebaseAdmin";
import {
  getRuntimeCachedValue,
  setRuntimeCachedValue,
  clearRuntimeCachedValue,
  resilientRead,
  logThrottled,
  safeErrorText,
} from "@/lib/runtimeResilience";
import {
  assertFirebaseWriteAvailable,
  firebaseWrite,
} from "@/lib/firebaseAccess";
import {
  inferStructuredLogCategory,
  listStructuredLogs,
  recordStructuredLog,
  type StructuredLogLevel,
} from "@/lib/structuredLogs";
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
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
}

function cleanName(value: unknown, fallback = "Група") {
  return (
    String(value || fallback)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80) || fallback
  );
}

function cleanDiscordRoleIds(value: unknown) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,;]+/g);
  const firstValidRoleId = items
    .map((item) => String(item || "").trim())
    .find((item) => /^\d{16,25}$/.test(item));
  return firstValidRoleId ? [firstValidRoleId] : [];
}

function cleanGroupIcon(value: unknown) {
  const icon = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
  if (!icon) return null;
  // Optional visual marker only: emoji, short text, or compact symbol. No HTML/URLs.
  return icon.replace(/[<>]/g, "");
}

function cleanPermissions(value: unknown) {
  const allowed = new Set<string>(DASHBOARD_PERMISSION_KEYS);
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,;]+/g);
  return Array.from(
    new Set(
      items
        .map((item) => String(item || "").trim())
        .filter((item): item is DashboardPermissionKey => allowed.has(item)),
    ),
  );
}

function cleanRole(
  value: unknown,
  fallback: DashboardRole = "member",
): DashboardRole {
  return value === "admin" ||
    value === "moderator" ||
    value === "mentor" ||
    value === "member"
    ? value
    : fallback;
}

function roleForGroup(
  id: string,
  rank: number,
  requestedRole?: unknown,
): DashboardRole {
  if (id === DEFAULT_ADMIN_GROUP_ID) return "admin";
  if (id === DEFAULT_MODERATOR_GROUP_ID) return "moderator";
  if (id === DEFAULT_MENTOR_GROUP_ID) return "mentor";
  if (id === DEFAULT_MEMBER_GROUP_ID) return "member";
  if (
    requestedRole !== undefined &&
    requestedRole !== null &&
    String(requestedRole).trim()
  ) {
    return cleanRole(requestedRole, "member");
  }
  if (rank >= 100) return "admin";
  if (rank >= 50) return "moderator";
  if (rank >= 20) return "mentor";
  return "member";
}

// Hash raw snapshots so legacy/direct changes also invalidate the token.
// Every new write carries a UUID generation, detecting delete/recreate and ABA.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function groupRevision(raw: Record<string, unknown>) {
  return createHash("sha256").update(stableJson(raw)).digest("hex");
}
export class AccessGroupError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
class CatalogChanged extends Error {}
function writeGuardRef() {
  return getFirebaseAdminDb()
    .collection("dashboardSettings")
    .doc("accessGroupsWriteGuard");
}
function generation(snapshot: any) {
  return snapshot.data()?.generation ?? null;
}
/** Editor reads never replace unavailable storage with cached/default rights. */
export async function listAccessGroupsForManagement(): Promise<AccessGroup[]> {
  if (!hasFirebaseProfileConfig())
    throw new AccessGroupError("Сховище груп недоступне.", 503);
  const snapshot = await collectionRef().get();
  return snapshot.docs
    .map((doc: any) => normalizeGroup(doc.id, doc.data()))
    .sort(
      (a: AccessGroup, b: AccessGroup) =>
        b.rank - a.rank ||
        a.id.localeCompare(b.id, "uk", { numeric: true }) ||
        a.name.localeCompare(b.name, "uk"),
    );
}
// PgFirestore supports document reads, not query reads in transactions. A
// catalogue snapshot read after its guard is accepted only if the guard still
// matches. All group writers change that guard in the same atomic transaction.
async function withGroupCatalog<T>(
  writer: (transaction: any, groups: AccessGroup[]) => Promise<T>,
): Promise<T> {
  assertFirebaseWriteAvailable("access-groups");
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await writeGuardRef().get();
    const groups = await listAccessGroupsForManagement();
    try {
      const result = await getFirebaseAdminDb().runTransaction(
        async (transaction) => {
          const guard = await transaction.get(writeGuardRef());
          if (generation(guard) !== generation(before))
            throw new CatalogChanged();
          const value = await writer(transaction, groups);
          transaction.set(writeGuardRef(), {
            generation: randomUUID(),
            updatedAt: nowIso(),
          });
          return value;
        },
      );
      clearRuntimeCachedValue("access-groups");
      return result;
    } catch (error) {
      if (!(error instanceof CatalogChanged)) throw error;
    }
  }
  throw new AccessGroupError(
    "Групи зараз змінює інший адміністратор. Онови список і повтори збереження.",
    409,
  );
}
async function assertFreshManager(transaction: any, viewer: DashboardSession) {
  if (!canManageGroups(viewer))
    throw new AccessGroupError("Недостатньо прав для зміни груп.", 403);
  if (viewer.isServerOwner) return;
  if (!viewer.groupId)
    throw new AccessGroupError("Онови сесію перед керуванням групами.", 403);
  const snapshot = await transaction.get(collectionRef().doc(viewer.groupId));
  if (
    !snapshot.exists ||
    !canManageGroups(
      applyAccessGroupToSession(
        viewer,
        normalizeGroup(viewer.groupId, snapshot.data()),
      ),
    )
  )
    throw new AccessGroupError(
      "Право керування групами вже змінено. Онови сесію.",
      403,
    );
}
function expectedRevision(value: unknown, currentId: string) {
  if (
    currentId
      ? typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)
      : value !== null
  )
    throw new AccessGroupError(
      "Онови сторінку: потрібна актуальна версія групи.",
      428,
    );
}
function assertRevision(snapshot: any, revision: unknown) {
  if (!snapshot.exists || groupRevision(snapshot.data()) !== revision)
    throw new AccessGroupError(
      "Групу змінили або видалили після відкриття редактора. Чернетка збережена; порівняй її з актуальними даними.",
      409,
    );
}

function normalizeGroup(
  idInput: string,
  raw: Record<string, unknown> = {},
): AccessGroup {
  const id = cleanId(raw.id || idInput);
  const fallback = DEFAULT_GROUPS.find((group) => group.id === id);
  const rank = Number.isFinite(Number(raw.rank))
    ? Math.floor(Number(raw.rank))
    : (fallback?.rank ?? 10);
  const role = roleForGroup(id, rank, raw.role || fallback?.role);
  const permissions = cleanPermissions(raw.permissions);

  return {
    id,
    revision: groupRevision(raw),
    lastMutationId:
      typeof raw.lastMutationId === "string" ? raw.lastMutationId : null,
    name: cleanName(raw.name, fallback?.name || "Група"),
    role,
    rank,
    lockedId: Boolean(
      raw.lockedId ?? fallback?.lockedId ?? FIXED_GROUP_IDS.has(id),
    ),
    protectedGroup: Boolean(
      raw.protectedGroup ?? fallback?.protectedGroup ?? FIXED_GROUP_IDS.has(id),
    ),
    discordRoleIds: cleanDiscordRoleIds(
      raw.discordRoleId ?? raw.discordRoleIds,
    ),
    icon: cleanGroupIcon(raw.icon ?? fallback?.icon),
    permissions: permissions.length
      ? permissions
      : fallback?.permissions || ["dashboard.view"],
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

function fallbackGroups() {
  return DEFAULT_GROUPS.map((group) => ({
    ...group,
    permissions: [...group.permissions],
    discordRoleIds: [...group.discordRoleIds],
  }));
}

const ACCESS_GROUPS_CACHE_TTL_MS = Math.max(
  60_000,
  Math.min(
    30 * 60_000,
    Number(process.env.ACCESS_GROUPS_CACHE_TTL_MS || 10 * 60_000),
  ),
);
const ACCESS_GROUPS_ENSURE_TTL_MS = Math.max(
  60_000,
  Math.min(
    60 * 60_000,
    Number(process.env.ACCESS_GROUPS_ENSURE_TTL_MS || 30 * 60_000),
  ),
);

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomAccessGroupsEnsuredAt: number | undefined;
}

function cacheAccessGroups(groups: AccessGroup[]) {
  return setRuntimeCachedValue(
    "access-groups",
    groups.map((group) => ({
      ...group,
      permissions: [...group.permissions],
      discordRoleIds: [...group.discordRoleIds],
    })),
  );
}

function cachedAccessGroups() {
  return getRuntimeCachedValue<AccessGroup[]>(
    "access-groups",
    ACCESS_GROUPS_CACHE_TTL_MS,
  );
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
      const stored = snapshot.docs.map((doc: any) =>
        normalizeGroup(doc.id, doc.data()),
      );
      const groups = stored.length ? stored : fallbackGroups();
      const sorted = groups.sort(
        (a: AccessGroup, b: AccessGroup) =>
          b.rank - a.rank ||
          a.id.localeCompare(b.id, "uk", { numeric: true }) ||
          a.name.localeCompare(b.name, "uk"),
      );

      if (
        stored.length < DEFAULT_GROUPS.length &&
        Date.now() - (globalThis.__mistblossomAccessGroupsEnsuredAt || 0) >
          ACCESS_GROUPS_ENSURE_TTL_MS
      ) {
        globalThis.__mistblossomAccessGroupsEnsuredAt = Date.now();
        void ensureDefaultAccessGroups().catch((error) => {
          logThrottled(
            "warn",
            "access_groups.ensure_defaults_failed",
            { message: safeErrorText(error) },
            5 * 60_000,
          );
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
  await firebaseWrite(
    "access-groups",
    "access-group:defaults:ensure",
    () =>
      withGroupCatalog(async (transaction) => {
        const snapshots = [];
        for (const group of DEFAULT_GROUPS)
          snapshots.push(await transaction.get(collectionRef().doc(group.id)));
        for (const [index, group] of DEFAULT_GROUPS.entries()) {
          const snap = snapshots[index],
            doc = collectionRef().doc(group.id);
          if (!snap.exists) {
            transaction.create(doc, {
              ...group,
              generation: randomUUID(),
              createdAt: nowIso(),
              updatedAt: nowIso(),
            });
            continue;
          }
          const current = normalizeGroup(group.id, snap.data());
          const patch: Partial<AccessGroup> = {};
          if (current.role !== group.role) patch.role = group.role;
          if (current.lockedId !== group.lockedId)
            patch.lockedId = group.lockedId;
          if (current.protectedGroup !== group.protectedGroup)
            patch.protectedGroup = group.protectedGroup;
          if (!current.icon && group.icon) patch.icon = group.icon;
          if (group.id === DEFAULT_ADMIN_GROUP_ID) {
            const permissions = Array.from(
              new Set([...current.permissions, ...DASHBOARD_PERMISSION_KEYS]),
            );
            if (permissions.length !== current.permissions.length)
              patch.permissions = permissions;
          }
          if (
            (group.id === DEFAULT_MENTOR_GROUP_ID ||
              group.id === DEFAULT_MEMBER_GROUP_ID) &&
            !current.permissions.includes("profiles.group.view")
          )
            patch.permissions = Array.from(
              new Set([
                ...(patch.permissions || current.permissions),
                "profiles.group.view",
              ]),
            );
          if (Object.keys(patch).length)
            transaction.set(
              doc,
              { ...patch, generation: randomUUID(), updatedAt: nowIso() },
              { merge: true },
            );
        }
      }),
    {
      timeoutMs: 4_000,
      logEvent: "access_groups.ensure_write_failed",
      fallback: () => undefined,
    },
  );
  return fallbackGroups();
}

export async function getAccessGroup(groupId: string) {
  const id = cleanId(groupId);
  if (!id) return null;
  const groups = await listAccessGroups();
  return groups.find((group) => group.id === id) || null;
}

export async function resolveAccessGroupFromDiscord(
  roleIdsInput: string[],
  userId?: string | null,
  ownerId?: string | null,
) {
  const user = String(userId || "").trim();
  const owner = String(ownerId || "").trim();
  const groups = await listAccessGroups();
  const admin =
    groups.find((group) => group.id === DEFAULT_ADMIN_GROUP_ID) ||
    DEFAULT_GROUPS[0];
  if (user && owner && user === owner) {
    return { group: admin, isServerOwner: true };
  }

  const roleIds = new Set(
    roleIdsInput.map((roleId) => String(roleId || "").trim()).filter(Boolean),
  );
  const matched = groups
    .filter((group) =>
      group.discordRoleIds.some((roleId) => roleIds.has(roleId)),
    )
    .sort((a, b) => b.rank - a.rank);

  if (matched[0]) return { group: matched[0], isServerOwner: false };

  const member =
    groups.find((group) => group.id === DEFAULT_MEMBER_GROUP_ID) ||
    DEFAULT_GROUPS.find((group) => group.id === DEFAULT_MEMBER_GROUP_ID) ||
    DEFAULT_GROUPS[DEFAULT_GROUPS.length - 1];
  return { group: member, isServerOwner: false };
}

export function applyAccessGroupToSession(
  session: DashboardSession,
  group: AccessGroup,
  isServerOwner = false,
): DashboardSession {
  const permissions = isServerOwner
    ? [...DASHBOARD_PERMISSION_KEYS]
    : [...group.permissions];
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

export function hasPermission(
  session: DashboardSession | null | undefined,
  permission: DashboardPermissionKey,
) {
  if (!session) return false;
  if (session.isServerOwner) return true;
  if (session.groupId || session.permissions?.length)
    return Boolean(session.permissions?.includes(permission));
  return session.role === "admin";
}

export function canManageGroups(session: DashboardSession | null | undefined) {
  return Boolean(
    session &&
    session.role === "admin" &&
    hasPermission(session, "groups.manage"),
  );
}

export function canEditTargetGroup(
  viewer: DashboardSession | null | undefined,
  target: AccessGroup,
) {
  if (!canManageGroups(viewer)) return false;
  if (!viewer) return false;
  if (viewer.isServerOwner) return true;
  if (target.id === DEFAULT_ADMIN_GROUP_ID) return false;
  if (
    target.role === "admin" ||
    target.rank >= 100 ||
    target.permissions.includes("groups.manage")
  )
    return false;
  if (viewer.groupId && viewer.groupId === target.id) return false;
  return true;
}

export async function upsertAccessGroup(
  input: {
    id?: unknown;
    currentId?: unknown;
    name?: unknown;
    role?: unknown;
    rank?: unknown;
    discordRoleId?: unknown;
    discordRoleIds?: unknown;
    icon?: unknown;
    permissions?: unknown;
    expectedRevision?: unknown;
    mutationId?: unknown;
  },
  viewer: DashboardSession,
) {
  if (!canManageGroups(viewer))
    throw new AccessGroupError("Недостатньо прав для зміни груп.", 403);
  const currentId = String(input.currentId || "").trim(),
    nextId = String(input.id || currentId).trim();
  if (
    !/^[A-Za-z0-9_-]{1,32}$/.test(nextId) ||
    (currentId && !/^[A-Za-z0-9_-]{1,32}$/.test(currentId))
  )
    throw new AccessGroupError("ID: 1–32 символи, латиниця, цифри, _ або -.");
  expectedRevision(input.expectedRevision, currentId);
  const mutationId = String(input.mutationId || "");
  if (!/^[a-f0-9-]{36}$/.test(mutationId))
    throw new AccessGroupError("Онови форму перед збереженням.");
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 80
  )
    throw new AccessGroupError("Вкажи назву групи до 80 символів.");
  if (
    input.icon !== undefined &&
    (typeof input.icon !== "string" || input.icon.length > 24)
  )
    throw new AccessGroupError("Іконка: до 24 символів.");
  const rawRoleIds = input.discordRoleId ?? input.discordRoleIds ?? "",
    roleIds = Array.isArray(rawRoleIds) ? rawRoleIds : [rawRoleIds];
  if (
    roleIds.length > 1 ||
    roleIds.some(
      (value) =>
        typeof value !== "string" ||
        (value.trim() && !/^\d{16,25}$/.test(value.trim())),
    )
  )
    throw new AccessGroupError("Вкажи лише один коректний Discord role ID.");
  const rank = Number(input.rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 100)
    throw new AccessGroupError("Ранг має бути цілим числом від 1 до 100.");
  if (
    input.role !== undefined &&
    !["member", "mentor", "moderator", "admin"].includes(String(input.role))
  )
    throw new AccessGroupError("Невідома системна роль.");
  if (
    !Array.isArray(input.permissions) ||
    input.permissions.length > DASHBOARD_PERMISSION_KEYS.length ||
    input.permissions.some((key) => !DASHBOARD_PERMISSION_KEYS.includes(key))
  )
    throw new AccessGroupError("Некоректний перелік прав.");
  return withGroupCatalog(async (transaction, groups) => {
    await assertFreshManager(transaction, viewer);
    const source = collectionRef().doc(currentId || nextId),
      snapshot = await transaction.get(source);
    if (currentId) assertRevision(snapshot, input.expectedRevision);
    else if (snapshot.exists || FIXED_GROUP_IDS.has(nextId))
      throw new AccessGroupError("Група з таким ID уже існує.", 409);
    const current = currentId
      ? normalizeGroup(currentId, snapshot.data())
      : null;
    if (current && !canEditTargetGroup(viewer, current))
      throw new AccessGroupError(
        "Цю групу не можна змінювати з поточного акаунта.",
        403,
      );
    if (current?.lockedId && nextId !== currentId)
      throw new AccessGroupError("Системний ID не змінюється.");
    const destination =
      currentId && nextId !== currentId
        ? await transaction.get(collectionRef().doc(nextId))
        : snapshot;
    if (
      currentId &&
      nextId !== currentId &&
      (destination.exists || FIXED_GROUP_IDS.has(nextId))
    )
      throw new AccessGroupError("Група з таким ID уже існує.", 409);
    const effectiveRank =
      nextId === DEFAULT_ADMIN_GROUP_ID
        ? 100
        : nextId === DEFAULT_MODERATOR_GROUP_ID
          ? 50
          : nextId === DEFAULT_MEMBER_GROUP_ID
            ? 10
            : rank;
    const effectiveRole = roleForGroup(
      nextId,
      effectiveRank,
      input.role || current?.role,
    );
    const permissions = cleanPermissions(input.permissions);
    if (!permissions.includes("dashboard.view"))
      permissions.unshift("dashboard.view");
    if (permissions.includes("groups.manage") && effectiveRole !== "admin")
      throw new AccessGroupError(
        "Право керування групами можна видавати тільки адмінам.",
      );
    if (
      !viewer.isServerOwner &&
      (effectiveRole === "admin" ||
        effectiveRank >= 100 ||
        permissions.includes("groups.manage"))
    )
      throw new AccessGroupError(
        "Адміністративні права груп змінює тільки власник Discord-сервера.",
        403,
      );
    const discordRoleIds = cleanDiscordRoleIds(rawRoleIds);
    const collision = groups.find(
      (group) =>
        group.id !== currentId &&
        discordRoleIds[0] &&
        group.discordRoleIds.includes(discordRoleIds[0]),
    );
    if (collision)
      throw new AccessGroupError(
        `Discord-роль уже привʼязана до групи «${collision.name}».`,
        409,
      );
    const doc = {
      ...(currentId ? snapshot.data() : {}),
      id: nextId,
      name: cleanName(input.name),
      role: effectiveRole,
      rank: effectiveRank,
      lockedId: FIXED_GROUP_IDS.has(nextId) || Boolean(current?.lockedId),
      protectedGroup:
        FIXED_GROUP_IDS.has(nextId) || Boolean(current?.protectedGroup),
      discordRoleIds,
      icon: cleanGroupIcon(input.icon ?? current?.icon),
      permissions,
      generation: randomUUID(),
      lastMutationId: mutationId,
      lastMutationBy: `${viewer.provider}:${viewer.id}`,
      createdAt: current?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    if (currentId && currentId !== nextId) transaction.delete(source);
    if (!currentId || currentId !== nextId)
      transaction.create(collectionRef().doc(nextId), doc);
    else transaction.set(source, doc);
    return normalizeGroup(nextId, doc);
  });
}
export async function deleteAccessGroup(
  groupId: string,
  viewer: DashboardSession,
  revision?: unknown,
) {
  const id = String(groupId || "").trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || FIXED_GROUP_IDS.has(id))
    throw new AccessGroupError("Системні групи не видаляються.");
  expectedRevision(revision, id);
  await withGroupCatalog(async (transaction) => {
    await assertFreshManager(transaction, viewer);
    const doc = collectionRef().doc(id),
      snapshot = await transaction.get(doc);
    assertRevision(snapshot, revision);
    const group = normalizeGroup(id, snapshot.data());
    if (group.protectedGroup || !canEditTargetGroup(viewer, group))
      throw new AccessGroupError(
        "Цю групу не можна видалити з поточного акаунта.",
        403,
      );
    transaction.delete(doc);
  });
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
  const status = String(value || "")
    .trim()
    .toLowerCase();
  if (
    status === "success" ||
    status === "warning" ||
    status === "error" ||
    status === "info"
  )
    return status;
  if (/failed|error|denied|blocked/i.test(action)) return "error";
  return "success";
}

function auditLevel(status: AdminAuditLogItem["status"]): StructuredLogLevel {
  if (status === "warning" || status === "error" || status === "success")
    return status;
  return "info";
}

function auditSummary(action: string, details: Record<string, unknown>) {
  const explicit = String(details.summary || details.message || "").trim();
  if (explicit) return explicit.slice(0, 900);
  if (
    typeof details.checked === "number" ||
    typeof details.changed === "number" ||
    typeof details.failed === "number"
  ) {
    return (
      [
        typeof details.checked === "number"
          ? `перевірено ${details.checked}`
          : null,
        typeof details.targets === "number" ? `цілей ${details.targets}` : null,
        typeof details.changed === "number"
          ? `змінено ${details.changed}`
          : null,
        typeof details.removedRoles === "number"
          ? `ролей знято ${details.removedRoles}`
          : null,
        typeof details.failed === "number" ? `помилок ${details.failed}` : null,
      ]
        .filter(Boolean)
        .join(" • ") || action
    );
  }
  return action;
}

/**
 * Compatibility reader for code that still expects the old audit shape.
 * Source of truth is now PostgreSQL `system_logs`; Discord is never read back
 * as log storage.
 */
export async function listAdminAuditLogs(
  limitInput: unknown = 100,
): Promise<AdminAuditLogItem[]> {
  const limit = Math.max(
    10,
    Math.min(250, Math.floor(Number(limitInput) || 50)),
  );
  const logs = await listStructuredLogs({ limit, sinceHours: 72 });
  return logs.map((item) => ({
    id: item.id,
    action: item.event,
    actorId: item.actorId || (item.source === "system" ? "system" : ""),
    actorName: item.actorName,
    actorGroupId: item.actorGroupId,
    isServerOwner: Boolean(item.details.isServerOwner),
    status:
      item.level === "warning" ||
      item.level === "error" ||
      item.level === "success"
        ? item.level
        : "info",
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
export async function recordAdminAudit(
  action: string,
  viewer: DashboardSession,
  details: Record<string, unknown> = {},
) {
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
    resourceType:
      typeof details.resourceType === "string" ? details.resourceType : null,
    resourceId:
      typeof details.resourceId === "string"
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
export async function recordSystemAudit(
  action: string,
  details: Record<string, unknown> = {},
) {
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
