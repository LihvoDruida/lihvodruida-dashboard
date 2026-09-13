import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { setGuildDiscordManagementSettings } from "@/lib/guildNicknamePolicy";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "settings");
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const policy = await setGuildDiscordManagementSettings({
      template: form.get("template"),
      nicknameCleanupConcurrency: form.get("nicknameCleanupConcurrency"),
      nicknameCleanupMaxConcurrency: form.get("nicknameCleanupMaxConcurrency"),
      nicknameReminderEnabled: form.get("nicknameReminderEnabled"),
      nicknameReminderIntervalHours: form.get("nicknameReminderIntervalHours"),
      nicknameInvalidRecheckHours: form.get("nicknameInvalidRecheckHours"),
      nicknameValidRecheckHours: form.get("nicknameValidRecheckHours"),
      nicknameReminderCooldownHours: form.get("nicknameReminderCooldownHours"),
      nicknameReminderBatchLimit: form.get("nicknameReminderBatchLimit"),
      nicknameReminderChannelId: form.get("nicknameReminderChannelId"),
    }, guard.session);

    await auditDiscordAdmin("discord.management_settings.update", guard.session, {
      status: "success",
      summary: `Оновлено Discord-налаштування. Шаблон: ${policy.template}`,
      template: policy.template,
      nicknameCleanupConcurrency: policy.nicknameCleanupConcurrency,
      nicknameCleanupMaxConcurrency: policy.nicknameCleanupMaxConcurrency,
      nicknameReminderEnabled: policy.nicknameReminderEnabled,
      nicknameReminderIntervalHours: policy.nicknameReminderIntervalHours,
      nicknameInvalidRecheckHours: policy.nicknameInvalidRecheckHours,
      nicknameValidRecheckHours: policy.nicknameValidRecheckHours,
      nicknameReminderCooldownHours: policy.nicknameReminderCooldownHours,
      nicknameReminderBatchLimit: policy.nicknameReminderBatchLimit,
      nicknameReminderChannelId: policy.nicknameReminderChannelId,
    });

    return adminDiscordResponse(request, {
      ok: true,
      title: "Discord-налаштування збережено",
      message: `Шаблон: ${policy.template}. Нові дії Discord беруть ці значення з панелі.`,
      data: { policy, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.settings_failed", error, "Налаштування не збережено.", guard.session);
  }
}
