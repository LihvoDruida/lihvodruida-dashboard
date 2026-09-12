import { NextRequest } from "next/server";

import {
  updateAccountCleanupAutomationSettings,
} from "@/lib/accountCleanupAutomation";
import {
  adminDiscordResponse,
  auditDiscordAdmin,
  discordAdminError,
  requireDiscordAdmin,
} from "@/lib/dashboardDiscordRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "profiles-cleanup-settings", 8 * 1024);
  if ("error" in guard) return guard.error;
  if (!guard.session.isServerOwner) {
    return adminDiscordResponse(request, {
      ok: false,
      tone: "error",
      title: "Немає доступу",
      message: "Автоматичне видалення акаунтів може налаштовувати лише власник Discord-сервера.",
      status: 403,
    });
  }

  try {
    const form = await request.formData();
    const saved = await updateAccountCleanupAutomationSettings({
      autoCheckEnabled: form.get("autoCheckEnabled"),
      autoCleanupEnabled: form.get("autoCleanupEnabled"),
      checkIntervalHours: form.get("checkIntervalHours"),
      cleanupIntervalHours: form.get("cleanupIntervalHours"),
      profileLimit: form.get("profileLimit"),
    }, guard.session);

    await auditDiscordAdmin("discord.profiles.cleanup_settings_update", guard.session, {
      status: "success",
      autoCheckEnabled: saved.autoCheckEnabled,
      autoCleanupEnabled: saved.autoCleanupEnabled,
      checkIntervalHours: saved.checkIntervalHours,
      cleanupIntervalHours: saved.cleanupIntervalHours,
      profileLimit: saved.profileLimit,
      summary: `Автоперевірка ${saved.autoCheckEnabled ? "увімкнена" : "вимкнена"}; автоочищення ${saved.autoCleanupEnabled ? "увімкнене" : "вимкнене"}.`,
    });

    return adminDiscordResponse(request, {
      ok: true,
      tone: saved.autoCleanupEnabled ? "warning" : "success",
      title: "Автоматизацію очищення збережено",
      message: `Перевірка: ${saved.autoCheckEnabled ? `кожні ${saved.checkIntervalHours} год` : "вимкнена"}. Очищення: ${saved.autoCleanupEnabled ? `кожні ${saved.cleanupIntervalHours} год` : "вимкнене"}.`,
      data: { refresh: true },
    });
  } catch (error) {
    return await discordAdminError(
      request,
      "admin.discord.profiles_cleanup_settings_failed",
      error,
      "Налаштування автоматичного очищення не збережено.",
      guard.session,
    );
  }
}
