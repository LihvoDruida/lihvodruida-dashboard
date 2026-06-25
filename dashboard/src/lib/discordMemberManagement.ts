import "server-only";

import { mapConcurrentSettled } from "@/lib/concurrency";
import {
  addGuildMemberRoles,
  assertDiscordRolesManageable,
  fetchDiscordRoleControlSnapshot,
  fetchDiscordGuildBanSnapshot,
  fetchDiscordGuildBans,
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordGuildMembers,
  fetchDiscordGuildSnapshot,
  getDiscordGuildId,
  removeGuildMemberRoles,
  replaceGuildMemberRoles,
  updateGuildMemberNickname,
  type DiscordGuildMemberModerationItem,
  type DiscordGuildMemberSnapshot,
} from "@/lib/discordAdmin";
import { getGuildNicknamePolicy, nicknameMatchesTemplate } from "@/lib/guildNicknamePolicy";
import { refreshGuildRosterApiBatch, loadStoredGuildRosterData, type GuildRosterMember } from "@/lib/guildRoster";
import { deleteDashboardProfilesByDiscordUserId, listAllDashboardProfilesForDiscordSync, getProfilePublicName, type DashboardProfile, type ProfileCharacter } from "@/lib/profiles";
import { buildBattleNetCharacterKey, normalizeBattleNetNameSlug, normalizeBattleNetRealmSlug, normalizeCharacterKey } from "@/lib/wowCharacters";
import { removeRaidSignupsForAccounts } from "@/lib/raids";

function snowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function cleanNickname(value: unknown) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, 32)
    .join("");
}

function cleanRoleIds(values: unknown) {
  const items = Array.isArray(values) ? values : String(values || "").split(/[\s,;]+/g);
  return Array.from(new Set(items.map(snowflake).filter(Boolean))).slice(0, 10);
}

type ManageableRoleForSelection = {
  id: string;
  name: string;
  position: number;
  manageable: boolean;
  blockedReason?: string | null;
};

function compareDiscordRolesDesc(a: Pick<ManageableRoleForSelection, "id" | "name" | "position">, b: Pick<ManageableRoleForSelection, "id" | "name" | "position">) {
  const byPosition = Number(b.position || 0) - Number(a.position || 0);
  if (byPosition !== 0) return byPosition;
  try {
    const aId = BigInt(a.id);
    const bId = BigInt(b.id);
    if (bId > aId) return 1;
    if (bId < aId) return -1;
  } catch {
    // fall back to name sorting below
  }
  return String(a.name || "").localeCompare(String(b.name || ""), "uk");
}

async function resolveHighestManageableDiscordRole(roleIdsInput: unknown) {
  const requestedRoleIds = cleanRoleIds(roleIdsInput);
  if (!requestedRoleIds.length) throw new Error("Вибери Discord-роль для синхронізації.");

  const snapshot = await fetchDiscordRoleControlSnapshot();
  if (snapshot.error) throw new Error(snapshot.error);

  const roleMap = new Map(snapshot.roles.map((role) => [role.id, role]));
  const requestedRoles = requestedRoleIds.map((roleId) => {
    const role = roleMap.get(roleId);
    if (role) return role;
    const fallbackRole: ManageableRoleForSelection = {
      id: roleId,
      name: roleId,
      position: 0,
      manageable: false,
      blockedReason: "Роль не знайдено на сервері.",
    };
    return fallbackRole;
  });
  const blocked = requestedRoles.filter((role) => !role.manageable);
  if (blocked.length) {
    throw new Error(blocked.map((role) => `${role.name}: ${role.blockedReason || "роль недоступна для керування."}`).join(" "));
  }

  const highestRole = requestedRoles.sort(compareDiscordRolesDesc)[0];
  if (!highestRole) throw new Error("Не вдалося визначити найвищу Discord-роль для синхронізації.");

  return {
    roleIds: [highestRole.id],
    roleId: highestRole.id,
    roleName: highestRole.name,
    rolePosition: highestRole.position,
    requestedRoleIds,
    requestedRoleNames: requestedRoles.map((role) => role.name),
    ignoredLowerRoleIds: requestedRoleIds.filter((roleId) => roleId !== highestRole.id),
  };
}

function displayName(member: DiscordGuildMemberModerationItem) {
  return member.nick || member.globalName || member.username || member.userId;
}

function serverNickname(member: DiscordGuildMemberModerationItem) {
  return cleanNickname(member.nick || "");
}

function memberHasInvalidServerNickname(member: DiscordGuildMemberModerationItem, template: string) {
  const nickname = serverNickname(member);
  return !nickname || !nicknameMatchesTemplate(nickname, template);
}

function memberModerationPreview(member: DiscordGuildMemberModerationItem, template: string) {
  const nick = serverNickname(member);
  return {
    ...member,
    serverNickname: nick || null,
    checkedNickname: nick || "",
    mismatchReason: nick ? `Серверний нік не відповідає шаблону: ${template}` : "Серверний нік не встановлено.",
  };
}

function serverNicknameValidation(member: { nick?: string | null }, template: string) {
  const nickname = cleanNickname(member.nick || "");
  if (!nickname) {
    return { ok: false, nickname: null, reason: "Серверний нік не встановлено." };
  }
  if (!nicknameMatchesTemplate(nickname, template)) {
    return { ok: false, nickname, reason: `Серверний нік не відповідає шаблону: ${template}` };
  }
  return { ok: true, nickname, reason: "" };
}

function explainDiscordModerationError(error: unknown, action: string) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/50013|Missing Permissions|permission/i.test(message)) {
    return `${action}: Discord не дозволив дію. Найчастіше причина — роль бота нижче цільової ролі/учасника, або цільовий користувач є власником сервера.`;
  }
  if (/10007|Unknown Member|404/i.test(message)) {
    return `${action}: учасника не знайдено на цьому Discord-сервері.`;
  }
  if (/50001|Missing Access/i.test(message)) {
    return `${action}: бот не має доступу до цього сервера або каналу керування.`;
  }
  if (/token|401|Unauthorized/i.test(message)) {
    return `${action}: Discord bot token недійсний або не налаштований.`;
  }
  return message || `${action}: Discord API не виконав дію.`;
}

async function memberSnapshot(userId: string) {
  return fetchDiscordGuildMemberSnapshot(userId).catch(() => null);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roleListWithout(roleIds: string[], removeIds: string[]) {
  const removeSet = new Set(removeIds);
  return roleIds.filter((roleId) => !removeSet.has(roleId));
}

function roleListWith(roleIds: string[], addIds: string[]) {
  return Array.from(new Set([...roleIds, ...addIds].filter(Boolean)));
}

async function waitForMemberRoles(userId: string, predicate: (roleIds: string[]) => boolean, attempts = 6) {
  let snapshot = await memberSnapshot(userId);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (snapshot && predicate(snapshot.roleIds)) return snapshot;
    await sleep(350 + attempt * 180);
    snapshot = await memberSnapshot(userId);
  }
  return snapshot;
}

