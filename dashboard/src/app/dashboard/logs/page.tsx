import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import AdminTabs from "@/components/AdminTabs";
import StructuredLogsExplorer from "@/components/StructuredLogsExplorer";
import StructuredLogSettingsPanel from "@/components/StructuredLogSettingsPanel";
import { buildPageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/auth";
import { canManageGroups, canViewAdminLogs } from "@/lib/permissions";
import { getStructuredLogOverview, listStructuredLogs } from "@/lib/structuredLogs";
import { getStructuredLogSettings } from "@/lib/logSettings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Журнал системи",
  description: "Структуровані логи Mistblossom: безпека, API, дії, Discord, база та інтеграції.",
  path: "/dashboard/logs",
  keywords: ["журнал", "логи", "безпека", "API", "Discord"],
});

function formatMb(bytes: number) {
  return `${(Math.max(0, bytes) / 1024 / 1024).toLocaleString("uk-UA", { maximumFractionDigits: 1 })} МБ`;
}

export default async function AdminLogsPage() {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canViewAdminLogs(user)) {
    redirect("/access-denied?reason=logs&from=/dashboard/logs");
    throw new Error("Access denied");
  }

  const [items, overview, settings] = await Promise.all([
    listStructuredLogs({ limit: 100, sinceHours: 24 }),
    getStructuredLogOverview(24),
    getStructuredLogSettings(),
  ]);
  const initialNow = new Date().toISOString();
  const canEdit = canManageGroups(user);
  const canTuneStorage = Boolean(user.isServerOwner);

  return (
    <main className="container app-page admin-container">
      <section className="dashboard-shell content-shell admin-page admin-logs-page app-page-stack" aria-label="Журнал системи">
        <DashboardIdentity user={user} activeSection="admin" />
        <AdminPageHeader
          eyebrow="Mistblossom Vanguard • Observability"
          title="Журнал системи"
          description="Локальний структурований журнал із PostgreSQL. Зберігаємо останні 3 дні; API, дії та системні події не дублюються в Discord. У Discord може йти тільки Security."
          metrics={[
            { label: "24 години", value: overview.total.toLocaleString("uk-UA"), note: "структурованих подій" },
            { label: "Помилки", value: overview.errors.toLocaleString("uk-UA"), tone: overview.errors ? "danger" : "good" },
            { label: "Security", value: overview.security.toLocaleString("uk-UA"), tone: overview.security ? "warning" : "good" },
            { label: "Сховище", value: formatMb(overview.storageBytes), note: `ліміт ${settings.maxStorageMb} МБ` },
            { label: "Retention", value: "3 дні", note: `до ${settings.maxRows.toLocaleString("uk-UA")} записів` },
          ]}
        />

        <AdminTabs active="logs" user={user} />

        <StructuredLogsExplorer initialItems={items} initialOverview={overview} settings={settings} initialNow={initialNow} />

        <StructuredLogSettingsPanel
          initialSettings={settings}
          canEdit={canEdit}
          canTuneStorage={canTuneStorage}
        />
      </section>
    </main>
  );
}
