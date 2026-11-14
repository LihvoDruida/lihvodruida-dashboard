import Link from "next/link";
import type { DashboardSession } from "@/lib/auth";
import { canManageDiscordMembers, canManageGroups, canViewAdminLogs } from "@/lib/permissions";

export type AdminTabKey = "overview" | "access" | "groups" | "profiles" | "cleanup" | "discord" | "logs" | "server" | "welcome" | "settings";

type NavItem = { key: AdminTabKey; href: string; label: string; description: string; visible: boolean };
export default function AdminTabs({ active, user }: { active: AdminTabKey; user?: DashboardSession | null }) {
  const groups = canManageGroups(user);
  const discord = canManageDiscordMembers(user);
  const logs = canViewAdminLogs(user);
  const owner = Boolean(user?.isServerOwner);
  const sections: Array<{ id: string; title: string; items: NavItem[] }> = [
    { id: "access", title: "Доступ і права", items: [
      { key: "overview", href: "/dashboard", label: "Огляд", description: "Стан і швидкі дії", visible: groups || discord || logs || owner },
      { key: "access", href: "/dashboard/access", label: "Авторизація", description: "Discord → група сайту", visible: groups },
      { key: "groups", href: "/dashboard/groups", label: "Групи", description: "Права й ранги", visible: groups },
    ] },
    { id: "discord", title: "Discord та учасники", items: [
      { key: "discord", href: "/dashboard/discord", label: "Учасники", description: "Ролі й ніки", visible: discord },
      { key: "cleanup", href: "/dashboard/discord/cleanup", label: "Модерація", description: "Виключення за правилами", visible: discord },
      { key: "profiles", href: "/dashboard/profiles", label: "Профілі", description: "Аудит і очищення", visible: owner },
      { key: "welcome", href: "/dashboard/welcome", label: "Привітання", description: "Стартова роль", visible: owner },
      { key: "settings", href: "/dashboard/settings", label: "Статик", description: "Статичні ролі", visible: groups },
    ] },
    { id: "system", title: "Система", items: [
      { key: "server", href: "/dashboard/server", label: "Сервер", description: "Ресурси", visible: owner },
      { key: "logs", href: "/dashboard/logs", label: "Журнали", description: "Аудит і помилки", visible: logs },
    ] },
  ];
  if (!sections.some(section => section.items.some(item => item.visible))) return null;
  return <nav className="management-nav" aria-label="Розділи панелі керування">
    {sections.map(section => {
      const visible = section.items.filter(item => item.visible);
      if (!visible.length) return null;
      return <div className="management-nav-group" key={section.id}>
        <span className="management-nav-label">{section.title}</span>
        <div className="management-nav-links">
          {visible.map(item => <Link key={item.key} href={item.href}
            aria-current={active === item.key ? "page" : undefined}>
            <strong>{item.label}</strong><small>{item.description}</small>
          </Link>)}
        </div>
      </div>;
    })}
  </nav>;
}