async function applyDiscordRoleDelta(params: {
  guildId: string;
  userId: string;
  addRoleIds?: string[];
  removeRoleIds?: string[];
  reason?: string;
  actionLabel?: string;
  before?: DiscordGuildMemberSnapshot | null;
}) {
  const before = params.before || await memberSnapshot(params.userId);
  if (!before) throw new Error("Discord-учасника не знайдено на сервері або бот не може його прочитати.");

  const requestedAdd = Array.from(new Set((params.addRoleIds || []).filter(Boolean)));
  const requestedRemove = Array.from(new Set((params.removeRoleIds || []).filter(Boolean)));
  const addSet = new Set(requestedAdd);
  const removeSet = new Set(requestedRemove);
  const conflictedRoleIds = requestedAdd.filter((roleId) => removeSet.has(roleId));
  if (conflictedRoleIds.length) {
    throw new Error(`Одна й та сама Discord-роль не може одночасно видаватись і зніматись: ${conflictedRoleIds.join(", ")}.`);
  }

  const addableRoleIds = requestedAdd.filter((roleId) => !before.roleIds.includes(roleId));
  const removableRoleIds = requestedRemove.filter((roleId) => before.roleIds.includes(roleId));
  const alreadyHadRoleIds = requestedAdd.filter((roleId) => before.roleIds.includes(roleId));
  const alreadyMissingRoleIds = requestedRemove.filter((roleId) => !before.roleIds.includes(roleId));

  if (!addableRoleIds.length && !removableRoleIds.length) {
    return {
      before,
      after: before,
      requestedAddRoleIds: requestedAdd,
      requestedRemoveRoleIds: requestedRemove,
      addableRoleIds,
      removableRoleIds,
      alreadyHadRoleIds,
      alreadyMissingRoleIds,
      addedRoleIds: [] as string[],
      removedRoleIds: [] as string[],
      stillMissingRoleIds: [] as string[],
      stillPresentRoleIds: [] as string[],
      usedPatchFallback: false,
      changed: 0,
      expectedChangeTotal: 0,
      unchangedBecauseAlreadyCorrect: alreadyHadRoleIds.length + alreadyMissingRoleIds.length,
      hasRequestedRole(roleId: string) {
        return addSet.has(roleId) || removeSet.has(roleId);
      },
    };
  }

  if (removableRoleIds.length) {
    await removeGuildMemberRoles({
      guildId: params.guildId,
      userId: params.userId,
      roleIds: removableRoleIds,
      reason: params.reason,
      concurrency: 1,
      maxConcurrency: 1,
    });
  }

  if (addableRoleIds.length) {
    await addGuildMemberRoles({
      guildId: params.guildId,
      userId: params.userId,
      roleIds: addableRoleIds,
      reason: params.reason,
      concurrency: 1,
      maxConcurrency: 1,
    });
  }

  let after = await waitForMemberRoles(params.userId, (roleIds) => {
    const removeOk = removableRoleIds.every((roleId) => !roleIds.includes(roleId));
    const addOk = addableRoleIds.every((roleId) => roleIds.includes(roleId));
    return removeOk && addOk;
  });

  let stillPresentRoleIds = removableRoleIds.filter((roleId) => after?.roleIds.includes(roleId));
  let stillMissingRoleIds = addableRoleIds.filter((roleId) => !after?.roleIds.includes(roleId));
  let usedPatchFallback = false;

  if ((stillPresentRoleIds.length || stillMissingRoleIds.length) && after) {
    usedPatchFallback = true;
    const desiredRoles = roleListWith(roleListWithout(after.roleIds, stillPresentRoleIds), stillMissingRoleIds);
    await replaceGuildMemberRoles({
      guildId: params.guildId,
      userId: params.userId,
      roleIds: desiredRoles,
      reason: `${params.reason || params.actionLabel || "Mistblossom role update"} (fallback role set)`,
    });
    after = await waitForMemberRoles(params.userId, (roleIds) => {
      const removeOk = removableRoleIds.every((roleId) => !roleIds.includes(roleId));
      const addOk = addableRoleIds.every((roleId) => roleIds.includes(roleId));
      return removeOk && addOk;
    });
    stillPresentRoleIds = removableRoleIds.filter((roleId) => after?.roleIds.includes(roleId));
    stillMissingRoleIds = addableRoleIds.filter((roleId) => !after?.roleIds.includes(roleId));
  }

  if (!after) throw new Error("Discord прийняв запит, але не вдалося повторно прочитати учасника для перевірки результату. Успіх не підтверджено.");

  const removedRoleIds = removableRoleIds.filter((roleId) => !after.roleIds.includes(roleId));
  const addedRoleIds = addableRoleIds.filter((roleId) => after.roleIds.includes(roleId));

  return {
    before,
    after,
    requestedAddRoleIds: requestedAdd,
    requestedRemoveRoleIds: requestedRemove,
    addableRoleIds,
    removableRoleIds,
    alreadyHadRoleIds,
    alreadyMissingRoleIds,
    addedRoleIds,
    removedRoleIds,
    stillMissingRoleIds,
    stillPresentRoleIds,
    usedPatchFallback,
    changed: addedRoleIds.length + removedRoleIds.length,
    expectedChangeTotal: addableRoleIds.length + removableRoleIds.length,
    unchangedBecauseAlreadyCorrect: alreadyHadRoleIds.length + alreadyMissingRoleIds.length,
    hasRequestedRole(roleId: string) {
      return addSet.has(roleId) || removeSet.has(roleId);
    },
  };
}

export async function updateDiscordMemberNickname(input: { userId: unknown; nickname: unknown; reason?: string }) {
  const guildId = getDiscordGuildId();
  const userId = snowflake(input.userId);
  const nickname = cleanNickname(input.nickname);
  if (!guildId) throw new Error("Discord-сервер не підключений.");
  if (!userId) throw new Error("Вкажи коректний Discord user ID.");
  if (!nickname) throw new Error("Вкажи новий серверний нік.");

  const guild = await fetchDiscordGuildSnapshot().catch(() => null);
  if (guild?.ownerId === userId) {
    throw new Error("Це власник сервера. Discord не дозволяє боту змінювати його нік — потрібно змінити вручну.");
  }

  const before = await memberSnapshot(userId);
  if (!before) throw new Error("Discord-учасника не знайдено на сервері або бот не може його прочитати.");

  try {
    await updateGuildMemberNickname({ guildId, userId, nickname, reason: input.reason || "Mistblossom manual nickname update" });
  } catch (error) {
    throw new Error(explainDiscordModerationError(error, "Зміна ніку"));
  }

  const after = await memberSnapshot(userId);
  if (!after) throw new Error("Нік відправлено в Discord, але не вдалося повторно прочитати учасника для перевірки результату.");
  if (after.nick !== nickname) {
    throw new Error("Discord прийняв запит, але серверний нік не змінився. Перевір ієрархію ролей бота або зміни нік вручну.");
  }

  return {
    userId,
    nickname,
    displayName: after.displayName || nickname,
    beforeNickname: before.nick || null,
    afterNickname: after.nick || null,
    verified: true,
  };
}

export async function addDiscordMemberRoles(input: { userId: unknown; roleIds: unknown; reason?: string }) {
  const guildId = getDiscordGuildId();
  const userId = snowflake(input.userId);
  const roleIds = cleanRoleIds(input.roleIds);
  if (!guildId) throw new Error("Discord-сервер не підключений.");
  if (!userId) throw new Error("Вкажи коректний Discord user ID.");
  if (!roleIds.length) throw new Error("Вибери хоча б одну Discord-роль.");

  const guild = await fetchDiscordGuildSnapshot().catch(() => null);
  if (guild?.ownerId === userId) {
    throw new Error("Це власник сервера. Discord не дозволяє боту змінювати ролі власника.");
  }

  const manageableRoleIds = await assertDiscordRolesManageable(roleIds);

  let delta: Awaited<ReturnType<typeof applyDiscordRoleDelta>>;
  try {
    delta = await applyDiscordRoleDelta({
      guildId,
      userId,
      addRoleIds: manageableRoleIds,
      reason: input.reason || "Mistblossom manual role add",
      actionLabel: "Видача ролі",
    });
  } catch (error) {
    throw new Error(explainDiscordModerationError(error, "Видача ролі"));
  }

  if (delta.stillMissingRoleIds.length) {
    throw new Error(`Discord прийняв запит, але ролі не зʼявилися в учасника: ${delta.stillMissingRoleIds.join(", ")}. Перевір ієрархію ролей бота.`);
  }

  return {
    userId,
    roleIds: manageableRoleIds,
    requestedRoleIds: roleIds,
    addedRoleIds: delta.addedRoleIds,
    alreadyHadRoleIds: delta.alreadyHadRoleIds,
    stillMissingRoleIds: delta.stillMissingRoleIds,
    beforeRoleIds: delta.before.roleIds,
    afterRoleIds: delta.after.roleIds,
    changed: delta.addedRoleIds.length,
    expectedChangeTotal: delta.expectedChangeTotal,
    usedPatchFallback: delta.usedPatchFallback,
    displayName: delta.after.displayName || delta.before.displayName || userId,
    verified: true,
  };
}

