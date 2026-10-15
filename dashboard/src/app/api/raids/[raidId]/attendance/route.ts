import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { handleRaidSessionAction, raidLiveRevision, syncRaidDiscordSignupUpdate, type RaidSignupStatus } from "@/lib/raids";
import { assertRequestBodySize, noStoreHeaders, safeErrorMessage, verifyTrustedOrigin, checkRateLimit, getClientIp, logDashboardEvent } from "@/lib/security";
import { diagnosticErrorSummary } from "@/lib/logPrivacy";
import { dashboardToastCookie } from "@/lib/serverToasts";
import { appBaseUrl, wantsJson } from "@/lib/apiRoute";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function raidPath(raidId: string) {
  return `/raids/${encodeURIComponent(raidId)}`;
}

function redirectToRaid(request: NextRequest, raidId: string, toast?: { tone?: "info" | "success" | "warning" | "error"; title: string; message?: string; ttl?: number }) {
  const url = new URL(raidPath(raidId), appBaseUrl(request));
  const response = NextResponse.redirect(url, { status: 303, headers: noStoreHeaders() });
  if (toast) response.headers.append("Set-Cookie", dashboardToastCookie(toast));
  return response;
}

function jsonToast(payload: { ok: boolean; status?: number; tone?: "info" | "success" | "warning" | "error"; title: string; message?: string; raid?: { id: string } | null; loginUrl?: string; revision?: string | null }) {
  return NextResponse.json({
    ok: payload.ok,
    toast: { tone: payload.tone || (payload.ok ? "success" : "error"), title: payload.title, message: payload.message },
    raid: payload.raid || null,
    loginUrl: payload.loginUrl || null,
    revision: payload.revision || null,
  }, { status: payload.status || (payload.ok ? 200 : 400), headers: noStoreHeaders() });
}

function cleanAction(value: unknown): RaidSignupStatus {
  const action = String(value || "").trim().toLowerCase();
  if (action === "late") return "late";
  if (["tentative", "maybe", "50/50", "5050", "half"].includes(action)) return "tentative";
  if (action === "skipped" || action === "skip") return "skipped";
  if (action === "going") return "going";
  throw new Error("Обери коректний варіант участі в рейді.");
}

type AttendanceInput = {
  action: RaidSignupStatus;
  characterKey: string | null;
  /** Другий метод запису: клас+спек замість персонажа Battle.net. */
  manual: { classKey: string; specKey: string } | null;
  signupRole: "tank" | "healer" | "dps" | null;
  reminderPreference?: boolean;
};

function readManualSelection(classKey: unknown, specKey: unknown) {
  const cls = String(classKey || "").trim().toLowerCase();
  const spec = String(specKey || "").trim().toLowerCase();
  return cls && spec ? { classKey: cls, specKey: spec } : null;
}

