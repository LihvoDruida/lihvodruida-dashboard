import type { DashboardSession } from "@/types/auth";
import {
  canManageDiscordMembers, canManageSettings, canViewAccessGroups, canViewAdminLogs,
} from "@/lib/permissions";

export type AdminTabKey = "overview" | "access" | "groups" | "profiles" | "cleanup" | "discord" | "logs" | "server" | "welcome" | "settings" | "system";
type ManagementSection = "access" | "discord" | "system";
export type ManagementItem = {
  key: AdminTabKey;
  section: ManagementSection;
  href: string;
  label: string;
  description: string;
  allowed: (user: DashboardSession | null | undefined) => boolean;
};
const owner = (user: DashboardSession | null | undefined) => Boolean(user?.isServerOwner);

export const MANAGEMENT_SECTIONS: Array<{ id: ManagementSection; title: string }> = [
  { id: "access", title: "Доступ і права" },
  { id: "discord", title: "Discord та учасники" },
  { id: "system", title: "Система" },
];
const items: ManagementItem[] = [
  { key: "access", section: "access", href: "/dashboard/access", label: "Авторизація", description: "Discord-ролі, групи й геообмеження", allowed: canManageSettings },
  { key: "groups", section: "access", href: "/dashboard/groups", label: "Групи доступу", description: "Права, ранги та відповідності", allowed: canViewAccessGroups },
  { key: "discord", section: "discord", href: "/dashboard/discord", label: "Учасники", description: "Ролі, ніки та синхронізація", allowed: canManageDiscordMembers },
  { key: "cleanup", section: "discord", href: "/dashboard/discord/cleanup", label: "Модерація", description: "Перевірка учасників за правилами", allowed: canManageDiscordMembers },
  { key: "profiles", section: "discord", href: "/dashboard/profiles", label: "Очищення профілів", description: "Перевірка, історія й контрольоване видалення", allowed: owner },
  { key: "welcome", section: "discord", href: "/dashboard/welcome", label: "Привітання", description: "Стартова роль і Welcome-картки", allowed: owner },
  { key: "settings", section: "discord", href: "/dashboard/settings", label: "Статик", description: "Ролі учасників і керівників", allowed: canManageSettings },
  { key: "logs", section: "system", href: "/dashboard/logs", label: "Журнали", description: "Помилки, події безпеки й аудит", allowed: canViewAdminLogs },
  { key: "system", section: "system", href: "/dashboard/system", label: "Налаштування", description: "Робочі параметри та стан конфігурації", allowed: canManageSettings },
  { key: "server", section: "system", href: "/dashboard/server", label: "Сервер", description: "Стан і ресурси хоста", allowed: owner },
];

export function canAccessManagement(user: DashboardSession | null | undefined) {
  return items.some(item => item.allowed(user));
}
export function managementItems(user: DashboardSession | null | undefined): ManagementItem[] {
  const allowed = items.filter(item => item.allowed(user));
  return allowed.length ? [
    { key: "overview", section: "access", href: "/dashboard", label: "Огляд", description: "Стан і швидкі дії", allowed: canAccessManagement },
    ...allowed,
  ] : [];
}
