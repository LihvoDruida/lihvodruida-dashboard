import type { ReactNode } from "react";
import RaidPollCreateClientForm from "@/components/RaidPollCreateClientForm";
import RaidPollRecalculateButton from "@/components/RaidPollRecalculateButton";
import RaidPollActions from "@/components/RaidPollActions";
import RaidPollBrowser, { type RaidPollCardModel } from "@/components/RaidPollBrowser";
import DashboardIdentity from "@/components/DashboardIdentity";
import type { DashboardSession } from "@/lib/auth";
import type { DiscordRoleOption } from "@/components/DiscordEmbedEditor";
import {
  RAID_POLL_DAYS,
  RAID_POLL_TIMES,
  pollAbsentVotersForDay,
  pollVoteCounts,
  pollVotersForDay,
  raidPollAvailabilityLabel,
  raidPollDayFullLabel,
  raidPollDifficultyLabel,
  raidPollRoleLabel,
  raidPollRoleShortLabel,
  raidPollSlotSummary,
  raidPollUniqueDayRecommendations,
  raidPollStatusLabel,
  raidPollRemainingLabel,
  raidPollStateKey,
  raidPollTitle,
  raidPollRepeatScheduleLabel,
  raidPollVoteSchedule,
  type RaidPollItem,
} from "@/lib/raidPolls";

export type PollChannelOption = { id: string; name: string };

