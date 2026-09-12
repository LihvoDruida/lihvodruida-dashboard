import { NextRequest } from "next/server";

import {
  adminDiscordResponse,
  auditDiscordAdmin,
  discordAdminError,
  requireDiscordAdmin,
} from "@/lib/dashboardDiscordRoute";
import { fetchDiscordGuildSnapshot } from "@/lib/discordAdmin";
import { createStableProfileId } from "@/lib/profileIds";
import {
  importLegacyDashboardProfiles,
  type LegacyProfileImportStrategy,
} from "@/lib/legacyProfileImport";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "profiles-import-firestore", 16 * 1024);
  if ("error" in guard) return guard.error;

  if (!guard.session.isServerOwner) {
    return adminDiscordResponse(request, {
      ok: false,
      tone: "error",
      title: "Імпорт доступний лише власнику",
      message: "Firestore → PostgreSQL може змінювати всі dashboardProfiles, тому цю дію може запускати тільки власник Discord-сервера.",
      status: 403,
    });
  }

  try {
    const form = await request.formData();
    const mode = String(form.get("mode") || "inspect").toLowerCase();
    const dryRun = mode !== "apply";
    const strategy: LegacyProfileImportStrategy = form.get("strategy") === "firestore-priority"
      ? "firestore-priority"
      : "safe";
    const rawLimit = Number(String(form.get("limit") || "0"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50_000, Math.floor(rawLimit)) : 0;
    const guild = await fetchDiscordGuildSnapshot().catch(() => null);
    const ownerDiscordId = String(
      guild?.ownerId || (guard.session.provider === "discord" ? guard.session.id : "") || "",
    ).trim();
    const ownerProfileId = String(
      guard.session.profileId || (ownerDiscordId ? await createStableProfileId("discord", ownerDiscordId) : "") || "",
    ).trim();

    const result = await importLegacyDashboardProfiles({
      dryRun,
      strategy,
      limit,
      protectedOwnerDiscordId: ownerDiscordId,
      protectedOwnerProfileId: ownerProfileId,
    });

    const strategyLabel = strategy === "firestore-priority"
      ? "Firestore має пріоритет"
      : "поточна PostgreSQL-база має пріоритет";
    const repairHint = !dryRun && result.characterLinkRepairFailed
      ? ` Індекс персонажів: ${result.characterLinkRepairs} оновлено, ${result.characterLinkRepairFailed} не вдалося відновити.`
      : !dryRun && result.characterLinkRepairs
        ? ` Індекс персонажів оновлено для ${result.characterLinkRepairs} профілів.`
        : "";
    const duplicateHint = result.duplicateProviderUsers
      ? ` У Firestore знайдено ${result.duplicateProviderUsers} provider ID з кількома документами — вони не об’єднувалися автоматично.`
      : "";
    const summary = dryRun
      ? `Firestore: ${result.sourceProfiles}; власника пропущено: ${result.ownerSkipped}; до імпорту: ${result.changed} (${result.created} нових, ${result.updated} оновлень); без змін: ${result.unchanged}. Режим: ${strategyLabel}.${duplicateHint}`
      : `Імпортовано: ${result.changed} профілів (${result.created} нових, ${result.updated} оновлено); без змін: ${result.unchanged}; власника пропущено: ${result.ownerSkipped}. Режим: ${strategyLabel}.${repairHint}${duplicateHint}`;

    await auditDiscordAdmin(
      dryRun ? "discord.profiles.firestore_import_inspect" : "discord.profiles.firestore_import_apply",
      guard.session,
      {
        status: result.characterLinkRepairFailed || result.duplicateProviderUsers ? "warning" : "success",
        summary,
        strategy,
        dryRun,
        sourceProfiles: result.sourceProfiles,
        candidateProfiles: result.candidateProfiles,
        ownerSkipped: result.ownerSkipped,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        duplicateProviderUsers: result.duplicateProviderUsers,
        characterLinkRepairs: result.characterLinkRepairs,
        characterLinkRepairFailed: result.characterLinkRepairFailed,
        samples: result.samples,
      },
    );

    return adminDiscordResponse(request, {
      ok: true,
      tone: result.characterLinkRepairFailed || result.duplicateProviderUsers
        ? "warning"
        : result.changed
          ? "success"
          : "info",
      title: dryRun ? "Перевірку Firestore завершено" : "Імпорт Firestore завершено",
      message: summary,
      ttl: dryRun ? 12000 : 18000,
      data: { ...result, refresh: !dryRun },
    });
  } catch (error) {
    return await discordAdminError(
      request,
      "admin.discord.profiles_firestore_import_failed",
      error,
      "Імпорт dashboardProfiles із Firestore не виконано.",
      guard.session,
    );
  }
}
