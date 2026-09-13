import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { acquireNicknameWarningExecution, inspectNicknameWarnings } from "@/lib/discordNicknameWarnings";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "nicknames-inspect", 8 * 1024);
  if ("error" in guard) return guard.error;

  const execution = acquireNicknameWarningExecution(`manual-inspect:${guard.session.id}`);
  if (!execution) {
    return adminDiscordResponse(request, {
      ok: false,
      tone: "warning",
      title: "Перевірка вже виконується",
      message: "Дочекайся завершення поточної перевірки/розсилки ніків і спробуй ще раз.",
    });
  }

  try {
    const form = await request.formData();
    const recheckAll = String(form.get("recheckAll") || "") === "1";
    const result = await inspectNicknameWarnings(recheckAll ? 0 : (form.get("limit") || 0));
    const missingNick = result.missingNicknameTotal ? ` Без серверного ніку: ${result.missingNicknameTotal}.` : "";
    const priority = result.fullScan
      ? ` Пріоритетну чергу перебудовано: некоректні — кожні ${result.invalidRecheckHours} год, коректні — кожні ${result.validRecheckHours} год.`
      : "";
    const summary = `Перевірено серверні ніки ${result.checked} учасників; не відповідають шаблону: ${result.invalidTotal}.${missingNick}${priority}`;
    await auditDiscordAdmin("discord.nickname_policy.inspect", guard.session, {
      status: result.invalidTotal ? "warning" : "success",
      summary,
      checked: result.checked,
      valid: result.validTotal,
      mismatched: result.invalidTotal,
      fullScan: result.fullScan,
      invalidRecheckHours: result.invalidRecheckHours,
      validRecheckHours: result.validRecheckHours,
      missingServerNickname: result.missingNicknameTotal || 0,
      template: result.template,
      preview: result.preview.slice(0, 20),
    });
    return adminDiscordResponse(request, {
      ok: true,
      tone: result.invalidTotal ? "warning" : "success",
      title: result.fullScan ? "Повну перевірку ніків завершено" : "Перевірку серверних ніків завершено",
      message: summary,
      data: { checked: result.checked, validTotal: result.validTotal, mismatchedTotal: result.invalidTotal, missingNicknameTotal: result.missingNicknameTotal || 0, fullScan: result.fullScan, preview: result.preview, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.nicknames_inspect_failed", error, "Перевірку ніків не виконано.", guard.session);
  } finally {
    execution.release();
  }
}
