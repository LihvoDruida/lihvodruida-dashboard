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
      roleRemoveConcurrency: form.get("roleRemoveConcurrency"),
      roleRemoveMaxConcurrency: form.get("roleRemoveMaxConcurrency"),
      nicknameCleanupConcurrency: form.get("nicknameCleanupConcurrency"),
      nicknameCleanupMaxConcurrency: form.get("nicknameCleanupMaxConcurrency"),
    }, guard.session);

    await auditDiscordAdmin("discord.management_settings.update", guard.session, {
      status: "success",
      summary: `Оновлено Discord-налаштування. Шаблон: ${policy.template}`,
      template: policy.template,
      roleRemoveConcurrency: policy.roleRemoveConcurrency,
      roleRemoveMaxConcurrency: policy.roleRemoveMaxConcurrency,
      nicknameCleanupConcurrency: policy.nicknameCleanupConcurrency,
      nicknameCleanupMaxConcurrency: policy.nicknameCleanupMaxConcurrency,
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
