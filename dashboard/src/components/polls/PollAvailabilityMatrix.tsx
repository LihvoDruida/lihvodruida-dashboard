import {RAID_POLL_TIMES,pollVotersForDay,pollAbsentVotersForDay,raidPollDayFullLabel,raidPollVoteSchedule,raidPollRoleShortLabel,raidPollAvailabilityLabel,type RaidPollItem,pollVoteCounts} from "@/lib/raidPolls";
import {pollDays,bestTimeForDay,voteDisplayName} from "@/lib/raidPollPresentation";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import Progress from "@/components/page/Progress";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "./poll-workspace.module.css";
export default function PollAvailabilityMatrix({poll,counts}: {poll: RaidPollItem;counts: ReturnType<typeof pollVoteCounts>}) {
  const days = pollDays(poll), maxDay = Math.max(1,...days.map(day => counts.days[day.value]));
  const maxSlot = Math.max(1,...days.flatMap(day => RAID_POLL_TIMES.map(time => counts.dayTimes[day.value][time])));
  return <PageSection id={`poll-${poll.id}-matrix-title`} title="Матриця день / час" description="Єдиний масштаб смуг дозволяє порівнювати явку між днями.">
    <DataGrid label="Доступність за днями">{days.map(day => {
      const available = pollVotersForDay(poll,day.value), absent = pollAbsentVotersForDay(poll,day.value);
      return <DataCard key={day.value} title={raidPollDayFullLabel(day.value)} description={`Найкращий час: ${bestTimeForDay(counts.dayTimes[day.value])}`}>
        <div className={styles.stack}>
          <Progress value={counts.days[day.value]} max={maxDay} label={`Можуть у ${day.label}: ${counts.days[day.value]}`} />
          <div className={styles.actions}><StatusBadge tone="success">Можуть: {counts.days[day.value]}</StatusBadge><StatusBadge>Не можуть: {counts.absent[day.value]}</StatusBadge></div>
          <ul className={styles.times}>{RAID_POLL_TIMES.map(time => <li key={time}><span>{time}</span><Progress value={counts.dayTimes[day.value][time]} max={maxSlot} label={`${day.label} ${time}: ${counts.dayTimes[day.value][time]} гравців`} /><strong>{counts.dayTimes[day.value][time]}</strong></li>)}</ul>
          <details className={styles.details}><summary>Доступні учасники: {available.length}</summary>{available.length ? <ul className={styles.voters}>{available.map(vote => <li key={vote.discordId}><strong>{voteDisplayName(vote)}</strong><span>{raidPollRoleShortLabel(vote.role)} · {raidPollAvailabilityLabel(raidPollVoteSchedule(vote)[day.value])}</span></li>)}</ul> : <p className={styles.metadata}>Доступних учасників поки немає.</p>}</details>
          {absent.length ? <p className={styles.metadata}>Не можуть: {absent.map(voteDisplayName).join(", ")}</p> : null}
        </div>
      </DataCard>;
    })}</DataGrid>
  </PageSection>;
}
