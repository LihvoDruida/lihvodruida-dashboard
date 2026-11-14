import type { ReactNode } from "react";
import type { DashboardSession } from "@/types/auth";
import AdminTabs, { type AdminTabKey } from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";

/** Geometry lives here; individual pages retain their own server authorization. */
export default function ManagementShell({ user, active, children, className = "", label }: {
  user: DashboardSession;
  active: AdminTabKey;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return <main className="container app-page admin-container">
    <section className={`dashboard-shell content-shell admin-workspace admin-page app-page-stack ${className}`} aria-label={label}>
      <DashboardIdentity user={user} activeSection="admin" />
      <div className="management-workspace-grid">
        <aside className="management-workspace-sidebar" aria-label="Навігація керування">
          <AdminTabs active={active} user={user} />
        </aside>
        <div className="management-workspace-content">{children}</div>
      </div>
    </section>
  </main>;
}
