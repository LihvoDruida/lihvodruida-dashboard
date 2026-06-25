import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { setRulesAcceptanceSettings } from "@/lib/rulesAcceptanceSettings";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "rules-acceptance-settings");
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const settings = await setRulesAcceptanceSettings({
      allowRepeatedAcceptForTesting: form.get("allowRepeatedAcceptForTesting"),
    }, guard.session);

    await auditDiscordAdmin("discord.rules.acceptance_settings.update", guard.session, {
      status: "success",
      summary: settings.allowRepeatedAcceptForTesting
        ? "Увімкнено тестовий режим повторного натискання кнопки правил."
        : "Вимкнено тестовий режим повторного натискання кнопки правил.",
      allowRepeatedAcceptForTesting: settings.allowRepeatedAcceptForTesting,
    });

    return adminDiscordResponse(request, {
      ok: true,
      title: "Налаштування правил збережено",
      message: settings.allowRepeatedAcceptForTesting
        ? "Кнопку прийняття правил можна тестувати повторно навіть тим, хто вже має роль."
        : "Повторне натискання знову зупиняється повідомленням про вже прийняті правила.",
      data: { settings, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.rules.acceptance_settings_failed", error, "Налаштування правил не збережено.", guard.session);
  }
}