export async function removeDiscordMemberRoles(input: { userId: unknown; roleIds: unknown; reason?: string }) {
  const guildId = getDiscordGuildId();
  const userId = snowflake(input.userId);
  const roleIds = cleanRoleIds(input.roleIds);
  if (!guildId) throw new Error("Discord-сервер не підключений.");
  if (!userId) throw new Error("Вкажи коректний Discord user ID.");
  if (!roleIds.length) throw new Error("Вибери хоча б одну Discord-роль.");

  const guild = await fetchDiscordGuildSnapshot().catch(() => null);
  if (guild?.ownerId === userId) {
    throw new Error("Це власник сервера. Discord не дозволяє боту змінювати ролі власника.");
  }

  const manageableRoleIds = await assertDiscordRolesManageable(roleIds);

  let delta: Awaited<ReturnType<typeof applyDiscordRoleDelta>>;
  try {
    delta = await applyDiscordRoleDelta({
      guildId,
      userId,
      removeRoleIds: manageableRoleIds,
      reason: input.reason || "Mistblossom manual role remove",
      actionLabel: "Зняття ролі",
    });
  } catch (error) {
    throw new Error(explainDiscordModerationError(error, "Зняття ролі"));
  }

  if (delta.stillPresentRoleIds.length) {
    throw new Error(`Discord прийняв запит, але ролі досі є в учасника: ${delta.stillPresentRoleIds.join(", ")}. Перевір ієрархію ролей бота.`);
  }

  return {
    userId,
    roleIds: manageableRoleIds,
    requestedRoleIds: roleIds,
    removedRoleIds: delta.removedRoleIds,
    alreadyMissingRoleIds: delta.alreadyMissingRoleIds,
    stillPresentRoleIds: delta.stillPresentRoleIds,
    beforeRoleIds: delta.before.roleIds,
    afterRoleIds: delta.after.roleIds,
    changed: delta.removedRoleIds.length,
    expectedChangeTotal: delta.expectedChangeTotal,
    usedPatchFallback: delta.usedPatchFallback,
    displayName: delta.after.displayName || delta.before.displayName || userId,
    verified: true,
  };
}

export async function inspectDiscordNicknameTemplate(limit: unknown = 0) {
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(50_000, Math.floor(parsedLimit))
    : 50_000;
  const policy = await getGuildNicknamePolicy();
  const members = await fetchDiscordGuildMembers(safeLimit);
  const mismatched = members.filter((member) => memberHasInvalidServerNickname(member, policy.template));
  return {
    template: policy.template,
    checked: members.length,
    checkedField: "server_nick",
    mismatched: mismatched.slice(0, 50).map((member) => memberModerationPreview(member, policy.template)),
    mismatchedTotal: mismatched.length,
    missingServerNicknameTotal: mismatched.filter((member) => !serverNickname(member)).length,
  };
}

export async function removeRolesFromMembersWithInvalidNicknames(input: {
  roleIds?: unknown;
  removeRoleIds?: unknown;
  addRoleIds?: unknown;
  limit?: unknown;
  dryRun?: boolean;
  reason?: string;
}) {
  const guildId = getDiscordGuildId();
  if (!guildId) throw new Error("Discord-сервер не підключений.");

  const removeRoleIds = cleanRoleIds(input.removeRoleIds ?? input.roleIds);
  const addRoleIds = cleanRoleIds(input.addRoleIds);
  if (!removeRoleIds.length && !addRoleIds.length) {
    throw new Error("Вибери хоча б одну Discord-роль: що знімати або що видавати при неправильному ніку.");
  }

  const manageableRemoveRoleIds = removeRoleIds.length ? await assertDiscordRolesManageable(removeRoleIds) : [];
  const manageableAddRoleIds = addRoleIds.length ? await assertDiscordRolesManageable(addRoleIds) : [];
  const duplicated = manageableRemoveRoleIds.filter((roleId) => manageableAddRoleIds.includes(roleId));
  if (duplicated.length) {
    throw new Error(`Одна й та сама роль не може одночасно зніматись і видаватись: ${duplicated.join(", ")}.`);
  }

  const parsedLimit = Number(input.limit);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(50_000, Math.floor(parsedLimit))
    : 50_000;
  const policy = await getGuildNicknamePolicy();
  const members = await fetchDiscordGuildMembers(limit);
  const invalidMembers = members.filter((member) => memberHasInvalidServerNickname(member, policy.template));
  const targets = invalidMembers.filter((member) => {
    const hasRemovable = manageableRemoveRoleIds.some((roleId) => member.roleIds.includes(roleId));
    const hasMissingAddable = manageableAddRoleIds.some((roleId) => !member.roleIds.includes(roleId));
    return hasRemovable || hasMissingAddable;
  });
  const previewTargets = targets.map((member) => memberModerationPreview(member, policy.template));

  if (input.dryRun) {
    return {
      dryRun: true,
      template: policy.template,
      checked: members.length,
      invalidTotal: invalidMembers.length,
      matchedTargets: targets.length,
      changed: 0,
      removedRolesTotal: 0,
      addedRolesTotal: 0,
      unchanged: 0,
      skippedBeforeChange: 0,
      skippedFreshValid: 0,
      skippedItems: [],
      skippedItemsTotal: 0,
      stillPresentTotal: 0,
      stillMissingTotal: 0,
      failed: 0,
      checkedField: "server_nick",
      removeRoleIds: manageableRemoveRoleIds,
      addRoleIds: manageableAddRoleIds,
      missingServerNicknameTotal: targets.filter((member) => !serverNickname(member)).length,
      preview: previewTargets.slice(0, 100),
      changedItems: [],
      changedItemsTotal: 0,
      errors: [],
      errorsTotal: 0,
    };
  }

  const { results, meta } = await mapConcurrentSettled(
    targets,
    async (member) => {
      const fresh = await memberSnapshot(member.userId);
      if (!fresh) {
        return {
          userId: member.userId,
          name: displayName(member),
          serverNickname: serverNickname(member) || null,
          skipped: true,
          skipReason: "Discord-учасника не вдалося повторно прочитати перед зміною ролей.",
          requested: [] as string[],
          requestedRemove: [] as string[],
          requestedAdd: [] as string[],
          removed: [] as string[],
          added: [] as string[],
          stillPresent: [] as string[],
          stillMissing: [] as string[],
          beforeRoleIds: member.roleIds,
          afterRoleIds: member.roleIds,
          usedPatchFallback: false,
        };
      }

      const freshNicknameCheck = serverNicknameValidation(fresh, policy.template);
      if (freshNicknameCheck.ok) {
        return {
          userId: member.userId,
          name: fresh.displayName || displayName(member),
          serverNickname: freshNicknameCheck.nickname,
          skipped: true,
          skipReason: "Серверний нік уже відповідає шаблону; ролі не змінювались.",
          requested: [] as string[],
          requestedRemove: [] as string[],
          requestedAdd: [] as string[],
          removed: [] as string[],
          added: [] as string[],
          stillPresent: [] as string[],
          stillMissing: [] as string[],
          beforeRoleIds: fresh.roleIds,
          afterRoleIds: fresh.roleIds,
          usedPatchFallback: false,
        };
      }

      const currentRoleIds = fresh.roleIds;
      const removableRoleIds = manageableRemoveRoleIds.filter((roleId) => currentRoleIds.includes(roleId));
      const addableRoleIds = manageableAddRoleIds.filter((roleId) => !currentRoleIds.includes(roleId));

      const delta = await applyDiscordRoleDelta({
        guildId,
        userId: member.userId,
        removeRoleIds: removableRoleIds,
        addRoleIds: addableRoleIds,
        before: fresh,
        reason: input.reason || `Nickname does not match template: ${policy.template}`,
        actionLabel: "Ролі за неправильний серверний нік",
      });

      if (delta.stillPresentRoleIds.length) {
        throw new Error(`Discord прийняв запит, але ролі не знялися: ${delta.stillPresentRoleIds.join(", ")}. Перевір ієрархію ролей або чи це власник сервера.`);
      }

      if (delta.stillMissingRoleIds.length) {
        throw new Error(`Discord прийняв запит, але ролі не видались: ${delta.stillMissingRoleIds.join(", ")}. Перевір ієрархію ролей або чи це власник сервера.`);
      }

      return {
        userId: member.userId,
        name: fresh.displayName || displayName(member),
        serverNickname: freshNicknameCheck.nickname,
        skipped: false,
        skipReason: "",
        requested: removableRoleIds,
        requestedRemove: removableRoleIds,
        requestedAdd: addableRoleIds,
        removed: delta.removedRoleIds,
        added: delta.addedRoleIds,
        stillPresent: delta.stillPresentRoleIds,
        stillMissing: delta.stillMissingRoleIds,
        beforeRoleIds: delta.before.roleIds,
        afterRoleIds: delta.after.roleIds,
        usedPatchFallback: delta.usedPatchFallback,
      };
    },
    {
      profile: "external-api",
      concurrency: policy.nicknameCleanupConcurrency || undefined,
      min: 1,
      max: policy.nicknameCleanupMaxConcurrency || 1,
    },
  );

  const okItems = results.filter((result) => result.ok);
  const failedItems = results.filter((result) => !result.ok);
  const changedItems = okItems.filter((result) => !result.value.skipped && (result.value.removed.length > 0 || result.value.added.length > 0));
  const skippedItems = okItems.filter((result) => result.value.skipped);
  const skippedFreshValidItems = skippedItems.filter((result) => /відповідає шаблону/i.test(result.value.skipReason || ""));
  const removedRolesTotal = changedItems.reduce((sum, result) => sum + result.value.removed.length, 0);
  const addedRolesTotal = changedItems.reduce((sum, result) => sum + result.value.added.length, 0);
  const stillPresentTotal = okItems.reduce((sum, result) => sum + result.value.stillPresent.length, 0);
  const stillMissingTotal = okItems.reduce((sum, result) => sum + result.value.stillMissing.length, 0);
  return {
    dryRun: false,
    template: policy.template,
    checked: members.length,
    invalidTotal: invalidMembers.length,
    matchedTargets: targets.length,
    changed: changedItems.length,
    removedRolesTotal,
    addedRolesTotal,
    unchanged: okItems.length - changedItems.length - skippedItems.length,
    skippedBeforeChange: skippedItems.length,
    skippedFreshValid: skippedFreshValidItems.length,
    skippedItems: skippedItems.slice(0, 100).map((item) => item.value),
    skippedItemsTotal: skippedItems.length,
    stillPresentTotal,
    stillMissingTotal,
    failed: failedItems.length,
    concurrency: meta.concurrency,
    durationMs: meta.durationMs,
    checkedField: "server_nick",
    removeRoleIds: manageableRemoveRoleIds,
    addRoleIds: manageableAddRoleIds,
    missingServerNicknameTotal: targets.filter((member) => !serverNickname(member)).length,
    preview: previewTargets.slice(0, 100),
    changedItems: changedItems.slice(0, 200).map((item) => item.value),
    changedItemsTotal: changedItems.length,
    errors: failedItems.slice(0, 100).map((item) => ({
      userId: item.item.userId,
      name: displayName(item.item),
      serverNickname: serverNickname(item.item) || null,
      error: item.error instanceof Error ? item.error.message : String(item.error || "Помилка Discord API"),
    })),
    errorsTotal: failedItems.length,
  };
}



