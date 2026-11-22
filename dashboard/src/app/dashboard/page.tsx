import { Suspense } from "react";
import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminTabs from "@/components/AdminTabs";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSkeleton from "@/components/page/PageSkeleton";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import OverviewAutomations from "@/components/management/overview/OverviewAutomations";
import OverviewIntegrations from "@/components/management/overview/OverviewIntegrations";
import { getSession } from "@/lib/auth";
import { canAccessManagement } from "@/lib/navigation/management";
import { overviewAutomationCount } from "@/lib/managementOverviewModel";
import { isDashboardStaff, dashboardRoleLabel } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Керування", description: "Стан системи та робочі розділи гільдії.", path: "/dashboard" });

export default async function AdminOverviewPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard");
  if (!canAccessManagement(user)) redirect("/access-denied?reason=admin&from=/dashboard");
  const automationCount = overviewAutomationCount(user);
  return <PageContainer label="Центр керування" navigation={<DashboardIdentity user={user} activeSection="admin" />}
    sidebar={<AdminTabs active="overview" user={user} />}>
    <PageHeader title="Центр керування" eyebrow="Mistblossom Vanguard"
      description="Стан інтеграцій і фонових задач. Розділи керування — у меню ліворуч."
      breadcrumbs={[{ label: "Профіль", href: "/profile" }, { label: "Керування" }]}
      metrics={[{ label: "Група доступу", value: user.groupName || dashboardRoleLabel(user.role) }]} />
    {isDashboardStaff(user) ? <PageErrorBoundary><OverviewIntegrations /></PageErrorBoundary> : null}
    {automationCount ? <Suspense fallback={<PageSkeleton label="Завантаження стану автоматизацій" count={automationCount} />}>
      <OverviewAutomations user={user} />
    </Suspense> : null}
  </PageContainer>;
}
