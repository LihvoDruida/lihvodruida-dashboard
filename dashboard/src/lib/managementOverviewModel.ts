import "server-only";
import type { DashboardSession } from "@/types/auth";
import { managementItems } from "@/lib/navigation/management";
import type { ManagementDirectoryItem } from "@/lib/managementDirectory";
import {
  canManageApplications, canManageDiscordMembers, canManageGroups, canManageRaids,
  canViewAdminLogs, canViewGuildRoster,
} from "@/lib/permissions";
import { AUTOMATION_TASK_IDS } from "@/lib/automationTaskCatalog";
import type { AutomationStatus } from "@/lib/automationStatus";

export function managementOverviewItems(user: DashboardSession): ManagementDirectoryItem[] {
  return managementItems(user).filter(item => item.key !== "overview")
    .map(({ key, href, label, description, section }) => ({ key, href, label, description, section }));
}

export function canViewOverviewAutomation(user: DashboardSession, id: AutomationStatus["id"]): boolean {
  switch (id) {
    case "accounts": return Boolean(user.isServerOwner);
    case "members": case "nicknames": case "onboarding": return canManageDiscordMembers(user);
    case "profile-nicknames": return canManageGroups(user);
    case "application-deliveries": return canManageApplications(user);
    case "log-maintenance": return canViewAdminLogs(user);
    case "guild-sync": return canViewGuildRoster(user);
    case "raid-lifecycle": case "polls": return canManageRaids(user);
    default: return false;
  }
}
export function overviewAutomationAction(user: DashboardSession, card: AutomationStatus): AutomationStatus["action"] | null {
  if (!canViewOverviewAutomation(user, card.id)) return null;
  if (card.id === "accounts") return { href: "/dashboard/profiles", label: "Переглянути очищення профілів" };
  return card.action;
}

export function overviewAutomationCount(user: DashboardSession): number {
  const ids: AutomationStatus["id"][] = ["members", "nicknames", "accounts", ...AUTOMATION_TASK_IDS];
  return ids.filter(id => canViewOverviewAutomation(user, id)).length;
}
