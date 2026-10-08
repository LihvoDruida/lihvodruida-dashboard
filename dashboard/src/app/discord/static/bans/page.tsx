import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { staticPermission } from "@/lib/staticRules";
import DashboardIdentity from "@/components/DashboardIdentity";
import StaticBansClient from "@/components/static/StaticBansClient";
import { buildPageMetadata } from "@/lib/seo";
export const metadata = buildPageMetadata({ title: "Порушення Статика", description: "Дисциплінарні попередження та тимчасові бани Статика.", path: "/discord/static/bans" });
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function StaticBansPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdiscord%2Fstatic%2Fbans");
  const access = await staticPermission(user);
  if (!access.view) redirect("/access-denied?reason=discord&from=/discord/static");
  return <main className="container app-page"><div className="dashboard-shell content-shell app-page-stack"><DashboardIdentity user={user} activeSection="static" /><StaticBansClient /></div></main>;
}
