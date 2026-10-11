import "server-only";
import { createHash } from "node:crypto";
import type { DashboardSession } from "@/lib/auth";

export function listNavigationScope(user: DashboardSession): string {
  return createHash("sha256").update(JSON.stringify({
    provider: user.provider, id: user.id, profileId: user.profileId || "", role: user.role,
    group: user.groupId || "", rank: user.groupRank ?? null,
    permissions: [...(user.permissions || [])].sort(), roles: [...(user.discordRoleIds || [])].sort(),
    owner: Boolean(user.isServerOwner), impersonatedBy: user.impersonatedBy || null,
  })).digest("hex");
}
