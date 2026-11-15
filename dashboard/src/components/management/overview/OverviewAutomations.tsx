import Link from "next/link";
import type { DashboardSession } from "@/types/auth";
import { getAutomationOverview } from "@/lib/automationOverview";
import { canViewOverviewAutomation, overviewAutomationAction } from "@/lib/managementOverviewModel";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import StatusBadge, { type StatusTone } from "@/components/page/StatusBadge";
import type { AutomationStatus } from "@/lib/automationStatus";
import styles from "./overview.module.css";

const tones: Record<AutomationStatus["state"], StatusTone> = {
  running: "info", waiting: "neutral", paused: "neutral", attention: "warning", unavailable: "danger",
};
function time(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return <time dateTime={value}>{new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }).format(new Date(value))} · Київ</time>;
}
export default async function OverviewAutomations({ user }: { user: DashboardSession }) {
  const overview = await getAutomationOverview().catch(() => null);
  const cards = overview?.cards.filter(card => canViewOverviewAutomation(user, card.id)) || [];
  const unavailable = !overview || (cards.length > 0 && cards.every(card => card.state === "unavailable"));
  return <PageSection id="overview-automations" title="Автоматизації"
    description={overview ? <>Знімок стану на {time(overview.checkedAt)}. Оновлюється разом зі сторінкою.</> : "Стан фонових задач і останні результати."}
    actions={<PageRefreshButton label="Оновити стан" />}>
    {unavailable ? <ErrorState description="Не вдалося прочитати стан фонових задач. Налаштування збережені; спробуй оновити стан пізніше." />
      : !cards.length ? <EmptyState title="Немає доступних автоматизацій" description="Для цієї групи не призначено перегляду фонових задач." />
      : <DataGrid label="Стан фонових задач">
        {cards.map(card => {
          const action = overviewAutomationAction(user, card);
          return <DataCard key={card.id} title={card.title} description={card.reason}
            badge={<StatusBadge tone={tones[card.state]}>{card.label}</StatusBadge>}
            actions={action ? <Link className="btn subtle" href={action.href} prefetch={false}>{action.label}</Link> : null}>
            <dl className={styles.taskDetails}>
              <div><dt>Останній результат</dt><dd>{card.lastResult}{time(card.lastAt)}</dd></div>
              <div><dt>Наступний запуск</dt><dd>{time(card.nextAt)}<span>{card.nextNote}</span></dd></div>
            </dl>
          </DataCard>;
        })}
      </DataGrid>}
  </PageSection>;
}
