import { NextRequest } from "next/server";

import {
  adminDiscordResponse,
  auditDiscordAdmin,
  discordAdminError,
  requireDiscordAdmin,
} from "@/lib/dashboardDiscordRoute";
import {
  callRecruitmentGatewayControl,
  type RecruitmentGatewayAction,
} from "@/lib/discordRecruitmentGatewayControl";
import {
  previewRecruitmentAdviceForText,
  scanDiscordRecruitmentAdvice,
} from "@/lib/discordRecruitmentAdvisor";
import { getRecruitmentAdvisorSettings } from "@/lib/discordRecruitmentAdvisorSettings";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanAction(value: unknown) {
  return String(value || "status")
    .trim()
    .toLowerCase();
}

function isGatewayAction(action: string): action is RecruitmentGatewayAction {
  return ["status", "start", "reconnect", "stop", "test-relay", "manual-scan"].includes(action);
}

function resultSummary(data: any) {
  if (!data || typeof data !== "object") return "Немає даних.";
  if ("scanned" in data || "matched" in data || "replied" in data) {
    return `Перевірено повідомлень: ${data.scanned || 0}; знайдено: ${data.matched || 0}; відповідей: ${data.replied || 0}; пропущено: ${data.skipped || 0}; помилок: ${Array.isArray(data.errors) ? data.errors.length : 0}.`;
  }
  return `enabled=${Boolean(data.enabled)}, connected=${Boolean(data.connected)}, readyState=${data.readyState ?? "—"}, lastEventAt=${data.lastEventAt || "—"}${data.lastError ? `, error=${data.lastError}` : ""}.`;
}

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "recruitment-control");
  if ("error" in guard) return guard.error;

  try {
    const form = await request.formData();
    const action = cleanAction(form.get("action"));
    const settings = await getRecruitmentAdvisorSettings({ bypassCache: true });

    if (action === "preview-text") {
      const content = String(form.get("content") || "").trim();
      if (!content) {
        return adminDiscordResponse(request, {
          ok: false,
          tone: "warning",
          title: "Немає тексту",
          message: "Встав Discord-повідомлення для тесту аналізу.",
          status: 400,
        });
      }
      const preview = previewRecruitmentAdviceForText(content, "0");
      const response = await preview.build();

      await auditDiscordAdmin(
        "discord.recruitment_advice.preview_text",
        guard.session,
        {
          status: preview.intent.matched ? "success" : "warning",
          summary: `matched=${preview.intent.matched}, score=${preview.intent.score}, reasons=${preview.intent.reasons.join(", ")}`,
          intent: preview.intent,
        },
      );

      return adminDiscordResponse(request, {
        ok: true,
        tone: preview.intent.matched ? "success" : "warning",
        title: preview.intent.matched
          ? "Повідомлення буде розпізнано"
          : "Повідомлення не пройшло фільтр",
        message: `score=${preview.intent.score}; причини: ${preview.intent.reasons.join(", ") || "—"}. Відповідь: ${response.slice(0, 420)}...`,
        ttl: 18000,
        data: { intent: preview.intent, response },
      });
    }

    if (action === "scan" || action === "dry-run-scan" || action === "retry-failed-skipped") {
      const dryRun = action === "dry-run-scan";
      const result = await scanDiscordRecruitmentAdvice({
        dryRun,
        force: true,
        limit: settings.manualScanLimit,
      });

      await auditDiscordAdmin(
        dryRun
          ? "discord.recruitment_advice.manual_dry_scan"
          : "discord.recruitment_advice.manual_scan",
        guard.session,
        {
          status: result.ok && !result.errors.length ? "success" : "warning",
          summary: resultSummary(result),
          result,
        },
      );

      return adminDiscordResponse(request, {
        ok: result.ok,
        tone: result.errors.length
          ? "warning"
          : result.replied || result.samples.length
            ? "success"
            : "info",
        title: dryRun
          ? "Тестову перевірку завершено"
          : "Ручну перевірку повідомлень завершено",
        message: `${resultSummary(result)}${dryRun && result.samples[0]?.response ? ` Приклад відповіді: ${result.samples[0].response.slice(0, 220)}...` : ""}`,
        ttl: 14000,
        data: { result, refresh: true },
      });
    }

    if (!isGatewayAction(action)) {
      return adminDiscordResponse(request, {
        ok: false,
        tone: "warning",
        title: "Невідома дія",
        message: `Дія ${action} не підтримується.`,
        status: 400,
      });
    }

    const result = await callRecruitmentGatewayControl(action);

    await auditDiscordAdmin(
      `discord.recruitment_gateway.${action}`,
      guard.session,
      {
        status:
          result.ok && !result.error && !result.lastError
            ? "success"
            : "warning",
        summary: resultSummary(result),
        result,
      },
    );

    return adminDiscordResponse(request, {
      ok: Boolean(result.ok),
      tone:
        result.ok && !result.error && !result.lastError ? "success" : "warning",
      title:
        action === "manual-scan"
          ? "Ручне сканування бота виконано"
          : action === "test-relay"
            ? "Тестове реле бота виконано"
            : "Команду Gateway виконано",
      message: resultSummary(result),
      ttl: 12000,
      data: { result, refresh: true },
    });
  } catch (error) {
    return await discordAdminError(
      request,
      "admin.discord.recruitment_control_failed",
      error,
      "Команду автовідповідей не виконано.",
      guard.session,
    );
  }
}
