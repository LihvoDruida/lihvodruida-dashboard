import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "roles-remove-disabled");
  if ("error" in guard) return guard.error;

  await auditDiscordAdmin("discord.member.roles.manual_remove_blocked", guard.session, {
    status: "warning",
    summary: "Ручне зняття ролей заблоковано: endpoint вимкнений.",
    endpointDisabled: true,
  });

  return adminDiscordResponse(request, {
    ok: false,
    tone: "warning",
    title: "Ручне зняття ролей вимкнено",
    message: "У /dashboard/discord більше не використовується ручне зняття ролей. Замість цього запусти перевірку Discord-стану профілів або масові ролі за неправильний серверний нік.",
    status: 410,
  });
}
