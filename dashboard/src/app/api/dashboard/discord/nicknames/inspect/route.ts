import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { inspectDiscordNicknameTemplate } from "@/lib/discordMemberManagement";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "nicknames-inspect", 8 * 1024);
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const result = await inspectDiscordNicknameTemplate(form.get("limit") || 0);
    const missingNick = result.missingServerNicknameTotal ? ` Без серверного ніку: ${result.missingServerNicknameTotal}.` : "";
    const summary = `Перевірено серверні ніки ${result.checked} учасників; не відповідають шаблону: ${result.mismatchedTotal}.${missingNick}`;
    await auditDiscordAdmin("discord.nickname_policy.inspect", guard.session, {
      status: result.mismatchedTotal ? "warning" : "success",
      summary,
      checked: result.checked,
      checkedField: result.checkedField,
      mismatched: result.mismatchedTotal,
      missingServerNickname: result.missingServerNicknameTotal || 0,
      template: result.template,
      preview: result.mismatched.slice(0, 20),
    });
    return adminDiscordResponse(request, {
      ok: true,
      tone: result.mismatchedTotal ? "warning" : "success",
      title: "Перевірку серверних ніків завершено",
      message: summary,
      data: { checked: result.checked, checkedField: result.checkedField, mismatchedTotal: result.mismatchedTotal, missingServerNicknameTotal: result.missingServerNicknameTotal || 0, preview: result.mismatched, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.nicknames_inspect_failed", error, "Перевірку ніків не виконано.", guard.session);
  }
}
