"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { requestRaidPollMutation, raidPollMutationFailure } from "@/lib/raidPollMutation";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useActionFocus } from "@/lib/useActionFocus";
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
          disabled={selectionDisabled}
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
  type ItemResult = { id: string; title: string; outcome: "confirmed" | "partial" | "rejected" | "unconfirmed"; message: string };
  const [results, setResults] = useState<ItemResult[]>([]);
  const [resultKind, setResultKind] = useState<"close" | "delete" | null>(null);
  const [summary, setSummary] = useState("");
  const requests = useDashboardRequests();
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLElement>(bulkPending);
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
  async function runBulk(kind: "close" | "delete", trigger: HTMLElement) {
    if (!canManage || requests.pending("bulk") || bulkPending || !visibleSelection.length) return;
    const scheduledSelected = visible.filter(card => card.state === "scheduled" && visibleSelection.includes(card.id)).length;
    const question = kind === "close"
      ? `Закрити вибрані рейд-пули (${visibleSelection.length})?${scheduledSelected ? `\n\nЗапланованих: ${scheduledSelected}. Їхню публікацію буде скасовано, а автоповтор вимкнено.` : ""}`
      : `Видалити вибрані рейд-пули (${visibleSelection.length})? Дію не можна скасувати.`;
    if (!window.confirm(question)) return;

    const request = requests.begin("bulk", Math.max(45_000, visibleSelection.length * 45_000));
    beginActionFocus(trigger, { preferResult: true });
    setBulkPending(true); setResultKind(kind); setResults([]); setSummary(`Обробляємо: 0 з ${visibleSelection.length}.`);
    const items: ItemResult[] = [];
    try {
      for (const id of visibleSelection) {
        if (!request.current()) return;
        const title = cards.find(card => card.id === id)?.title || id;
        try {
          const data = await requestRaidPollMutation(kind === "delete" ? `/api/polls/${encodeURIComponent(id)}` : `/api/polls/${encodeURIComponent(id)}/close`, {
            method: kind === "delete" ? "DELETE" : "POST", action: `bulk-${kind}-raid-poll`, signal: request.signal, json: kind === "close" ? { action: "close" } : undefined,
          });
          if (!request.current()) return;
          const partial = Boolean(data.warning || data.discordDeleteFailed);
          items.push({ id, title, outcome: partial ? "partial" : "confirmed", message: data.warning || (partial ? "Запис змінено, оновлення Discord потребує перевірки." : "Сервер підтвердив виконання.") });
        } catch (error) {
          if (!request.current()) return;
          items.push({ id, title, ...raidPollMutationFailure(error) });
        }
        setResults([...items]); setSummary(`Оброблено: ${items.length} з ${visibleSelection.length}.`);
      }
      const count = (outcome: ItemResult["outcome"]) => items.filter(item => item.outcome === outcome).length;
      const confirmed = count("confirmed"), partial = count("partial"), rejected = count("rejected"), unconfirmed = count("unconfirmed");
      const message = `Підтверджено: ${confirmed}. Частково: ${partial}. Відхилено: ${rejected}. Не підтверджено: ${unconfirmed}.`;
      setSummary(message);
      // Unknown outcomes must not remain selected for an accidental bulk replay.
      setSelected(items.filter(item => item.outcome === "rejected").map(item => item.id));
      dispatchDashboardToast({ tone: partial || rejected || unconfirmed ? "warning" : "success", title: partial || rejected || unconfirmed ? "Обробку завершено з зауваженнями" : kind === "close" ? "Рейд-пули закрито" : "Рейд-пули видалено", message, ttl: 7200 });
      if (confirmed || partial) router.refresh();
    } finally {
      if (request.current()) setBulkPending(false);
      request.finish();
    }
  }

  return (
    <section ref={scopeRef} className="panel poll-browser dashboard-list-panel" aria-label="Список рейд-пулів" aria-busy={bulkPending}>
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

      <p className="raid-poll-action-result" role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="" data-bulk-result="">{summary}</p>
      {results.length ? <ul className="poll-bulk-results" aria-label="Результати масової дії">{results.map(item => <li key={item.id} data-poll-outcome={item.outcome}><strong>{item.title}</strong><span>{item.message}</span><a href={resultKind === "delete" && (item.outcome === "confirmed" || item.outcome === "partial") ? "/polls" : `/polls/${encodeURIComponent(item.id)}`}>{resultKind === "delete" && (item.outcome === "confirmed" || item.outcome === "partial") ? "До списку рейд-пулів" : "Перевірити стан"}</a></li>)}</ul> : null}
      {canManage && visibleSelection.length ? (
        <div className="poll-bulk" role="region" aria-label="Масові дії">
          <strong>Вибрано: {visibleSelection.length}</strong>
          <button type="button" className="btn subtle" onClick={() => setSelected([])} disabled={bulkPending}>Зняти вибір</button>
          <button type="button" className="btn subtle" onClick={() => setSelected(visible.map((card) => card.id))} disabled={bulkPending}>
            Вибрати всі у вкладці
          </button>
          <button type="button" className="btn danger" onClick={event => void runBulk("close", event.currentTarget)} disabled={bulkPending}>
            {bulkPending ? "Обробляємо…" : tab === "scheduled" ? "Скасувати заплановані" : "Закрити вибрані"}
          </button>
          <button type="button" className="btn danger" onClick={event => void runBulk("delete", event.currentTarget)} disabled={bulkPending}>
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
