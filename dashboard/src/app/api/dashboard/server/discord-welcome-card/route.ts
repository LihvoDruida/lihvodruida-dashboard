import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { setDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "server-discord-welcome-card-settings", 12 * 1024);
  if ("error" in guard) return guard.error;
  if (!guard.session.isServerOwner) {
    return adminDiscordResponse(request, {
      ok: false,
      tone: "error",
      title: "Немає доступу",
      message: "Налаштування welcome-карток доступні лише власнику Discord-сервера.",
      status: 403,
    });
  }

  try {
    const form = await request.formData();
    const saved = await setDiscordWelcomeCardSettings({
      enabled: form.get("enabled"),
      channelId: form.get("channelId"),
      messageTemplate: form.get("messageTemplate"),
      greetings: form.get("greetings"),
      labelPrefix: form.get("labelPrefix"),
      fileName: form.get("fileName"),
    }, guard.session);

    await auditDiscordAdmin("discord.welcome_card_settings.update", guard.session, {
      status: "success",
      enabled: saved.enabled,
      channelId: saved.channelId,
      greetings: saved.greetings.length,
      labelPrefix: saved.labelPrefix,
      fileName: saved.fileName,
      summary: `Welcome-картка ${saved.enabled ? `увімкнена для каналу ${saved.channelId}` : "вимкнена"}.`,
    });

    return adminDiscordResponse(request, {
      ok: true,
      tone: saved.enabled ? "success" : "warning",
      title: "Welcome-картки збережено",
      message: saved.enabled
        ? `Нові учасники отримуватимуть картку в каналі ${saved.channelId}.`
        : "Публічні welcome-картки вимкнені.",
      data: { refresh: true },
    });
  } catch (error) {
    return discordAdminError(
      request,
      "admin.discord.welcome_card_settings_failed",
      error,
      "Налаштування welcome-карток не збережено.",
      guard.session,
    );
  }
}
