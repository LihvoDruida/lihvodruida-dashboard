import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { staticPermission } from "@/lib/staticRules";
import DashboardIdentity from "@/components/DashboardIdentity";
import { buildPageMetadata } from "@/lib/seo";
import StaticEventsClient from "@/components/static/StaticEventsClient";
export const metadata = buildPageMetadata({ title: "Журнал Статика", description: "Журнал подій і рішень Статика.", path: "/discord/static/events" });
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function StaticEventsClientPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdiscord%2Fstatic%2Fevents");
  const access = await staticPermission(user);
  if (!access.view) redirect("/access-denied?reason=discord&from=/discord/static");
  return <main className="container app-page"><div className="dashboard-shell content-shell app-page-stack">
    <DashboardIdentity user={user} activeSection="static" />
    <StaticEventsClient />
  </div></main>;
}
