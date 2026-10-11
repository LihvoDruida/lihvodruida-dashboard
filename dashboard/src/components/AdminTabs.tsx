import type { DashboardSession } from "@/lib/auth";
import {
  canManageDiscordMembers,
  canManageGroups,
  canViewAdminLogs,
} from "@/lib/permissions";

export type AdminTabKey =
  "overview" | "groups" | "cleanup" | "discord" | "logs" | "server" | "welcome" | "settings";

export default function AdminTabs({
  active,
  user,
}: {
  active: AdminTabKey;
  user?: DashboardSession | null;
}) {
  const canOpenGroups = canManageGroups(user);
  const canOpenDiscord = canManageDiscordMembers(user);
  const canOpenLogs = canViewAdminLogs(user);
  const tabs = [
    {
      key: "overview" as const,
      href: "/dashboard",
      label: "Огляд",
      description: "центр керування",
      visible: canOpenGroups || canOpenDiscord || canOpenLogs,
    },
    {
      key: "settings" as const,
      href: "/dashboard/settings",
      label: "Налаштування",
      description: "ролі Статика",
      visible: canOpenGroups,
    },
    {
      key: "groups" as const,
      href: "/dashboard/groups",
      label: "Групи",
      description: "ролі й доступи",
      visible: canOpenGroups,
    },
    {
      key: "discord" as const,
      href: "/dashboard/discord",
      label: "Discord",
      description: "учасники й ніки",
      visible: canOpenDiscord,
    },
    {
      key: "logs" as const,
      href: "/dashboard/logs",
      label: "Логи",
      description: "результати дій",
      visible: canOpenLogs,
    },
    {
      key: "server" as const,
      href: "/dashboard/server",
      label: "Сервер",
      description: "CPU · RAM · Swap · Docker",
      visible: Boolean(user?.isServerOwner),
    },
    {
      key: "welcome" as const,
      href: "/dashboard/welcome",
      label: "Welcome",
      description: "картки · стартова роль",
      visible: Boolean(user?.isServerOwner),
    },
  ].filter((tab) => tab.visible);

  if (!tabs.length) return null;

  // Logs retain their existing navigation and presentation.
  if (active !== "logs") {
    const sections = [
      { label: "Доступ і склад", keys: ["overview", "groups", "settings"] },
      { label: "Discord та автоматизація", keys: ["discord", "cleanup", "welcome"] },
      { label: "Система", keys: ["server", "logs"] },
    ];
    const managementTabs = [...tabs, { key: "cleanup" as const, href: "/dashboard/discord/cleanup", label: "Очищення", description: "роль та строк", visible: canOpenDiscord }].filter(tab => tab.visible);
    return <nav className="management-nav" aria-label="Розділи керування">
      {sections.map(section => {
        const links = section.keys.map(key => managementTabs.find(tab => tab.key === key)).filter(tab => tab !== undefined);
        return links.length ? <div className="management-nav-group" key={section.label}>
          <span className="management-nav-label">{section.label}</span>
          <div className="management-nav-links">{links.map(tab => <a key={tab.key} href={tab.href}
            aria-current={active === tab.key ? "page" : undefined}>
            <strong>{tab.key === "settings" ? "Статик" : tab.key === "welcome" ? "Привітання" : tab.label}</strong><small>{tab.description}</small>
          </a>)}</div>
        </div> : null;
      })}
    </nav>;
  }


  return (
    <nav className="admin-tabs dashboard-subnav" aria-label="Розділи керування">
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className={active === tab.key ? "is-active" : undefined}
          aria-current={active === tab.key ? "page" : undefined}
        >
          <strong>{tab.label}</strong>
          <small>{tab.description}</small>
        </a>
      ))}
    </nav>
  );
}
