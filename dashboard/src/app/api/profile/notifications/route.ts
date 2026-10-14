import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRaidReminderPreference, setRaidReminderPreference } from "@/lib/discordNotificationPreferences";
import { assertRequestBodySize, checkRateLimit, getClientIp, noStoreHeaders, verifyTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStoreHeaders() });
async function ownSession() {
  const session = await getSession();
  return session?.profileId && session.provider === "discord" && !session.impersonatedBy && /^\d{16,25}$/.test(session.id) ? session : null;
}
export async function GET() {
  const session = await ownSession();
  if (!session) return reply({ ok: false, error: "Потрібен власний Discord-акаунт." }, 401);
  try { return reply({ ok: true, ...await getRaidReminderPreference(session.id) }); }
  catch { return reply({ ok: false, error: "Налаштування тимчасово недоступні." }, 503); }
}
export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return reply({ ok: false, error: "Недовірене джерело запиту." }, 403);
  const oversized = assertRequestBodySize(request, 1024);
  if (oversized) return oversized;
  const session = await ownSession();
  if (!session) return reply({ ok: false, error: "Потрібен власний Discord-акаунт." }, 401);
  if (!checkRateLimit(`profile-notifications:${session.id}:${getClientIp(request)}`, 20, 600_000).ok) return reply({ ok: false, error: "Забагато запитів." }, 429);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ ok: false, error: "Потрібен JSON-запит." }, 415);
  const reader = request.body?.getReader();
  if (!reader) return reply({ ok: false, error: "Порожній запит." }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) { await reader.cancel(); return reply({ ok: false, error: "Запит завеликий." }, 413); }
      chunks.push(part.value);
    }
  } catch { return reply({ ok: false, error: "Не вдалося прочитати запит." }, 400); }
  finally { reader.releaseLock(); }
  let data: any;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return reply({ ok: false, error: "Некоректний JSON." }, 400); }
  if (!data || Array.isArray(data) || typeof data.enabled !== "boolean" || Object.keys(data).some((key) => key !== "enabled")) return reply({ ok: false, error: "Некоректне налаштування." }, 400);
  try { return reply({ ok: true, ...await setRaidReminderPreference(session.id, data.enabled, session.profileId) }); }
  catch { return reply({ ok: false, error: "Не вдалося підтвердити збереження. Перевір актуальний стан перед повтором." }, 503); }
}
