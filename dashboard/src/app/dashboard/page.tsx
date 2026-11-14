import { managementItems, canAccessManagement } from "@/lib/navigation/management";
import ManagementShell from "@/components/management/ManagementShell";
import Link from "next/link";
import { redirect } from "next/navigation";
import AdminPageHeader from "@/components/AdminPageHeader";
import IntegrationStatusPanel from "@/components/IntegrationStatusPanel";
import AutomationOverview from "@/components/AutomationOverview";
import { getAutomationOverview } from "@/lib/automationOverview";
import { getSession } from "@/lib/auth";
import { canManageDiscordMembers, isDashboardStaff } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({
  title: "Керування", description: "Стан системи та швидкий доступ до адміністративних задач.", path: "/dashboard",
});

export default async function AdminOverviewPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard");
  const discord = canManageDiscordMembers(user);
  if (!canAccessManagement(user)) redirect("/access-denied?reason=admin&from=/dashboard");
  const automationOverview = discord ? await getAutomationOverview().catch(() => null) : null;
  const actions = managementItems(user).filter(item => item.key !== "overview");
  return <ManagementShell user={user} active="overview" className="">
      <AdminPageHeader eyebrow="Mistblossom Vanguard • Керування" title="Центр керування"
        description="Обирай конкретне завдання. Доступні лише розділи, дозволені твоєю актуальною групою Discord."
        metrics={[
          { label: "Група", value: user.groupName || user.role, tone: "good" },
          { label: "Доступні розділи", value: String(actions.length) },
          { label: "Discord", value: discord ? "Керування" : "Лише перегляд" },
        ]} />
      
      <section className="panel management-hub" aria-labelledby="management-hub-title">
        <header className="management-hub__header"><h2 id="management-hub-title">Робочі розділи</h2>
          <p>Налаштування доступу, Discord, профілі та система тепер відокремлені один від одного.</p></header>
        <div className="management-hub__grid">
          {actions.map(action => <Link className="management-hub__link" key={action.href} href={action.href}>
            <strong>{action.label}</strong><small>{action.description}</small><span aria-hidden="true">→</span>
          </Link>)}
        </div>
      </section>
      {isDashboardStaff(user) ? <section className="panel" aria-label="Стан інтеграцій"><h2>Інтеграції</h2><IntegrationStatusPanel compact /></section> : null}
      {automationOverview ? <AutomationOverview overview={automationOverview} /> : null}
    </ManagementShell>;
}