type AccountCleanupRosterRefreshResult = {
  attempted: boolean;
  skipped: boolean;
  refreshed: boolean;
  failed: boolean;
  memberCount: number;
  source: string | null;
  syncStatus: string | null;
  syncPhase: string | null;
  syncProcessed: { roster: number; battleNet: number; raiderIo: number } | null;
  error: string | null;
};

function accountCleanupFlag(name: string, fallback = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function accountCleanupRosterRefreshSteps() {
  const value = Number(process.env.ACCOUNT_CLEANUP_ROSTER_REFRESH_STEPS || 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(Math.floor(value), 8));
}

async function refreshGuildRosterBeforeAccountCleanup(): Promise<AccountCleanupRosterRefreshResult> {
  if (!accountCleanupFlag("ACCOUNT_CLEANUP_REFRESH_ROSTER", true)) {
    return {
      attempted: false,
      skipped: true,
      refreshed: false,
      failed: false,
      memberCount: 0,
      source: null,
      syncStatus: null,
      syncPhase: null,
      syncProcessed: null,
      error: null,
    };
  }

  try {
    let latest: Awaited<ReturnType<typeof refreshGuildRosterApiBatch>> | null = null;
    const steps = accountCleanupRosterRefreshSteps();
    for (let step = 0; step < steps; step += 1) {
      latest = await refreshGuildRosterApiBatch({
        forceRoster: step === 0,
        continueSync: step > 0,
        softSync: true,
        bypassCache: true,
      });

      // The first forced step refreshes and writes the authoritative guild roster list.
      // Extra steps only enrich Battle.net/Raider.IO fields and are controlled by env.
      if (step === 0 && steps === 1) break;
      if (latest.refresh.sync.status !== "running") break;
    }

    const sync = latest?.refresh.sync || null;
    const failed = Boolean(
      !latest ||
        sync?.status === "failed" ||
        latest.refresh.roster.source === "Battle.net roster unavailable" ||
        /unavailable|failed|помилка/i.test(String(latest.error || "")),
    );

    return {
      attempted: true,
      skipped: false,
      refreshed: Boolean(latest?.refresh.roster.refreshed),
      failed,
      memberCount: latest?.members.length || 0,
      source: latest?.source || latest?.refresh.roster.source || null,
      syncStatus: sync?.status || null,
      syncPhase: sync?.phase || null,
      syncProcessed: sync?.processed || null,
      error: failed
        ? latest?.error || latest?.refresh.sync.errors?.at(-1) || "Не вдалося оновити склад гільдії перед очищенням."
        : null,
    };
  } catch (error) {
    return {
      attempted: true,
      skipped: false,
      refreshed: false,
      failed: true,
      memberCount: 0,
      source: null,
      syncStatus: "failed",
      syncPhase: "failed",
      syncProcessed: null,
      error: safeErrorText(error, "Не вдалося оновити склад гільдії перед очищенням."),
    };
  }
}

type DiscordProfileMembershipCleanupStatus = "member" | "not_member" | "banned";

type DiscordProfileMembershipPreview = {
  profileId: string;
  userId: string;
  name: string;
  status: Exclude<DiscordProfileMembershipCleanupStatus, "member">;
  reason: string;
  banReason?: string | null;
  characters: number;
  lastLoginAt?: string | null;
  updatedAt?: string | null;
};

type DiscordProfileRosterProtectedPreview = {
  profileId: string;
  userId: string;
  name: string;
  characters: number;
  matchedRosterCharacters: string[];
  reason: string;
  lastLoginAt?: string | null;
  updatedAt?: string | null;
};

function isDiscordApiNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /^Discord API 404:/i.test(message) || /Unknown Member|Unknown Ban/i.test(message);
}

