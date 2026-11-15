import {pollVoteCounts,raidPollStateKey,raidPollStatusLabel,raidPollRemainingLabel,raidPollRepeatScheduleLabel,raidPollDifficultyLabel,type RaidPollItem} from "@/lib/raidPolls";
import {roleBreakdown,pollDays,pollCloseLabel,formatDateTime} from "@/lib/raidPollPresentation";
import DataCard from "@/components/page/DataCard";
import StatusBadge from "@/components/page/StatusBadge";
import Notice from "@/components/page/Notice";
import PageSection from "@/components/page/PageSection";
import DropdownMenu from "@/components/ui/DropdownMenu";
import RaidPollActions from "@/components/RaidPollActions";
import RaidPollRecalculateButton from "@/components/RaidPollRecalculateButton";
import PollRecommendations from "./PollRecommendations";
import PollAvailabilityMatrix from "./PollAvailabilityMatrix";
import PollVotes from "./PollVotes";
import styles from "./poll-workspace.module.css";
export default function PollResults({poll,canManage = false,relatedPolls = [poll],relatedUnavailable = false}: {poll: RaidPollItem;canManage?: boolean;relatedPolls?: RaidPollItem[];relatedUnavailable?: boolean}) {
  const counts = pollVoteCounts(poll), state = raidPollStateKey(poll), roles = roleBreakdown(poll), days = pollDays(poll);
  return <div className={styles.stack}>
    <DataCard title="Стан голосування" badge={<StatusBadge tone={state === "open" ? "success" : state === "closed" ? "neutral" : "warning"}>{raidPollStatusLabel(poll)}</StatusBadge>}
      actions={<><RaidPollActions pollId={poll.id} pollTitle={poll.title} state={state} canManage={canManage} editHref={`/polls/${encodeURIComponent(poll.id)}/edit`} messageUrl={poll.messageUrl} redirectAfterDelete="/polls" />{canManage ? <DropdownMenu label="Перерахунок" closeOnAction={false}><RaidPollRecalculateButton /></DropdownMenu> : null}</>}>
      <div className={styles.stack}><StatusBadge>{raidPollDifficultyLabel(poll.difficulty)}</StatusBadge>
      <dl className={styles.facts}><div><dt>Проголосували</dt><dd>{counts.total}<small>Танки {roles.tanks} · хіли {roles.healers} · ДД {roles.dps}</small></dd></div><div><dt>{state === "scheduled" ? "До публікації" : state === "closed" ? "Завершено" : state === "paused" ? "Заморожено" : "До закриття"}</dt><dd>{state === "closed" ? "—" : raidPollRemainingLabel(poll)}<small>{pollCloseLabel(poll)}</small></dd></div><div><dt>Дні пулу</dt><dd>{days.map(day => day.label).join(" · ")}<small>{days.length} із 7</small></dd></div><div><dt>Автоповтор</dt><dd>{poll.autoRepeatWeekly ? "Увімкнено" : "Вимкнено"}<small>{raidPollRepeatScheduleLabel(poll)}</small></dd></div></dl>
      </div>
    </DataCard>
    {state === "scheduled" ? <Notice title="Публікацію заплановано">Публікація в Discord: {formatDateTime(poll.scheduledPublishAtMs || poll.scheduledPublishAt)}. Відлік до закриття почнеться після успішної публікації.</Notice> : null}
    {canManage && state === "scheduled" && poll.scheduledPublishLastError ? <Notice title="Публікація потребує уваги" tone="warning">{poll.scheduledPublishLastErrorAt ? `Остання спроба: ${formatDateTime(poll.scheduledPublishLastErrorAt)}. ` : ""}{poll.scheduledPublishLastError} Автоматична спроба повториться пізніше.</Notice> : null}
    {state === "paused" ? <Notice title="Голосування призупинено">{poll.pausedByName ? `Призупинив: ${poll.pausedByName}. ` : ""}Залишок часу: {raidPollRemainingLabel(poll)}. {poll.pausedNote}</Notice> : null}
    <PollRecommendations poll={poll} relatedPolls={relatedPolls} unavailable={relatedUnavailable} />
    <PollAvailabilityMatrix poll={poll} counts={counts} />
    <PageSection id={`poll-${poll.id}-discord-title`} title="Discord" description="Стан оголошення та можливість голосувати."><dl className={styles.facts}><div><dt>Повідомлення</dt><dd>{poll.messageId ? "Опубліковано" : "Немає"}</dd></div><div><dt>Оновлено</dt><dd>{formatDateTime(poll.updatedAt)}</dd></div><div><dt>Голосування</dt><dd>{state === "open" ? "Активне" : state === "paused" ? "Пауза" : "Вимкнене"}</dd></div></dl></PageSection>
    <PollVotes poll={poll} />
  </div>;
}
