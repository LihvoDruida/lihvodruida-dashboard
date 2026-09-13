import { NextRequest } from "next/server";

import { auditDiscordAdmin, adminDiscordResponse, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { acquireNicknameWarningExecution, sendNicknameWarnings } from "@/lib/discordNicknameWarnings";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "nicknames-notify", 8 * 1024);
  if ("error" in guard) return guard.error;

  const execution = acquireNicknameWarningExecution(`manual:${guard.session.id}`);
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
    const result = await sendNicknameWarnings({
      limit: form.get("limit"),
      source: "manual",
      force: String(form.get("force") || "") === "1",
    });

    await auditDiscordAdmin("discord.nickname_warning.manual", guard.session, {
      status: result.failed ? "warning" : "success",
      summary: result.summary,
      template: result.template,
      checked: result.checked,
      invalid: result.invalid,
      notified: result.notified,
      dm: result.dm,
      channel: result.channel,
      cooldownSkipped: result.cooldownSkipped,
      correctedBeforeSend: result.correctedBeforeSend,
      failed: result.failed,
      missingNickname: result.missingNicknameTotal,
      sent: result.sent,
      errors: result.errors,
    });

    return adminDiscordResponse(request, {
      ok: true,
      tone: result.failed ? "warning" : "success",
      title: "Попередження про ніки оброблено",
      message: result.summary,
      ttl: result.failed ? 16000 : 10000,
      data: { result, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(request, "admin.discord.nickname_warning_failed", error, "Попередження не надіслано.", guard.session);
  } finally {
    execution.release();
  }
}