function safeErrorText(error: unknown, fallback = "невідома помилка") {
  const message = error instanceof Error ? error.message : String(error || "");
  return (message || fallback).slice(0, 300);
}

function profileCleanupDisplayName(profile: DashboardProfile) {
  return getProfilePublicName(profile) || profile.displayName || profile.login || profile.profileId;
}

function discordProfileCleanupPreview(profile: DashboardProfile, status: Exclude<DiscordProfileMembershipCleanupStatus, "member">, reason: string, banReason?: string | null): DiscordProfileMembershipPreview {
  return {
    profileId: profile.profileId,
    userId: profileDiscordId(profile),
    name: profileCleanupDisplayName(profile),
    status,
    reason,
    banReason: banReason || null,
    characters: Array.isArray(profile.characters) ? profile.characters.length : 0,
    lastLoginAt: profile.lastLoginAt || null,
    updatedAt: profile.updatedAt || null,
  };
}

function rosterMemberLabel(member: GuildRosterMember) {
  const name = member.name || member.key || "Персонаж";
  const realm = member.realmName || member.realmSlug || "";
  const status = member.guildStatusLabel || member.guildStatus || "";
  return [name, realm, status].filter(Boolean).join(" • ");
}

function buildStoredGuildRosterCharacterMap(members: GuildRosterMember[]) {
  const map = new Map<string, string>();
  for (const member of members) {
    const label = rosterMemberLabel(member);
    const keys = rosterMemberRankLookupKeys(member);
    for (const key of keys) {
      if (!map.has(key)) map.set(key, label);
    }
  }
  return map;
}

function guildRosterCharacterMatchesForProfile(profile: DashboardProfile, rosterKeys: Map<string, string>) {
  const matches = new Set<string>();
  for (const character of profile.characters || []) {
    for (const key of profileCharacterRankLookupKeys(character)) {
      const label = rosterKeys.get(key);
      if (label) matches.add(label);
    }
  }
  return Array.from(matches).slice(0, 20);
}

function discordProfileRosterProtectedPreview(profile: DashboardProfile, matchedRosterCharacters: string[]): DiscordProfileRosterProtectedPreview {
  return {
    profileId: profile.profileId,
    userId: profileDiscordId(profile),
    name: profileCleanupDisplayName(profile),
    characters: Array.isArray(profile.characters) ? profile.characters.length : 0,
    matchedRosterCharacters,
    reason: "Акаунт не видаляється: щонайменше один персонаж цього Discord-акаунту ще є у збереженому складі гільдії.",
    lastLoginAt: profile.lastLoginAt || null,
    updatedAt: profile.updatedAt || null,
  };
}

async function resolveFreshDiscordProfileMembershipStatus(userId: string): Promise<{
  status: DiscordProfileMembershipCleanupStatus;
  member: DiscordGuildMemberSnapshot | null;
  ban: Awaited<ReturnType<typeof fetchDiscordGuildBanSnapshot>> | null;
  reason: string;
  banCheckError?: string | null;
}> {
  try {
    const member = await fetchDiscordGuildMemberSnapshot(userId);
    return {
      status: "member",
      member,
      ban: null,
      reason: "Discord-акаунт зараз є учасником сервера.",
    };
  } catch (error) {
    if (!isDiscordApiNotFound(error)) {
      throw new Error(explainDiscordModerationError(error, "Перевірка Discord-учасника"));
    }
  }

  try {
    const ban = await fetchDiscordGuildBanSnapshot(userId);
    if (ban) {
      return {
        status: "banned",
        member: null,
        ban,
        reason: ban.reason ? `Discord-акаунт у бані сервера: ${ban.reason}` : "Discord-акаунт у бані сервера.",
      };
    }
  } catch (error) {
    return {
      status: "not_member",
      member: null,
      ban: null,
      reason: "Discord-акаунта немає серед учасників сервера. Перевірку бану не вдалося виконати, але відсутність на сервері підтверджена.",
      banCheckError: safeErrorText(error),
    };
  }

  return {
    status: "not_member",
    member: null,
    ban: null,
    reason: "Discord-акаунта немає серед учасників сервера.",
  };
}

export async function inspectDashboardProfilesDiscordMembership(limit: unknown = 0) {
  const parsedLimit = Number(limit);
  const profileLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(50_000, Math.floor(parsedLimit))
    : 50_000;

  const [profiles, discordMembers, storedRoster] = await Promise.all([
    listAllDashboardProfilesForDiscordSync(profileLimit),
    fetchDiscordGuildMembers(0),
    loadStoredGuildRosterData(),
  ]);

  let bans: Awaited<ReturnType<typeof fetchDiscordGuildBans>> = [];
  let banCheckError: string | null = null;
  try {
    bans = await fetchDiscordGuildBans(0);
  } catch (error) {
    banCheckError = safeErrorText(error, "Перевірка банів Discord недоступна.");
  }

  const discordMemberMap = new Map(discordMembers.map((member) => [member.userId, member]));
  const banMap = new Map(bans.map((ban) => [ban.userId, ban]));
  const rosterAvailable = storedRoster.members.length > 0;
  const rosterKeyMap = rosterAvailable ? buildStoredGuildRosterCharacterMap(storedRoster.members) : new Map<string, string>();
  const discordProfiles = profiles.filter((profile) => profile.provider === "discord" || Boolean(profileDiscordId(profile)));
  const activeMembers: Array<{ profileId: string; userId: string; name: string; serverNickname: string | null }> = [];
  const invalidProfiles: Array<{ profileId: string; name: string; provider: string; providerUserId: string }> = [];
  const rosterProtectedProfiles: DiscordProfileRosterProtectedPreview[] = [];
  const targets: DiscordProfileMembershipPreview[] = [];

  const profilesByDiscordUser = new Map<string, DashboardProfile[]>();
  for (const profile of discordProfiles) {
    const userId = profileDiscordId(profile);
    if (!userId) {
      invalidProfiles.push({
        profileId: profile.profileId,
        name: profileCleanupDisplayName(profile),
        provider: String(profile.provider || ""),
        providerUserId: String(profile.providerUserId || ""),
      });
      continue;
    }

    const bucket = profilesByDiscordUser.get(userId) || [];
    bucket.push(profile);
    profilesByDiscordUser.set(userId, bucket);
  }

  if (rosterAvailable) {
    for (const [userId, userProfiles] of profilesByDiscordUser.entries()) {
      const rosterMatches = Array.from(new Set(userProfiles.flatMap((profile) => guildRosterCharacterMatchesForProfile(profile, rosterKeyMap))));
      if (rosterMatches.length) {
        for (const profile of userProfiles) {
          rosterProtectedProfiles.push(discordProfileRosterProtectedPreview(profile, rosterMatches));
        }
        continue;
      }

      const member = discordMemberMap.get(userId) || null;
      if (member) {
        for (const profile of userProfiles) {
          activeMembers.push({
            profileId: profile.profileId,
            userId,
            name: profileCleanupDisplayName(profile),
            serverNickname: member.nick || null,
          });
        }
        continue;
      }

      const ban = banMap.get(userId);
      for (const profile of userProfiles) {
        if (ban) {
          targets.push(discordProfileCleanupPreview(
            profile,
            "banned",
            ban.reason ? `Discord-акаунт у бані сервера: ${ban.reason}` : "Discord-акаунт у бані сервера.",
            ban.reason,
          ));
          continue;
        }

        targets.push(discordProfileCleanupPreview(
          profile,
          "not_member",
          banCheckError
            ? "Discord-акаунта немає серед учасників сервера. Бан-лист не вдалося прочитати, тому статус бану не уточнено."
            : "Discord-акаунта немає серед учасників сервера.",
          null,
        ));
      }
    }
  }

  const bannedTotal = targets.filter((item) => item.status === "banned").length;
  const missingMemberTotal = targets.filter((item) => item.status === "not_member").length;
  return {
    checkedProfiles: profiles.length,
    checkedDiscordProfiles: discordProfiles.length,
    checkedDiscordMembers: discordMembers.length,
    checkedBans: bans.length,
    checkedRosterCharacters: storedRoster.members.length,
    storedRosterSource: storedRoster.source,
    storedRosterError: storedRoster.error || null,
    rosterAvailable,
    rosterSafetyBlocked: !rosterAvailable,
    banCheckError,
    activeMemberTotal: activeMembers.length,
    rosterProtectedTotal: rosterProtectedProfiles.length,
    invalidDiscordProfileTotal: invalidProfiles.length,
    invalidProfiles: invalidProfiles.slice(0, 100),
    targetProfilesTotal: targets.length,
    targetDiscordUsersTotal: new Set(targets.map((item) => item.userId)).size,
    bannedTotal,
    missingMemberTotal,
    targets,
    preview: targets.slice(0, 200),
    rosterProtectedPreview: rosterProtectedProfiles.slice(0, 100),
    activePreview: activeMembers.slice(0, 50),
  };
}

