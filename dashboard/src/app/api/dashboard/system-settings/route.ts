import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageSettings } from "@/lib/permissions";
import {
  assertRequestBodySize,
  checkRateLimit,
  getClientIp,
  noStoreHeaders,
  verifyTrustedOrigin,
} from "@/lib/security";
import { SystemSettingsConflictError, envStatus, loadSystemSettings, saveSystemSettings, systemSettingsView } from "@/lib/systemSettings";
import { normalizeSystemSettings } from "@/lib/systemSettingsSchema";

export const revalidate = 0;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: noStoreHeaders() });

async function ownerSession() {
  const session = await getSession({ live: true });
  if (!session) return { error: json({ ok: false, message: "Потрібен вхід." }, 401) };
  if (!canManageSettings(session)) return { error: json({ ok: false, message: "Налаштування системи доступні лише власнику Discord-сервера." }, 403) };
  return { session };
}

export async function GET() {
  const guard = await ownerSession();
  if ("error" in guard) return guard.error;
  try {
    const state = await loadSystemSettings();
    return json({ ok: true, revision: state.revision, updatedAt: state.updatedAt, updatedBy: state.updatedBy, settings: systemSettingsView(state), env: envStatus() });
  } catch {
    return json({ ok: false, message: "Не вдалося прочитати налаштування зі сховища." }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return json({ ok: false, message: "Недовірене джерело запиту." }, 403);
  const tooLarge = assertRequestBodySize(request, 16 * 1024);
  if (tooLarge) return tooLarge;
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json({ ok: false, message: "Очікується JSON." }, 415);
  const guard = await ownerSession();
  if ("error" in guard) return guard.error;
  const { session } = guard;

  const rate = checkRateLimit(`system-settings:${session.id}:${getClientIp(request)}`, 20, 10 * 60 * 1000);
  if (!rate.ok) return json({ ok: false, message: "Забагато змін. Зачекай кілька хвилин." }, 429);

  let body: { revision?: unknown; values?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Пошкоджений JSON." }, 400);
  }
  const revision = Number(body?.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) return json({ ok: false, message: "Потрібна ревізія налаштувань." }, 400);
  const normalized = normalizeSystemSettings(body?.values);
  if ("errors" in normalized) return json({ ok: false, message: "Перевір виділені поля.", errors: normalized.errors }, 422);

  let previous: Record<string, string>;
  try {
    previous = (await loadSystemSettings()).values;
  } catch {
    return json({ ok: false, message: "Сховище недоступне; нічого не змінено." }, 503);
  }
  try {
    const state = await saveSystemSettings(normalized.values, revision, session);
    // Values are non-secret by construction, so the audit can name what changed.
    const changed = [...new Set([...Object.keys(previous), ...Object.keys(state.values)])]
      .filter(key => previous[key] !== state.values[key])
      .map(key => ({ key, from: previous[key] || "(.env)", to: state.values[key] || "(.env)" }));
    await recordAdminAudit("system.settings.update", session, {
      status: "success",
      summary: changed.length ? `Змінено системні налаштування: ${changed.map(item => item.key).join(", ")}` : "Системні налаштування збережено без змін.",
      changed,
      revision: state.revision,
    }).catch(() => undefined);
    return json({ ok: true, revision: state.revision, updatedAt: state.updatedAt, updatedBy: state.updatedBy, settings: systemSettingsView(state), env: envStatus() });
  } catch (error) {
    if (error instanceof SystemSettingsConflictError) return json({ ok: false, message: error.message }, 409);
    return json({ ok: false, message: "Не вдалося зберегти налаштування; нічого не змінено." }, 503);
  }
}
