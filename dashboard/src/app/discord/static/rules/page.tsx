import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { staticPermission } from "@/lib/staticRules";
import DashboardIdentity from "@/components/DashboardIdentity";
import { buildPageMetadata } from "@/lib/seo";
import StaticRulesClient from "@/components/static/StaticRulesClient";
export const metadata = buildPageMetadata({ title: "Правила Статика", description: "Окрема сторінка Markdown-правил Статика.", path: "/discord/static/rules" });
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function StaticRulesClientPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdiscord%2Fstatic%2Frules");
  const access = await staticPermission(user);
  if (!access.view) redirect("/access-denied?reason=discord&from=/discord/static");
  return <main className="container app-page"><div className="dashboard-shell content-shell app-page-stack">
    <DashboardIdentity user={user} activeSection="static" />
    <StaticRulesClient />
  </div></main>;
}
