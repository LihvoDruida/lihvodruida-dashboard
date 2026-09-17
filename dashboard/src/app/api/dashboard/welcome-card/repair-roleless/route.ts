import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { repairRolelessDiscordMembers } from "@/lib/discordNewcomerRecovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 45;

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "welcome-roleless-repair", 2048);
  if ("error" in guard) return guard.error;
  if (!guard.session.isServerOwner) {
    return adminDiscordResponse(request, { ok: false, tone: "error", title: "Немає доступу", message: "Відновлення ролей доступне лише власнику.", status: 403 });
  }
  try {
    const result = await repairRolelessDiscordMembers();
    await auditDiscordAdmin("discord.newcomer.roleless_repair", guard.session, {
      status: result.failed ? "warning" : "success",
      ...result,
      summary: `Відновлення стартової ролі: видано ${result.assigned}/${result.targeted}; помилок ${result.failed}.`,
    });
    return adminDiscordResponse(request, {
      ok: result.failed === 0,
      tone: result.failed ? "warning" : "success",
      title: "Відновлення ролей завершено",
      message: `Стартову роль видано ${result.assigned} з ${result.targeted} учасників без ролей. Помилок: ${result.failed}.`,
      data: { refresh: true },
    });
  } catch (error) {
    return discordAdminError(request, "admin.discord.roleless_repair_failed", error, "Стартову роль не відновлено.", guard.session);
  }
}
