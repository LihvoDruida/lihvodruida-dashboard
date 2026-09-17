import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { runDiscordNewcomerOnboarding } from "@/lib/discordNewcomerOnboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 45;

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "welcome-run-onboarding", 1024);
  if ("error" in guard) return guard.error;
  if (!guard.session.isServerOwner) {
    return adminDiscordResponse(request, { ok: false, tone: "error", title: "Немає доступу", message: "Ручний onboarding доступний лише власнику.", status: 403 });
  }
  try {
    const result = await runDiscordNewcomerOnboarding({ source: "manual" });
    await auditDiscordAdmin("discord.newcomer.onboarding_manual", guard.session, {
      status: result.failed || result.defaultRoleFailed || result.channelFailed ? "warning" : "success",
      ...result,
      summary: `Onboarding: знайдено ${result.newcomers}, оброблено ${result.processed}, ролей ${result.defaultRoleAssigned}, карток ${result.channelSent}, DM ${result.sent}.`,
    });
    return adminDiscordResponse(request, {
      ok: !(result.failed || result.defaultRoleFailed || result.channelFailed),
      tone: result.failed || result.defaultRoleFailed || result.channelFailed ? "warning" : "success",
      title: "Onboarding перевірено",
      message: `Нових/очікуючих: ${result.newcomers}; оброблено: ${result.processed}; ролей: ${result.defaultRoleAssigned}; карток: ${result.channelSent}; DM: ${result.sent}.`,
      data: { refresh: true },
    });
  } catch (error) {
    return discordAdminError(request, "admin.discord.onboarding_manual_failed", error, "Ручний onboarding не виконано.", guard.session);
  }
}
