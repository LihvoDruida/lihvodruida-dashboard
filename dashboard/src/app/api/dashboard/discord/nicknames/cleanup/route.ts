import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { removeRolesFromMembersWithInvalidNicknames } from "@/lib/discordMemberManagement";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "nicknames-cleanup", 32 * 1024);
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const apply = String(form.get("apply") || form.get("mode") || "") === "1" || String(form.get("mode") || "") === "apply";
    const removeRoleIds = form.getAll("removeRoleIds");
    const legacyRoleIds = form.getAll("roleIds");
    const addRoleIds = form.getAll("addRoleIds");
    const result = await removeRolesFromMembersWithInvalidNicknames({
      removeRoleIds: removeRoleIds.length ? removeRoleIds : legacyRoleIds,
      addRoleIds,
      limit: form.get("limit"),
      dryRun: !apply,
      reason: `Nickname does not match Mistblossom template; action by ${guard.session.name || guard.session.id}`,
    });

    const missingNick = result.missingServerNicknameTotal ? ` Без серверного ніку: ${result.missingServerNicknameTotal}.` : "";
    const summary = result.dryRun
      ? `Перевірено серверні ніки ${result.checked} учасників; невідповідних загалом ${result.invalidTotal || result.matchedTargets}; цілей для вибраних ролей: ${result.matchedTargets}.${missingNick} Зміни не застосовувались.`
      : `Перевірено серверні ніки ${result.checked} учасників; цілей ${result.matchedTargets}; ролі змінено у ${result.changed} учасників; знято ролей ${result.removedRolesTotal || 0}; видано ролей ${result.addedRolesTotal || 0}; без змін ${result.unchanged || 0}; пропущено перед зміною ${result.skippedBeforeChange || 0}; помилок ${result.failed}.${missingNick}`;

    await auditDiscordAdmin("discord.member.roles.apply_invalid_nickname", guard.session, {
      status: result.dryRun ? "info" : result.failed ? "warning" : "success",
      summary,
      dryRun: result.dryRun,
      template: result.template,
      checked: result.checked,
      targets: result.matchedTargets,
      checkedField: result.checkedField,
      missingServerNickname: result.missingServerNicknameTotal || 0,
      changed: result.changed,
      removedRoles: result.removedRolesTotal || 0,
      addedRoles: result.addedRolesTotal || 0,
      removeRoleIds: result.removeRoleIds || [],
      addRoleIds: result.addRoleIds || [],
      unchanged: result.unchanged || 0,
      skippedBeforeChange: result.skippedBeforeChange || 0,
      skippedFreshValid: result.skippedFreshValid || 0,
      skippedItems: result.skippedItems || [],
      skippedItemsTotal: result.skippedItemsTotal || 0,
      stillPresent: result.stillPresentTotal || 0,
      stillMissing: result.stillMissingTotal || 0,
      failed: result.failed,
      errors: result.errors || [],
      changedItems: result.changedItems || [],
      changedItemsTotal: result.changedItemsTotal ?? result.changed,
      changedNames: result.changedItems?.map((item) => item.name).filter(Boolean) || [],
      errorsTotal: result.errorsTotal ?? result.failed,
    });

    const changedNames = result.changedItems?.slice(0, 6).map((item) => item.name).filter(Boolean) || [];
    const changedHint = !result.dryRun && changedNames.length
      ? ` Змінено ролі у: ${changedNames.join(", ")}${result.changed > changedNames.length ? ` та ще ${result.changed - changedNames.length}` : ""}.`
      : "";
    const failedHint = result.failed
      ? ` Помилки: ${result.errors?.slice(0, 3).map((item) => `${item.name}: ${item.error}`).join(" | ")}`
      : "";
    const rateLimitHint = result.errors?.some((item) => /429|rate limit/i.test(String(item.error || "")))
      ? " Частина запитів уперлась у rate limit Discord; система повторює такі запити, але Discord може все одно обмежити операцію. Запусти дію ще раз для залишку або зменш паралельність до 1."
      : "";

    return adminDiscordResponse(request, {
      ok: true,
      tone: result.dryRun ? "info" : result.failed ? "warning" : "success",
      title: result.dryRun ? "Перевірку серверних ніків завершено" : "Ролі за серверним ніком оновлено",
      message: `${summary}${changedHint}${failedHint}${rateLimitHint}`,
      ttl: result.dryRun ? 9000 : 16000,
      data: { result, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.nicknames_cleanup_failed", error, "Масову дію не виконано.", guard.session);
  }
}
