import type { ReactNode } from "react";
import type { DashboardSession } from "@/types/auth";
import type { AdminTabKey } from "@/lib/navigation/management";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminTabs from "@/components/AdminTabs";
import PageContainer from "@/components/page/PageContainer";
import PageHeader, { type PageHeaderProps } from "@/components/page/PageHeader";

export default function ManagementPage({ user, active, header, children }: {
  user: DashboardSession;
  active: AdminTabKey;
  header: PageHeaderProps;
  children: ReactNode;
}) {
  return <PageContainer label={header.title} navigation={<DashboardIdentity user={user} activeSection="admin" />}
    sidebar={<AdminTabs active={active} user={user} />}>
    <PageHeader {...header} breadcrumbs={header.breadcrumbs || [{ label: "Керування", href: "/dashboard" }, { label: header.title }]} />
    {children}
  </PageContainer>;
}