export async function cleanupDashboardProfilesDiscordMembership(input: {
  limit?: unknown;
  dryRun?: boolean;
  reason?: string;
}) {
  const rosterRefresh = await refreshGuildRosterBeforeAccountCleanup();
  const inspection = await inspectDashboardProfilesDiscordMembership(input.limit || 0);
  const allProfiles = await listAllDashboardProfilesForDiscordSync(input.limit || 0);
  const targetProfileIds = new Set(inspection.targets.map((target) => target.profileId));
  const targetProfiles = allProfiles.filter((profile) => targetProfileIds.has(profile.profileId));

  const raidPreview = await removeRaidSignupsForAccounts({
    profiles: targetProfiles,
    discordUserIds: inspection.targets.map((target) => target.userId),
    dryRun: true,
    syncDiscord: false,
  }).catch((error) => ({
    dryRun: true,
    scannedRaids: 0,
    changedRaids: 0,
    removedSignups: 0,
    discordSynced: 0,
    discordFailed: 0,
    changedItems: [],
    error: safeErrorText(error, "Не вдалося порахувати рейдові записи для очищення."),
  }));

  const rosterRefreshBlocked = Boolean(rosterRefresh.attempted && rosterRefresh.failed);

  if (input.dryRun || inspection.rosterSafetyBlocked || rosterRefreshBlocked) {
    return {
      dryRun: true,
      ...inspection,
      rosterRefresh,
      changed: 0,
      deletedProfilesTotal: 0,
      deletedDiscordUsersTotal: 0,
      removedRaidSignupsTotal: 0,
      updatedRaidsTotal: 0,
      raidCleanupPreview: raidPreview,
      skippedFreshMember: 0,
      skippedNotFound: 0,
      failed: 0,
      changedItems: [],
      changedItemsTotal: 0,
      skippedItems: [],
      skippedItemsTotal: 0,
      errors: [
        ...(inspection.rosterSafetyBlocked
          ? [{
              userId: "",
              name: "Guild roster safety",
              profileIds: [],
              error: "Очищення заблоковано: збережений склад гільдії порожній. Спочатку онови склад гільдії.",
            }]
          : []),
        ...(rosterRefreshBlocked
          ? [{
              userId: "",
              name: "Guild roster refresh",
              profileIds: [],
              error: rosterRefresh.error || "Очищення заблоковано: склад гільдії не оновився перед cleanup.",
            }]
          : []),
      ],
      errorsTotal: (inspection.rosterSafetyBlocked ? 1 : 0) + (rosterRefreshBlocked ? 1 : 0),
    };
  }

  const profilesById = new Map(targetProfiles.map((profile) => [profile.profileId, profile]));
  const byDiscordUser = new Map<string, DiscordProfileMembershipPreview[]>();
  for (const target of inspection.targets) {
    if (!target.userId) continue;
    const bucket = byDiscordUser.get(target.userId) || [];
    bucket.push(target);
    byDiscordUser.set(target.userId, bucket);
  }

  const { results, meta } = await mapConcurrentSettled(
    Array.from(byDiscordUser.entries()).map(([userId, profilesForUser]) => ({ userId, profilesForUser })),
    async (target) => {
      const fresh = await resolveFreshDiscordProfileMembershipStatus(target.userId);
      const firstProfile = target.profilesForUser[0];
      if (fresh.status === "member") {
        return {
          userId: target.userId,
          name: fresh.member?.displayName || firstProfile?.name || target.userId,
          status: fresh.status,
          skipped: true,
          skipReason: "Перед видаленням акаунт повторно знайдено на Discord-сервері; профіль і рейдові записи не чіпали.",
          profileIds: target.profilesForUser.map((item) => item.profileId),
          deletedProfileIds: [] as string[],
          deletedProfiles: 0,
          raidCleanup: null as Awaited<ReturnType<typeof removeRaidSignupsForAccounts>> | null,
          banReason: null as string | null,
          banCheckError: null as string | null,
        };
      }

      const profilesForUser = target.profilesForUser.map((item) => profilesById.get(item.profileId)).filter(Boolean) as DashboardProfile[];
      const raidCleanup = await removeRaidSignupsForAccounts({
        profiles: profilesForUser,
        discordUserIds: [target.userId],
        dryRun: false,
        syncDiscord: true,
        reason: input.reason || "Mistblossom account cleanup",
      });

      const deleted = await deleteDashboardProfilesByDiscordUserId(target.userId);
      const skipped = deleted.deleted <= 0;
      return {
        userId: target.userId,
        name: fresh.member?.displayName || fresh.ban?.globalName || fresh.ban?.username || firstProfile?.name || target.userId,
        status: fresh.status,
        skipped,
        skipReason: skipped ? `Профіль уже відсутній у Firebase або не знайдений: ${deleted.reason}.` : "",
        profileIds: target.profilesForUser.map((item) => item.profileId),
        deletedProfileIds: deleted.profileIds,
        deletedProfiles: deleted.deleted,
        raidCleanup,
        banReason: fresh.ban?.reason || null,
        banCheckError: fresh.banCheckError || null,
        reason: fresh.reason,
      };
    },
    {
      profile: "external-api",
      concurrency: 1,
      min: 1,
      max: 1,
    },
  );

  const okItems = results.filter((item) => item.ok);
  const failedItems = results.filter((item) => !item.ok);
  const changedItems = okItems.filter((item) => !item.value.skipped && item.value.deletedProfiles > 0).map((item) => item.value);
  const skippedItems = okItems.filter((item) => item.value.skipped).map((item) => item.value);
  const deletedProfilesTotal = changedItems.reduce((sum, item) => sum + item.deletedProfiles, 0);
  const deletedDiscordUsersTotal = changedItems.length;
  const removedRaidSignupsTotal = changedItems.reduce((sum, item) => sum + (item.raidCleanup?.removedSignups || 0), 0);
  const updatedRaidsTotal = changedItems.reduce((sum, item) => sum + (item.raidCleanup?.changedRaids || 0), 0);
  const skippedFreshMember = skippedItems.filter((item) => item.status === "member").length;
  const skippedNotFound = skippedItems.filter((item) => item.status !== "member").length;

  return {
    dryRun: false,
    ...inspection,
    rosterRefresh,
    changed: changedItems.length,
    deletedProfilesTotal,
    deletedDiscordUsersTotal,
    removedRaidSignupsTotal,
    updatedRaidsTotal,
    raidCleanupPreview: raidPreview,
    skippedFreshMember,
    skippedNotFound,
    skippedItems: skippedItems.slice(0, 100),
    skippedItemsTotal: skippedItems.length,
    failed: failedItems.length,
    concurrency: meta.concurrency,
    durationMs: meta.durationMs,
    changedItems: changedItems.slice(0, 200),
    changedItemsTotal: changedItems.length,
    errors: failedItems.slice(0, 100).map((item) => ({
      userId: item.item.userId,
      name: item.item.profilesForUser[0]?.name || item.item.userId,
      profileIds: item.item.profilesForUser.map((profile) => profile.profileId),
      error: item.error instanceof Error ? item.error.message : String(item.error || "Помилка перевірки Discord-профілю"),
    })),
    errorsTotal: failedItems.length,
  };
}