async function readAttendanceInput(request: NextRequest): Promise<AttendanceInput> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null) as { action?: unknown; characterKey?: unknown; character_key?: unknown; classKey?: unknown; specKey?: unknown; signupRole?: unknown; reminderEnabled?: unknown } | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Некоректні дані запису в рейд.");
    return {
      action: cleanAction(body?.action),
      characterKey: String(body?.characterKey || body?.character_key || "").trim() || null,
      manual: readManualSelection(body?.classKey, body?.specKey),
      signupRole: ["tank", "healer", "dps"].includes(String(body?.signupRole || "")) ? body!.signupRole as "tank" | "healer" | "dps" : null,
      reminderPreference: typeof body?.reminderEnabled === "boolean" ? body.reminderEnabled : undefined,
    };
  }
  const form = await request.formData();
  return {
    action: cleanAction(form.get("action")),
    characterKey: String(form.get("characterKey") || "").trim() || null,
    manual: readManualSelection(form.get("classKey"), form.get("specKey")),
    signupRole: ["tank", "healer", "dps"].includes(String(form.get("signupRole") || "")) ? String(form.get("signupRole")) as "tank" | "healer" | "dps" : null,
    reminderPreference: ["true", "false"].includes(String(form.get("reminderEnabled"))) ? form.get("reminderEnabled") === "true" : undefined,
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ raidId: string }> }) {
  const startedAt = Date.now();
  if (!verifyTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "untrusted_origin" }, { status: 403, headers: noStoreHeaders() });
  const tooLarge = assertRequestBodySize(request, 64 * 1024);
  if (tooLarge) return tooLarge;

  const { raidId } = await context.params;
  const report = (level: "info" | "warn" | "error" | "debug", details: Record<string, unknown>) => {
    try { logDashboardEvent(level, "raids.attendance.result", request, {
      resourceType: "raid", resourceId: raidId, durationMs: Math.max(0, Date.now() - startedAt), ...details,
    }, { category: "action", ...(level === "debug" ? { persist: false } : {}) }); } catch { /* Diagnostics cannot change attendance. */ }
  };
  const user = await getSession();

  const jsonMode = wantsJson(request);

  if (!user) {
    report("warn", { outcome: "rejected", phase: "authorization", reason: "session_required", statusCode: jsonMode ? 401 : 303 });
    const loginUrl = new URL("/login", appBaseUrl(request));
    loginUrl.searchParams.set("next", raidPath(raidId));
    loginUrl.searchParams.set("error", "session_required");
    if (jsonMode) {
      return jsonToast({ ok: false, status: 401, tone: "warning", title: "Потрібен Discord-вхід", message: "Увійди через Discord, а потім повтори запис на рейд.", loginUrl: loginUrl.toString() });
    }
    return NextResponse.redirect(loginUrl, { status: 303, headers: noStoreHeaders() });
  }

  if (!checkRateLimit(`raid-attendance:${raidId}:${user.id}:${getClientIp(request)}`, 30, 5 * 60_000).ok) {
    report("warn", { outcome: "rejected", phase: "rate_limit", reason: "rate_limited", statusCode: 429 });
    return jsonToast({ ok: false, status: 429, tone: "warning", title: "Забагато запитів", message: "Повтори запис трохи пізніше." });
  }
  let phase = "input";
  try {
    const { action, characterKey, manual, signupRole, reminderPreference } = await readAttendanceInput(request);
    phase = "commit";
    const result = await handleRaidSessionAction({ raidId, action, user, characterKey, manual, signupRole, reminderPreference, syncDiscord: false });

    if (!result.ok) {
      report("warn", { outcome: "rejected", phase, reason: "policy_rejected", action, statusCode: jsonMode ? 400 : 303 });
      if (jsonMode) return jsonToast({ ok: false, tone: "error", title: "Запис не оновлено", message: result.content || "Дію не виконано." });
      return redirectToRaid(request, raidId, { tone: "error", title: "Запис не оновлено", message: result.content || "Дію не виконано.", ttl: 8200 });
    }

    let discordSync = "not_needed";
    if ("raid" in result && result.raid) {
      const raidToSync = result.raid;
      try {
        after(async () => {
          try {
            const confirmed = await syncRaidDiscordSignupUpdate(raidToSync);
            report(confirmed ? "debug" : "warn", { phase: "discord_sync", outcome: confirmed ? "confirmed" : "unconfirmed", commitState: "committed", reason: confirmed ? null : "sync_not_confirmed", nextAction: confirmed ? null : "check_publication" });
          } catch (error) {
            report("warn", { phase: "discord_sync", outcome: "unconfirmed", commitState: "committed", nextAction: "check_publication", ...diagnosticErrorSummary(error) });
          }
        });
        discordSync = "scheduled";
      } catch { discordSync = "deferred"; }
    }
    report(discordSync === "deferred" ? "warn" : "info", { phase: "commit", outcome: "committed", action, discordSync, statusCode: jsonMode ? 200 : 303, ...(discordSync === "deferred" ? { reason: "after_unavailable", nextAction: "check_publication" } : {}) });

    const successMessage = (result.content || (action === "going"
      ? "Тебе записано на рейд. Склад оновлюється."
      : action === "tentative"
        ? "Тебе записано 50/50. Якщо треба звільнити місце, запис піде в лаву запасних після сірого списку."
        : action === "late"
          ? "Позначено, що ти затримаєшся. Склад оновлюється."
          : "Позначено, що ти пропускаєш рейд.")) + (discordSync === "deferred" ? " ⚠️ Запис збережено. Перевір оновлення Discord окремо." : "");

    const tone = successMessage.includes("⚠️") ? "warning" : "success";
    if (jsonMode) {
      return jsonToast({ ok: true, tone, title: "Запис оновлено", message: successMessage, raid: { id: raidId },  revision: "raid" in result && result.raid ? raidLiveRevision(result.raid) : null });
    }
    return redirectToRaid(request, raidId, { tone, title: "Запис оновлено", message: successMessage, ttl: successMessage.includes("⚠️") ? 9200 : 6200 });
  } catch (error) {
    report(phase === "input" ? "warn" : "error", { phase, outcome: phase === "input" ? "rejected" : "unconfirmed", reason: phase === "input" ? "invalid_input" : "operation_failed", statusCode: jsonMode ? 400 : 303, ...diagnosticErrorSummary(error) });
    if (jsonMode) return jsonToast({ ok: false, tone: "error", title: "Запис не оновлено", message: safeErrorMessage(error) });
    return redirectToRaid(request, raidId, { tone: "error", title: "Запис не оновлено", message: safeErrorMessage(error), ttl: 8200 });
  }
}
