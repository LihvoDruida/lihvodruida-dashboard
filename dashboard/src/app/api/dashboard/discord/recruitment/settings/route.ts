import { NextRequest } from "next/server";

import {
  adminDiscordResponse,
  auditDiscordAdmin,
  discordAdminError,
  requireDiscordAdmin,
} from "@/lib/dashboardDiscordRoute";
import { setRecruitmentAdvisorSettings } from "@/lib/discordRecruitmentAdvisorSettings";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "recruitment-settings");
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const settings = await setRecruitmentAdvisorSettings(
      {
        enabled: form.get("enabled"),
        dryRun: form.get("dryRun"),
        lookbackHours: form.get("lookbackHours"),
        maxPages: form.get("maxPages"),
        maxReplies: form.get("maxReplies"),
        maxChannels: form.get("maxChannels"),
        minRio: form.get("minRio"),
        minIlvl: form.get("minIlvl"),
        manualScanLimit: form.get("manualScanLimit"),
      },
      guard.session,
    );

    await auditDiscordAdmin(
      "discord.recruitment_advice.settings_update",
      guard.session,
      {
        status: "success",
        summary: `Оновлено автовідповіді рекрутингу: ${settings.enabled ? "увімкнено" : "вимкнено"}, dryRun=${settings.dryRun}.`,
        settings,
      },
    );

    return adminDiscordResponse(request, {
      ok: true,
      title: "Налаштування автовідповідей збережено",
      message: `Система ${settings.enabled ? "увімкнена" : "вимкнена"}. Ручна перевірка дивиться ${settings.lookbackHours} год., ліміт відповідей: ${settings.manualScanLimit}.`,
      data: { settings, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(
      request,
      "admin.discord.recruitment_settings_failed",
      error,
      "Налаштування автовідповідей не збережено.",
      guard.session,
    );
  }
}
