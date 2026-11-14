import Link from "next/link";
import type { DashboardSession } from "@/lib/auth";

import { MANAGEMENT_SECTIONS, managementItems, type AdminTabKey } from "@/lib/navigation/management";
export type { AdminTabKey } from "@/lib/navigation/management";

export default function AdminTabs({ active, user }: { active: AdminTabKey; user?: DashboardSession | null }) {
  const items = managementItems(user);
  const sections = MANAGEMENT_SECTIONS.map(section => ({
    ...section, items: items.filter(item => item.section === section.id).map(item => ({ ...item, visible: true })),
  }));
  if (!sections.some(section => section.items.some(item => item.visible))) return null;
  return <nav className="management-nav" aria-label="Розділи панелі керування">
    {sections.map(section => {
      const visible = section.items.filter(item => item.visible);
      if (!visible.length) return null;
      return <div className="management-nav-group" key={section.id}>
        <span className="management-nav-label">{section.title}</span>
        <div className="management-nav-links">
          {visible.map(item => <Link key={item.key} href={item.href}
            aria-current={active === item.key ? "page" : undefined}>
            <strong>{item.label}</strong><small>{item.description}</small>
          </Link>)}
        </div>
      </div>;
    })}
  </nav>;
}
