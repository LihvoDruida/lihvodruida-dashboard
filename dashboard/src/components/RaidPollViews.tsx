import type { CSSProperties, ReactNode } from "react";
import RaidPollCreateClientForm from "@/components/RaidPollCreateClientForm";
import RaidPollDeleteButton from "@/components/RaidPollDeleteButton";
import RaidPollRecalculateButton from "@/components/RaidPollRecalculateButton";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import type { DashboardSession } from "@/lib/auth";
import type { DiscordRoleOption } from "@/components/DiscordEmbedEditor";
import { hierarchyTitle } from "@/lib/permissions";
import {
  RAID_POLL_DAYS,
  RAID_POLL_TIMES,
  pollAbsentVotersForDay,
  pollVoteCounts,
  pollVotersForDay,
  raidPollAvailabilityLabel,
  raidPollClassColor,
  raidPollDayFullLabel,
  raidPollDifficultyLabel,
  raidPollRoleLabel,
  raidPollSlotSummary,
  raidPollUniqueDayRecommendations,
  raidPollStatusLabel,
  raidPollTitle,
  raidPollRepeatScheduleLabel,
  raidPollVoteSchedule,
  type RaidPollDay,
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

function statusClass(poll: RaidPollItem) {
  return poll.status === "closed" ? "closed" : "published";
}

export function RaidPollPageShell({ user, title, description, children }: { user?: DashboardSession | null; title: string; description: string; children: ReactNode }) {
  return (
    <main className="container raid-page raid-poll-page">
      <section className="dashboard-shell content-shell raid-shell" aria-label="Панель рейд-пулів Mistblossom Vanguard">
        {user ? <DashboardIdentity user={user} activeSection="raids" /> : null}
        <header className="hero panel dashboard-hero raid-dashboard-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Рейд-пули</div>
            <div className="content-hero-status-row">
              <span className="content-mode-pill content-mode-pill--library">{user ? hierarchyTitle(user.role) : "Учасник"}</span>
              <span className="content-hero-path">Discord голосування • Firebase sync • сайт-результати</span>
            </div>
            <h1>{title}</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">{description}</p>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд рейд-пулів"
            summary={[
              { label: "ДЖЕРЕЛО", value: "Сайт", note: "Створення тільки через dashboard" },
              { label: "DISCORD", value: "Vote UI", note: "Бот лише публікує та приймає голоси" },
            ]}
            stats={[
              { label: "ДНІ", value: "7" },
              { label: "ЧАС", value: "19–21" },
              { label: "LIVE", value: "SYNC" },
            ]}
          />
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

export function RaidPollListCard({ poll, canManage = false, relatedPolls = [poll] }: { poll: RaidPollItem; canManage?: boolean; relatedPolls?: RaidPollItem[] }) {
  const counts = pollVoteCounts(poll);
  const activeDays = pollDays(poll);
  const canClose = canManage && poll.status === "open";
  return (
    <article className={`raid-poll-list-card dashboard-list-row raid-poll-list-card--${poll.status}`}>
      <div className="raid-poll-list-card__status" aria-label={`Статус: ${raidPollStatusLabel(poll)}`}>
        {poll.status === "open" ? "Активний" : "Архівний"}
      </div>

      <div className="raid-poll-list-card__body">
        <header className="raid-poll-list-card__header">
          <div className="raid-poll-list-card__badges">
            <span className={`raid-poll-difficulty-badge raid-poll-difficulty-badge--${poll.difficulty}`}>{raidPollDifficultyLabel(poll.difficulty)}</span>
            <span className="raid-poll-id-chip">ID: {shortPollId(poll.id)}</span>
            {poll.autoRepeatWeekly ? <span className="raid-poll-repeat-chip">↻ {raidPollRepeatScheduleLabel(poll)}</span> : null}
          </div>
          <h3><a href={`/polls/${encodeURIComponent(poll.id)}`}>{poll.title}</a></h3>
          <p>{poll.description}</p>
        </header>

        <div className="raid-poll-day-chips" aria-label="Дні рейд-пулу">
          {activeDays.map((day) => <span key={day.value}>{day.label}</span>)}
        </div>

        <dl className="raid-poll-card-metrics">
          <div>
            <dt>Проголосували</dt>
            <dd>{counts.total} {counts.total === 1 ? "гравець" : "гравців"}</dd>
          </div>
          <div>
            <dt>{poll.status === "open" ? "Закривається" : "Завершено"}</dt>
            <dd>{pollCloseLabel(poll)}</dd>
          </div>
          <div>
            <dt>2 рекомендовані дні</dt>
            <dd>{bestDaySummary(poll, relatedPolls)}</dd>
          </div>
          <div>
            <dt>Автоповтор</dt>
            <dd>{raidPollRepeatScheduleLabel(poll)}</dd>
          </div>
        </dl>
      </div>

      <footer className="raid-poll-list-card__actions dashboard-list-actions">
        <a className="btn subtle raid-poll-primary-action" href={`/polls/${encodeURIComponent(poll.id)}`}>Переглянути результати</a>
        {poll.messageUrl ? <a className="btn subtle" href={poll.messageUrl} target="_blank" rel="noreferrer">Discord</a> : null}
        {canManage ? <a className="btn subtle" href={`/polls/${encodeURIComponent(poll.id)}/edit`}>Редагувати</a> : null}
        {canClose ? (
          <form action={`/api/polls/${encodeURIComponent(poll.id)}/close`} method="post" data-confirm-message="Закрити рейд-пул зараз?">
            <button className="btn danger" type="submit">Закрити</button>
          </form>
        ) : null}
      </footer>
    </article>
  );
}

function pollDays(poll: RaidPollItem) {
  const active = poll.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value);
  return RAID_POLL_DAYS.filter((day) => active.includes(day.value));
}

function bestTimeForDay(poll: RaidPollItem, day: RaidPollDay) {
  const counts = pollVoteCounts(poll).dayTimes[day];
  const best = RAID_POLL_TIMES
    .map((time) => ({ time, count: counts[time] || 0 }))
    .sort((a, b) => b.count - a.count || RAID_POLL_TIMES.indexOf(a.time) - RAID_POLL_TIMES.indexOf(b.time))[0];
  return best && best.count > 0 ? `${best.time} · ${best.count}` : "—";
}

function voteDisplayName(vote: RaidPollItem["votes"][number]) {
  return vote.characterName || vote.discordName || "Гравець";
}

function VoteCharacterBadge({ vote }: { vote: RaidPollItem["votes"][number] }) {
  const classColor = raidPollClassColor(vote.characterClass);
  const style = { "--raid-poll-class-color": classColor } as CSSProperties;
  return (
    <span className="raid-poll-character-badge" style={style}>
      <strong>{voteDisplayName(vote)}</strong>
      <small>{[vote.characterSpecName, vote.characterClass, vote.characterRole ? raidPollRoleLabel(vote.characterRole) : null].filter(Boolean).join(" • ") || vote.discordName}</small>
    </span>
  );
}

export function RaidPollResults({ poll, canManage = false, relatedPolls = [poll] }: { poll: RaidPollItem; canManage?: boolean; relatedPolls?: RaidPollItem[] }) {
  const counts = pollVoteCounts(poll);
  const activeDays = pollDays(poll);
  const recommendations = raidPollUniqueDayRecommendations(poll, relatedPolls, 2);
  const bestSlot = recommendations[0] || null;
  return (
    <section className="panel raid-poll-results raid-poll-results--smart">
      <div className="raid-form-section-head raid-poll-detail-head">
        <div>
          <h2>{raidPollTitle(poll)}</h2>
          <p>{poll.description}</p>
        </div>
        <span className={`raid-status-pill ${statusClass(poll)}`}>{raidPollStatusLabel(poll)}</span>
      </div>

      <div className="raid-poll-summary-grid raid-poll-summary-grid--smart">
        <div><strong>{counts.total}</strong><span>Проголосували</span></div>
        <div><strong>{formatDateTime(poll.closesAtMs)}</strong><span>Закриття</span></div>
        <div><strong>{raidPollDifficultyLabel(poll.difficulty)}</strong><span>Складність</span></div>
        <div><strong>{activeDays.map((day) => day.label).join(" • ")}</strong><span>Дні пулу</span></div>
        <div><strong>{raidPollRepeatScheduleLabel(poll)}</strong><span>Автоповтор</span></div>
      </div>

      <section className="raid-poll-recommendation-card" aria-label="Рекомендований день та час рейду">
        <div>
          <span className="eyebrow">Розумний пріоритет</span>
          <h3>2 рекомендовані слоти</h3>
          <p>Розрахунок враховує найраніший зручний час: якщо гравець вказав 19:00, він рахується доступним і на всі пізніші слоти цього дня. Додатково активні голосування розводяться по різних днях: один і той самий день не пропонується різним рейд-пулам. Пріоритет: валідне ядро ролей → мінімум 1 танк і ціль 2 танки → більшість хілів за формулою 1 хіл на 4–5 ДД → максимум ДД → баланс melee/ranged ~40/60 → utility checklist.</p>
        </div>
        <div className="raid-poll-best-slot">
          <strong>{raidPollSlotSummary(bestSlot)}</strong>
          <span>{bestSlot ? `Пріоритет: танки ${bestSlot.tanks}/${bestSlot.requiredTanks} (ціль ${bestSlot.desiredTanks}) → хіли ${bestSlot.healers}/${bestSlot.requiredHealers} ядро (ціль ${bestSlot.desiredHealers}) → ДД ${bestSlot.effectiveDps} (${bestSlot.melee}/${bestSlot.ranged}) → utility ${bestSlot.utilityScore}` : "Потрібні голоси з персонажами, щоб зʼявився нормальний розрахунок."}</span>
        </div>
        <div className="raid-poll-slot-list">
          {recommendations.length ? recommendations.map((slot, index) => (
            <span key={`${slot.day}:${slot.time}`} className={index === 0 ? "is-best" : ""}>
              <b>{index + 1}</b> {raidPollSlotSummary(slot)}
            </span>
          )) : <em>Поки немає доступних унікальних слотів.</em>}
          {recommendations.length === 1 ? <em>Другий день не запропоновано: усі інші сильні дні вже зайняті іншими активними рейд-пулами або не мають голосів.</em> : null}
        </div>
      </section>

      <div className="raid-poll-smart-layout">
        <div className="raid-poll-table-card raid-poll-table-card--wide">
          <div className="raid-poll-card-headline">
            <h3>Розумна матриця день / час</h3>
            <p>Для кожного дня видно доступних, тих хто поставив «Не можу», найсильніший час і конкретних персонажів. Один голос на день означає «з цього часу і пізніше».</p>
          </div>
          <div className="raid-poll-day-matrix">
            {activeDays.map((day) => {
              const available = pollVotersForDay(poll, day.value);
              const absent = pollAbsentVotersForDay(poll, day.value);
              return (
                <article className="raid-poll-day-card" key={day.value}>
                  <header>
                    <span>{day.emoji}</span>
                    <div>
                      <strong>{raidPollDayFullLabel(day.value)}</strong>
                      <small>Найкращий час: {bestTimeForDay(poll, day.value)}</small>
                    </div>
                  </header>
                  <div className="raid-poll-day-stats">
                    <span><strong>{counts.days[day.value]}</strong> можуть</span>
                    <span><strong>{counts.absent[day.value]}</strong> не можуть</span>
                  </div>
                  <div className="raid-poll-time-row" aria-label={`Голоси за часом для ${day.fullLabel}`}>
                    {RAID_POLL_TIMES.map((time) => (
                      <span key={time} className={counts.dayTimes[day.value][time] ? "has-votes" : ""}>{time}<b>{counts.dayTimes[day.value][time]}</b></span>
                    ))}
                  </div>
                  <div className="raid-poll-day-voters">
                    {available.length ? available.map((vote) => {
                      const schedule = raidPollVoteSchedule(vote);
                      return <span key={vote.discordId}>{voteDisplayName(vote)} <b>{raidPollAvailabilityLabel(schedule[day.value])}</b></span>;
                    }) : <em>Доступних поки немає</em>}
                  </div>
                  {absent.length ? (
                    <div className="raid-poll-day-absent">
                      <strong>Не можуть:</strong> {absent.map(voteDisplayName).join(", ")}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        <aside className="raid-poll-table-card raid-poll-discord-sync-card">
          <div className="raid-poll-card-headline">
            <h3>Discord sync</h3>
            <p>Публічний embed оновлюється після підтвердження голосу. Приватний Discord-пульт користувача не плодиться — кнопки й select оновлюють той самий ephemeral flow.</p>
          </div>
          <div className="raid-poll-sync-metrics">
            <span><strong>{poll.messageId ? "ON" : "—"}</strong>Message</span>
            <span><strong>{poll.updatedAt ? formatDateTime(poll.updatedAt) : "—"}</strong>Оновлено</span>
            <span><strong>{poll.autoRepeatWeekly ? "ON" : "—"}</strong>Repeat</span>
          </div>
          {poll.messageUrl ? <a className="btn subtle" href={poll.messageUrl} target="_blank" rel="noreferrer">Відкрити Discord</a> : null}
        </aside>
      </div>

      <div className="raid-poll-voters raid-poll-voters--cards">
        <h3>Усі голоси</h3>
        {poll.votes.length ? poll.votes.map((vote) => {
          const schedule = raidPollVoteSchedule(vote);
          return (
            <div className="raid-poll-voter raid-poll-voter--smart" key={vote.discordId}>
              <VoteCharacterBadge vote={vote} />
              <div className="raid-poll-vote-schedule">
                {activeDays.map((day) => (
                  <span key={day.value} className={schedule[day.value] === "absent" ? "is-absent" : schedule[day.value] ? "is-ready" : ""}>
                    <strong>{day.label}</strong>
                    {raidPollAvailabilityLabel(schedule[day.value])}
                  </span>
                ))}
              </div>
              <small>{vote.guildName} • Discord: {vote.discordName} • {formatDateTime(vote.updatedAt)}</small>
            </div>
          );
        }) : <p className="raid-empty">Голосів поки немає.</p>}
      </div>

      <div className="raid-form-actions">
        <a className="btn subtle" href="/polls">До списку пулів</a>
        {poll.messageUrl ? <a className="btn subtle" href={poll.messageUrl} target="_blank" rel="noreferrer">Відкрити Discord</a> : null}
        {canManage ? <a className="btn subtle" href={`/polls/${encodeURIComponent(poll.id)}/edit`}>Редагувати</a> : null}
        {canManage ? <RaidPollRecalculateButton /> : null}
        {canManage && poll.status === "open" ? (
          <form action={`/api/polls/${encodeURIComponent(poll.id)}/close`} method="post" data-confirm-message="Закрити рейд-пул зараз?">
            <button className="btn danger" type="submit">Закрити голосування</button>
          </form>
        ) : null}
        {canManage ? <RaidPollDeleteButton pollId={poll.id} pollTitle={poll.title} /> : null}
      </div>
    </section>
  );
}
