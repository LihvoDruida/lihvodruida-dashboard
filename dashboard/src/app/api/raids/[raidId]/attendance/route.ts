import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { handleRaidSessionAction, raidLiveRevision, syncRaidDiscordSignupUpdate, type RaidSignupStatus } from "@/lib/raids";
import { assertRequestBodySize, noStoreHeaders, safeErrorMessage } from "@/lib/security";
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
  return "going";
}

type AttendanceInput = {
  action: RaidSignupStatus;
  characterKey: string | null;
  /** Другий метод запису: клас+спек замість персонажа Battle.net. */
  manual: { classKey: string; specKey: string } | null;
};

function readManualSelection(classKey: unknown, specKey: unknown) {
  const cls = String(classKey || "").trim().toLowerCase();
  const spec = String(specKey || "").trim().toLowerCase();
  return cls && spec ? { classKey: cls, specKey: spec } : null;
}

async function readAttendanceInput(request: NextRequest): Promise<AttendanceInput> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null) as { action?: unknown; characterKey?: unknown; character_key?: unknown; classKey?: unknown; specKey?: unknown } | null;
    return {
      action: cleanAction(body?.action),
      characterKey: String(body?.characterKey || body?.character_key || "").trim() || null,
      manual: readManualSelection(body?.classKey, body?.specKey),
    };
  }
  const form = await request.formData();
  return {
    action: cleanAction(form.get("action")),
    characterKey: String(form.get("characterKey") || "").trim() || null,
    manual: readManualSelection(form.get("classKey"), form.get("specKey")),
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ raidId: string }> }) {
  const tooLarge = assertRequestBodySize(request, 64 * 1024);
  if (tooLarge) return tooLarge;

  const { raidId } = await context.params;
  const user = await getSession();

  const jsonMode = wantsJson(request);

  if (!user) {
    const loginUrl = new URL("/login", appBaseUrl(request));
    loginUrl.searchParams.set("next", raidPath(raidId));
    loginUrl.searchParams.set("error", "session_required");
    if (jsonMode) {
      return jsonToast({ ok: false, status: 401, tone: "warning", title: "Потрібен Discord-вхід", message: "Увійди через Discord, а потім повтори запис на рейд.", loginUrl: loginUrl.toString() });
    }
    return NextResponse.redirect(loginUrl, { status: 303, headers: noStoreHeaders() });
  }

  try {
    const { action, characterKey, manual } = await readAttendanceInput(request);
    const result = await handleRaidSessionAction({ raidId, action, user, characterKey, manual, syncDiscord: false });

    if (!result.ok) {
      if (jsonMode) return jsonToast({ ok: false, tone: "error", title: "Запис не оновлено", message: result.content || "Дію не виконано." });
      return redirectToRaid(request, raidId, { tone: "error", title: "Запис не оновлено", message: result.content || "Дію не виконано.", ttl: 8200 });
    }

    if ("raid" in result && result.raid) {
      const raidToSync = result.raid;
      after(async () => {
        await syncRaidDiscordSignupUpdate(raidToSync);
      });
    }

    const successMessage = result.content || (action === "going"
      ? "Тебе записано на рейд. Склад оновлюється."
      : action === "tentative"
        ? "Тебе записано 50/50. Якщо треба звільнити місце, запис піде в лаву запасних після сірого списку."
        : action === "late"
          ? "Позначено, що ти затримаєшся. Склад оновлюється."
          : "Позначено, що ти пропускаєш рейд.");

    const tone = successMessage.includes("⚠️") ? "warning" : "success";
    if (jsonMode) {
      return jsonToast({ ok: true, tone, title: "Запис оновлено", message: successMessage, raid: { id: raidId },  revision: "raid" in result && result.raid ? raidLiveRevision(result.raid) : null });
    }
    return redirectToRaid(request, raidId, { tone, title: "Запис оновлено", message: successMessage, ttl: successMessage.includes("⚠️") ? 9200 : 6200 });
  } catch (error) {
    if (jsonMode) return jsonToast({ ok: false, tone: "error", title: "Запис не оновлено", message: safeErrorMessage(error) });
    return redirectToRaid(request, raidId, { tone: "error", title: "Запис не оновлено", message: safeErrorMessage(error), ttl: 8200 });
  }
}
