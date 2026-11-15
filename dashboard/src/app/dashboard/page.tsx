import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminTabs from "@/components/AdminTabs";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import PageSkeleton from "@/components/page/PageSkeleton";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import DropdownMenu from "@/components/ui/DropdownMenu";
import ManagementDirectory from "@/components/management/overview/ManagementDirectory";
import OverviewAutomations from "@/components/management/overview/OverviewAutomations";
import OverviewIntegrations from "@/components/management/overview/OverviewIntegrations";
import { getSession } from "@/lib/auth";
import { canAccessManagement } from "@/lib/navigation/management";
import { managementOverviewItems, overviewAutomationCount } from "@/lib/managementOverviewModel";
import { normalizeDirectoryFilters } from "@/lib/managementDirectory";
import { isDashboardStaff, dashboardRoleLabel } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Керування", description: "Стан системи та робочі розділи гільдії.", path: "/dashboard" });

type SearchParams = Record<string, string | string[] | undefined>;
const scalar = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard");
  if (!canAccessManagement(user)) redirect("/access-denied?reason=admin&from=/dashboard");
  const params = await searchParams;
  const items = managementOverviewItems(user);
  const automationCount = overviewAutomationCount(user);
  const primary = items.find(item => item.key === "discord") || items[0];
  const secondary = items.filter(item => item.section === "system" && item.key !== primary?.key)
    .map(item => ({ id: item.key, label: item.label, href: item.href }));
  const initialFilters = normalizeDirectoryFilters({ query: scalar(params.q), section: scalar(params.section), sort: scalar(params.sort) });
  return <PageContainer label="Центр керування" navigation={<DashboardIdentity user={user} activeSection="admin" />}
    sidebar={<AdminTabs active="overview" user={user} />}>
    <PageHeader title="Центр керування" eyebrow="Mistblossom Vanguard"
      description="Знайди потрібний інструмент і перевір стан системи. Показано розділи, доступні твоїй групі."
      breadcrumbs={[{ label: "Профіль", href: "/profile" }, { label: "Керування" }]}
      actions={<>
        {primary ? <Link className="btn primary" href={primary.href} prefetch={false}>{primary.label}</Link> : null}
        <DropdownMenu label="Системні розділи" items={secondary} />
      </>}
      metrics={[{ label: "Група доступу", value: user.groupName || dashboardRoleLabel(user.role) }, { label: "Розділи керування", value: items.length }]} />
    <PageSection id="management-directory-title" title="Робочі розділи" description="Пошук і фільтри працюють одразу, без перезавантаження сторінки.">
      <PageErrorBoundary resetKey={user.groupId}>
        <ManagementDirectory items={items} initialFilters={initialFilters} />
      </PageErrorBoundary>
    </PageSection>
    {isDashboardStaff(user) ? <PageErrorBoundary><OverviewIntegrations /></PageErrorBoundary> : null}
    {automationCount ? <Suspense fallback={<PageSkeleton label="Завантаження стану автоматизацій" count={automationCount} />}>
      <OverviewAutomations user={user} />
    </Suspense> : null}
  </PageContainer>;
}