function profileDiscordId(profile: DashboardProfile) {
  const direct = snowflake(profile.providerUserId);
  return direct || "";
}

type StoredGuildRankInfo = {
  key: string;
  region?: string | null;
  characterName?: string | null;
  realmSlug?: string | null;
  realmName?: string | null;
  rank?: number | null;
  status: "guild_master" | "officer" | "member" | null;
  label?: string | null;
  source: "stored_guild_roster" | "stored_profile_character";
};

function isStoredOfficerStatus(value: unknown) {
  return value === "guild_master" || value === "officer";
}

function guildRankPriority(rankInfo: StoredGuildRankInfo | null) {
  if (rankInfo?.status === "guild_master") return 0;
  if (rankInfo?.status === "officer") return 1;
  if (rankInfo?.status === "member") return 2;
  return 99;
}

type OfficerCharacterMatch = {
  character: ProfileCharacter;
  rankInfo: StoredGuildRankInfo;
  matchedKey: string;
};

function addCharacterLookupKeys(keys: Set<string>, input: {
  key?: unknown;
  region?: unknown;
  realmSlug?: unknown;
  realmName?: unknown;
  name?: unknown;
  normalizedName?: unknown;
}) {
  const normalizedStoredKey = normalizeCharacterKey(input.key);
  if (normalizedStoredKey) keys.add(normalizedStoredKey);

  const rawStoredKey = String(input.key || "").normalize("NFC").trim().toLocaleLowerCase("uk");
  const rawParts = rawStoredKey.split(":").filter(Boolean);
  if (rawParts.length >= 3) {
    const keyFromFirstThreeParts = normalizeCharacterKey(rawParts.slice(0, 3).join(":"));
    if (keyFromFirstThreeParts) keys.add(keyFromFirstThreeParts);
  }

  const region = input.region || "eu";
  const realms = [input.realmSlug, input.realmName]
    .map((value) => normalizeBattleNetRealmSlug(value))
    .filter(Boolean);
  const names = [input.normalizedName, input.name]
    .map((value) => normalizeBattleNetNameSlug(value))
    .filter(Boolean);

  for (const realm of realms) {
    for (const name of names) {
      const key = buildBattleNetCharacterKey(region, realm, name);
      if (key) keys.add(key);
    }
  }
}

function profileCharacterRankLookupKeys(character: ProfileCharacter) {
  const keys = new Set<string>();
  addCharacterLookupKeys(keys, character);
  return Array.from(keys);
}

function rosterMemberRankLookupKeys(member: GuildRosterMember) {
  const keys = new Set<string>();
  addCharacterLookupKeys(keys, {
    key: member.key,
    region: member.region,
    realmSlug: member.realmSlug,
    realmName: member.realmName,
    name: member.name,
    normalizedName: member.name,
  });
  return Array.from(keys);
}

function characterStoredRankInfo(character: ProfileCharacter): StoredGuildRankInfo | null {
  if (!isStoredOfficerStatus(character.guildStatus)) return null;
  const keys = profileCharacterRankLookupKeys(character);
  const key = keys[0] || String(character.key || "").normalize("NFC").trim().toLocaleLowerCase("uk");
  if (!key) return null;

  return {
    key,
    region: character.region || "eu",
    realmSlug: character.realmSlug || null,
    realmName: character.realmName || null,
    characterName: character.name || null,
    rank: Number.isFinite(Number(character.guildRank)) ? Number(character.guildRank) : null,
    status: character.guildStatus,
    label: character.guildStatusLabel || (character.guildStatus === "guild_master" ? "Глава" : "Офіцер"),
    source: "stored_profile_character",
  };
}

function buildStoredGuildRankMap(params: { profiles: DashboardProfile[]; rosterMembers: GuildRosterMember[] }) {
  const rankMap = new Map<string, StoredGuildRankInfo>();
  const sourceCounts = { storedRosterCharacters: 0, storedRosterOfficerCharacters: 0, storedProfileOfficerCharacters: 0 };

  const setRankInfo = (key: string, rankInfo: StoredGuildRankInfo) => {
    const previous = rankMap.get(key);
    if (!previous || guildRankPriority(rankInfo) < guildRankPriority(previous)) {
      rankMap.set(key, rankInfo);
    }
  };

  const storedRosterOfficerMembers = params.rosterMembers.filter((member) => isStoredOfficerStatus(member.guildStatus));
  sourceCounts.storedRosterCharacters = params.rosterMembers.length;
  sourceCounts.storedRosterOfficerCharacters = storedRosterOfficerMembers.length;

  for (const member of storedRosterOfficerMembers) {
    const keys = rosterMemberRankLookupKeys(member);
    const primaryKey = keys[0] || String(member.key || "").normalize("NFC").trim().toLocaleLowerCase("uk");
    if (!primaryKey) continue;

    const rankInfo: StoredGuildRankInfo = {
      key: primaryKey,
      region: member.region || "eu",
      realmSlug: member.realmSlug || null,
      realmName: member.realmName || null,
      characterName: member.name || null,
      rank: Number.isFinite(Number(member.rank)) ? Number(member.rank) : null,
      status: member.guildStatus,
      label: member.guildStatusLabel || (member.guildStatus === "guild_master" ? "Глава" : "Офіцер"),
      source: "stored_guild_roster",
    };

    for (const key of keys.length ? keys : [primaryKey]) {
      setRankInfo(key, rankInfo);
    }
  }

  // Fallback for cases where the guild roster cache has not been written yet,
  // but profile characters already contain trusted guildStatus/guildStatusLabel
  // from the site sync. This stays stored-only: no Battle.net request is made here.
  if (!rankMap.size) {
    for (const profile of params.profiles) {
      for (const character of profile.characters) {
        const rankInfo = characterStoredRankInfo(character);
        if (!rankInfo) continue;
        sourceCounts.storedProfileOfficerCharacters += 1;
        for (const key of profileCharacterRankLookupKeys(character)) {
          setRankInfo(key, rankInfo);
        }
      }
    }
  }

  return { rankMap, ...sourceCounts };
}

function guildOfficerCharacters(profile: DashboardProfile, rankMap: Map<string, StoredGuildRankInfo>): OfficerCharacterMatch[] {
  const matches: OfficerCharacterMatch[] = [];

  for (const character of profile.characters) {
    for (const key of profileCharacterRankLookupKeys(character)) {
      const rankInfo = rankMap.get(key);
      if (!rankInfo || !isStoredOfficerStatus(rankInfo.status)) continue;
      matches.push({ character, rankInfo, matchedKey: key });
      break;
    }
  }

  return matches.sort((a, b) => guildRankPriority(a.rankInfo) - guildRankPriority(b.rankInfo) || String(a.character.name || "").localeCompare(String(b.character.name || ""), "uk"));
}

function formatOfficerCharacter(match: OfficerCharacterMatch) {
  const label = match.rankInfo.label || (match.rankInfo.status === "guild_master" ? "Глава" : match.rankInfo.status === "officer" ? "Офіцер" : "");
  const rosterName = match.rankInfo.characterName && match.rankInfo.characterName !== match.character.name ? ` → ${match.rankInfo.characterName}` : "";
  const source = match.rankInfo.source === "stored_guild_roster" ? "склад" : "профіль";
  return `${match.character.name}${rosterName}${label ? ` (${label})` : ""} • ${source}`;
}

