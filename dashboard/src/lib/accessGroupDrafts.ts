import {
  DASHBOARD_PERMISSION_KEYS,
  type AccessGroup,
  type DashboardPermissionKey,
} from "@/lib/accessGroupSchema";
export const NEW_GROUP_DRAFT = "create";
export const groupDraftKey = (id: string) => `group:${id}`;
export type GroupValues = {
  id: string;
  name: string;
  role: AccessGroup["role"];
  rank: string;
  icon: string;
  discordRoleId: string;
  permissions: DashboardPermissionKey[];
};
export type GroupDraft = {
  key: string;
  base: GroupValues;
  baseRevision: string | null;
  values: GroupValues;
  editToken: string;
  updatedAt: number;
  pending?: { mutationId: string; targetId: string; values: GroupValues };
};
export function groupValues(group?: AccessGroup): GroupValues {
  return group
    ? {
        id: group.id,
        name: group.name,
        role: group.role,
        rank: String(group.rank),
        icon: group.icon || "",
        discordRoleId: group.discordRoleIds[0] || "",
        permissions: [...group.permissions],
      }
    : {
        id: "",
        name: "",
        role: "member",
        rank: "20",
        icon: "",
        discordRoleId: "",
        permissions: ["dashboard.view"],
      };
}
export function sameGroupValues(a: GroupValues, b: GroupValues) {
  return (
    ["id", "name", "role", "rank", "icon", "discordRoleId"].every(
      (key) => a[key as keyof GroupValues] === b[key as keyof GroupValues],
    ) &&
    [...a.permissions].sort().join("|") === [...b.permissions].sort().join("|")
  );
}
export function draftDirty(draft: GroupDraft) {
  return !sameGroupValues(draft.values, draft.base);
}
export function makeGroupDraft(group?: AccessGroup): GroupDraft {
  const values = groupValues(group);
  return {
    key: group ? groupDraftKey(group.id) : NEW_GROUP_DRAFT,
    base: values,
    values,
    baseRevision: group?.revision || null,
    editToken: crypto.randomUUID(),
    updatedAt: Date.now(),
  };
}
export function updateGroupDraft(
  current: GroupDraft,
  patch: Partial<GroupValues>,
): GroupDraft {
  return {
    ...current,
    values: { ...current.values, ...patch },
    editToken: crypto.randomUUID(),
    updatedAt: Date.now(),
  };
}
function validValues(value: any): value is GroupValues {
  return (
    value &&
    typeof value === "object" &&
    ["id", "name", "rank", "icon", "discordRoleId"].every(
      (key) => typeof value[key] === "string",
    ) &&
    value.id.length <= 32 &&
    value.name.length <= 80 &&
    value.rank.length <= 12 &&
    value.icon.length <= 24 &&
    value.discordRoleId.length <= 25 &&
    ["member", "mentor", "moderator", "admin"].includes(value.role) &&
    Array.isArray(value.permissions) &&
    value.permissions.length <= DASHBOARD_PERMISSION_KEYS.length &&
    value.permissions.every((key: any) =>
      DASHBOARD_PERMISSION_KEYS.includes(key),
    )
  );
}
export function parseGroupDrafts(raw: string | null): {
  expanded: string;
  drafts: Map<string, GroupDraft>;
} {
  const result = { expanded: "", drafts: new Map<string, GroupDraft>() };
  if (!raw) return result;
  if (raw.length > 131072)
    throw new Error("Чернетки завеликі для відновлення.");
  const data = JSON.parse(raw);
  if (
    data?.version !== 1 ||
    !Array.isArray(data.drafts) ||
    data.drafts.length > 100
  )
    throw new Error("Невідомий формат чернеток.");
  result.expanded =
    typeof data.expanded === "string" ? data.expanded.slice(0, 40) : "";
  for (const draft of data.drafts) {
    if (
      !draft ||
      (draft.key !== NEW_GROUP_DRAFT &&
        !/^group:[A-Za-z0-9_-]{1,32}$/.test(draft.key)) ||
      !validValues(draft.values) ||
      !validValues(draft.base) ||
      (draft.baseRevision !== null &&
        (typeof draft.baseRevision !== "string" ||
          !/^[a-f0-9]{64}$/.test(draft.baseRevision))) ||
      typeof draft.editToken !== "string" ||
      !/^[a-f0-9-]{36}$/.test(draft.editToken) ||
      !Number.isFinite(draft.updatedAt) ||
      (draft.key !== NEW_GROUP_DRAFT &&
        (draft.baseRevision === null ||
          draft.base.id !== draft.key.slice(6))) ||
      (draft.pending &&
        (!/^[a-f0-9-]{36}$/.test(draft.pending.mutationId) ||
          !/^[A-Za-z0-9_-]{1,32}$/.test(draft.pending.targetId) ||
          !validValues(draft.pending.values)))
    )
      throw new Error(
        "Чернетка пошкоджена; автоматичне відновлення неможливе.",
      );
    if (draftDirty(draft) || draft.pending) result.drafts.set(draft.key, draft);
  }
  return result;
}
/** A receipt confirms only that explicit submission. Later typing stays dirty. */
export function reconcileGroupDrafts(
  drafts: Map<string, GroupDraft>,
  groups: AccessGroup[],
) {
  const next = new Map(drafts);
  for (const [key, draft] of drafts) {
    const receipt =
      draft.pending &&
      groups.find(
        (group) =>
          group.id === draft.pending!.targetId &&
          group.lastMutationId === draft.pending!.mutationId,
      );
    if (!receipt) continue;
    next.delete(key);
    if (!sameGroupValues(draft.values, draft.pending!.values))
      next.set(groupDraftKey(receipt.id), {
        ...draft,
        key: groupDraftKey(receipt.id),
        base: groupValues(receipt),
        baseRevision: receipt.revision || null,
        pending: undefined,
      });
  }
  return next;
}
