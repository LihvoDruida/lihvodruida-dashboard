import "server-only";

import { cache } from "react";
import type { DashboardSession } from "@/types/auth";
import { applyAccessGroupToSession, listAccessGroupsForManagement } from "@/lib/accessGroups";
import { getAuthAccessPolicy } from "@/lib/authAccessPolicy";
import { DASHBOARD_PERMISSION_KEYS } from "@/lib/accessGroupSchema";
import { withTimeout } from "@/lib/runtimeResilience";
import { logDashboardEvent } from "@/lib/security";

/** Request-local deduplication only. A previous request cannot authorize this one. */
const readAuthorizationSnapshot = cache(async () => {
  return withTimeout(Promise.all([
    listAccessGroupsForManagement(),
    getAuthAccessPolicy({ strict: true }),
  ]), 3_000, "authorization snapshot");
});

export async function refreshSessionAuthorization(session: DashboardSession | null): Promise<DashboardSession | null> {
  if (!session || session.provider === "github") return null;
  try {
    const [groups, policy] = await readAuthorizationSnapshot();
    if (session.provider === "token") {
      if (!policy.allowEmergencyTokenLogin || !process.env.ADMIN_DASHBOARD_TOKEN) return null;
      return { ...session, role: "admin", isServerOwner: false, permissions: [...DASHBOARD_PERMISSION_KEYS] };
    }
    if (session.impersonatedBy) {
      const group = groups.find(group => group.id === session.groupId);
      return group?.permissions.includes("dashboard.view")
        ? applyAccessGroupToSession(session, group, false) : null;
    }
    if (session.isServerOwner && policy.allowServerOwner) {
      return { ...session, permissions: [...DASHBOARD_PERMISSION_KEYS] };
    }
    const roles = new Set(session.discordRoleIds || []);
    const mapped = new Set(policy.roleGroupMappings.filter(mapping => roles.has(mapping.roleId)).map(mapping => mapping.groupId));
    const group = groups.filter(group => mapped.has(group.id))
      .sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id))[0];
    if (!group?.permissions.includes("dashboard.view")) return null;
    return applyAccessGroupToSession(session, group, false);
  } catch (error) {
    logDashboardEvent("warn", "auth.authorization_unavailable", undefined, {
      userId: session.id,
      message: error instanceof Error ? error.message : "Authorization unavailable",
    });
    return null;
  }
}
