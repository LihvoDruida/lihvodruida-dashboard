import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { syncDiscordOfficerRolesFromProfiles } from "@/lib/discordMemberManagement";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "officers-sync", 16 * 1024);
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const result = await syncDiscordOfficerRolesFromProfiles({
      roleIds: form.getAll("officerRoleIds"),
      limit: form.get("limit"),
      reason: `Mistblossom stored guild officer role sync by ${guard.session.name || guard.session.id}`,
    });

    const nicknameSkipped = (result.skippedMissingNickname || result.skippedInvalidNickname)
      ? ` Пропущено через серверний нік: без ніку ${result.skippedMissingNickname || 0}, не за глобальною структурою ${result.skippedInvalidNickname || 0}.`
      : "";
    const roleHint = result.selectedRoleName ? ` Роль: ${result.selectedRoleName}.` : "";
    const ignoredHint = result.ignoredLowerRoleIds?.length ? ` Нижчі вибрані ролі проігноровано: ${result.ignoredLowerRoleIds.length}.` : "";
    const storedSourceHint = result.checkedStoredRosterCharacters
      ? `збережений склад ${result.checkedStoredRosterCharacters || 0}, офіцерських у складі ${result.checkedStoredRosterOfficerCharacters || 0}`
      : `fallback з профілів, офіцерських персонажів ${result.checkedStoredProfileOfficerCharacters || 0}`;
    const summary = `Перевірено профілів ${result.checkedProfiles}; персонажів у профілях ${result.checkedCharacters || 0}; джерело статусів: ${storedSourceHint}; Discord-учасників ${result.checkedDiscordMembers || 0}; знайдено офіцерських профілів ${result.officerProfiles}; офіцерських персонажів ${result.officerCharactersTotal || 0}; роль видано ${result.changed} учасникам; видано ролей ${result.addedRolesTotal}; уже мали роль ${result.alreadyHad}; пропущено ${result.skipped}; помилок ${result.failed}.${roleHint}${ignoredHint}${nicknameSkipped}`;
    const hasWarnings = Boolean(result.failed || result.skippedMissingNickname || result.skippedInvalidNickname);

    await auditDiscordAdmin("discord.member.roles.sync_stored_officers", guard.session, {
      status: hasWarnings ? "warning" : "success",
      summary,
      checkedProfiles: result.checkedProfiles,
      officerProfiles: result.officerProfiles,
      checkedCharacters: result.checkedCharacters,
      checkedDiscordMembers: result.checkedDiscordMembers,
      checkedRosterCharacters: result.checkedRosterCharacters,
      checkedStoredRosterCharacters: result.checkedStoredRosterCharacters,
      checkedStoredRosterOfficerCharacters: result.checkedStoredRosterOfficerCharacters,
      checkedStoredProfileOfficerCharacters: result.checkedStoredProfileOfficerCharacters,
      matchedStoredOfficerCharacterKeys: result.matchedStoredOfficerCharacterKeys,
      storedRosterSource: result.storedRosterSource,
      storedRosterError: result.storedRosterError,
      checkedBattleNetRegions: result.checkedBattleNetRegions,
      officerCharactersTotal: result.officerCharactersTotal,
      matchMode: result.matchMode,
      changed: result.changed,
      addedRoles: result.addedRolesTotal,
      alreadyHad: result.alreadyHad,
      skipped: result.skipped,
      failed: result.failed,
      skippedMissingNickname: result.skippedMissingNickname,
      skippedInvalidNickname: result.skippedInvalidNickname,
      nicknameTemplate: result.nicknameTemplate,
      checkedField: result.checkedField,
      roleIds: result.roleIds,
      selectedRoleId: result.selectedRoleId,
      selectedRoleName: result.selectedRoleName,
      selectedRolePosition: result.selectedRolePosition,
      requestedRoleIds: result.requestedRoleIds,
      ignoredLowerRoleIds: result.ignoredLowerRoleIds,
      changedItems: result.changedItems,
      changedItemsTotal: result.changedItemsTotal,
      skippedItems: result.skippedItems,
      skippedItemsTotal: result.skippedItemsTotal,
      alreadyHadItems: result.alreadyHadItems,
      alreadyHadItemsTotal: result.alreadyHadItemsTotal,
      errors: result.errors,
      errorsTotal: result.errorsTotal,
    });

    const changedNames = result.changedItems.slice(0, 6).map((item) => item.name).filter(Boolean);
    const changedHint = changedNames.length
      ? ` Видано: ${changedNames.join(", ")}${result.changed > changedNames.length ? ` та ще ${result.changed - changedNames.length}` : ""}.`
      : "";
    const errorHint = result.failed
      ? ` Помилки: ${result.errors.slice(0, 3).map((item) => `${item.name}: ${item.error}`).join(" | ")}`
      : "";

    return adminDiscordResponse(request, {
      ok: true,
      tone: hasWarnings ? "warning" : "success",
      title: "Синхронізацію офіцерських ролей завершено",
      message: `${summary}${changedHint}${errorHint}`,
      ttl: hasWarnings ? 14000 : 7600,
      data: { result, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.officers_sync_failed", error, "Офіцерські ролі не синхронізовано.", guard.session);
  }
}
