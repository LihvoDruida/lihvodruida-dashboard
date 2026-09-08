import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageRaids } from "@/lib/permissions";
import { saveRaidBenchPrioritySettingsFromForm } from "@/lib/raids";
import {
  assertRequestBodySize,
  logDashboardEvent,
  safeErrorMessage,
} from "@/lib/security";
import {  } from "@/lib/serverToasts";
import {  redirectWithToast } from "@/lib/apiRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function benchPriorityAuditKey(userId: string, settings: {
  enabled: boolean;
  characterKeys: string[];
  manualNames: string[];
}) {
  const hash = createHash("sha256")
    .update(JSON.stringify({
      enabled: settings.enabled,
      characterKeys: [...settings.characterKeys].sort(),
      manualNames: [...settings.manualNames].sort(),
    }))
    .digest("hex")
    .slice(0, 24);
  const actor = String(userId || "user").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "user";
  return `raids:bench-priority:${actor}:${hash}`;
}

export async function POST(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 128 * 1024);
  if (tooLarge) return tooLarge;

  const user = await getSession();
  if (!user || !canManageRaids(user)) {
    return redirectWithToast("/raids", {
      tone: "error",
      title: "Доступ заборонено",
      message: "Твоя роль не має доступу до налаштувань рейдів.",
      ttl: 7600,
    });
  }

  try {
    const form = await request.formData();
    const result = await saveRaidBenchPrioritySettingsFromForm(form, user);
    const settings = result.settings;
    logDashboardEvent("info", "raids.bench_priority.saved", request, {
      actorId: user.id,
      actorRole: user.role,
      enabled: settings.enabled,
      characterKeys: settings.characterKeys.length,
      manualNames: settings.manualNames.length,
      changed: result.changed,
    });

    if (!result.changed) {
      return redirectWithToast("/raids/bench-priority", {
        tone: "info",
        title: "Без змін",
        message: "Сірий список уже має такі самі налаштування, повторний запис не створювався.",
        ttl: 5200,
      });
    }

    await recordAdminAudit("raids.bench_priority.save", user, {
      auditKey: benchPriorityAuditKey(user.id, settings),
      status: "success",
      summary: `Сірий список рейдів оновлено: ${settings.characterKeys.length} зі складу, ${settings.manualNames.length} вручну.`,
      enabled: settings.enabled,
      characterKeys: settings.characterKeys.length,
      manualNames: settings.manualNames.length,
    }).catch(() => false);
    return redirectWithToast("/raids/bench-priority", {
      tone: "success",
      title: "Сірий список збережено",
      message:
        "Нові правила одразу застосовуються до всіх рейдів і Discord-складу.",
      ttl: 6200,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "raids.bench_priority.save_failed", request, {
      actorId: user.id,
      actorRole: user.role,
      message,
    });
    await recordAdminAudit("raids.bench_priority.save_failed", user, {
      status: "error",
      summary: `Сірий список рейдів не збережено: ${message}`,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return redirectWithToast("/raids/bench-priority", {
      tone: "error",
      title: "Сірий список не збережено",
      message,
      ttl: 8600,
    });
  }
}
