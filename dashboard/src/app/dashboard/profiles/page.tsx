import { redirect } from "next/navigation";
import Link from "next/link";
import ManagementPage from "@/components/management/ManagementPage";
import ProfileCleanupForms from "@/components/management/cleanup/ProfileCleanupForms";
import { getSession } from "@/lib/auth";
import { getAccountCleanupAutomationSettings } from "@/lib/accountCleanupAutomation";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Очищення профілів", description: "Перевірка, підтверджене видалення та історія обслуговування профілів.", path: "/dashboard/profiles" });
export default async function ProfileMaintenancePage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard%2Fprofiles");
  if (!user.isServerOwner) redirect("/access-denied?reason=owner-only&from=/dashboard/profiles");
  const cleanupAutomation = await getAccountCleanupAutomationSettings();
  return <ManagementPage user={user} active="profiles" header={{ title: "Очищення профілів", description: "Обслуговування профілів доступне лише власнику Discord-сервера.",
    actions: <Link className="btn subtle" href="/profiles">Каталог профілів</Link> }}>
    <ProfileCleanupForms settings={cleanupAutomation} />
  </ManagementPage>;
}
