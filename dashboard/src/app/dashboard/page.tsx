import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import AdminTabs from "@/components/AdminTabs";
import IntegrationStatusPanel from "@/components/IntegrationStatusPanel";
import AutomationOverview from "@/components/AutomationOverview";
import { getAutomationOverview } from "@/lib/automationOverview";
import { getSession } from "@/lib/auth";
import { canManageGroups, canManageDiscordMembers, canViewAdminLogs } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({
  title: "Керування", description: "Стан системи та швидкий доступ до адміністративних задач.", path: "/dashboard",
});

export default async function AdminOverviewPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard");
  const groups = canManageGroups(user);
  const discord = canManageDiscordMembers(user);
  const logs = canViewAdminLogs(user);
  if (!groups && !discord && !logs && !user.isServerOwner) redirect("/access-denied?reason=admin&from=/dashboard");
  const automationOverview = discord ? await getAutomationOverview().catch(() => null) : null;
  const actions = [
    { href: "/dashboard/access", title: "Правила входу", description: "Discord-ролі, групи сайту й географія", show: groups },
    { href: "/dashboard/groups", title: "Групи доступу", description: "Ранги та точкові дозволи", show: groups },
    { href: "/dashboard/discord", title: "Discord", description: "Учасники, ролі, ніки, синхронізація", show: discord },
    { href: "/dashboard/profiles", title: "Очищення профілів", description: "Перевірка, історія й контрольоване видалення", show: Boolean(user.isServerOwner) },
    { href: "/dashboard/welcome", title: "Привітання", description: "Стартова роль і Welcome-картки", show: Boolean(user.isServerOwner) },
    { href: "/dashboard/logs", title: "Журнали", description: "Помилки, події безпеки, аудит дій", show: logs },
    { href: "/dashboard/server", title: "Стан сервера", description: "Моніторинг і ресурси хоста", show: Boolean(user.isServerOwner) },
  ].filter(action => action.show);
  return <main className="container app-page admin-container">
    <section className="dashboard-shell content-shell admin-workspace admin-page app-page-stack">
      <DashboardIdentity user={user} activeSection="admin" />
      <AdminPageHeader eyebrow="Mistblossom Vanguard • Керування" title="Центр керування"
        description="Обирай конкретне завдання. Доступні лише розділи, дозволені твоєю актуальною групою Discord."
        metrics={[
          { label: "Група", value: user.groupName || user.role, tone: "good" },
          { label: "Доступні розділи", value: String(actions.length) },
          { label: "Discord", value: discord ? "Керування" : "Лише перегляд" },
        ]} />
      <AdminTabs active="overview" user={user} />
      <section className="panel management-hub" aria-labelledby="management-hub-title">
        <header className="management-hub__header"><h2 id="management-hub-title">Робочі розділи</h2>
          <p>Налаштування доступу, Discord, профілі та система тепер відокремлені один від одного.</p></header>
        <div className="management-hub__grid">
          {actions.map(action => <Link className="management-hub__link" key={action.href} href={action.href}>
            <strong>{action.title}</strong><small>{action.description}</small><span aria-hidden="true">→</span>
          </Link>)}
        </div>
      </section>
      <section className="panel" aria-label="Стан інтеграцій"><h2>Інтеграції</h2><IntegrationStatusPanel compact /></section>
      {automationOverview ? <AutomationOverview overview={automationOverview} /> : null}
    </section>
  </main>;
}
