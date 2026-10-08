import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { fetchDiscordRoleControlSnapshot } from "@/lib/discordAdmin";
import { getStaticSettings, saveStaticSettings, staticPermission } from "@/lib/staticRules";
import { assertRequestBodySize, checkRateLimit, noStoreHeaders, verifyTrustedOrigin } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: noStoreHeaders() });
async function adminSession() {
  const session = await getSession({ live: true });
  const access = await staticPermission(session);
  return { session, allowed: Boolean(session && access.admin) };
}
export async function GET() {
  try {
    const { allowed } = await adminSession();
    if (!allowed) return reply({ ok: false, error: "Налаштування доступні лише адміністрації." }, 403);
    const [settings, control] = await Promise.all([getStaticSettings(), fetchDiscordRoleControlSnapshot()]);
    return reply({ ok: true, settings, roles: control.roles, botCanManageRoles: control.botCanManageRoles, warning: control.error || null, guildName: control.guild?.name || null });
  } catch { return reply({ ok: false, error: "Не вдалося перевірити роль адміністратора." }, 503); }
}
export async function POST(request: NextRequest) {
  const large = assertRequestBodySize(request, 4096);
  if (large) return large;
  if (!verifyTrustedOrigin(request)) return reply({ ok: false, error: "Неприпустиме джерело запиту." }, 403);
  try {
    const { session, allowed } = await adminSession();
    if (!allowed || !session) return reply({ ok: false, error: "Немає прав на зміну Discord-ролей." }, 403);
    if (!checkRateLimit(`static-role-config:${session.id}`, 10, 60_000).ok) return reply({ ok: false, error: "Забагато запитів." }, 429);
    const body = await request.json().catch(() => ({}));
    if (typeof body.memberRoleId !== "string" || typeof body.managerRoleId !== "string") return reply({ ok: false, error: "Вибери дві Discord-ролі." }, 400);
    const settings = await saveStaticSettings({ memberRoleId: body.memberRoleId, managerRoleId: body.managerRoleId }, session.id, true);
    return reply({ ok: true, settings });
  } catch (error) { return reply({ ok: false, error: error instanceof Error ? error.message : "Не вдалося зберегти ролі." }, 400); }
}
