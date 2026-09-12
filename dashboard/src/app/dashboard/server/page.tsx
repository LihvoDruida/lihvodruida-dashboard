import { redirect } from "next/navigation";

import AdminTabs from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import ServerStatusDashboard from "@/components/ServerStatusDashboard";
import { getSession } from "@/lib/auth";
import { buildPageMetadata } from "@/lib/seo";
import { getServerStatusSnapshot } from "@/lib/serverStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Стан сервера",
  description: "Приватний моніторинг CPU, RAM, swap, диска та uptime сервера Mistblossom Vanguard.",
  path: "/dashboard/server",
  keywords: ["server monitoring", "cpu", "ram", "disk", "uptime"],
});

export default async function ServerStatusPage() {
  const user = await getSession();
  if (!user) {
    redirect("/login");
  }
  if (!user.isServerOwner) {
    redirect("/access-denied?reason=owner-only&from=/dashboard/server");
  }

  const snapshot = await getServerStatusSnapshot();

  return (
    <main className="container app-page admin-container server-status-container">
      <section className="dashboard-shell content-shell admin-page server-status-page app-page-stack" aria-label="Стан сервера Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="admin" />
        <AdminPageHeader
          eyebrow="Mistblossom Vanguard • Owner only"
          title="Стан сервера"
          description="Живі CPU, RAM, Swap, диск, Docker cache та uptime без запису телеметрії в базу даних."
          metrics={[
            { label: "Хост", value: snapshot.platform.hostname, note: `${snapshot.platform.platform} ${snapshot.platform.arch}` },
            { label: "CPU", value: `${snapshot.cpu.logicalCores} ядра`, note: snapshot.cpu.model },
            { label: "RAM", value: `${Math.round(snapshot.memory.usagePercent)}%`, tone: snapshot.memory.usagePercent >= 85 ? "danger" : snapshot.memory.usagePercent >= 70 ? "warning" : "good" },
            { label: "Диск", value: snapshot.disk.usagePercent === null ? "—" : `${Math.round(snapshot.disk.usagePercent)}%`, tone: (snapshot.disk.usagePercent ?? 0) >= 85 ? "danger" : (snapshot.disk.usagePercent ?? 0) >= 70 ? "warning" : "good" },
          ]}
        />
        <AdminTabs active="server" user={user} />
        <ServerStatusDashboard initialSnapshot={snapshot} />
      </section>
    </main>
  );
}
