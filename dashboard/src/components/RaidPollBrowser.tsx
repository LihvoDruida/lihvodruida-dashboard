"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import RaidPollActions from "@/components/RaidPollActions";

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

function RaidPollCard({
  card,
  canManage,
  selected,
  onToggle,
}: {
  card: RaidPollCardModel;
  canManage: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const href = `/polls/${encodeURIComponent(card.id)}`;
  return (
    <article className={`poll-card dashboard-list-row poll-card--${card.state}${selected ? " is-selected" : ""}`}>
      <div className="poll-card__rail" aria-hidden="true" />

      {canManage ? (
        <label className="poll-card__select">
          <input type="checkbox" checked={selected} onChange={() => onToggle(card.id)} />
          <span className="sr-only">Вибрати «{card.title}»</span>
        </label>
      ) : null}

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

      <footer className="poll-card__actions dashboard-list-actions">
        <RaidPollActions
          pollId={card.id}
          pollTitle={card.title}
          state={card.state}
          canManage={canManage}
          editHref={`${href}/edit`}
          messageUrl={card.messageUrl}
          showView
        />
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
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkPending, setBulkPending] = useState(false);
  const router = useRouter();

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  /**
   * Масові дії йдуть послідовно, а не Promise.all: паралельні виклики
   * вперлися б у rate limit Discord і частина пулів лишилась би
   * неоновленою без жодного сигналу користувачу.
   */
  async function runBulk(kind: "close" | "delete") {
    if (bulkPending || !selected.length) return;
    const question = kind === "close"
      ? `Закрити вибрані рейд-пули (${selected.length})?`
      : `Видалити вибрані рейд-пули (${selected.length})? Дію не можна скасувати.`;
    if (!window.confirm(question)) return;

    setBulkPending(true);
    let done = 0;
    let failed = 0;

    for (const id of selected) {
      try {
        const response = await fetch(
          kind === "delete" ? `/api/polls/${encodeURIComponent(id)}` : `/api/polls/${encodeURIComponent(id)}/close`,
          {
            method: kind === "delete" ? "DELETE" : "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": `bulk-${kind}-raid-poll` },
            credentials: "same-origin",
            cache: "no-store",
            body: kind === "close" ? JSON.stringify({ action: "close" }) : undefined,
          },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.ok === false) failed += 1;
        else done += 1;
      } catch {
        failed += 1;
      }
    }

    dispatchDashboardToast({
      tone: failed ? "warning" : "success",
      title: failed ? "Виконано частково" : kind === "close" ? "Рейд-пули закрито" : "Рейд-пули видалено",
      message: failed ? `Успішно: ${done}, з помилкою: ${failed}.` : `Оброблено ${done}.`,
      ttl: 7200,
    });

    setSelected([]);
    setBulkPending(false);
    router.refresh();
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (card.state !== tab) return false;
      if (!needle) return true;
      return `${card.title} ${card.description} ${card.difficultyLabel} ${card.id}`.toLowerCase().includes(needle);
    });
  }, [cards, tab, query]);

  return (
    <section className="panel poll-browser dashboard-list-panel" aria-label="Список рейд-пулів">
      <header className="poll-browser__head dashboard-list-head">
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

      {canManage && selected.length ? (
        <div className="poll-bulk" role="region" aria-label="Масові дії">
          <strong>Вибрано: {selected.length}</strong>
          <button type="button" className="btn subtle" onClick={() => setSelected([])} disabled={bulkPending}>Зняти вибір</button>
          <button type="button" className="btn subtle" onClick={() => setSelected(visible.map((card) => card.id))} disabled={bulkPending}>
            Вибрати всі у вкладці
          </button>
          <button type="button" className="btn danger" onClick={() => runBulk("close")} disabled={bulkPending}>
            {bulkPending ? "Обробляємо…" : "Закрити вибрані"}
          </button>
          <button type="button" className="btn danger" onClick={() => runBulk("delete")} disabled={bulkPending}>
            {bulkPending ? "Обробляємо…" : "Видалити вибрані"}
          </button>
        </div>
      ) : null}

      <div className="poll-list dashboard-list">
        {visible.length ? (
          visible.map((card) => (
            <RaidPollCard
              key={card.id}
              card={card}
              canManage={canManage}
              selected={selected.includes(card.id)}
              onToggle={toggle}
            />
          ))
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
