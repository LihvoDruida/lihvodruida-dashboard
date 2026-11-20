import { redirect } from "next/navigation";
import ManagementPage from "@/components/management/ManagementPage";
import Notice from "@/components/page/Notice";
import SystemSettingsClient from "@/components/management/system/SystemSettingsClient";
import { getSession } from "@/lib/auth";
import { canManageSettings } from "@/lib/permissions";
import { envStatus, loadSystemSettings, systemSettingsView } from "@/lib/systemSettings";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Налаштування системи", description: "Робочі параметри панелі та стан конфігурації.", path: "/dashboard/system" });

export default async function SystemSettingsPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard%2Fsystem");
  if (!canManageSettings(user)) redirect("/access-denied?reason=owner&from=/dashboard/system");
  const state = await loadSystemSettings().catch(() => null);
  return <ManagementPage user={user} active="system" header={{
    title: "Налаштування системи",
    description: "Робочі параметри панелі без редагування .env. Секрети й ключі запуску налаштовуються на сервері командою make configure.",
  }}>
    {state
      ? <SystemSettingsClient initial={{ revision: state.revision, updatedAt: state.updatedAt, updatedBy: state.updatedBy, settings: systemSettingsView(state), env: envStatus() }} />
      : <Notice title="Сховище недоступне" tone="danger">Не вдалося прочитати налаштування з PostgreSQL. Спробуй пізніше; нічого не змінено.</Notice>}
  </ManagementPage>;
}
