import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DashboardIdentity from "@/components/DashboardIdentity";
import StaticManageClient from "@/components/static/StaticManageClient";
import { buildPageMetadata } from "@/lib/seo";
export const metadata = buildPageMetadata({ title: "Статик • правила та склад", description: "Правила, запрошення та реєстр рейдового Статика.", path: "/discord/static" });
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function StaticManagePage() {
  const user = await getSession();
  if (!user) redirect("/login?next=%2Fdiscord%2Fstatic");
  return <main className="container app-page"><div className="dashboard-shell content-shell app-page-stack">
    <DashboardIdentity user={user} activeSection="static" />
    <StaticManageClient />
  </div></main>;
}