export async function syncDiscordOfficerRolesFromProfiles(input: {
  roleIds?: unknown;
  limit?: unknown;
  reason?: string;
}) {
  const guildId = getDiscordGuildId();
  if (!guildId) throw new Error("Discord-сервер не підключений.");

  const officerRole = await resolveHighestManageableDiscordRole(input.roleIds);
  const manageableRoleIds = officerRole.roleIds;
  const parsedLimit = Number(input.limit);
  const profileLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(50_000, Math.floor(parsedLimit)) : undefined;

  const [profiles, storedRoster, policy, discordMembers] = await Promise.all([
    listAllDashboardProfilesForDiscordSync(profileLimit),
    loadStoredGuildRosterData(),
    getGuildNicknamePolicy(),
    fetchDiscordGuildMembers(0),
  ]);
  const storedRankMap = buildStoredGuildRankMap({ profiles, rosterMembers: storedRoster.members });
  const rankMap = storedRankMap.rankMap;

  if (!rankMap.size) {
    throw new Error("У збережених даних сайту немає персонажів зі статусом guildStatus=officer або guildStatus=guild_master. Офіцерські ролі не змінено.");
  }

  const discordMemberMap = new Map(discordMembers.map((member) => [member.userId, member]));
  const candidates = profiles.map((profile) => {
    const discordId = profileDiscordId(profile);
    const officers = guildOfficerCharacters(profile, rankMap);
    return { profile, discordId, officers, checkedCharacters: profile.characters.length };
  }).filter((item) => item.discordId && item.officers.length > 0);

  const checkedCharacters = profiles.reduce((sum, profile) => sum + profile.characters.length, 0);
  const officerCharactersTotal = candidates.reduce((sum, candidate) => sum + candidate.officers.length, 0);

  const { results, meta } = await mapConcurrentSettled(
    candidates,
    async (candidate) => {
      const snapshot = discordMemberMap.get(candidate.discordId) || await memberSnapshot(candidate.discordId);
      if (!snapshot) {
        return {
          profileId: candidate.profile.profileId,
          userId: candidate.discordId,
          name: getProfilePublicName(candidate.profile),
          officerCharacters: candidate.officers.map(formatOfficerCharacter),
          checkedCharacters: candidate.checkedCharacters,
          skipped: true,
          skipReason: "Discord-учасника не знайдено на сервері.",
          serverNickname: null as string | null,
          added: [] as string[],
          alreadyHad: [] as string[],
          stillMissing: [] as string[],
        };
      }

      const nicknameCheck = serverNicknameValidation(snapshot, policy.template);
      if (!nicknameCheck.ok) {
        return {
          profileId: candidate.profile.profileId,
          userId: candidate.discordId,
          name: snapshot.displayName || getProfilePublicName(candidate.profile),
          officerCharacters: candidate.officers.map(formatOfficerCharacter),
          checkedCharacters: candidate.checkedCharacters,
          skipped: true,
          skipReason: nicknameCheck.reason,
          serverNickname: nicknameCheck.nickname,
          added: [] as string[],
          alreadyHad: [] as string[],
          stillMissing: [] as string[],
        };
      }

      let delta: Awaited<ReturnType<typeof applyDiscordRoleDelta>>;
      try {
        delta = await applyDiscordRoleDelta({
          guildId,
          userId: candidate.discordId,
          addRoleIds: manageableRoleIds,
          before: snapshot,
          reason: input.reason || "Mistblossom stored guild officer sync",
          actionLabel: "Синхронізація офіцерської ролі",
        });
      } catch (error) {
        throw new Error(explainDiscordModerationError(error, "Синхронізація офіцерської ролі"));
      }

      if (delta.stillMissingRoleIds.length) {
        throw new Error(`Discord прийняв запит, але офіцерська роль не зʼявилась: ${delta.stillMissingRoleIds.join(", ")}. Перевір ієрархію ролей бота.`);
      }

      return {
        profileId: candidate.profile.profileId,
        userId: candidate.discordId,
        name: delta.after.displayName || snapshot.displayName || getProfilePublicName(candidate.profile),
        officerCharacters: candidate.officers.map(formatOfficerCharacter),
        checkedCharacters: candidate.checkedCharacters,
        skipped: false,
        skipReason: "",
        serverNickname: serverNicknameValidation(delta.after || snapshot, policy.template).nickname,
        added: delta.addedRoleIds,
        alreadyHad: delta.alreadyHadRoleIds,
        stillMissing: delta.stillMissingRoleIds,
        beforeRoleIds: delta.before.roleIds,
        afterRoleIds: delta.after.roleIds,
        usedPatchFallback: delta.usedPatchFallback,
      };
    },
    { profile: "external-api", concurrency: 1, min: 1, max: 1 },
  );

  const okItems = results.filter((item) => item.ok);
  const failedItems = results.filter((item) => !item.ok);
  const changedItems = okItems.filter((item) => !item.value.skipped && item.value.added.length > 0).map((item) => item.value);
  const skippedItems = okItems.filter((item) => item.value.skipped).map((item) => item.value);
  const alreadyHadItems = okItems.filter((item) => !item.value.skipped && item.value.added.length === 0 && item.value.alreadyHad.length > 0).map((item) => item.value);
  const addedRolesTotal = changedItems.reduce((sum, item) => sum + item.added.length, 0);
  const skippedMissingNickname = skippedItems.filter((item) => !item.serverNickname).length;
  const skippedInvalidNickname = skippedItems.filter((item) => item.serverNickname && /шаблону/i.test(item.skipReason || "")).length;

  return {
    checkedProfiles: profiles.length,
    checkedCharacters,
    checkedDiscordMembers: discordMembers.length,
    checkedRosterCharacters: storedRankMap.storedRosterCharacters,
    checkedStoredRosterCharacters: storedRankMap.storedRosterCharacters,
    checkedStoredRosterOfficerCharacters: storedRankMap.storedRosterOfficerCharacters,
    checkedStoredProfileOfficerCharacters: storedRankMap.storedProfileOfficerCharacters,
    matchedStoredOfficerCharacterKeys: rankMap.size,
    storedRosterSource: storedRoster.source,
    storedRosterError: storedRoster.error || null,
    checkedBattleNetRegions: [],
    officerProfiles: candidates.length,
    officerCharactersTotal,
    changed: changedItems.length,
    addedRolesTotal,
    alreadyHad: alreadyHadItems.length,
    skipped: skippedItems.length,
    skippedMissingNickname,
    skippedInvalidNickname,
    failed: failedItems.length,
    roleIds: manageableRoleIds,
    selectedRoleId: officerRole.roleId,
    selectedRoleName: officerRole.roleName,
    selectedRolePosition: officerRole.rolePosition,
    requestedRoleIds: officerRole.requestedRoleIds,
    requestedRoleNames: officerRole.requestedRoleNames,
    ignoredLowerRoleIds: officerRole.ignoredLowerRoleIds,
    nicknameTemplate: policy.template,
    checkedField: "server_nick",
    matchMode: "stored_site_profile_characters_x_stored_guild_roster_by_character_key",
    concurrency: meta.concurrency,
    durationMs: meta.durationMs,
    changedItems: changedItems.slice(0, 200),
    changedItemsTotal: changedItems.length,
    skippedItems: skippedItems.slice(0, 100),
    skippedItemsTotal: skippedItems.length,
    alreadyHadItems: alreadyHadItems.slice(0, 100),
    alreadyHadItemsTotal: alreadyHadItems.length,
    errors: failedItems.slice(0, 100).map((item) => ({
      profileId: item.item.profile.profileId,
      userId: item.item.discordId,
      name: getProfilePublicName(item.item.profile),
      officerCharacters: item.item.officers.map(formatOfficerCharacter),
      error: item.error instanceof Error ? item.error.message : String(item.error || "Помилка Discord API"),
    })),
    errorsTotal: failedItems.length,
  };
}
