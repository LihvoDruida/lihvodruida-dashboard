import { redirect } from "next/navigation";

import AdminTabs from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
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
    <main className="container admin-container server-status-container">
      <section className="dashboard-shell content-shell admin-page server-status-page" aria-label="Стан сервера Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="admin" />
        <header className="hero panel admin-hero server-status-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <span className="eyebrow">Mistblossom Vanguard • Owner only</span>
            <h1>Стан сервера</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">Живий моніторинг процесора, кожного логічного ядра, оперативної пам’яті, swap, диска та uptime. Системний API доступний тільки власнику Discord-сервера.</p>
          </div>
          <HeroSidePanel
            ariaLabel="Коротка інформація про сервер"
            summary={[
              { label: "ХОСТ", value: snapshot.platform.hostname, note: `${snapshot.platform.platform} ${snapshot.platform.arch}` },
              { label: "CPU", value: `${snapshot.cpu.logicalCores} ядер`, note: snapshot.cpu.model },
            ]}
            stats={[
              { label: "RAM", value: `${Math.round(snapshot.memory.usagePercent)}%` },
              { label: "ДИСК", value: snapshot.disk.usagePercent === null ? "—" : `${Math.round(snapshot.disk.usagePercent)}%` },
              { label: "UPTIME", value: `${Math.max(0, Math.floor(snapshot.uptime.systemSeconds / 3600))} год` },
            ]}
          />
        </header>
        <AdminTabs active="server" user={user} />
        <ServerStatusDashboard initialSnapshot={snapshot} />
      </section>
    </main>
  );
}
