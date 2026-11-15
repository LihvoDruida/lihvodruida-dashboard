import {raidPollVoteSchedule,raidPollAvailabilityLabel,raidPollRoleLabel,type RaidPollItem} from "@/lib/raidPolls";
import {pollDays,formatDateTime,voteDisplayName} from "@/lib/raidPollPresentation";
import PageSection from "@/components/page/PageSection";
import EmptyState from "@/components/page/EmptyState";
import StatusBadge from "@/components/page/StatusBadge";
import DataTable from "@/components/ui/DataTable";
import styles from "./poll-workspace.module.css";
export default function PollVotes({poll}: {poll: RaidPollItem}) {
  const days = pollDays(poll), votes = [...poll.votes].sort((a,b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0));
  return <PageSection id={`poll-${poll.id}-votes-title`} title="Усі голоси" description={`${votes.length} голосів. Останні зміни зверху.`}>
    {votes.length ? <DataTable caption="Голоси учасників" headings={["Учасник", "Доступність", "Оновлено"]} tableClassName={styles.table}>
      {votes.map(vote => {const schedule = raidPollVoteSchedule(vote); return <tr key={vote.discordId}><th scope="row"><strong>{voteDisplayName(vote)}</strong><small>{raidPollRoleLabel(vote.role)}</small></th>
        <td><div className={styles.actions}>{days.map(day => <StatusBadge key={day.value} tone={schedule[day.value] === "absent" ? "neutral" : schedule[day.value] ? "success" : "neutral"}>{day.label}: {raidPollAvailabilityLabel(schedule[day.value])}</StatusBadge>)}</div></td>
        <td>{formatDateTime(vote.updatedAt)}</td></tr>;})}
    </DataTable> : <EmptyState title="Голосів поки немає" description="Відкрий повідомлення Discord і вкажи доступність. Результат зʼявиться тут." />}
  </PageSection>;
}
