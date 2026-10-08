import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addStaticViolation, createStaticInvite, listStaticOverview, removeStaticMember, removeStaticViolation, revokeStaticInvite, staticPermission, unblockStaticMember } from "@/lib/staticRules";
import { assertRequestBodySize, checkRateLimit, noStoreHeaders, verifyTrustedOrigin } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: noStoreHeaders() });
export async function GET() {
  try {
    const session = await getSession({ live: true });
    const access = await staticPermission(session);
    if (!access.view) return reply({ ok: false, error: "Немає доступу." }, 403);
    return reply({ ok: true, permissions: access, ...await listStaticOverview() });
  } catch { return reply({ ok: false, error: "Сервіс тимчасово недоступний." }, 503); }
}
export async function POST(request: NextRequest) {
  const large = assertRequestBodySize(request, 32 * 1024);
  if (large) return large;
  if (!verifyTrustedOrigin(request)) return reply({ ok: false, error: "Неприпустиме джерело запиту." }, 403);
  const session = await getSession({ live: true });
  let access;
  try { access = await staticPermission(session); } catch { return reply({ ok: false, error: "Не вдалося перевірити Discord-ролі." }, 503); }
  if (!access.edit || !session) return reply({ ok: false, error: "Редагувати може тільки уповноважений РЛ або адміністратор." }, 403);
  if (!checkRateLimit(`static-manage:${session.id}`, 30, 60_000).ok) return reply({ ok: false, error: "Забагато запитів." }, 429);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "create-invite") return reply({ ok: true, invite: await createStaticInvite(session.id) });
    if (action === "revoke-invite") { await revokeStaticInvite(String(body.id || ""), session.id); return reply({ ok: true }); }
    if (action === "remove-member") { await removeStaticMember(String(body.userId || ""), session.id); return reply({ ok: true }); }
    if (action === "unblock-member") { await unblockStaticMember(String(body.userId || ""), session.id); return reply({ ok: true }); }
    if (action === "add-violation") { const result = await addStaticViolation(String(body.userId || ""), String(body.description || ""), session.id); return reply({ ok: true, result, warning: result.warning }); }
    if (action === "remove-violation") { await removeStaticViolation(String(body.userId || ""), String(body.violationId || ""), session.id); return reply({ ok: true }); }
    return reply({ ok: false, error: "Невідома дія." }, 400);
  } catch (error) { return reply({ ok: false, error: error instanceof Error ? error.message : "Помилка збереження." }, 400); }
}
