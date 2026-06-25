import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "roles-add-disabled");
  if ("error" in guard) return guard.error;

  await auditDiscordAdmin("discord.member.roles.manual_add_blocked", guard.session, {
    status: "warning",
    summary: "Ручну видачу ролей заблоковано: endpoint вимкнений.",
    endpointDisabled: true,
  });

  return adminDiscordResponse(request, {
    ok: false,
    tone: "warning",
    title: "Ручну видачу ролей вимкнено",
    message: "У /dashboard/discord більше не використовується ручне додавання ролей. Замість цього запусти перевірку Discord-стану профілів або окрему синхронізацію офіцерських ролей.",
    status: 410,
  });
}
