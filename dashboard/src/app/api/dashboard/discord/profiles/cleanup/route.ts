import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { cleanupDashboardProfilesDiscordMembership } from "@/lib/discordMemberManagement";

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
    const apply = mode === "apply";
    const result = await cleanupDashboardProfilesDiscordMembership({
      limit: form.get("limit") || 0,
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
      title: apply ? "Очищення Firebase-профілів завершено" : "Перевірку профілів завершено",
      message: summary,
      ttl: apply ? 16000 : 11000,
      data: { ...compactProfileCleanupResult(result), refresh: apply },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.profiles_cleanup_failed", error, "Перевірку Discord-профілів не виконано.", guard.session);
  }
}
