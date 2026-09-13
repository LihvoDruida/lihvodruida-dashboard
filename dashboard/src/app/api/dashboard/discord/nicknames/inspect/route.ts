import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { inspectNicknameWarnings } from "@/lib/discordNicknameWarnings";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "nicknames-inspect", 8 * 1024);
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const result = await inspectNicknameWarnings(form.get("limit") || 0);
    const missingNick = result.missingNicknameTotal ? ` Без серверного ніку: ${result.missingNicknameTotal}.` : "";
    const summary = `Перевірено серверні ніки ${result.checked} учасників; не відповідають шаблону: ${result.invalidTotal}.${missingNick}`;
    await auditDiscordAdmin("discord.nickname_policy.inspect", guard.session, {
      status: result.invalidTotal ? "warning" : "success",
      summary,
      checked: result.checked,
      mismatched: result.invalidTotal,
      missingServerNickname: result.missingNicknameTotal || 0,
      template: result.template,
      preview: result.preview.slice(0, 20),
    });
    return adminDiscordResponse(request, {
      ok: true,
      tone: result.invalidTotal ? "warning" : "success",
      title: "Перевірку серверних ніків завершено",
      message: summary,
      data: { checked: result.checked, mismatchedTotal: result.invalidTotal, missingNicknameTotal: result.missingNicknameTotal || 0, preview: result.preview, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.nicknames_inspect_failed", error, "Перевірку ніків не виконано.", guard.session);
  }
}