function formatDateTime(isoOrMs: string | number | null | undefined) {
  if (!isoOrMs) return "—";
  const date = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: process.env.RAID_TIME_ZONE || process.env.NEXT_PUBLIC_RAID_TIME_ZONE || "Europe/Kyiv",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function RaidPollPageShell({
  user,
  title,
  description,
  eyebrow = "Mistblossom Vanguard • Голосування",
  stats = [],
  actions,
  activeSection = "polls",
  children,
}: {
  user?: DashboardSession | null;
  title: string;
  description: string;
  eyebrow?: string;
  stats?: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
  activeSection?: "polls" | "raids";
  children: ReactNode;
}) {
  return (
    <main className="container raid-page raid-poll-page poll-page">
      <section className="dashboard-shell content-shell raid-shell" aria-label="Панель рейд-пулів Mistblossom Vanguard">
        {user ? <DashboardIdentity user={user} activeSection={activeSection} /> : null}

        {/* Спрощений херо: один рядок сенсу + компактна стрічка метрик замість
            важкої бічної панелі, яка займала половину першого екрана. */}
        <header className="poll-hero">
          <div className="poll-hero__copy">
            <span className="poll-hero__eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>

          {stats.length ? (
            <dl className="poll-hero__stats">
              {stats.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {actions ? <div className="poll-hero__actions">{actions}</div> : null}
        </header>

        {children}
      </section>
    </main>
  );
}

export function RaidPollCreateForm({ channels, roles = [], discordEnabled }: { channels: PollChannelOption[]; roles?: DiscordRoleOption[]; discordEnabled: boolean }) {
  return <RaidPollCreateClientForm channels={channels} roles={roles} defaultChannelId={channels[0]?.id || ""} disabled={!discordEnabled} />;
}

export function RaidPollEditForm({ poll, channels, roles = [], discordEnabled }: { poll: RaidPollItem; channels: PollChannelOption[]; roles?: DiscordRoleOption[]; discordEnabled: boolean }) {
  return <RaidPollCreateClientForm poll={poll} channels={channels} roles={roles} defaultChannelId={poll.channelId || channels[0]?.id || ""} disabled={!discordEnabled} />;
}

function shortPollId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function pollCloseLabel(poll: RaidPollItem) {
  if (poll.status === "closed") return poll.closedAt ? formatDateTime(poll.closedAt) : "Завершено";
  return formatDateTime(poll.closesAtMs);
}

function bestDaySummary(poll: RaidPollItem, relatedPolls: RaidPollItem[] = [poll]) {
  const recommendations = raidPollUniqueDayRecommendations(poll, relatedPolls, 2);
  if (!recommendations.length) return raidPollSlotSummary(null);
  return recommendations.map((slot, index) => `${index + 1}) ${raidPollSlotSummary(slot)}`).join(" / ");
}

function roleBreakdown(poll: RaidPollItem) {
  let tanks = 0;
  let healers = 0;
  let dps = 0;
  for (const vote of poll.votes) {
    if (vote.role === "tank") tanks += 1;
    else if (vote.role === "healer") healers += 1;
    else if (vote.role === "dps") dps += 1;
  }
  return { tanks, healers, dps };
}

/**
 * Серверна проєкція пулу в легку модель для клієнтського списку.
 * Важкі розрахунки (рекомендації, ролі) лишаються на сервері — у браузер
 * їде тільки готовий текст, а не весь масив голосів.
 */
export function buildRaidPollCardModel(poll: RaidPollItem, relatedPolls: RaidPollItem[] = [poll]): RaidPollCardModel {
  const counts = pollVoteCounts(poll);
  const roles = roleBreakdown(poll);
  const state = raidPollStateKey(poll);

  return {
    id: poll.id,
    shortId: shortPollId(poll.id),
    title: poll.title,
    description: poll.description,
    difficulty: poll.difficulty,
    difficultyLabel: raidPollDifficultyLabel(poll.difficulty),
    state,
    statusLabel: raidPollStatusLabel(poll),
    dayLabels: pollDays(poll).map((day) => day.label),
    votes: counts.total,
    tanks: roles.tanks,
    healers: roles.healers,
    dps: roles.dps,
    deadlineCaption: state === "closed" ? "Завершено" : state === "paused" ? "Заморожено" : "До закриття",
    deadlineLabel: pollCloseLabel(poll),
    remainingLabel: state === "closed" ? "—" : raidPollRemainingLabel(poll),
    recommendation: bestDaySummary(poll, relatedPolls),
    repeatLabel: raidPollRepeatScheduleLabel(poll),
    autoRepeat: Boolean(poll.autoRepeatWeekly),
    pausedNote: poll.pausedNote || null,
    messageUrl: poll.messageUrl || null,
  };
}

export function RaidPollList({
  polls,
  relatedPolls,
  canManage = false,
  createHref = "/polls/new",
}: {
  polls: RaidPollItem[];
  relatedPolls?: RaidPollItem[];
  canManage?: boolean;
  createHref?: string;
}) {
  const related = relatedPolls?.length ? relatedPolls : polls;
  const cards = polls.map((poll) => buildRaidPollCardModel(poll, related));
  return <RaidPollBrowser cards={cards} canManage={canManage} createHref={createHref} />;
}

function pollDays(poll: RaidPollItem) {
  const active = poll.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value);
  return RAID_POLL_DAYS.filter((day) => active.includes(day.value));
}

/**
 * Приймає вже пораховані counts. Раніше функція викликала pollVoteCounts()
 * усередині й запускалась для кожного з 7 днів — сім повних перерахунків
 * матриці голосів на один рендер сторінки.
 */
function bestTimeForDay(counts: Record<string, number>) {
  const best = RAID_POLL_TIMES
    .map((time) => ({ time, count: counts[time] || 0 }))
    .sort((a, b) => b.count - a.count || RAID_POLL_TIMES.indexOf(a.time) - RAID_POLL_TIMES.indexOf(b.time))[0];
  return best && best.count > 0 ? `${best.time} · ${best.count}` : "—";
}

/** Підпис голосу — гільдійний нік Discord. Персонажів у пулі більше немає. */
function voteDisplayName(vote: RaidPollItem["votes"][number]) {
  return vote.discordName || "Гравець";
}

function VoteIdentityBadge({ vote }: { vote: RaidPollItem["votes"][number] }) {
  return (
    <span className="poll-voter__identity">
      <strong>{voteDisplayName(vote)}</strong>
      <span className={`poll-role-chip poll-role-chip--${vote.role || "unset"}`}>{raidPollRoleLabel(vote.role)}</span>
    </span>
  );
}

export function RaidPollResults({ poll, canManage = false, relatedPolls = [poll] }: { poll: RaidPollItem; canManage?: boolean; relatedPolls?: RaidPollItem[] }) {
  const counts = pollVoteCounts(poll);
  const activeDays = pollDays(poll);
  const recommendations = raidPollUniqueDayRecommendations(poll, relatedPolls, 2);
  const bestSlot = recommendations[0] || null;
  const state = raidPollStateKey(poll);
  const roles = roleBreakdown(poll);
  const maxDayVotes = Math.max(1, ...activeDays.map((day) => counts.days[day.value]));
  // Спільний масштаб для смуг годин: інакше день із двома голосами виглядав би
  // так само «повним», як день із двадцятьма.
  const maxSlotVotes = Math.max(1, ...activeDays.flatMap((day) => RAID_POLL_TIMES.map((time) => counts.dayTimes[day.value][time])));

  return (
    <div className={`poll-detail poll-detail--${state}`}>
      {/* Панель керування зверху: статус і всі дії в одному місці,
          щоб не шукати кнопки в кінці довгої сторінки. */}
      <section className="panel poll-detail__bar" aria-label="Керування рейд-пулом">
        <div className="poll-detail__identity">
          <div className="poll-detail__badges">
            <span className={`poll-chip poll-chip--${poll.difficulty}`}>{raidPollDifficultyLabel(poll.difficulty)}</span>
            <span className={`poll-state poll-state--${state}`}>{raidPollStatusLabel(poll)}</span>
            {poll.autoRepeatWeekly ? <span className="poll-chip poll-chip--ghost">↻ {raidPollRepeatScheduleLabel(poll)}</span> : null}
          </div>
          <h2>{raidPollTitle(poll)}</h2>
          <p>{poll.description}</p>
          {state === "paused" ? (
            <p className="poll-detail__paused">
              ⏸ Голосування призупинено{poll.pausedByName ? ` (${poll.pausedByName})` : ""}. Час до закриття заморожено: {raidPollRemainingLabel(poll)}.
              {poll.pausedNote ? ` ${poll.pausedNote}` : ""}
            </p>
          ) : null}
        </div>

        <div className="poll-detail__actions">
          <a className="btn subtle" href="/polls">До списку</a>
          <RaidPollActions
            pollId={poll.id}
            pollTitle={poll.title}
            state={state}
            canManage={canManage}
            editHref={`/polls/${encodeURIComponent(poll.id)}/edit`}
            messageUrl={poll.messageUrl}
            redirectAfterDelete="/polls"
          />
          {canManage ? <RaidPollRecalculateButton /> : null}
        </div>
      </section>

      <section className="poll-metrics" aria-label="Ключові показники">
        <div>
          <span>Проголосували</span>
          <strong>{counts.total}</strong>
          <div className="poll-role-summary">
            <span className="poll-role-chip poll-role-chip--tank">🛡️ {roles.tanks}</span>
            <span className="poll-role-chip poll-role-chip--healer">💚 {roles.healers}</span>
            <span className="poll-role-chip poll-role-chip--dps">⚔️ {roles.dps}</span>
          </div>
        </div>
        <div>
          <span>{state === "closed" ? "Завершено" : state === "paused" ? "Заморожено" : "До закриття"}</span>
          <strong>{state === "closed" ? "—" : raidPollRemainingLabel(poll)}</strong>
          <small>{pollCloseLabel(poll)}</small>
        </div>
        <div>
          <span>Дні пулу</span>
          <strong>{activeDays.map((day) => day.label).join(" · ")}</strong>
          <small>{activeDays.length} з 7</small>
        </div>
        <div>
          <span>Автоповтор</span>
          <strong>{poll.autoRepeatWeekly ? "Увімкнено" : "Вимкнено"}</strong>
          <small>{raidPollRepeatScheduleLabel(poll)}</small>
        </div>
      </section>

      <section className="panel poll-recommendation" aria-label="Рекомендований день та час рейду">
        <div className="poll-recommendation__head">
          <span className="poll-recommendation__eyebrow">Розумний пріоритет</span>
          <h3>Рекомендовані слоти</h3>
        </div>

        <div className="poll-recommendation__body">
          <div className="poll-recommendation__best">
            <strong>{raidPollSlotSummary(bestSlot)}</strong>
            <span>
              {bestSlot
                ? `Танки ${bestSlot.tanks}/${bestSlot.desiredTanks} → хіли ${bestSlot.healers}/${bestSlot.desiredHealers} → всього ${bestSlot.total} → ДД ${bestSlot.effectiveDps}${bestSlot.unknown ? ` → без ролі ${bestSlot.unknown}` : ""}`
                : "Потрібні голоси з вибраною роллю, щоб зʼявився нормальний розрахунок."}
            </span>
          </div>

          <ol className="poll-recommendation__list">
            {recommendations.length
              ? recommendations.map((slot, index) => (
                  <li key={`${slot.day}:${slot.time}`} className={index === 0 ? "is-best" : undefined}>
                    <b>{index + 1}</b>
                    <span>{raidPollSlotSummary(slot)}</span>
                  </li>
                ))
              : <li className="is-empty"><span>Поки немає доступних унікальних слотів.</span></li>}
          </ol>
        </div>

        <details className="poll-recommendation__how">
          <summary>Як рахується пріоритет</summary>
          <p>
            Найраніший зручний час означає доступність і на всі пізніші слоти дня. Активні голосування
            розводяться по різних днях: один день не пропонується двом рейд-пулам.
          </p>
          <p>
            Порядок пріоритету, зверху вниз: <b>зібране ядро</b> (1 танк, 1 хіл, 3 ДД) → <b>два танки</b> →
            <b> хіли</b> до потрібної кількості, далі бонус за запасних (максимум +2) → <b>загальна кількість
            гравців</b> → ДД → штраф за голоси без вибраної ролі. Кожен рівень важливіший за всі нижчі
            разом: день із двома танками виграє в дня з одним, а між двома рівноцінними днями завжди
            перемагає той, де людей більше. Класи й спеки не враховуються — пул питає лише про час і роль.
          </p>
        </details>
      </section>

      <section className="panel poll-matrix" aria-label="Матриця день / час">
        <div className="poll-section-head">
          <h3>Матриця день / час</h3>
          <p>Для кожного дня — доступні, відсутні, найсильніший час і хто саме може.</p>
        </div>

        <div className="poll-matrix__grid">
          {activeDays.map((day) => {
            const available = pollVotersForDay(poll, day.value);
            const absent = pollAbsentVotersForDay(poll, day.value);
            const dayVotes = counts.days[day.value];
            return (
              <article className="poll-day" key={day.value}>
                <header className="poll-day__head">
                  <strong>{raidPollDayFullLabel(day.value)}</strong>
                  <small>Найкращий час: {bestTimeForDay(counts.dayTimes[day.value])}</small>
                </header>

                <div className="poll-day__bar" aria-hidden="true">
                  <i style={{ width: `${Math.round((dayVotes / maxDayVotes) * 100)}%` }} />
                </div>

                <div className="poll-day__stats">
                  <span className="is-ready"><b>{dayVotes}</b> можуть</span>
                  <span className="is-absent"><b>{counts.absent[day.value]}</b> не можуть</span>
                </div>

                {/* Смуга всередині слота дає побачити розподіл по годинах
                    без читання цифр — головне, за чим сюди заходять. */}
                <ul className="poll-day__times">
                  {RAID_POLL_TIMES.map((time) => {
                    const value = counts.dayTimes[day.value][time];
                    const fill = maxSlotVotes ? Math.round((value / maxSlotVotes) * 100) : 0;
                    return (
                      <li key={time} className={value ? "has-votes" : undefined}>
                        <i className="poll-day__times-fill" style={{ width: `${fill}%` }} aria-hidden="true" />
                        <span>{time}</span>
                        <b>{value}</b>
                      </li>
                    );
                  })}
                </ul>

                <div className="poll-day__voters">
                  {available.length
                    ? available.map((vote) => {
                        const schedule = raidPollVoteSchedule(vote);
                        return (
                          <span key={vote.discordId}>
                            {voteDisplayName(vote)}
                            <i className={`poll-role-dot poll-role-dot--${vote.role || "unset"}`} aria-hidden="true" />
                            <em>{raidPollRoleShortLabel(vote.role)}</em>
                            <b>{raidPollAvailabilityLabel(schedule[day.value])}</b>
                          </span>
                        );
                      })
                    : <em>Доступних поки немає</em>}
                </div>

                {absent.length ? (
                  <p className="poll-day__absent"><strong>Не можуть:</strong> {absent.map(voteDisplayName).join(", ")}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel poll-sync" aria-label="Discord-синхронізація">
        <div className="poll-section-head">
          <h3>Discord</h3>
          <p>Публічний embed оновлюється лише коли стан справді змінився — зайві PATCH не витрачають ліміт Discord.</p>
        </div>

        <div className="poll-sync__metrics">
          <div>
            <span>Повідомлення</span>
            <strong>{poll.messageId ? "Опубліковано" : "Немає"}</strong>
          </div>
          <div>
            <span>Оновлено</span>
            <strong>{poll.updatedAt ? formatDateTime(poll.updatedAt) : "—"}</strong>
          </div>
          <div>
            <span>Кнопки голосування</span>
            <strong>{state === "open" ? "Активні" : state === "paused" ? "Пауза" : "Вимкнені"}</strong>
          </div>
        </div>

        {poll.messageUrl ? <a className="btn subtle" href={poll.messageUrl} target="_blank" rel="noreferrer">Відкрити в Discord</a> : null}
      </section>

      <section className="panel poll-voters" aria-label="Усі голоси">
        <div className="poll-section-head">
          <h3>Усі голоси</h3>
          <p>{counts.total ? `${counts.total} записів, останні зміни зверху.` : "Голосів поки немає."}</p>
        </div>

        {poll.votes.length ? (
          <div className="poll-voters__list">
            {poll.votes.map((vote) => {
              const schedule = raidPollVoteSchedule(vote);
              return (
                <article className="poll-voter" key={vote.discordId}>
                  <VoteIdentityBadge vote={vote} />
                  <div className="poll-voter__schedule">
                    {activeDays.map((day) => (
                      <span
                        key={day.value}
                        className={schedule[day.value] === "absent" ? "is-absent" : schedule[day.value] ? "is-ready" : undefined}
                      >
                        <strong>{day.label}</strong>
                        {raidPollAvailabilityLabel(schedule[day.value])}
                      </span>
                    ))}
                  </div>
                  <small className="poll-voter__meta">Оновлено {formatDateTime(vote.updatedAt)}</small>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="poll-empty">Ніхто ще не проголосував. Перевір, що embed опубліковано в потрібному каналі.</p>
        )}
      </section>
    </div>
  );
}
