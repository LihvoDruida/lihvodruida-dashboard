"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import RaidPollActions from "@/components/RaidPollActions";

import ListViewMemory from "@/components/ListViewMemory";
import { listEntryId, listViewUrl } from "@/lib/listViewState";
import { replaceClientListLocation } from "@/lib/clientListLocation";

export type RaidPollCardModel = {
  id: string;
  shortId: string;
  title: string;
  description: string;
  difficulty: string;
  difficultyLabel: string;
  state: "scheduled" | "open" | "paused" | "closed";
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

type TabKey = "all" | "scheduled" | "open" | "paused" | "closed";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "Усі" },
  { key: "scheduled", label: "Заплановані" },
  { key: "open", label: "Активні" },
  { key: "paused", label: "На паузі" },
  { key: "closed", label: "Архів" },
];

function RaidPollCard({
  card,
  canManage,
  selected,
  selectionDisabled,
  onToggle,
}: {
  card: RaidPollCardModel;
  canManage: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  onToggle: (id: string) => void;
}) {
  const href = `/polls/${encodeURIComponent(card.id)}`;
  return (
    <article id={listEntryId("polls", card.id)} data-list-entry="polls" className={`poll-card dashboard-list-row poll-card--${card.state}${selected ? " is-selected" : ""}`}>
      <div className="poll-card__rail" aria-hidden="true" />

      {canManage ? (
        <label className="poll-card__select">
          <input type="checkbox" disabled={selectionDisabled} checked={selected} onChange={() => onToggle(card.id)} />
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
  navigationScope,
}: {
  cards: RaidPollCardModel[];
  canManage?: boolean;
  createHref?: string;
  navigationScope: string;
}) {
  const counts = useMemo(
    () => ({
      all: cards.length,
      scheduled: cards.filter((card) => card.state === "scheduled").length,
      open: cards.filter((card) => card.state === "open").length,
      paused: cards.filter((card) => card.state === "paused").length,
      closed: cards.filter((card) => card.state === "closed").length,
    }),
    [cards],
  );

  const search = useSearchParams();
  const [initialTab] = useState<TabKey>(() => counts.scheduled ? "scheduled" : counts.open ? "open" : counts.paused ? "paused" : counts.closed ? "closed" : "all");
  const filters = new URL(listViewUrl("polls", `/polls?${search}`) || "/polls", "https://list.invalid").searchParams;
  if (!filters.has("tab")) filters.set("tab", search.get("view") === "all" ? "all" : initialTab);
  const currentUrl = listViewUrl("polls", `/polls?${filters}`) || "/polls";
  const tab = (filters.get("tab") || "all") as TabKey;
  const urlQuery = filters.get("q") || "";
  const [query, setQuery] = useState(urlQuery);
  const ownQuery = useRef<string | null>(null);
  useEffect(() => {
    if (ownQuery.current !== urlQuery) setQuery(urlQuery);
    ownQuery.current = null;
  }, [urlQuery]);
  function changeQuery(value: string) {
    setQuery(value); setSelected([]);
    const href = replaceClientListLocation("polls", { q: value });
    ownQuery.current = new URL(href, "https://list.invalid").searchParams.get("q") || "";
  }
  function changeTab(value: TabKey) {
    setSelected([]);
    replaceClientListLocation("polls", { tab: value });
  }
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkPending, setBulkPending] = useState(false);
  const router = useRouter();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (tab !== "all" && card.state !== tab) return false;
      if (!needle) return true;
      return `${card.title} ${card.description} ${card.difficultyLabel} ${card.id}`.toLowerCase().includes(needle);
    });
  }, [cards, tab, query]);

  const visibleIds = new Set(visible.map(card => card.id));
  const visibleSelection = selected.filter(id => visibleIds.has(id));


  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  /**
   * Масові дії йдуть послідовно, а не Promise.all: паралельні виклики
   * вперлися б у rate limit Discord і частина пулів лишилась би
   * неоновленою без жодного сигналу користувачу.
   */
  async function runBulk(kind: "close" | "delete") {
    if (!canManage || bulkPending || !visibleSelection.length) return;
    const scheduledSelected = visible.filter(card => card.state === "scheduled" && visibleSelection.includes(card.id)).length;
    const question = kind === "close"
      ? `Закрити вибрані рейд-пули (${visibleSelection.length})?${scheduledSelected ? `\n\nЗапланованих: ${scheduledSelected}. Їхню публікацію буде скасовано, а автоповтор вимкнено.` : ""}`
      : `Видалити вибрані рейд-пули (${visibleSelection.length})? Дію не можна скасувати.`;
    if (!window.confirm(question)) return;

    setBulkPending(true);
    let done = 0;
    let failed = 0;

    for (const id of visibleSelection) {
      try {
        const response = await fetch(
          kind === "delete" ? `/api/polls/${encodeURIComponent(id)}` : `/api/polls/${encodeURIComponent(id)}/close`,
          {
            method: kind === "delete" ? "DELETE" : "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json", "X-Dashboard-Action": `bulk-${kind}-raid-poll` },
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(45_000),
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

      <ListViewMemory key={navigationScope} kind="polls" scope={navigationScope} currentUrl={currentUrl} />
      <div className="poll-browser__controls">
        <div className="poll-tabs" role="tablist" aria-label="Стан рейд-пулів">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`poll-tab${tab === item.key ? " is-active" : ""}`}
              disabled={bulkPending}
              onClick={() => changeTab(item.key)}
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
            maxLength={160}
            value={query}
            disabled={bulkPending}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Пошук за назвою або складністю"
            autoComplete="off"
          />
        </label>
      </div>

      {canManage && visibleSelection.length ? (
        <div className="poll-bulk" role="region" aria-label="Масові дії">
          <strong>Вибрано: {visibleSelection.length}</strong>
          <button type="button" className="btn subtle" onClick={() => setSelected([])} disabled={bulkPending}>Зняти вибір</button>
          <button type="button" className="btn subtle" onClick={() => setSelected(visible.map((card) => card.id))} disabled={bulkPending}>
            Вибрати всі у вкладці
          </button>
          <button type="button" className="btn danger" onClick={() => runBulk("close")} disabled={bulkPending}>
            {bulkPending ? "Обробляємо…" : tab === "scheduled" ? "Скасувати заплановані" : "Закрити вибрані"}
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
              selected={visibleSelection.includes(card.id)}
              selectionDisabled={bulkPending}
              onToggle={toggle}
            />
          ))
        ) : (
          <p className="poll-empty">
            {query.trim()
              ? "Нічого не знайдено за цим запитом."
              : tab === "all" ? "Рейд-пулів ще немає." : tab === "scheduled"
                ? "Запланованих публікацій немає."
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
