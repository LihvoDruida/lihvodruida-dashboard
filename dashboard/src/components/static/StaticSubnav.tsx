import Link from "next/link";
import styles from "./static.module.css";
const items = [
  { href: "/discord/static", label: "Огляд і склад" },
  { href: "/discord/static/rules", label: "Правила Статика" },
  { href: "/discord/static/events", label: "Журнал подій" },
] as const;
export function StaticSubnav({ active }: { active: typeof items[number]["href"] }) {
  return <nav className={`${styles.subnav} dashboard-subnav`} aria-label="Розділи Статика">
    {items.map((item) => <Link key={item.href} href={item.href} className={active === item.href ? "is-active" : undefined} aria-current={active === item.href ? "page" : undefined}><strong>{item.label}</strong></Link>)}
  </nav>;
}
