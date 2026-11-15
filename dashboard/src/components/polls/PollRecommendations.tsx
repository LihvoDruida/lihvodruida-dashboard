import type {RaidPollItem} from "@/lib/raidPolls";
import {raidPollUniqueDayRecommendations,raidPollSlotSummary,RAID_POLL_WOW_WEEK_LABEL} from "@/lib/raidPolls";
import PageSection from "@/components/page/PageSection";
import DataCard from "@/components/page/DataCard";
import DataGrid from "@/components/page/DataGrid";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import styles from "./poll-workspace.module.css";
export default function PollRecommendations({poll,relatedPolls,unavailable = false}: {poll: RaidPollItem;relatedPolls: RaidPollItem[];unavailable?: boolean}) {
  const recommendations = unavailable ? [] : raidPollUniqueDayRecommendations(poll,relatedPolls,3);
  return <PageSection id={`poll-${poll.id}-recommendations-title`} title="Рекомендовані слоти" description="До двох основних рейдів і один додатковий. Дні узгоджені з іншими активними пулами.">
    {unavailable ? <ErrorState title="Рекомендації тимчасово недоступні" description="Не вдалося отримати інші активні пули й перевірити перетин днів. Голоси цього пулу доступні нижче." actions={<PageRefreshButton />} />
      : recommendations.length ? <DataGrid label="Рекомендовані день і час">{recommendations.map((slot,index) => <DataCard key={`${slot.day}:${slot.time}`} title={`${index === 2 ? "Додатковий рейд" : `Рейд ${index + 1}`} · ${raidPollSlotSummary(slot)}`}>
        <dl className={styles.facts}><div><dt>Танки</dt><dd>{slot.tanks} / {slot.desiredTanks}</dd></div><div><dt>Хіли</dt><dd>{slot.healers} / {slot.desiredHealers}</dd></div><div><dt>Усього</dt><dd>{slot.total}</dd></div><div><dt>ДД</dt><dd>{slot.effectiveDps}</dd></div>{slot.unknown ? <div><dt>Без вибраної ролі</dt><dd>{slot.unknown}</dd></div> : null}</dl>
      </DataCard>)}</DataGrid> : <EmptyState title="Придатних слотів поки немає" description="Потрібно більше голосів із вибраною роллю та доступністю." />}
    <details className={styles.details}><summary>Як визначається пріоритет</summary><p>WoW-тиждень: {RAID_POLL_WOW_WEEK_LABEL}. Вибраний найраніший час означає доступність і на пізніші слоти цього дня. Один день не пропонується двом активним пулам.</p>
      <p>Спочатку формуються два основні рейди. Субота або неділя отримує місце, якщо є життєздатне ядро й явка не просідає більш ніж приблизно на 40% від найсильнішого дня. Третій рейд є додатковим і за придатності має пріоритет ближче до понеділка або вівторка.</p>
      <p>У межах пріоритету враховуються зібране ядро, танки, хіли, загальна кількість гравців, ДД і голоси без ролі. Класи й спеціалізації не впливають на цей розрахунок.</p>
    </details>
  </PageSection>;
}
