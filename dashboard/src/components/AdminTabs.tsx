import type { DashboardSession } from "@/lib/auth";
import {
  canManageDiscordMembers,
  canManageGroups,
  canViewAdminLogs,
} from "@/lib/permissions";

export type AdminTabKey =
  "overview" | "groups" | "discord" | "recruitment" | "logs" | "server";

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
      key: "recruitment" as const,
      href: "/dashboard/discord/recruitment",
      label: "Автовідповіді",
      description: "Discord-рекрутинг",
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
      description: "CPU · RAM · диск",
      visible: Boolean(user?.isServerOwner),
    },
  ].filter((tab) => tab.visible);

  if (!tabs.length) return null;

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
