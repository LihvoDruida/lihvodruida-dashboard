"use client";

import { useMemo, useState } from "react";
import RaidPollPauseButton from "@/components/RaidPollPauseButton";

export type RaidPollCardModel = {
  id: string;
  shortId: string;
  title: string;
  description: string;
  difficulty: string;
  difficultyLabel: string;
  state: "open" | "paused" | "closed";
  statusLabel: string;
  dayLabels: string[];
  votes: number;
  tanks: number;
  healers: number;
  dps: number;
  deadlineCaption: string;
  deadlineLabel: string;
  remainingLabel: string;
  recommendation: string;
  repeatLabel: string;
  autoRepeat: boolean;
  pausedNote: string | null;
  messageUrl: string | null;
};

type TabKey = "open" | "paused" | "closed";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "open", label: "Активні" },
  { key: "paused", label: "На паузі" },
  { key: "closed", label: "Архів" },
];

function RaidPollCard({ card, canManage }: { card: RaidPollCardModel; canManage: boolean }) {
  const href = `/polls/${encodeURIComponent(card.id)}`;
  return (
    <article className={`poll-card poll-card--${card.state}`}>
      <div className="poll-card__rail" aria-hidden="true" />

      <div className="poll-card__main">
        <div className="poll-card__meta">
          <span className={`poll-chip poll-chip--${card.difficulty}`}>{card.difficultyLabel}</span>
          <span className={`poll-state poll-state--${card.state}`}>{card.statusLabel}</span>
          {card.autoRepeat ? <span className="poll-chip poll-chip--ghost" title={`Автоповтор: ${card.repeatLabel}`}>↻ {card.repeatLabel}</span> : null}
          <span className="poll-card__id" title={`ID: ${card.id}`}>{card.shortId}</span>
        </div>

        <h3 className="poll-card__title">
          <a href={href}>{card.title}</a>
        </h3>
        <p className="poll-card__description">{card.description}</p>

        {card.pausedNote ? <p className="poll-card__note">⏸ {card.pausedNote}</p> : null}

        <ul className="poll-card__days" aria-label="Дні рейд-пулу">
          {card.dayLabels.map((day) => (
            <li key={day}>{day}</li>
          ))}
        </ul>
      </div>

      <dl className="poll-card__stats">
        <div>
          <dt>Голоси</dt>
          <dd>
            {card.votes}
            <small>{card.tanks} танк · {card.healers} хіл · {card.dps} дд</small>
          </dd>
        </div>
        <div>
          <dt>{card.deadlineCaption}</dt>
          <dd>
            {card.remainingLabel}
            <small>{card.deadlineLabel}</small>
          </dd>
        </div>
        <div className="poll-card__stats-wide">
          <dt>Рекомендація</dt>
          <dd>
            <span className="poll-card__recommendation">{card.recommendation}</span>
          </dd>
        </div>
      </dl>

      <footer className="poll-card__actions">
        <a className="btn subtle poll-card__primary" href={href}>Результати</a>
        {card.messageUrl ? (
          <a className="btn subtle" href={card.messageUrl} target="_blank" rel="noreferrer">Discord</a>
        ) : null}
        {canManage ? <a className="btn subtle" href={`${href}/edit`}>Редагувати</a> : null}
        {canManage && card.state !== "closed" ? (
          <RaidPollPauseButton pollId={card.id} paused={card.state === "paused"} />
        ) : null}
        {canManage && card.state !== "closed" ? (
          <form action={`/api/polls/${encodeURIComponent(card.id)}/close`} method="post" data-confirm-message="Закрити рейд-пул зараз? Це фінальна дія.">
            <button className="btn danger" type="submit">Закрити</button>
          </form>
        ) : null}
      </footer>
    </article>
  );
}

export default function RaidPollBrowser({
  cards,
  canManage = false,
  createHref,
}: {
  cards: RaidPollCardModel[];
  canManage?: boolean;
  createHref?: string;
}) {
  const counts = useMemo(
    () => ({
      open: cards.filter((card) => card.state === "open").length,
      paused: cards.filter((card) => card.state === "paused").length,
      closed: cards.filter((card) => card.state === "closed").length,
    }),
    [cards],
  );

  // Стартова вкладка — перша непорожня, щоб не відкривати порожній екран.
  const [tab, setTab] = useState<TabKey>(() => {
    if (counts.open) return "open";
    if (counts.paused) return "paused";
    return counts.closed ? "closed" : "open";
  });
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (card.state !== tab) return false;
      if (!needle) return true;
      return `${card.title} ${card.description} ${card.difficultyLabel} ${card.id}`.toLowerCase().includes(needle);
    });
  }, [cards, tab, query]);

  return (
    <section className="panel poll-browser" aria-label="Список рейд-пулів">
      <header className="poll-browser__head">
        <div className="poll-browser__headline">
          <h2>Рейд-пули</h2>
          <p>Голосування за день і час рейду. Створення — через сайт, голоси — через Discord.</p>
        </div>
        {canManage && createHref ? (
          <a className="btn primary poll-browser__create" href={createHref}>Створити рейд-пул</a>
        ) : null}
      </header>

      <div className="poll-browser__controls">
        <div className="poll-tabs" role="tablist" aria-label="Стан рейд-пулів">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`poll-tab${tab === item.key ? " is-active" : ""}`}
              onClick={() => setTab(item.key)}
            >
              <span>{item.label}</span>
              <b>{counts[item.key]}</b>
            </button>
          ))}
        </div>

        <label className="poll-search">
          <span className="sr-only">Пошук рейд-пулу</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Пошук за назвою або складністю"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="poll-list">
        {visible.length ? (
          visible.map((card) => <RaidPollCard key={card.id} card={card} canManage={canManage} />)
        ) : (
          <p className="poll-empty">
            {query.trim()
              ? "Нічого не знайдено за цим запитом."
              : tab === "open"
                ? "Активних рейд-пулів немає."
                : tab === "paused"
                  ? "Немає пулів на паузі."
                  : "Архів порожній."}
          </p>
        )}
      </div>
    </section>
  );
}
