import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStaticSettings, saveStaticSettings, staticPermission } from "@/lib/staticRules";
import { assertRequestBodySize, checkRateLimit, noStoreHeaders, verifyTrustedOrigin } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: noStoreHeaders() });
export async function GET() {
  try {
    const session = await getSession({ live: true });
    const permissions = await staticPermission(session);
    if (!permissions.view) return reply({ ok: false, error: "Немає доступу до правил." }, 403);
    return reply({ ok: true, permissions, settings: await getStaticSettings() });
  } catch { return reply({ ok: false, error: "Не вдалося отримати правила." }, 503); }
}
export async function POST(request: NextRequest) {
  const large = assertRequestBodySize(request, 32 * 1024);
  if (large) return large;
  if (!verifyTrustedOrigin(request)) return reply({ ok: false, error: "Неприпустиме джерело запиту." }, 403);
  try {
    const session = await getSession({ live: true });
    const permissions = await staticPermission(session);
    if (!session || !permissions.edit) return reply({ ok: false, error: "Редагувати може лише відповідальний РЛ або адміністрація." }, 403);
    if (!checkRateLimit(`static-rules:${session.id}`, 12, 60_000).ok) return reply({ ok: false, error: "Забагато запитів." }, 429);
    const body = await request.json().catch(() => ({}));
    if (typeof body.text !== "string" || body.text.length > 20_000) return reply({ ok: false, error: "Некоректна довжина Markdown." }, 400);
    return reply({ ok: true, settings: await saveStaticSettings({ text: body.text }, session.id) });
  } catch (error) { return reply({ ok: false, error: error instanceof Error ? error.message : "Не вдалося зберегти правила." }, 400); }
}
