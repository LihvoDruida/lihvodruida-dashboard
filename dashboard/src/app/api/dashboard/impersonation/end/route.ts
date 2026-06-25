import { NextRequest, NextResponse } from "next/server";
import { getSession, setSession } from "@/lib/auth";
import { applyAccessGroupToSession, recordAdminAudit, resolveAccessGroupFromDiscord } from "@/lib/accessGroups";
import { fetchDiscordGuildMemberSnapshot, fetchDiscordGuildSnapshot } from "@/lib/discordAdmin";
import { noStoreHeaders } from "@/lib/security";
import { dashboardToastCookie } from "@/lib/serverToasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.impersonatedBy || session.provider !== "discord") {
    return NextResponse.redirect(new URL("/", request.url), { status: 303, headers: noStoreHeaders() });
  }

  try {
    const [member, guild] = await Promise.all([
      fetchDiscordGuildMemberSnapshot(session.id),
      fetchDiscordGuildSnapshot().catch(() => null),
    ]);
    const resolved = await resolveAccessGroupFromDiscord(member.roleIds || [], session.id, guild?.ownerId || null);
    await setSession(applyAccessGroupToSession({ ...session, discordRoleIds: member.roleIds || [], impersonatedBy: undefined }, resolved.group, resolved.isServerOwner));
    await recordAdminAudit("access_group.impersonate.end", session, {
      status: "success",
      summary: `Завершено перегляд як інша група. Повернення до ${resolved.group.name}.`,
      restoredGroupId: resolved.group.id,
      restoredGroupName: resolved.group.name,
      restoredRole: resolved.group.role,
    }).catch(() => false);
  } catch (error) {
    await setSession({ ...session, impersonatedBy: undefined });
    await recordAdminAudit("access_group.impersonate.end", session, {
      status: "warning",
      summary: "Перегляд як інша група завершено, але Discord-ролі не вдалося перечитати. Сесію повернуто без impersonation.",
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
  }

  const response = NextResponse.redirect(new URL("/dashboard/groups", request.url), { status: 303, headers: noStoreHeaders() });
  response.headers.append("Set-Cookie", dashboardToastCookie({ tone: "success", title: "Перегляд завершено", message: "Повернули реальні права твого акаунта." }));
  return response;
}
