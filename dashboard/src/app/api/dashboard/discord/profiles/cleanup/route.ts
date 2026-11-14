import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { cleanupDashboardProfilesDiscordMembership } from "@/lib/discordMemberManagement";
import { acquireAccountCleanupExecutionLock, getAccountCleanupAutomationSettings, recordAccountCleanupRun } from "@/lib/accountCleanupAutomation";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function compactProfileCleanupResult(result: Awaited<ReturnType<typeof cleanupDashboardProfilesDiscordMembership>>) {
  const compact = { ...result } as Partial<typeof result>;
  delete compact.targets;
  delete compact.activePreview;
  delete compact.rosterProtectedPreview;
  return compact;
}

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "profiles-cleanup", 8 * 1024);
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const mode = String(form.get("mode") || "inspect").toLowerCase();
    const limitText = String(form.get("limit") ?? "0").trim();
    const requestedLimit = /^(0|[1-9][0-9]{0,4})$/.test(limitText) ? Number(limitText) : -1;
    if (requestedLimit < 0 || requestedLimit > 50_000) {
      return adminDiscordResponse(request, { ok: false, title: "Некоректний ліміт", message: "Дозволено ціле число від 0 до 50000.", status: 400 });
    }
    const apply = mode === "apply";
    // Checking may be delegated to authorized moderators; destructive changes may not.
    if (mode !== "inspect" && mode !== "apply") {
      return adminDiscordResponse(request, {
        ok: false, title: "Невідомий режим", message: "Дозволено лише перевірку або підтверджене очищення.", status: 400,
      });
    }
    if (apply && !guard.session.isServerOwner) {
      return adminDiscordResponse(request, {
        ok: false, title: "Недостатньо прав", message: "Видалення вебпрофілів дозволено лише власнику Discord-сервера.", status: 403,
      });
    }
    if (apply && form.get("confirmDeletion") !== "DELETE_STALE_PROFILES") {
      return adminDiscordResponse(request, {
        ok: false, title: "Потрібне підтвердження", message: "Перед очищенням переглянь кандидатів і підтвердь видалення у формі.", status: 400,
      });
    }
    const execution = await acquireAccountCleanupExecutionLock(`manual:${apply ? "apply" : "inspect"}`);
    if (!execution) {
      return adminDiscordResponse(request, {
        ok: false,
        tone: "warning",
        title: "Перевірка вже виконується",
        message: "Дочекайся завершення поточної автоматичної або ручної перевірки акаунтів і повтори дію.",
        status: 409,
      });
    }

    try {
    if (apply) {
      const settings = await getAccountCleanupAutomationSettings({ fresh: true });
      const preview = settings.recentRuns.find(run => run.mode === "inspect" && run.source === "manual" && run.actorId === guard.session.id);
      const previewAt = preview ? Date.parse(preview.completedAt) : Number.NaN;
      const lastApplyAt = settings.lastCleanupAt ? Date.parse(settings.lastCleanupAt) : Number.NaN;
      const now = Date.now();
      const previewFresh = preview?.status === "success" && Number.isFinite(previewAt) && previewAt <= now && now - previewAt <= 15 * 60_000;
      if (!previewFresh || preview?.scopeLimit !== requestedLimit || (Number.isFinite(lastApplyAt) && lastApplyAt >= previewAt)) {
        return adminDiscordResponse(request, {
          ok: false, title: "Спочатку виконай перевірку", message: "Для видалення потрібен успішний ручний dry-run за останні 15 хвилин. Після кожного видалення перевірку треба повторити.", status: 409,
        });
      }
    }
      const startedAt = new Date().toISOString();
      const result = await cleanupDashboardProfilesDiscordMembership({
      limit: requestedLimit,
      dryRun: !apply,
      reason: `Mistblossom Discord profile cleanup by ${guard.session.name || guard.session.id}`,
    });

    const banHint = result.banCheckError ? " Бан-лист не вдалося прочитати, але відсутність учасників перевірено через список сервера." : "";
    const refreshHint = result.rosterRefresh?.attempted
      ? result.rosterRefresh.failed
        ? ` Оновлення складу перед cleanup не вдалося: ${result.rosterRefresh.error || "невідома помилка"}.`
        : ` Склад перед cleanup оновлено: ${result.rosterRefresh.memberCount} персонажів; source: ${result.rosterRefresh.source || "unknown"}.`
      : " Автооновлення складу перед cleanup вимкнено.";
    const rosterHint = result.rosterSafetyBlocked
      ? " Очищення заблоковано: збережений склад гільдії порожній."
      : ` Склад гільдії перевірено: ${result.checkedRosterCharacters}; захищено по roster: ${result.rosterProtectedTotal}.`;
    const summary = apply
      ? `Перевірено профілів: ${result.checkedDiscordProfiles}; кандидатів: ${result.targetProfilesTotal}; видалено профілів: ${result.deletedProfilesTotal}; прибрано рейдових записів: ${result.removedRaidSignupsTotal}; оновлено рейдів: ${result.updatedRaidsTotal}; прибрано зі складів сезону: ${result.removedRosterPicksTotal || 0}; оновлено складів: ${result.updatedRostersTotal || 0}; прибрано голосів у пулах: ${result.removedPollVotesTotal || 0}; оновлено пулів: ${result.updatedPollsTotal || 0}; помилок: ${result.failed}.${refreshHint}${rosterHint}${banHint}`
      : `Перевірено профілів: ${result.checkedDiscordProfiles}; не на сервері: ${result.missingMemberTotal}; у бані: ${result.bannedTotal}; кандидатів: ${result.targetProfilesTotal}; потенційно рейдових записів до видалення: ${result.raidCleanupPreview?.removedSignups || 0}; піків у складах сезону: ${result.rosterPickCleanupPreview?.removedPicks || 0}; голосів у пулах: ${result.pollVoteCleanupPreview?.removedVotes || 0}.${refreshHint}${rosterHint}${banHint}`;

    const runStatus = result.failed || result.rosterSafetyBlocked || result.rosterRefresh?.failed ? "warning" : "success";
    await recordAccountCleanupRun({
      mode: apply ? "apply" : "inspect",
      source: "manual",
      status: runStatus,
      startedAt,
      checkedProfiles: result.checkedDiscordProfiles,
      scopeLimit: requestedLimit,
      actorId: guard.session.id,
      candidates: result.targetProfilesTotal,
      deletedProfiles: result.deletedProfilesTotal,
      removedRaidSignups: result.removedRaidSignupsTotal,
      removedRosterPicks: result.removedRosterPicksTotal || 0,
      removedPollVotes: result.removedPollVotesTotal || 0,
      errors: result.errorsTotal || result.failed || 0,
      summary,
      error: runStatus === "warning" ? summary : null,
    }).catch(() => null);

    await auditDiscordAdmin(apply ? "discord.profiles.cleanup_apply" : "discord.profiles.cleanup_inspect", guard.session, {
      ...compactProfileCleanupResult(result),
      status: result.failed || result.rosterSafetyBlocked || result.rosterRefresh?.failed ? "warning" : result.targetProfilesTotal ? "warning" : "success",
      summary,
      checkedProfiles: result.checkedProfiles,
      checkedDiscordProfiles: result.checkedDiscordProfiles,
      checkedDiscordMembers: result.checkedDiscordMembers,
      checkedBans: result.checkedBans,
      checkedRosterCharacters: result.checkedRosterCharacters,
      rosterRefresh: result.rosterRefresh,
      rosterProtectedTotal: result.rosterProtectedTotal,
      rosterSafetyBlocked: result.rosterSafetyBlocked,
      targetProfilesTotal: result.targetProfilesTotal,
      targetDiscordUsersTotal: result.targetDiscordUsersTotal,
      bannedTotal: result.bannedTotal,
      missingMemberTotal: result.missingMemberTotal,
      deletedProfilesTotal: result.deletedProfilesTotal,
      removedRaidSignupsTotal: result.removedRaidSignupsTotal,
      updatedRaidsTotal: result.updatedRaidsTotal,
      removedRosterPicksTotal: result.removedRosterPicksTotal || 0,
      updatedRostersTotal: result.updatedRostersTotal || 0,
      removedPollVotesTotal: result.removedPollVotesTotal || 0,
      updatedPollsTotal: result.updatedPollsTotal || 0,
      changed: result.changed,
    });

      return adminDiscordResponse(request, {
        ok: true,
        tone: apply
          ? result.failed || result.rosterSafetyBlocked || result.rosterRefresh?.failed ? "warning" : result.deletedProfilesTotal ? "success" : "info"
          : result.rosterSafetyBlocked || result.rosterRefresh?.failed || result.targetProfilesTotal ? "warning" : "success",
        title: apply ? "Очищення профілів завершено" : "Перевірку профілів завершено",
        message: summary,
        ttl: apply ? 16000 : 11000,
        data: { ...compactProfileCleanupResult(result), refresh: apply },
      });
    } finally {
      await execution.release();
    }
  } catch (error) {
    return await discordAdminError(request, "admin.discord.profiles_cleanup_failed", error, "Перевірку Discord-профілів не виконано.", guard.session);
  }
}
