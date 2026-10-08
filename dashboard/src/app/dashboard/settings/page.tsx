import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { staticPermission } from "@/lib/staticRules";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminTabs from "@/components/AdminTabs";
import { buildPageMetadata } from "@/lib/seo";
import StaticRoleSettingsClient from "@/components/static/StaticRoleSettingsClient";
export const metadata = buildPageMetadata({ title: "Налаштування панелі", description: "Discord-ролі Статика, права РЛ та видача ролей.", path: "/dashboard/settings" });
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function StaticRoleSettingsClientPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard%2Fsettings");
  const permissions = await staticPermission(user);
  if (!permissions.admin) redirect("/access-denied?reason=admin&from=/dashboard/settings");
  return <main className="container app-page"><div className="dashboard-shell content-shell app-page-stack">
    <DashboardIdentity user={user} activeSection="admin" />
    <AdminTabs active="settings" user={user} />
    <StaticRoleSettingsClient />
  </div></main>;
}
